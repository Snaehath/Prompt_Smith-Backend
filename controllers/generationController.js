const { Generation, GenerationStatus } = require("../models/Generation");
const { generationQueue } = require("../services/generationQueue");
const { createStreamTicket } = require("../middleware/authMiddleware");
const ApiError = require("../utils/ApiError");

/**
 * Helper to write a formatted Server-Sent Event with monotonic ID
 */
const writeSSE = (res, id, event, data) => {
  res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

/**
 * @desc    Create a new asynchronous image generation job (Decoupled & Idempotent)
 * @route   POST /api/generations
 */
exports.createGeneration = async (req, res, next) => {
  try {
    const params = (req.body.parameters && typeof req.body.parameters === "object" && !Array.isArray(req.body.parameters))
      ? req.body.parameters
      : {};

    const {
      subject,
      action = "",
      style = "",
      context = "",
      complexity = 3,
      modelId = "flux-2-klein"
    } = req.body;

    const resolution = req.body.resolution || req.body.aspectRatio || params.aspectRatio || params.resolution || "16:9";
    const rawSteps = req.body.steps !== undefined ? req.body.steps : params.steps;
    const rawSeed = req.body.seed !== undefined ? req.body.seed : params.seed;

    const steps = (rawSteps !== undefined && rawSteps !== null && rawSteps !== "" && !isNaN(Number(rawSteps)))
      ? Number(rawSteps)
      : null;

    // Allow valid integer seed >= 0; omitted/null/undefined handled as null (random)
    const seed = (rawSeed !== undefined && rawSeed !== null && rawSeed !== "" && !isNaN(Number(rawSeed)) && Number(rawSeed) >= 0)
      ? Number(rawSeed)
      : null;

    const numComplexity = Math.min(Math.max(Number(complexity) || 3, 1), 5);

    // Compute deterministic payload hash for idempotency conflict detection
    const payloadHash = Generation.computePayloadHash({
      subject,
      action,
      style,
      context,
      complexity: numComplexity,
      resolution,
      modelId,
      seed
    });

    // Check Idempotency Key
    const idempotencyKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    if (idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0) {
      const cleanKey = idempotencyKey.trim();
      const existingQuery = { idempotencyKey: cleanKey };
      if (req.user) existingQuery.userId = req.user._id;

      const existingJob = await Generation.findOne(existingQuery);
      if (existingJob) {
        // Enforce Idempotency Safety: same key + different payload MUST be rejected!
        if (existingJob.payloadHash && existingJob.payloadHash !== payloadHash) {
          throw ApiError.conflict(
            "Idempotency key was already submitted with a different request payload",
            "IDEMPOTENCY_PAYLOAD_MISMATCH"
          );
        }

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
      payloadHash,
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
        seed: seed !== null && !isNaN(Number(seed)) ? Number(seed) : null,
        steps: steps !== null && !isNaN(Number(steps)) ? Number(steps) : null
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
 * @desc    Issue a short-lived (60s) single-use ticket for native browser EventSource
 * @route   POST /api/generations/:id/ticket
 */
exports.getStreamTicket = async (req, res, next) => {
  try {
    const generation = await Generation.findById(req.params.id);
    if (!generation) {
      throw ApiError.notFound("Generation job not found", "JOB_NOT_FOUND");
    }

    // Enforce ownership if job is bound to a user
    if (generation.userId) {
      if (!req.user || !generation.userId.equals(req.user._id)) {
        throw ApiError.forbidden("Not authorized to access stream for this generation", "UNAUTHORIZED_ACCESS");
      }
    }

    const ticket = createStreamTicket(req.user?._id, generation._id, 60);

    res.status(200).json({
      ticket,
      expiresIn: 60,
      eventsUrl: `/api/generations/${generation._id}/events?ticket=${encodeURIComponent(ticket)}`
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

    // IDOR Security: Enforce ownership check if generation belongs to a registered user
    if (generation.userId) {
      if (!req.user || !generation.userId.equals(req.user._id)) {
        throw ApiError.forbidden("Access denied to this generation", "UNAUTHORIZED_ACCESS");
      }
    }

    // Configure headers for resilient SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    // Reconnection advice for browser EventSource
    res.write("retry: 3000\n\n");

    let eventSeq = 1;
    const lastEventId = req.headers["last-event-id"];
    if (lastEventId) {
      eventSeq = Number(lastEventId) + 1;
    }

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

    // Send initial snapshot so client recovers state immediately upon connect/reconnect
    writeSSE(res, eventSeq++, "stage", {
      generationId: generation._id,
      stage: generation.stage,
      progress: generation.progress,
      status: generation.status
    });

    if (generation.blueprint) {
      writeSSE(res, eventSeq++, "blueprint", generation.blueprint);
    }

    // Subscribe to live queue events
    const unsubscribe = generationQueue.subscribe(generation._id, (payload) => {
      writeSSE(res, payload.id, payload.event, payload.data);

      // Close stream cleanly on terminal events
      if (["complete", "failed", "cancelled"].includes(payload.event)) {
        clearInterval(heartbeatInterval);
        res.end();
      }
    });

    // Heartbeat ping every 15 seconds to prevent NAT/proxy disconnects
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
 * @desc    Polling endpoint for authoritative job snapshot & result
 * @route   GET /api/generations/:id
 */
exports.getGenerationStatus = async (req, res, next) => {
  try {
    const generation = await Generation.findById(req.params.id);
    if (!generation) {
      throw ApiError.notFound("Generation job not found", "JOB_NOT_FOUND");
    }

    // IDOR Security: Enforce ownership check
    if (generation.userId) {
      if (!req.user || !generation.userId.equals(req.user._id)) {
        throw ApiError.forbidden("Access denied to this generation", "UNAUTHORIZED_ACCESS");
      }
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

    // IDOR Security: Enforce ownership check
    if (generation.userId) {
      if (!req.user || !generation.userId.equals(req.user._id)) {
        throw ApiError.forbidden("Not authorized to cancel this generation", "UNAUTHORIZED_CANCELLATION");
      }
    }

    const cancelResult = await generationQueue.cancel(
      generation._id,
      req.body.reason || "Client initiated cancellation"
    );

    res.status(200).json({
      jobId: generation._id,
      ...cancelResult
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List generation history (Paginated & Ownership-isolated)
 * @route   GET /api/generations
 */
exports.listGenerations = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const query = req.user
      ? { userId: req.user._id }
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

// Aliased for route/spec compatibility
exports.streamEvents = exports.getGenerationEvents;
