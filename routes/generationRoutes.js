const express = require("express");
const router = express.Router();
const {
  createGeneration,
  getGenerationEvents,
  getGenerationStatus,
  cancelGeneration,
  listGenerations
} = require("../controllers/generationController");
const { optionalProtect } = require("../middleware/authMiddleware");
const { aiRateLimiter } = require("../middleware/rateLimiter");
const { validateGenerationInput } = require("../middleware/validateInput");

// Create generation job (Idempotent, validated, decoupled from stream)
router.post("/", aiRateLimiter, optionalProtect, validateGenerationInput, createGeneration);

// List past generation jobs (Paginated)
router.get("/", optionalProtect, listGenerations);

// Polling fallback endpoint for status & output
router.get("/:id", optionalProtect, getGenerationStatus);

// Pure read-only Server-Sent Events stream for telemetry
router.get("/:id/events", getGenerationEvents);

// Cancel in-progress or queued generation
router.post("/:id/cancel", optionalProtect, cancelGeneration);

module.exports = router;
