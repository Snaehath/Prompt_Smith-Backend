const ApiError = require("../utils/ApiError");
const { getModelById, isValidModel } = require("../services/modelRegistry");

const ALLOWED_BODY_FIELDS = [
  "subject",
  "action",
  "style",
  "context",
  "complexity",
  "resolution",
  "modelId",
  "seed",
  "steps"
];

/**
 * Validates inbound generation parameters against allowed schemas and models
 */
const validateGenerationInput = (req, res, next) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return next(ApiError.badRequest("Request body must be a valid JSON object", "INVALID_BODY"));
  }

  const errors = [];
  const keys = Object.keys(req.body);

  // 1. Reject unexpected fields
  for (const key of keys) {
    if (!ALLOWED_BODY_FIELDS.includes(key)) {
      errors.push({ field: key, message: `Unexpected or forbidden field '${key}' in payload` });
    }
  }

  const { subject, action, style, context, complexity, resolution, modelId, seed, steps } = req.body;

  // 2. Subject validation
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    errors.push({ field: "subject", message: "Subject is required and cannot be empty" });
  } else if (subject.trim().length > 500) {
    errors.push({ field: "subject", message: "Subject must not exceed 500 characters" });
  }

  // 3. Optional text field lengths
  const checkLength = (val, name) => {
    if (val !== undefined && val !== null) {
      if (typeof val !== "string") {
        errors.push({ field: name, message: `${name} must be a string` });
      } else if (val.trim().length > 500) {
        errors.push({ field: name, message: `${name} must not exceed 500 characters` });
      }
    }
  };

  checkLength(action, "action");
  checkLength(style, "style");
  checkLength(context, "context");

  // 4. Complexity validation (1..5)
  if (complexity !== undefined && complexity !== null) {
    const numComp = Number(complexity);
    if (isNaN(numComp) || !Number.isInteger(numComp) || numComp < 1 || numComp > 5) {
      errors.push({ field: "complexity", message: "Complexity must be an integer between 1 and 5" });
    }
  }

  // 5. Model validation against authoritative Model Registry
  const chosenModelId = modelId || "flux-1-dev";
  const modelDef = getModelById(chosenModelId);

  if (!modelDef) {
    errors.push({
      field: "modelId",
      message: `Unknown or disabled modelId '${chosenModelId}'`
    });
  } else {
    // 6. Resolution validation against model capabilities
    if (resolution && !modelDef.supportedResolutions.includes(resolution)) {
      errors.push({
        field: "resolution",
        message: `Resolution '${resolution}' is not supported by ${modelDef.label}. Allowed: ${modelDef.supportedResolutions.join(", ")}`
      });
    }

    // 7. Steps validation against model limits
    if (steps !== undefined && steps !== null) {
      const numSteps = Number(steps);
      if (isNaN(numSteps) || !Number.isInteger(numSteps) || numSteps < modelDef.minSteps || numSteps > modelDef.maxSteps) {
        errors.push({
          field: "steps",
          message: `Steps must be an integer between ${modelDef.minSteps} and ${modelDef.maxSteps} for ${modelDef.label}`
        });
      }
    }
  }

  // 8. Seed validation
  if (seed !== undefined && seed !== null) {
    const numSeed = Number(seed);
    if (isNaN(numSeed) || !Number.isInteger(numSeed) || numSeed < 0 || numSeed > 2147483647) {
      errors.push({ field: "seed", message: "Seed must be a positive 32-bit integer" });
    }
  }

  if (errors.length > 0) {
    return next(ApiError.badRequest("Invalid generation parameters provided", "VALIDATION_FAILED", errors));
  }

  next();
};

module.exports = { validateGenerationInput };
