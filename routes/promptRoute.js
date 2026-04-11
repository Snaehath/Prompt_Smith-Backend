const express = require("express");
const router = express.Router();
const { chatWithGemini } = require("../services/geminiService");
const { promptSchema } = require("../schemas/promptSchema");
const { generateImage } = require("../services/nvidiaService");
const {
  GENERATE_PROMPT_SYSTEM,
  GENERATE_PROMPT_USER,
  IMAGE_QUALITY_SYSTEM,
  RETRY_QUALITY_SYSTEM,
} = require("../utils/prompts");

// # expand prompt (Gemini only)
router.post("/expand", async (req, res) => {
  const { context, style, purpose, complexity } = req.body;

  const userText = GENERATE_PROMPT_USER(
    context,
    style || "Photorealistic",
    purpose || "Desktop Wallpaper",
    complexity || 3
  );

  try {
    const result = await chatWithGemini(
      GENERATE_PROMPT_SYSTEM,
      userText,
      promptSchema
    );
    res.status(200).json(result);
  } catch (error) {
    console.error("Expansion error:", error);
    res.status(500).json({ error: "Failed to expand prompt" });
  }
});

// # create prompt (Full Flow - Gemini + NVIDIA)
router.post("/create", async (req, res) => {
  const { context, style, purpose, resolution, complexity } = req.body;
  
  const userText = GENERATE_PROMPT_USER(
    context, 
    style || "Photorealistic", 
    purpose || "Desktop Wallpaper",
    complexity || 3
  );

  try {
    // Gemini handles the expansion (User Prompt) using System Instructions
    const result = await chatWithGemini(GENERATE_PROMPT_SYSTEM, userText, promptSchema);
    
    // NVIDIA handles image generation (NVIDIA System Prompt + Gemini's Result)
    const imageUrl = await generateImage(result.prompt, resolution, IMAGE_QUALITY_SYSTEM);
    
    res.status(200).json({ ...result, imageUrl });
  } catch (error) {
    console.error("Creation error:", error);
    res.status(500).json({ error: "Failed to create prompt" });
  }
});

/**
 * Regeneration / Retry Endpoint
 * Skips Gemini to avoid redundant logic once a blueprint exists.
 * Just calls NVIDIA with the specialized retry system prompt.
 */
router.post(["/refine", "/retry"], async (req, res) => {
  const { prompt, resolution, title } = req.body;

  try {
    // Regenerate image using existing prompt + high-fidelity retry system
    const imageUrl = await generateImage(prompt, resolution, RETRY_QUALITY_SYSTEM);
    
    if (!imageUrl) throw new Error("Image generation failed");
    
    res.status(200).json({ prompt, imageUrl, title });
  } catch (error) {
    console.error("Regeneration error:", error);
    res.status(500).json({ error: "Failed to regenerate image" });
  }
});

module.exports = router;
