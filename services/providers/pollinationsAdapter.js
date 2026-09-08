const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

class PollinationsAdapter {
  constructor() {
    this.name = "pollinations";
  }

  isConfigured() {
    return true; // Zero-key required
  }

  async generateImage({ prompt, width = 1024, height = 1024, seed = null, modelId = "pollinations-turbo", signal = null }) {
    const finalSeed = seed !== null ? seed : Math.floor(Math.random() * 1000000);
    // Prefer turbo or default for high availability and zero rate limits
    const engine = modelId.includes("flux") ? "turbo" : "turbo";
    const encodedPrompt = encodeURIComponent(prompt.trim());
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${engine}&nologo=true&seed=${finalSeed}`;

    const fetchOptions = signal ? { signal } : {};
    let response = await fetch(url, fetchOptions);

    if (!response.ok) {
      // Fallback to default engine if specific model was rate limited
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${finalSeed}`;
      response = await fetch(fallbackUrl, fetchOptions);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Pollinations HTTP ${response.status}: ${errorText}`);
      error.status = response.status;
      error.code = response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;

    return {
      imageUrl: dataUrl,
      provider: "pollinations",
      modelId: `pollinations-${engine}`
    };
  }
}

module.exports = new PollinationsAdapter();
