const express = require("express");
const router = express.Router();
const { createPrompt, getPrompts, updatePrompt, deletePrompt } = require("../controllers/promptController");
const { generatePromptHandler, enhancePromptHandler } = require("../controllers/neuralController");
const { protect } = require("../middleware/authMiddleware");
const { aiRateLimiter } = require("../middleware/rateLimiter");

// Gemini Prompt Copilot endpoints (supports both /api/prompts/generate and /api/prompt/generate)
router.post("/generate", aiRateLimiter, generatePromptHandler);
router.post(["/enhance", "/expand"], aiRateLimiter, enhancePromptHandler);

router.route("/")
  .post(protect, createPrompt)
  .get(protect, getPrompts);

router.route("/:id")
  .put(protect, updatePrompt)
  .delete(protect, deletePrompt);

module.exports = router;
