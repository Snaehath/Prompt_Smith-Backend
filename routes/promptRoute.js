const express = require("express");
const router = express.Router();
const { chatWithGemini } = require("../services/geminiService");
const { promptSchema } = require("../schemas/promptSchema");
const {
  GENERATE_PROMPT_SYSTEM,
  ENHANCE_PROMPT_SYSTEM,
} = require("../utils/prompts");

// # create prompt
router.post("/create", async (req, res) => {
  const { context, style, purpose } = req.body;
  
  const sysPrompt = GENERATE_PROMPT_SYSTEM(
    context, 
    style || "Photorealistic", 
    purpose || "Desktop Wallpaper"
  );

  try {
    const result = await chatWithGemini(sysPrompt, promptSchema);
    res.send(result);
  } catch (error) {
    console.error("Creation error:", error);
    res.status(500).json({ error: "Failed to create prompt" });
  }
});

// # refine prompt
router.post("/refine", async (req, res) => {
  const { prompt, feedback } = req.body;
  const sysMsg = ENHANCE_PROMPT_SYSTEM(prompt, feedback);

  try {
    const result = await chatWithGemini(sysMsg, promptSchema);
    res.send(result);
  } catch (error) {
    console.error("Refinement error:", error);
    res.status(500).json({ error: "Failed to refine prompt" });
  }
});

module.exports = router;
