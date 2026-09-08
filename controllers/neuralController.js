const { generatePromptFromIdea, enhanceExistingPrompt } = require("../services/geminiService");
const { generateImage, upscaleImage } = require("../services/nvidiaService");
const { getModels } = require("../services/modelRegistry");
const {
  IMAGE_QUALITY_SYSTEM,
  RETRY_QUALITY_SYSTEM,
} = require("../utils/prompts");
const ArtifactModel = require("../models/Artifact");
const ApiError = require("../utils/ApiError");

// Helper to format SSE events
const sendSSE = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

/**
 * @desc    Get all available neural generation models
 * @route   GET /api/prompt/models
 */
exports.listModels = (req, res) => {
  res.status(200).json(getModels());
};

/**
 * @desc    Get synthesis archive history
 * @route   GET /api/prompt/archive
 */
exports.getArchive = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const query = req.user ? { $or: [{ userId: req.user._id }, { userId: null }] } : {};
    const [artifacts, total] = await Promise.all([
      ArtifactModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select("-__v"),
      ArtifactModel.countDocuments(query)
    ]);

    res.status(200).json({
      items: artifacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Generate a complete high-fidelity prompt from an idea (Gemini Copilot)
 * @route   POST /api/prompt/generate
 */
exports.generatePromptHandler = async (req, res, next) => {
  const { topic = "a surreal fantasy landscape", style = "" } = req.body || {};

  try {
    const result = await generatePromptFromIdea(topic, style);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Enhance an existing prompt with cinematography and lighting (Gemini Copilot)
 * @route   POST /api/prompt/enhance, /api/prompt/expand
 */
exports.enhancePromptHandler = async (req, res, next) => {
  const { prompt, style = "", subject, action, context, complexity } = req.body || {};

  try {
    // 1. Direct prompt enhancement
    if (prompt && typeof prompt === "string" && prompt.trim().length > 0) {
      const result = await enhanceExistingPrompt(prompt.trim(), style);
      return res.status(200).json(result);
    }

    // 2. Backward-compatible prompt enhancement if subject was sent
    if (subject && typeof subject === "string" && subject.trim().length > 0) {
      const result = await enhanceExistingPrompt(subject, style);
      return res.status(200).json(result);
    }

    throw ApiError.badRequest("Prompt string or subject is required for prompt enhancement", "INVALID_INPUT");
  } catch (error) {
    next(error);
  }
};

// Backward-compatible alias for existing callers
exports.expandPromptBlueprint = exports.enhancePromptHandler;

/**
 * @desc    Full generation pipeline: Gemini expansion + Neural image synthesis
 * @route   POST /api/prompt/create
 */
exports.createPromptAndImage = async (req, res, next) => {
  const { subject, action, style, context, resolution, complexity, modelId, seed } = req.body;

  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    return next(ApiError.badRequest("Subject is required for creation", "INVALID_INPUT"));
  }

  const startTime = Date.now();
  const userText = GENERATE_PROMPT_USER(
    subject,
    action, 
    style, 
    context,
    complexity || 3
  );

  try {
    // Direct pass-through: Use user's detailed prompt directly without internal modification
    let finalPrompt = (subject || "").trim();
    const extras = [action, style, context]
      .filter(Boolean)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (extras.length > 0) {
      finalPrompt += `, ${extras.join(", ")}`;
    }

    const result = {
      title: (subject || "Generated Art").slice(0, 32).trim(),
      subject: subject || "",
      action: action || "",
      style: style || "",
      context: context || "",
      description: subject || "",
      prompt: finalPrompt
    };
    
    // Synthesize image via Neural Gateway (FLUX.2 Klein)
    const chosenModel = modelId || "flux-2-klein";
    const imageUrl = await generateImage(
      result.prompt, 
      resolution || "16:9", 
      IMAGE_QUALITY_SYSTEM, 
      chosenModel,
      null,
      false,
      null,
      seed
    );

    if (!imageUrl) {
      throw ApiError.badGateway("Image synthesis pipeline returned empty output", "SYNTHESIS_FAILED");
    }

    // 3. Persist artifact record in MongoDB
    const artifact = await ArtifactModel.create({
      ...result,
      modelId: chosenModel,
      resolution: resolution || "16:9",
      userId: req.user ? req.user._id : null,
      metadata: {
        seed: seed || null,
        generationDurationMs: Date.now() - startTime
      }
    });

    res.status(200).json({
      ...artifact.toObject(),
      imageUrl
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Regenerate image from existing prompt with custom parameters
 * @route   POST /api/prompt/refine, /api/prompt/retry
 */
exports.refinePromptImage = async (req, res, next) => {
  const { 
    prompt, 
    resolution, 
    title, 
    modelId, 
    inputImage,
    isTiled,
    steps,
    seed
  } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return next(ApiError.badRequest("Prompt string is required for refinement", "INVALID_INPUT"));
  }

  const startTime = Date.now();
  const chosenModel = modelId || "flux-2-klein";

  try {
    const imageUrl = await generateImage(
      prompt, 
      resolution || "16:9", 
      RETRY_QUALITY_SYSTEM, 
      chosenModel, 
      inputImage,
      isTiled,
      steps,
      seed
    );
    
    if (!imageUrl) {
      throw ApiError.badGateway("Image generation failed", "SYNTHESIS_FAILED");
    }
    
    const artifact = await ArtifactModel.create({ 
      prompt, 
      title: title || "Refined Blueprint", 
      modelId: chosenModel,
      resolution: resolution || "16:9",
      userId: req.user ? req.user._id : null,
      metadata: {
        seed,
        steps,
        generationDurationMs: Date.now() - startTime
      }
    });
    
    res.status(200).json({
      ...artifact.toObject(),
      imageUrl
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upscale an existing image
 * @route   POST /api/prompt/upscale
 */
exports.upscaleImageHandler = async (req, res, next) => {
  const { imageUrl, upscaleFactor } = req.body;

  if (!imageUrl || typeof imageUrl !== "string") {
    return next(ApiError.badRequest("imageUrl is required for upscaling", "INVALID_INPUT"));
  }

  try {
    const enhancedUrl = await upscaleImage(imageUrl, upscaleFactor || 2);
    if (!enhancedUrl) {
      throw ApiError.badGateway("Upscaling service unavailable", "UPSCALE_FAILED");
    }
    res.status(200).json({ imageUrl: enhancedUrl });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Real-time generation telemetry stream using Server-Sent Events (SSE)
 * @route   GET /api/prompt/stream
 */
exports.createStreamGeneration = async (req, res, next) => {
  const { subject, action, style, context, resolution, complexity, modelId, seed } = req.query;

  if (!subject) {
    return next(ApiError.badRequest("Subject parameter is required", "INVALID_INPUT"));
  }

  // Set HTTP headers for SSE streaming
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const startTime = Date.now();

  try {
    // Stage 1: Expanding Blueprint
    sendSSE(res, "stage", { 
      stage: "blueprint_synthesis", 
      progress: 25, 
      message: "Analyzing creative pillars and crafting neural blueprint with Gemini..." 
    });

    // Direct pass-through: Use user's detailed prompt directly without internal modification
    let finalPrompt = (subject || "").trim();
    const extras = [action, style, context]
      .filter(Boolean)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (extras.length > 0) {
      finalPrompt += `, ${extras.join(", ")}`;
    }

    const blueprint = {
      title: (subject || "Generated Art").slice(0, 32).trim(),
      subject: subject || "",
      action: action || "",
      style: style || "",
      context: context || "",
      description: subject || "",
      prompt: finalPrompt
    };
    sendSSE(res, "blueprint", blueprint);

    // Stage 2: Visual Synthesis
    const chosenModel = modelId || "flux-2-klein";
    sendSSE(res, "stage", { 
      stage: "visual_rendering", 
      progress: 65, 
      message: `Synthesizing canvas with ${chosenModel} engine...` 
    });

    const imageUrl = await generateImage(
      blueprint.prompt,
      resolution || "16:9",
      IMAGE_QUALITY_SYSTEM,
      chosenModel,
      null,
      false,
      null,
      seed ? Number(seed) : null
    );

    if (!imageUrl) throw new Error("Neural synthesis engine produced no canvas");

    // Stage 3: Persistence
    sendSSE(res, "stage", { 
      stage: "archiving", 
      progress: 90, 
      message: "Indexing artwork into neural archive..." 
    });

    const artifact = await ArtifactModel.create({
      ...blueprint,
      modelId: chosenModel,
      resolution: resolution || "16:9",
      userId: req.user ? req.user._id : null,
      metadata: {
        generationDurationMs: Date.now() - startTime
      }
    });

    // Stage 4: Complete
    sendSSE(res, "complete", {
      ...artifact.toObject(),
      imageUrl
    });

    res.end();
  } catch (error) {
    console.error("SSE Generation Failure:", error);
    sendSSE(res, "error", { error: error.message || "Synthesis stream failed" });
    res.end();
  }
};
