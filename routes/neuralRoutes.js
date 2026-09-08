const express = require("express");
const router = express.Router();
const {
  listModels,
  getArchive,
  expandPromptBlueprint,
  createPromptAndImage,
  refinePromptImage,
  upscaleImageHandler,
  createStreamGeneration
} = require("../controllers/neuralController");
const { optionalProtect } = require("../middleware/authMiddleware");
const { aiRateLimiter } = require("../middleware/rateLimiter");

// Model Discovery
router.get("/models", listModels);

// Neural Archive (associates with logged in user if token present)
router.get("/archive", optionalProtect, getArchive);

// Blueprint Expansion (Gemini reasoning)
router.post("/expand", aiRateLimiter, expandPromptBlueprint);

// Full Synthesis Pipeline (Gemini + FLUX)
router.post("/create", aiRateLimiter, optionalProtect, createPromptAndImage);

// Real-Time Progress Stream (Server-Sent Events)
router.get("/stream", aiRateLimiter, optionalProtect, createStreamGeneration);

// Image Regeneration / Retry
router.post(["/refine", "/retry"], aiRateLimiter, optionalProtect, refinePromptImage);

// Super-Resolution / Upscale
router.post("/upscale", aiRateLimiter, upscaleImageHandler);

module.exports = router;
