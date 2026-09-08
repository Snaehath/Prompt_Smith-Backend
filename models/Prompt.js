const mongoose = require("mongoose");

const VariableSchema = new mongoose.Schema({
  name: { type: String, required: true },
  value: { type: String, default: "" },
});

const VersionSchema = new mongoose.Schema({
  content: { type: String, required: true },
  imageUrl: { type: String },
  parameters: { type: Map, of: String }, // e.g., { "--ar": "16:9", "--v": "6" }
  createdAt: { type: Date, default: Date.now },
});

const PromptSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    rawContent: { type: String, required: true }, // The prompt with {{variables}}
    variables: [VariableSchema],
    category: { type: String },
    tags: [{ type: String }],
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    versions: [VersionSchema],
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Prompt || mongoose.model("Prompt", PromptSchema);
