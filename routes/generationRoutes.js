const express = require("express");
const router = express.Router();
const {
  createGeneration,
  getStreamTicket,
  getGenerationEvents,
  streamEvents,
  getGenerationStatus,
  cancelGeneration,
  listGenerations
} = require("../controllers/generationController");
const { optionalProtect } = require("../middleware/authMiddleware");
const { aiRateLimiter } = require("../middleware/rateLimiter");
const { validateGenerationInput } = require("../middleware/validateInput");

// Create generation job (Idempotent, validated, decoupled from stream)
router.post("/", aiRateLimiter, optionalProtect, validateGenerationInput, createGeneration);

// List past generation jobs (Paginated, ownership-scoped)
router.get("/", optionalProtect, listGenerations);

// Request short-lived (60s) single-use ticket for native browser EventSource
router.post("/:id/ticket", optionalProtect, getStreamTicket);

// Polling fallback endpoint for status & output (IDOR protected)
router.get("/:id", optionalProtect, getGenerationStatus);

// Pure read-only Server-Sent Events stream for telemetry (Supports Bearer, Cookie, or ?ticket=)
router.get("/:id/events", optionalProtect, streamEvents || getGenerationEvents);

// Cancel in-progress or queued generation (IDOR protected)
router.post("/:id/cancel", optionalProtect, cancelGeneration);

module.exports = router;
