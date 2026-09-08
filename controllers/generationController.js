const { Generation, GenerationStatus } = require("../models/Generation");
const { generationQueue } = require("../services/generationQueue");
const ApiError = require("../utils/ApiError");

/**
 * Helper to write a formatted Server-Sent Event with monotonic ID
 */
const writeSSE = (res, id, event, data) => {
  res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

/**
 * @desc    Create a new asynchronous image generation job (Decoupled from SSE)
 * @route   POST /api/generations
 */
exports.createGeneration = async (req, res, next) => {
  try {
    const {
      subject,
      action = "",
      style = "",
      context = "",
      complexity = 3,
      resolution = "16:9",
      modelId = "flux-1-dev",
      seed = null
    } = req.body;

    if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
      throw ApiError.badRequest("Subject is required and must be a non-empty string", "INVALID_SUBJECT");
    }

    if (subject.length > 500) {
      throw ApiError.badRequest("Subject exceeds maximum length of 500 characters", "SUBJECT_TOO_LONG");
    }

    const numComplexity = Math.min(Math.max(Number(complexity) || 3, 1), 5);

    // Check Idempotency Key (prevents duplicate billing/generation on network retries)
    const idempotencyKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    if (idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0) {
      const cleanKey = idempotencyKey.trim();
      const existingQuery = { idempotencyKey: cleanKey };
      if (req.user) existingQuery.userId = req.user._id;

      const existingJob = await Generation.findOne(existingQuery);
      if (existingJob) {
        return res.status(200).json({
          jobId: existingJob._id,
          status: existingJob.status,
          stage: existingJob.stage,
          progress: existingJob.progress,
          isDuplicate: true,
          eventsUrl: `/api/generations/${existingJob._id}/events`
        });
      }
    }

    // Persist Generation job in queued state
    const generation = await Generation.create({
      userId: req.user ? req.user._id : null,
      idempotencyKey: idempotencyKey ? idempotencyKey.trim() : null,
      status: GenerationStatus.QUEUED,
      stage: "queued",
      progress: 0,
      input: {
        subject: subject.trim(),
        action: action ? action.trim() : "",
        style: style ? style.trim() : "",
        context: context ? context.trim() : "",
        complexity: numComplexity,
        resolution,
        modelId,
        seed: seed !== null && !isNaN(Number(seed)) ? Number(seed) : null
      },
      modelId,
      metadata: {
        requestId: req.id,
        clientIp: req.ip
      }
    });

    // Enqueue job for background processing
    await generationQueue.enqueue(generation._id);

    res.status(201).json({
      jobId: generation._id,
      status: GenerationStatus.QUEUED,
      stage: "queued",
      progress: 0,
      eventsUrl: `/api/generations/${generation._id}/events`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Pure read-only SSE telemetry listener for a generation job
 *          Reconnecting to this endpoint NEVER initiates a new generation.
 * @route   GET /api/generations/:id/events
 */
exports.getGenerationEvents = async (req, res, next) => {
  try {
    const generation = await Generation.findById(req.params.id);
    if (!generation) {
      throw ApiError.notFound("Generation job not found", "JOB_NOT_FOUND");
    }

    // Configure headers for resilient SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });

    // Reconnection advice: wait 3 seconds before reconnecting
    res.write("retry: 3000\n\n");

    let eventSeq = 1;

    // If job is already in a terminal state when client connects
    if (generation.status === GenerationStatus.COMPLETED) {
      writeSSE(res, eventSeq++, "complete", {
        generationId: generation._id,
        status: generation.status,
        progress: 100,
        imageUrl: generation.image?.url,
        blueprint: generation.blueprint
      });
      return res.end();
    }

    if (generation.status === GenerationStatus.FAILED) {
      writeSSE(res, eventSeq++, "failed", {
        generationId: generation._id,
        status: generation.status,
        error: generation.error
      });
      return res.end();
    }

    if (generation.status === GenerationStatus.CANCELLED) {
      writeSSE(res, eventSeq++, "cancelled", {
        generationId: generation._id,
        status: generation.status,
        reason: generation.error?.message || "Cancelled"
      });
      return res.end();
    }

    // Send initial snapshot
    writeSSE(res, eventSeq++, "stage", {
      generationId: generation._id,
      stage: generation.stage,
      progress: generation.progress,
      status: generation.status
    });

    // Subscribe to live queue events
    const unsubscribe = generationQueue.subscribe(generation._id, (payload) => {
      writeSSE(res, payload.id, payload.event, payload.data);

      // Close stream on terminal events
      if (["complete", "failed", "cancelled"].includes(payload.event)) {
        clearInterval(heartbeatInterval);
        res.end();
      }
    });

    // Heartbeat every 15 seconds to prevent NAT/proxy disconnects
    const heartbeatInterval = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15000);

    // Cleanup on client disconnect
    req.on("close", () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Polling endpoint for job status & result
 * @route   GET /api/generations/:id
 */
exports.getGenerationStatus = async (req, res, next) => {
  try {
    const generation = await Generation.findById(req.params.id);
    if (!generation) {
      throw ApiError.notFound("Generation job not found", "JOB_NOT_FOUND");
    }

    res.status(200).json(generation);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Cancel an in-progress or queued generation job
 * @route   POST /api/generations/:id/cancel
 */
exports.cancelGeneration = async (req, res, next) => {
  try {
    const generation = await Generation.findById(req.params.id);
    if (!generation) {
      throw ApiError.notFound("Generation job not found", "JOB_NOT_FOUND");
    }

    // Ownership check if job belongs to a user
    if (generation.userId && req.user && !generation.userId.equals(req.user._id)) {
      throw ApiError.forbidden("Not authorized to cancel this generation", "UNAUTHORIZED_CANCELLATION");
    }

    const cancelResult = await generationQueue.cancel(
      generation._id,
      req.body.reason || "Client initiated cancellation"
    );

    res.status(200).json({
      jobId: generation._id,
      status: GenerationStatus.CANCELLED,
      ...cancelResult
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List generation history (Paginated)
 * @route   GET /api/generations
 */
exports.listGenerations = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const query = req.user
      ? { $or: [{ userId: req.user._id }, { userId: null }] }
      : { userId: null };

    const [items, total] = await Promise.all([
      Generation.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select("-__v"),
      Generation.countDocuments(query)
    ]);

    res.status(200).json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};
