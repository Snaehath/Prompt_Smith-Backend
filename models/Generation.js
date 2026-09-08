const mongoose = require("mongoose");
const crypto = require("crypto");
const { isLocalMode } = require("../utils/db");
const { LocalGeneration } = require("../utils/localStore");

const GenerationStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  BLUEPRINTING: "blueprinting",
  RENDERING: "rendering",
  ARCHIVING: "archiving",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
};

const GenerationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    idempotencyKey: {
      type: String,
      default: null,
      trim: true
    },
    payloadHash: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: Object.values(GenerationStatus),
      default: GenerationStatus.QUEUED,
      index: true
    },
    stage: {
      type: String,
      default: "queued"
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    input: {
      subject: { type: String, required: true },
      action: { type: String, default: "" },
      style: { type: String, default: "" },
      context: { type: String, default: "" },
      complexity: { type: Number, default: 3 },
      resolution: { type: String, default: "16:9" },
      modelId: { type: String, default: "flux-1-dev" },
      seed: { type: Number, default: null },
      steps: { type: Number, default: null }
    },
    blueprint: {
      title: { type: String },
      subject: { type: String },
      action: { type: String },
      style: { type: String },
      context: { type: String },
      description: { type: String },
      prompt: { type: String }
    },
    provider: {
      type: String,
      default: "nvidia"
    },
    modelId: {
      type: String,
      default: "flux-1-dev"
    },
    attempt: {
      type: Number,
      default: 1
    },
    fallbackUsed: {
      type: Boolean,
      default: false
    },
    image: {
      url: { type: String, default: null },
      storageKey: { type: String, default: null },
      mimeType: { type: String, default: "image/jpeg" },
      width: { type: Number, default: 1024 },
      height: { type: Number, default: 1024 },
      sizeBytes: { type: Number, default: null }
    },
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null },
      retryable: { type: Boolean, default: false },
      details: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    cost: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      estimatedCostUsd: { type: Number, default: 0.0 }
    },
    metadata: {
      requestId: { type: String, default: null },
      clientIp: { type: String, default: null },
      generationDurationMs: { type: Number, default: null },
      steps: { type: Number, default: null },
      seed: { type: Number, default: null },
      versions: {
        promptSchemaVersion: { type: Number, default: 1 },
        systemPromptVersion: { type: Number, default: 2 },
        generatorVersion: { type: String, default: "2.3.0" }
      }
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// High-performance compound indexes
GenerationSchema.index({ userId: 1, createdAt: -1 });
GenerationSchema.index({ status: 1, createdAt: -1 });
GenerationSchema.index({ idempotencyKey: 1, userId: 1 }, { sparse: true });
GenerationSchema.index({ createdAt: -1 });

// Helper to compute deterministic hash of canonical generation input
GenerationSchema.statics.computePayloadHash = function (input) {
  const canonical = JSON.stringify({
    subject: (input.subject || "").trim().toLowerCase(),
    action: (input.action || "").trim().toLowerCase(),
    style: (input.style || "").trim().toLowerCase(),
    context: (input.context || "").trim().toLowerCase(),
    complexity: Number(input.complexity) || 3,
    resolution: input.resolution || "16:9",
    modelId: input.modelId || "flux-1-dev",
    seed: input.seed !== null && input.seed !== undefined ? Number(input.seed) : null
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
};

/**
 * Atomic State Machine Transition
 * Ensures that terminal states (completed, failed, cancelled) can NEVER be overwritten by races.
 */
GenerationSchema.statics.atomicTransition = async function (generationId, allowedFromStatuses, targetStatus, patch = {}) {
  const query = {
    _id: generationId,
    status: { $in: allowedFromStatuses }
  };

  const update = {
    $set: {
      status: targetStatus,
      ...patch
    }
  };

  if (targetStatus === GenerationStatus.RUNNING && !patch.startedAt) {
    update.$set.startedAt = new Date();
  }

  if ([GenerationStatus.COMPLETED, GenerationStatus.FAILED, GenerationStatus.CANCELLED].includes(targetStatus)) {
    update.$set.completedAt = new Date();
  }

  return await this.findOneAndUpdate(query, update, { new: true });
};

const MongooseGeneration = mongoose.models.Generation || mongoose.model("Generation", GenerationSchema);

const Generation = new Proxy(MongooseGeneration, {
  get(target, prop) {
    if (isLocalMode()) {
      if (prop in LocalGeneration) {
        return LocalGeneration[prop];
      }
    }
    return target[prop];
  }
});

module.exports = {
  Generation,
  GenerationStatus
};
