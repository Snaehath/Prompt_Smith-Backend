const mongoose = require("mongoose");
const { isLocalMode } = require("../utils/db");
const { LocalPrompt } = require("../utils/localStore");

const VariableSchema = new mongoose.Schema({
  name: { type: String, required: true },
  value: { type: String, default: "" },
});

const VersionSchema = new mongoose.Schema({
  content: { type: String, required: true },
  imageUrl: { type: String },
  parameters: { type: Map, of: String },
  createdAt: { type: Date, default: Date.now },
});

const PromptSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    rawContent: { type: String, required: true },
    variables: [VariableSchema],
    category: { type: String },
    tags: [{ type: String }],
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    versions: [VersionSchema],
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const MongoosePrompt = mongoose.models.Prompt || mongoose.model("Prompt", PromptSchema);

const Prompt = new Proxy(MongoosePrompt, {
  get(target, prop) {
    if (isLocalMode()) {
      if (prop in LocalPrompt) {
        return LocalPrompt[prop];
      }
    }
    return target[prop];
  }
});

Prompt.Prompt = Prompt;
module.exports = Prompt;
