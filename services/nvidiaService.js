// # nvidia image generation service
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const NVIDIA_INVOKE_URL = "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-medium";

/**
 * Generate an image using NVIDIA's Stable Diffusion 3 Medium API
 * @param {string} prompt - The high-fidelity user/gemini prompt
 * @param {string} resolution - Standard resolution key (e.g. '1080p-desktop') 
 * @param {string} systemPrompt - Instructions/Quality keywords
 * @returns {Promise<string>} - Returns base64 image string or URL
 */
async function generateImage(prompt, resolution = "16:9", systemPrompt = "4k resolution, ultra-detailed, masterpiece, high quality, sharp focus") {
  const apiKey = process.env.NVIDIA_API_KEY;
  
  if (!apiKey) {
    console.warn("NVIDIA_API_KEY not found in environment. Skipping image generation.");
    return null;
  }

  // Map internal resolution to NVIDIA aspect ratios
  const aspectRatio = resolution.includes("mobile") || resolution.includes("ipad") ? "9:16" : "16:9";

  if (!prompt || typeof prompt !== "string") {
    console.error("Invalid prompt provided to NVIDIA Service:", prompt);
    return null;
  }

  const payload = {
    prompt: `${prompt.trim()}, ${systemPrompt}`,
    cfg_scale: 5,
    aspect_ratio: aspectRatio,
    seed: Math.floor(Math.random() * 1000000), // Randomize seed for retries
    steps: 50,
    negative_prompt: "blurry, low quality, distorted, grainy, pixelated"
  };

  try {
    const response = await fetch(NVIDIA_INVOKE_URL, {
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
      console.error(`NVIDIA API Error (${response.status}):`, errBody);
      return null;
    }

    const data = await response.json();
    
    // NVIDIA typically returns the image as a base64 string in the 'image' field
    // or inside an 'artifacts' array depending on the exact model version.
    if (data.image) {
      return `data:image/png;base64,${data.image}`;
    } else if (data.artifacts && data.artifacts[0]?.base64) {
      return `data:image/png;base64,${data.artifacts[0].base64}`;
    }

    return null;
  } catch (error) {
    console.error("Failed to invoke NVIDIA Image API:", error);
    return null;
  }
}

module.exports = { generateImage };
