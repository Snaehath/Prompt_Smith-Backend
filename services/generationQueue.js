const { EventEmitter } = require("events");
const { Generation, GenerationStatus } = require("../models/Generation");
const ArtifactModel = require("../models/Artifact");
const { chatWithGemini } = require("./geminiService");
const { promptSchema } = require("../schemas/promptSchema");
const providerRouter = require("./providerRouter");
const {
  GENERATE_PROMPT_SYSTEM,
  GENERATE_PROMPT_USER
} = require("../utils/prompts");

class GenerationQueue extends EventEmitter {
  constructor(concurrency = 4) {
    super();
    this.concurrency = concurrency;
    this.runningCount = 0;
    this.waitingQueue = []; // Array of generation IDs
    this.activeAbortControllers = new Map(); // jobId -> AbortController
    this.eventSequences = new Map(); // jobId -> current sequence number
  }

  /**
   * Enqueue a generation job ID for background processing
   */
  async enqueue(generationId) {
    this.waitingQueue.push(generationId.toString());
    this.eventSequences.set(generationId.toString(), 0);
    this.emitEvent(generationId.toString(), "queued", {
      status: GenerationStatus.QUEUED,
      progress: 0,
      queuePosition: this.waitingQueue.length
    });
    this.processNext();
  }

  /**
   * Cancel an active or queued generation job
   */
  async cancel(generationId, reason = "User requested cancellation") {
    const id = generationId.toString();

    // 1. If still waiting in queue
    const queueIndex = this.waitingQueue.indexOf(id);
    if (queueIndex !== -1) {
      this.waitingQueue.splice(queueIndex, 1);
      await Generation.findByIdAndUpdate(id, {
        status: GenerationStatus.CANCELLED,
        stage: "cancelled",
        completedAt: new Date(),
        "error.code": "GENERATION_CANCELLED",
        "error.message": reason
      });
      this.emitEvent(id, "cancelled", { reason });
      this.cleanup(id);
      return { success: true, status: GenerationStatus.CANCELLED };
    }

    // 2. If currently running, signal abort
    const abortController = this.activeAbortControllers.get(id);
    if (abortController) {
      abortController.abort();
      await Generation.findByIdAndUpdate(id, {
        status: GenerationStatus.CANCELLED,
        stage: "cancelled",
        completedAt: new Date(),
        "error.code": "GENERATION_CANCELLED",
        "error.message": reason
      });
      this.emitEvent(id, "cancelled", { reason });
      this.cleanup(id);
      return { success: true, status: GenerationStatus.CANCELLED };
    }

    return { success: false, message: "Job not cancellable or already finished" };
  }

  /**
   * Subscribe an SSE client to job events
   */
  subscribe(generationId, callback) {
    const id = generationId.toString();
    const eventName = `job:${id}`;
    this.on(eventName, callback);
    return () => this.off(eventName, callback);
  }

  /**
   * Emit versioned monotonic SSE event
   */
  emitEvent(generationId, eventType, data) {
    const id = generationId.toString();
    const seq = (this.eventSequences.get(id) || 0) + 1;
    this.eventSequences.set(id, seq);

    const payload = {
      id: seq,
      event: eventType,
      data: {
        generationId: id,
        timestamp: new Date().toISOString(),
        ...data
      }
    };

    this.emit(`job:${id}`, payload);
  }

  /**
   * Concurrency-controlled worker loop
   */
  async processNext() {
    if (this.runningCount >= this.concurrency || this.waitingQueue.length === 0) {
      return;
    }

    const nextJobId = this.waitingQueue.shift();
    this.runningCount++;

    const abortController = new AbortController();
    this.activeAbortControllers.set(nextJobId, abortController);

    this.executeJob(nextJobId, abortController.signal)
      .catch((err) => {
        console.error(`[GenerationQueue] Fatal uncaught error on job ${nextJobId}:`, err);
      })
      .finally(() => {
        this.runningCount--;
        this.cleanup(nextJobId);
        this.processNext();
      });
  }

  /**
   * Execute the multi-stage generation state machine
   */
  async executeJob(generationId, signal) {
    const startTime = Date.now();
    let generation;

    try {
      generation = await Generation.findById(generationId);
      if (!generation) {
        console.error(`[GenerationQueue] Job not found: ${generationId}`);
        return;
      }

      if (generation.status === GenerationStatus.CANCELLED) {
        return;
      }

      // Check for early cancellation
      if (signal.aborted) throw new Error("AbortError");

      // === Stage 1: Running & Prompt Blueprint Expansion ===
      await generation.markRunning("blueprint_synthesis", 20);
      this.emitEvent(generationId, "stage", {
        stage: "blueprint_synthesis",
        progress: 20,
        message: "Expanding visual blueprint with Gemini reasoning engine..."
      });

      const userText = GENERATE_PROMPT_USER(
        generation.input.subject,
        generation.input.action,
        generation.input.style,
        generation.input.context,
        generation.input.complexity || 3
      );

      const blueprint = await chatWithGemini(GENERATE_PROMPT_SYSTEM, userText, promptSchema);
      if (signal.aborted) throw new Error("AbortError");

      generation.blueprint = blueprint;
      await generation.updateStage("visual_rendering", 50, { blueprint });

      this.emitEvent(generationId, "blueprint", blueprint);
      this.emitEvent(generationId, "stage", {
        stage: "visual_rendering",
        progress: 50,
        message: `Synthesizing canvas using ${generation.modelId} engine...`
      });

      // === Stage 2: Neural Image Synthesis ===
      const synthResult = await providerRouter.synthesizeImage({
        prompt: blueprint.prompt,
        resolution: generation.input.resolution || "16:9",
        modelId: generation.modelId || "flux-1-dev",
        seed: generation.input.seed,
        signal
      });

      if (signal.aborted) throw new Error("AbortError");
      if (!synthResult || !synthResult.imageUrl) {
        throw new Error("Neural synthesis engine produced empty output");
      }

      const imageUrl = synthResult.imageUrl;
      generation.fallbackUsed = Boolean(synthResult.fallbackUsed);
      generation.provider = synthResult.provider;

      // === Stage 3: Archiving & Persistence ===
      await generation.updateStage("archiving", 85);
      this.emitEvent(generationId, "stage", {
        stage: "archiving",
        progress: 85,
        message: "Persisting blueprint and image artifacts..."
      });

      const durationMs = Date.now() - startTime;

      // Backward compatible Artifact record
      const artifact = await ArtifactModel.create({
        ...blueprint,
        modelId: generation.modelId,
        resolution: generation.input.resolution || "16:9",
        userId: generation.userId,
        imageUrl: imageUrl.startsWith("http") ? imageUrl : null,
        metadata: {
          generationDurationMs: durationMs,
          seed: generation.input.seed
        }
      });

      // Mark Generation completed
      await generation.markCompleted({
        image: {
          url: imageUrl,
          mimeType: "image/jpeg",
          width: generation.input.resolution === "16:9" ? 1248 : 1024,
          height: generation.input.resolution === "16:9" ? 832 : 1024
        },
        blueprint,
        metadata: {
          generationDurationMs: durationMs,
          seed: generation.input.seed,
          artifactId: artifact._id
        }
      });

      // Emit complete
      this.emitEvent(generationId, "complete", {
        generationId,
        status: GenerationStatus.COMPLETED,
        progress: 100,
        imageUrl,
        blueprint,
        artifactId: artifact._id,
        durationMs
      });
    } catch (err) {
      const isAbort = err.name === "AbortError" || err.message === "AbortError" || signal.aborted;

      if (isAbort) {
        console.log(`[GenerationQueue] Job ${generationId} cancelled cleanly.`);
        if (generation) {
          await generation.markCancelled("Generation aborted by user");
        }
        this.emitEvent(generationId, "cancelled", { reason: "Aborted by user" });
      } else {
        console.error(`[GenerationQueue] Job ${generationId} failed:`, err.message);
        if (generation) {
          await generation.markFailed({
            code: "GENERATION_FAILED",
            message: err.message || "Synthesis failed",
            retryable: true
          });
        }
        this.emitEvent(generationId, "failed", {
          code: "GENERATION_FAILED",
          message: err.message || "Synthesis failed",
          retryable: true
        });
      }
    }
  }

  cleanup(generationId) {
    const id = generationId.toString();
    this.activeAbortControllers.delete(id);
  }
}

// Singleton generation queue instance (Concurrency limit: 4)
const generationQueue = new GenerationQueue(4);

module.exports = { generationQueue };
