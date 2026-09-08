// # Multi-Provider Neural Synthesis Service (NVIDIA NIM + Pollinations Fallback)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// NVIDIA NIM Neural Engine definitions and constraints
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
const generateWithPollinations = async (prompt, width = 1024, height = 1024, seed = null, engine = "flux") => {
  try {
    const finalSeed = seed !== null ? seed : Math.floor(Math.random() * 1000000);
    const pollinationsModel = engine === "turbo" ? "turbo" : "flux";
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=${pollinationsModel}&nologo=true&seed=${finalSeed}`;

    console.log(`[Neural Gateway] Dispatching to Pollinations (${pollinationsModel})...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Pollinations inference error: HTTP ${res.status}`);
      return null;
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:image/jpeg;base64,${base64}`;
  } catch (err) {
    console.error("Pollinations inference failed:", err.message);
    return null;
  }
};

/**
 * Resilient Image Synthesis Gateway
 * Routes request to NVIDIA NIM or Pollinations based on modelId, with automatic failover.
 */
const generateImage = async (
  prompt, 
  resolution = "16:9", 
  systemPrompt = "", 
  modelId = "flux-1-dev", 
  inputImage = null,
  isTiled = false,
  customSteps = null,
  customSeed = null
) => {
  // Map resolution string to dimension buckets
  let width = 1024, height = 1024;
  if (resolution === "1080x1920" || resolution.includes("mobile") || resolution === "9:16") {
    width = 832;
    height = 1248;
  } else if (resolution === "1920x1080" || resolution === "16:9") {
    width = 1248;
    height = 832;
  } else if (resolution === "1:1") {
    width = 1024;
    height = 1024;
  }

  if (!prompt || typeof prompt !== "string") {
    console.error("Invalid prompt input:", prompt);
    return null;
  }

  const seed = customSeed !== null ? customSeed : Math.floor(Math.random() * 1000000);

  // If client explicitly selected a Pollinations engine
  if (modelId === "pollinations-flux") {
    return await generateWithPollinations(prompt, width, height, seed, "flux");
  }
  if (modelId === "pollinations-turbo") {
    return await generateWithPollinations(prompt, width, height, seed, "turbo");
  }

  // Otherwise, route to NVIDIA NIM with Pollinations fallback
  const apiKey = process.env.NVIDIA_API_KEY;
  const model = MODELS[modelId] || MODELS["flux-1-dev"];

  let combinedPrompt = `${prompt.trim()}${systemPrompt ? `, ${systemPrompt}` : ""}`;
  if (model.maxPromptLength && combinedPrompt.length > model.maxPromptLength) {
    const safetyLimit = model.maxPromptLength - 10;
    combinedPrompt = combinedPrompt.substring(0, safetyLimit);
  }

  const payload = {
    prompt: combinedPrompt,
    width,
    height,
    seed,
    steps: customSteps || model.steps || 50,
    ...(isTiled && { tiling: true })
  };

  // If NVIDIA key is missing, immediately failover to Pollinations FLUX
  if (!apiKey) {
    console.warn("[Neural Gateway] NVIDIA_API_KEY absent. Automatically routing to Pollinations FLUX failover...");
    return await generateWithPollinations(combinedPrompt, width, height, seed, "flux");
  }

  try {
    const response = await fetch(model.url, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      }
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.warn(`[Neural Gateway] NVIDIA API Warning (${response.status}) [${modelId}]: ${errBody}. Executing automatic failover...`);
      return await generateWithPollinations(combinedPrompt, width, height, seed, "flux");
    }

    const data = await response.json();
    
    if (data.image) return `data:image/png;base64,${data.image}`;
    if (data.artifacts && data.artifacts[0]?.base64) return `data:image/png;base64,${data.artifacts[0].base64}`;
    if (data.b64_json) return `data:image/png;base64,${data.b64_json}`;

    // Fallback if unexpected JSON structure returned
    return await generateWithPollinations(combinedPrompt, width, height, seed, "flux");
  } catch (error) {
    console.error("[Neural Gateway] NVIDIA request error, falling back to secondary engine:", error.message);
    return await generateWithPollinations(combinedPrompt, width, height, seed, "flux");
  }
};

const upscaleImage = async (imageUrl, factor = 2) => {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  const UPSCALE_URL = "https://ai.api.nvidia.com/v1/genai/nvidia/super-resolution";
  const payload = {
    image: imageUrl.split(",")[1] || imageUrl,
    upscale_factor: factor
  };

  try {
    const response = await fetch(UPSCALE_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      }
    });

    if (!response.ok) return null;
    const data = await response.json();
    return `data:image/png;base64,${data.image || data.b64_json}`;
  } catch (error) {
    console.error("Upscaling failure:", error);
    return null;
  }
};

module.exports = { generateImage, upscaleImage, MODELS, generateWithPollinations };
