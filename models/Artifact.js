const mongoose = require("mongoose");
const { isLocalMode } = require("../utils/db");
const { LocalArtifact } = require("../utils/localStore");

const ArtifactSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    prompt: { type: String, required: true },
    modelId: { type: String, required: true },
    provider: { type: String, default: "nvidia" },
    description: { type: String },
    subject: { type: String },
    action: { type: String },
    style: { type: String },
    context: { type: String },
    resolution: { type: String, default: "16:9" },
    imageUrl: { type: String, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    metadata: {
      seed: { type: Number },
      steps: { type: Number },
      generationDurationMs: { type: Number }
    }
  },
  { timestamps: true }
);

const MongooseArtifact = mongoose.models.Artifact || mongoose.model("Artifact", ArtifactSchema);

const Artifact = new Proxy(MongooseArtifact, {
  get(target, prop) {
    if (isLocalMode()) {
      if (prop in LocalArtifact) {
        return LocalArtifact[prop];
      }
    }
    return target[prop];
  }
});

Artifact.Artifact = Artifact;
module.exports = Artifact;
