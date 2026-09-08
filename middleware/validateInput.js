const ApiError = require("../utils/ApiError");
const { getModelById } = require("../services/modelRegistry");

const ALLOWED_BODY_FIELDS = [
  "subject",
  "action",
  "style",
  "context",
  "complexity",
  "resolution",
  "aspectRatio",
  "modelId",
  "seed",
  "steps",
  "parameters"
];

const ALLOWED_PARAMETER_FIELDS = [
  "aspectRatio",
  "resolution",
  "steps",
  "seed"
];

/**
 * Validates inbound generation parameters against allowed schemas and models.
 * Accepts both top-level parameters and nested `parameters: { aspectRatio, steps, seed }`.
 */
const validateGenerationInput = (req, res, next) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return next(ApiError.badRequest("Request body must be a valid JSON object", "INVALID_BODY"));
  }

  const errors = [];
  const keys = Object.keys(req.body);

  // 1. Reject unexpected top-level fields
  for (const key of keys) {
    if (!ALLOWED_BODY_FIELDS.includes(key)) {
      errors.push({ field: key, message: `Unexpected or forbidden field '${key}' in payload` });
    }
  }

  // 2. Validate optional nested 'parameters' object if supplied
  let params = {};
  if (req.body.parameters !== undefined && req.body.parameters !== null) {
    if (typeof req.body.parameters !== "object" || Array.isArray(req.body.parameters)) {
      errors.push({ field: "parameters", message: "Optional 'parameters' field must be an object" });
    } else {
      params = req.body.parameters;
      for (const pKey of Object.keys(params)) {
        if (!ALLOWED_PARAMETER_FIELDS.includes(pKey)) {
          errors.push({ field: `parameters.${pKey}`, message: `Unexpected field '${pKey}' in parameters object` });
        }
      }
    }
  }

  const { subject, action, style, context, complexity, modelId } = req.body;

  // 3. Subject validation (generous 50,000 character limit for rich, complex creative prompts)
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    errors.push({ field: "subject", message: "Subject is required and cannot be empty" });
  } else if (subject.trim().length > 50000) {
    errors.push({ field: "subject", message: "Subject must not exceed 50000 characters" });
  }

  // 4. Optional text field lengths
  const checkLength = (val, name) => {
    if (val !== undefined && val !== null) {
      if (typeof val !== "string") {
        errors.push({ field: name, message: `${name} must be a string` });
      } else if (val.trim().length > 50000) {
        errors.push({ field: name, message: `${name} must not exceed 50000 characters` });
      }
    }
  };

  checkLength(action, "action");
  checkLength(style, "style");
  checkLength(context, "context");

  // 5. Complexity validation (1..5)
  if (complexity !== undefined && complexity !== null) {
    const numComp = Number(complexity);
    if (isNaN(numComp) || !Number.isInteger(numComp) || numComp < 1 || numComp > 5) {
      errors.push({ field: "complexity", message: "Complexity must be an integer between 1 and 5" });
    }
  }

  // 6. Normalize resolution / aspectRatio (support both top-level and parameters object)
  const resolution = req.body.resolution || req.body.aspectRatio || params.aspectRatio || params.resolution || "16:9";
  req.body.resolution = resolution;

  // 7. Model validation against authoritative Model Registry
  const chosenModelId = modelId || "flux-2-klein";
  const modelDef = getModelById(chosenModelId);

  if (!modelDef) {
    errors.push({
      field: "modelId",
      message: `Unknown or disabled modelId '${chosenModelId}'`
    });
  } else {
    // Resolution validation against model capabilities
    if (resolution && !modelDef.supportedResolutions.includes(resolution)) {
      errors.push({
        field: "resolution",
        message: `Resolution '${resolution}' is not supported by ${modelDef.label}. Allowed: ${modelDef.supportedResolutions.join(", ")}`
      });
    }

    // 8. Steps validation against model limits
    const rawSteps = req.body.steps !== undefined ? req.body.steps : params.steps;
    if (rawSteps !== undefined && rawSteps !== null && rawSteps !== "") {
      const numSteps = Number(rawSteps);
      if (isNaN(numSteps) || !Number.isInteger(numSteps) || numSteps < modelDef.minSteps || numSteps > modelDef.maxSteps) {
        errors.push({
          field: "steps",
          message: `Steps must be an integer between ${modelDef.minSteps} and ${modelDef.maxSteps} for ${modelDef.label}`
        });
      } else {
        req.body.steps = numSteps;
      }
    } else {
      req.body.steps = null;
    }
  }

  // 9. Seed validation: allows valid integers >= 0; omitted/null/undefined handled as random (null)
  const rawSeed = req.body.seed !== undefined ? req.body.seed : params.seed;
  if (rawSeed !== undefined && rawSeed !== null && rawSeed !== "") {
    const numSeed = Number(rawSeed);
    if (isNaN(numSeed) || !Number.isInteger(numSeed) || numSeed < 0 || numSeed > 2147483647) {
      errors.push({
        field: "seed",
        message: "Seed must be an integer greater than or equal to 0 (valid 32-bit integer)"
      });
    } else {
      req.body.seed = numSeed;
    }
  } else {
    req.body.seed = null; // Omitted seed handled as random
  }

  if (errors.length > 0) {
    return next(ApiError.badRequest("Invalid generation parameters provided", "VALIDATION_FAILED", errors));
  }

  next();
};

module.exports = { validateGenerationInput };
