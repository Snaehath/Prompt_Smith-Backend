const ApiError = require("../utils/ApiError");
const { getModels } = require("../services/modelRegistry");

const ALLOWED_RESOLUTIONS = ["16:9", "1:1", "9:16", "1080x1920", "1920x1080"];

/**
 * Validates inbound generation parameters against allowed schemas and models
 */
const validateGenerationInput = (req, res, next) => {
  const { subject, complexity, resolution, modelId, seed } = req.body;
  const errors = [];

  // Subject validation
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    errors.push({ field: "subject", message: "Subject is required and cannot be empty" });
  } else if (subject.trim().length > 500) {
    errors.push({ field: "subject", message: "Subject must not exceed 500 characters" });
  }

  // Complexity validation
  if (complexity !== undefined && complexity !== null) {
    const numComp = Number(complexity);
    if (isNaN(numComp) || numComp < 1 || numComp > 5) {
      errors.push({ field: "complexity", message: "Complexity must be an integer between 1 and 5" });
    }
  }

  // Resolution validation
  if (resolution && !ALLOWED_RESOLUTIONS.includes(resolution)) {
    errors.push({
      field: "resolution",
      message: `Invalid resolution '${resolution}'. Allowed: ${ALLOWED_RESOLUTIONS.join(", ")}`
    });
  }

  // Model validation against Model Registry
  if (modelId) {
    const registeredIds = getModels().map((m) => m.id);
    if (!registeredIds.includes(modelId)) {
      errors.push({
        field: "modelId",
        message: `Unknown modelId '${modelId}'. Registered models: ${registeredIds.join(", ")}`
      });
    }
  }

  // Seed validation
  if (seed !== undefined && seed !== null && isNaN(Number(seed))) {
    errors.push({ field: "seed", message: "Seed must be a valid integer number" });
  }

  if (errors.length > 0) {
    return next(ApiError.badRequest("Invalid input parameters provided", "VALIDATION_FAILED", errors));
  }

  next();
};

module.exports = { validateGenerationInput, ALLOWED_RESOLUTIONS };
