const mongoose = require("mongoose");

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
      seed: { type: Number, default: null }
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
        systemPromptVersion: { type: Number, default: 1 }
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

// Lifecycle helper methods
GenerationSchema.methods.markRunning = function (stage = "starting", progress = 5) {
  this.status = GenerationStatus.RUNNING;
  this.stage = stage;
  this.progress = progress;
  this.startedAt = this.startedAt || new Date();
  return this.save();
};

GenerationSchema.methods.updateStage = function (stage, progress, patch = {}) {
  this.stage = stage;
  this.progress = progress;
  Object.assign(this, patch);
  return this.save();
};

GenerationSchema.methods.markCompleted = function ({ image, blueprint, metadata = {}, cost = {} }) {
  this.status = GenerationStatus.COMPLETED;
  this.stage = "complete";
  this.progress = 100;
  if (image) this.image = image;
  if (blueprint) this.blueprint = blueprint;
  if (cost) this.cost = { ...this.cost, ...cost };
  if (metadata) this.metadata = { ...this.metadata, ...metadata };
  this.completedAt = new Date();
  return this.save();
};

GenerationSchema.methods.markFailed = function ({ code, message, retryable = false, details = null }) {
  this.status = GenerationStatus.FAILED;
  this.stage = "failed";
  this.error = { code, message, retryable, details };
  this.completedAt = new Date();
  return this.save();
};

GenerationSchema.methods.markCancelled = function (reason = "Client requested cancellation") {
  this.status = GenerationStatus.CANCELLED;
  this.stage = "cancelled";
  this.error = { code: "GENERATION_CANCELLED", message: reason, retryable: false };
  this.completedAt = new Date();
  return this.save();
};

module.exports = {
  Generation: mongoose.models.Generation || mongoose.model("Generation", GenerationSchema),
  GenerationStatus
};
