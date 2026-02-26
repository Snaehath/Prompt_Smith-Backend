const express = require("express");
const router = express.Router();
const { chatWithGemini } = require("../models/geminiClient");
const { promptSchema } = require("../schemas/promptSchema");
const {
  GENERATE_PROMPT_SYSTEM,
  ENHANCE_PROMPT_SYSTEM,
} = require("../utils/prompts");

/**
 * [POST] /api/prompts/create
 * Create a new visual prompt
 */
router.post("/create", async (req, res) => {
  const { style, subject, extraPrompt } = req.body;
  const systemPrompt = GENERATE_PROMPT_SYSTEM(style, subject, extraPrompt);

  try {
    const result = await chatWithGemini(systemPrompt, promptSchema);
    res.send(result);
  } catch (error) {
    console.error("Creation error:", error);
    res.status(500).json({ error: "Failed to create prompt" });
  }
});

/**
 * [POST] /api/prompts/refine
 * Enhance/Refine an existing prompt
 */
router.post("/refine", async (req, res) => {
  const { prompt, extraPrompt } = req.body;
  const sysMsg = ENHANCE_PROMPT_SYSTEM(prompt, extraPrompt);

  try {
    const result = await chatWithGemini(sysMsg, promptSchema);
    res.send(result);
  } catch (error) {
    console.error("Refinement error:", error);
    res.status(500).json({ error: "Failed to refine prompt" });
  }
});

module.exports = router;
