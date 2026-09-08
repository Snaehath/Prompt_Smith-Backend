const { EventEmitter } = require("events");
const { Generation, GenerationStatus } = require("../models/Generation");
const ArtifactModel = require("../models/Artifact");
const providerRouter = require("./providerRouter");

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
   * Reconcile interrupted or orphaned jobs on server startup
   */
  async reconcileZombieJobs() {
    try {
      // 1. Mark in-progress jobs that crashed with previous process as failed
      const interrupted = await Generation.updateMany(
        { status: GenerationStatus.RUNNING },
        {
          $set: {
            status: GenerationStatus.FAILED,
            stage: "failed",
            completedAt: new Date(),
            error: {
              code: "SERVER_RESTARTED",
              message: "Generation was interrupted by a server restart and cannot be safely resumed. Please retry.",
              retryable: true
            }
          }
        }
      );

      if (interrupted.modifiedCount > 0) {
        console.log(`[GenerationQueue] Reconciled ${interrupted.modifiedCount} zombie jobs from previous instance.`);
      }

      // 2. Re-enqueue jobs that were waiting in queued state
      const queuedJobs = await Generation.find({ status: GenerationStatus.QUEUED }).sort({ createdAt: 1 });
      for (const job of queuedJobs) {
        const idStr = job._id.toString();
        if (!this.waitingQueue.includes(idStr)) {
          this.waitingQueue.push(idStr);
          this.eventSequences.set(idStr, 0);
        }
      }

      if (queuedJobs.length > 0) {
        console.log(`[GenerationQueue] Recovered ${queuedJobs.length} queued jobs from database.`);
        this.processNext();
      }
    } catch (err) {
      console.error("[GenerationQueue] Startup job reconciliation failed:", err.message);
    }
  }

  /**
   * Enqueue a generation job ID for background processing
   */
  async enqueue(generationId) {
    const id = generationId.toString();
    this.waitingQueue.push(id);
    this.eventSequences.set(id, 0);

    this.emitEvent(id, "queued", {
      status: GenerationStatus.QUEUED,
      stage: "queued",
      progress: 0,
      queuePosition: this.waitingQueue.length
    });

    this.processNext();
  }

  /**
   * Safely cancel an active or queued generation job
   */
  async cancel(generationId, reason = "User requested cancellation") {
    const id = generationId.toString();

    // 1. If still waiting in queue
    const queueIndex = this.waitingQueue.indexOf(id);
    if (queueIndex !== -1) {
      this.waitingQueue.splice(queueIndex, 1);
    }

    // 2. If running, abort HTTP signals downstream
    const abortController = this.activeAbortControllers.get(id);
    if (abortController) {
      abortController.abort();
    }

    // 3. Atomically transition state to CANCELLED (cannot overwrite COMPLETED or FAILED)
    const updated = await Generation.atomicTransition(
      id,
      [GenerationStatus.QUEUED, GenerationStatus.RUNNING],
      GenerationStatus.CANCELLED,
      {
        stage: "cancelled",
        error: { code: "GENERATION_CANCELLED", message: reason, retryable: false }
      }
    );

    this.cleanup(id);

    if (!updated) {
      return { success: false, message: "Job is already completed, failed, or cancelled" };
    }

    this.emitEvent(id, "cancelled", { reason });
    return { success: true, status: GenerationStatus.CANCELLED };
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
   * Emit monotonic SSE event to subscribers
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
        console.error(`[GenerationQueue] Fatal uncaught worker error on job ${nextJobId}:`, err);
      })
      .finally(() => {
        this.runningCount--;
        this.cleanup(nextJobId);
        this.processNext();
      });
  }

  /**
   * Multi-stage generation worker with race-safe atomic state transitions
   */
  async executeJob(generationId, signal) {
    const startTime = Date.now();
    let generation;

    try {
      generation = await Generation.findById(generationId);
      if (!generation) {
        console.error(`[GenerationQueue] Job not found in database: ${generationId}`);
        return;
      }

      if ([GenerationStatus.COMPLETED, GenerationStatus.CANCELLED, GenerationStatus.FAILED].includes(generation.status)) {
        return;
      }

      if (signal.aborted) throw new Error("AbortError");

      // === Stage 1: Running & Prompt Blueprint Expansion ===
      const runningJob = await Generation.atomicTransition(
        generationId,
        [GenerationStatus.QUEUED],
        GenerationStatus.RUNNING,
        { stage: "blueprint_synthesis", progress: 20 }
      );

      if (!runningJob) {
        console.log(`[GenerationQueue] Job ${generationId} transition to RUNNING aborted (already finished or cancelled).`);
        return;
      }

      // Use user's exact detailed prompt directly without internal modification
      let finalPrompt = (generation.input.subject || "").trim();
      const extras = [generation.input.action, generation.input.style, generation.input.context]
        .filter(Boolean)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (extras.length > 0) {
        finalPrompt += `, ${extras.join(", ")}`;
      }

      const blueprint = {
        title: (generation.input.subject || "Generated Art").slice(0, 32).trim(),
        subject: generation.input.subject || "",
        action: generation.input.action || "",
        style: generation.input.style || "",
        context: generation.input.context || "",
        description: generation.input.subject || "",
        prompt: finalPrompt
      };

      if (signal.aborted) throw new Error("AbortError");

      // Update blueprint in DB
      await Generation.findByIdAndUpdate(generationId, {
        $set: { blueprint, stage: "visual_rendering", progress: 40 }
      });

      this.emitEvent(generationId, "blueprint", blueprint);
      this.emitEvent(generationId, "stage", {
        stage: "visual_rendering",
        progress: 40,
        message: `Synthesizing canvas using ${generation.modelId || "FLUX.2"} engine...`
      });

      // === Stage 2: Neural Image Synthesis ===
      const synthResult = await providerRouter.synthesizeImage({
        prompt: blueprint.prompt,
        resolution: generation.input.resolution || "16:9",
        modelId: generation.modelId || "flux-2-klein",
        seed: generation.input.seed,
        signal
      });

      if (signal.aborted) throw new Error("AbortError");
      if (!synthResult || !synthResult.imageUrl) {
        throw new Error("Neural synthesis engine produced empty output");
      }

      const imageUrl = synthResult.imageUrl;

      // === Stage 3: Archiving & Persistence ===
      await Generation.findByIdAndUpdate(generationId, {
        $set: { stage: "archiving", progress: 85 }
      });

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
        imageUrl: imageUrl || null,
        metadata: {
          generationDurationMs: durationMs,
          seed: generation.input.seed
        }
      });

      // Atomically mark COMPLETED (ensures cancellation cannot be overwritten)
      const completedJob = await Generation.atomicTransition(
        generationId,
        [GenerationStatus.RUNNING],
        GenerationStatus.COMPLETED,
        {
          stage: "complete",
          progress: 100,
          image: {
            url: imageUrl,
            mimeType: "image/jpeg",
            width: generation.input.resolution === "16:9" ? 1248 : 1024,
            height: generation.input.resolution === "16:9" ? 832 : 1024
          },
          blueprint,
          fallbackUsed: Boolean(synthResult.fallbackUsed),
          provider: synthResult.provider || "nvidia",
          metadata: {
            generationDurationMs: durationMs,
            seed: generation.input.seed,
            artifactId: artifact._id
          }
        }
      );

      if (!completedJob) {
        console.log(`[GenerationQueue] Job ${generationId} was cancelled during synthesis, completion discarded.`);
        return;
      }

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
        await Generation.atomicTransition(
          generationId,
          [GenerationStatus.QUEUED, GenerationStatus.RUNNING],
          GenerationStatus.CANCELLED,
          {
            stage: "cancelled",
            error: { code: "GENERATION_CANCELLED", message: "Generation aborted by user", retryable: false }
          }
        );
        this.emitEvent(generationId, "cancelled", { reason: "Aborted by user" });
      } else {
        console.error(`[GenerationQueue] Job ${generationId} failed:`, err.message);
        await Generation.atomicTransition(
          generationId,
          [GenerationStatus.QUEUED, GenerationStatus.RUNNING],
          GenerationStatus.FAILED,
          {
            stage: "failed",
            error: {
              code: err.code || "GENERATION_FAILED",
              message: err.message || "Synthesis failed",
              retryable: err.retryable !== false
            }
          }
        );
        this.emitEvent(generationId, "failed", {
          code: err.code || "GENERATION_FAILED",
          message: err.message || "Synthesis failed",
          retryable: err.retryable !== false
        });
      }
    }
  }

  cleanup(generationId) {
    const id = generationId.toString();
    this.activeAbortControllers.delete(id);
    this.eventSequences.delete(id);
  }
}

// Singleton generation queue instance (Concurrency limit: 4)
const generationQueue = new GenerationQueue(4);

module.exports = { generationQueue };
