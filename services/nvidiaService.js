// # Backward Compatibility Neural Synthesis Facade
// Delegates directly to ProviderRouter, CircuitBreaker, and PollinationsAdapter to eliminate duplicate network logic.
const providerRouter = require("./providerRouter");
const pollinationsAdapter = require("./providers/pollinationsAdapter");

// NVIDIA NIM Neural Engine definitions and constraints for legacy callers
const MODELS = {
  "flux-1-dev": {
    url: "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
    steps: 50,
    maxPromptLength: 800,
    provider: "nvidia"
  },
  "flux-1-schnell": {
    url: "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell",
    steps: 4,
    maxPromptLength: 800,
    provider: "nvidia"
  },
  "flux-2-klein": {
    url: "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b",
    steps: 4,
    maxPromptLength: 800,
    provider: "nvidia"
  }
};

/**
 * Direct synthesizer using Pollinations AI engine (Zero-key failover & free provider)
 */
const generateWithPollinations = async (prompt, width = 1024, height = 1024, seed = null, engine = "flux", signal = null) => {
  try {
    const result = await pollinationsAdapter.generateImage({
      prompt,
      width,
      height,
      seed,
      modelId: `pollinations-${engine}`,
      signal
    });
    return result ? result.imageUrl : null;
  } catch (err) {
    if (err.name === "AbortError" || signal?.aborted) {
      throw err;
    }
    console.error("Pollinations inference failed:", err.message);
    return null;
  }
};

/**
 * Resilient Image Synthesis Gateway
 * Routes request through ProviderRouter with Circuit Breaker and automatic Pollinations failover.
 */
const generateImage = async (
  prompt,
  resolution = "16:9",
  systemPrompt = "",
  modelId = "flux-1-dev",
  inputImage = null,
  isTiled = false,
  customSteps = null,
  customSeed = null,
  signal = null
) => {
  if (!prompt || typeof prompt !== "string") {
    console.error("Invalid prompt input:", prompt);
    return null;
  }

  const combinedPrompt = `${prompt.trim()}${systemPrompt ? `, ${systemPrompt}` : ""}`;

  try {
    const result = await providerRouter.synthesizeImage({
      prompt: combinedPrompt,
      resolution,
      modelId,
      steps: customSteps,
      seed: customSeed,
      signal
    });

    return result ? result.imageUrl : null;
  } catch (error) {
    if (error.name === "AbortError" || signal?.aborted) {
      throw error;
    }
    console.error("[Neural Gateway] Synthesis failed:", error.message);
    return null;
  }
};

/**
 * Super-Resolution / Upscale an existing image
 */
const upscaleImage = async (imageUrl, factor = 2) => {
  return await providerRouter.upscaleImage(imageUrl, factor);
};

module.exports = { generateImage, upscaleImage, MODELS, generateWithPollinations };
