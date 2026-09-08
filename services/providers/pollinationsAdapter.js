const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

class PollinationsAdapter {
  constructor() {
    this.name = "pollinations";
  }

  isConfigured() {
    return true; // Zero-key required
  }

  async generateImage({ prompt, width = 1024, height = 1024, seed = null, modelId = "pollinations-flux", signal = null }) {
    const finalSeed = seed !== null ? seed : Math.floor(Math.random() * 1000000);
    const engine = modelId.includes("turbo") ? "turbo" : "flux";
    const encodedPrompt = encodeURIComponent(prompt.trim());
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${engine}&nologo=true&seed=${finalSeed}`;

    const fetchOptions = signal ? { signal } : {};
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Pollinations HTTP ${response.status}: ${errorText}`);
      error.status = response.status;
      error.code = response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      imageUrl: `data:image/jpeg;base64,${base64}`,
      provider: "pollinations",
      modelId: `pollinations-${engine}`
    };
  }
}

module.exports = new PollinationsAdapter();
