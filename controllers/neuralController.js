const { chatWithGemini } = require("../services/geminiService");
const { promptSchema } = require("../schemas/promptSchema");
const { generateImage, upscaleImage } = require("../services/nvidiaService");
const { getModels } = require("../services/modelRegistry");
const {
  GENERATE_PROMPT_SYSTEM,
  GENERATE_PROMPT_USER,
  IMAGE_QUALITY_SYSTEM,
  RETRY_QUALITY_SYSTEM,
} = require("../utils/prompts");
const ArtifactModel = require("../models/Artifact");

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
exports.getArchive = async (req, res) => {
  try {
    const query = req.user ? { $or: [{ userId: req.user._id }, { userId: null }] } : {};
    const artifacts = await ArtifactModel.find(query).sort({ createdAt: -1 }).limit(50);
    res.status(200).json(artifacts);
  } catch (error) {
    console.error("Archive fetch error:", error);
    res.status(500).json({ error: "Failed to fetch neural archive" });
  }
};

/**
 * @desc    Expand raw ideas into structured art prompt blueprint
 * @route   POST /api/prompt/expand
 */
exports.expandPromptBlueprint = async (req, res) => {
  const { subject, action, style, context, complexity } = req.body;

  if (!subject) {
    return res.status(400).json({ error: "Subject is required for prompt expansion" });
  }

  const userText = GENERATE_PROMPT_USER(
    subject,
    action,
    style,
    context,
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
};

/**
 * @desc    Full generation pipeline: Gemini expansion + Neural image synthesis
 * @route   POST /api/prompt/create
 */
exports.createPromptAndImage = async (req, res) => {
  const { subject, action, style, context, resolution, complexity, modelId, seed } = req.body;

  if (!subject) {
    return res.status(400).json({ error: "Subject is required for creation" });
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
    // 1. Expand prompt using Google Gemini
    const result = await chatWithGemini(GENERATE_PROMPT_SYSTEM, userText, promptSchema);
    
    // 2. Synthesize image via Neural Gateway (NVIDIA NIM or Pollinations fallback)
    const chosenModel = modelId || "flux-1-dev";
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
      throw new Error("Image synthesis pipeline returned empty output");
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
    console.error("Creation error:", error);
    res.status(500).json({ error: error.message || "Failed to create prompt & image" });
  }
};

/**
 * @desc    Regenerate image from existing prompt with custom parameters
 * @route   POST /api/prompt/refine, /api/prompt/retry
 */
exports.refinePromptImage = async (req, res) => {
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

  if (!prompt) {
    return res.status(400).json({ error: "Prompt string is required for refinement" });
  }

  const startTime = Date.now();
  const chosenModel = modelId || "flux-1-dev";

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
    
    if (!imageUrl) throw new Error("Image generation failed");
    
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
    console.error("Regeneration error:", error);
    res.status(500).json({ error: "Failed to regenerate image" });
  }
};

/**
 * @desc    Upscale an existing image
 * @route   POST /api/prompt/upscale
 */
exports.upscaleImageHandler = async (req, res) => {
  const { imageUrl, upscaleFactor } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: "imageUrl is required for upscaling" });
  }

  try {
    const enhancedUrl = await upscaleImage(imageUrl, upscaleFactor || 2);
    if (!enhancedUrl) throw new Error("Upscaling service unavailable");
    res.status(200).json({ imageUrl: enhancedUrl });
  } catch (error) {
    console.error("Upscale error:", error);
    res.status(500).json({ error: "Failed to upscale image" });
  }
};

/**
 * @desc    Real-time generation telemetry stream using Server-Sent Events (SSE)
 * @route   GET /api/prompt/stream
 */
exports.createStreamGeneration = async (req, res) => {
  const { subject, action, style, context, resolution, complexity, modelId, seed } = req.query;

  if (!subject) {
    return res.status(400).json({ error: "Subject parameter is required" });
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

    const userText = GENERATE_PROMPT_USER(
      subject,
      action,
      style,
      context,
      Number(complexity) || 3
    );

    const blueprint = await chatWithGemini(GENERATE_PROMPT_SYSTEM, userText, promptSchema);
    sendSSE(res, "blueprint", blueprint);

    // Stage 2: Visual Synthesis
    const chosenModel = modelId || "flux-1-dev";
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
