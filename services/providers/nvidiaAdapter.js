const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

// Verified active NVIDIA NIM endpoint: FLUX.2 Klein 4B
const NVIDIA_FLUX_URL = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b";

class NvidiaAdapter {
  constructor() {
    this.name = "nvidia";
  }

  isConfigured() {
    return Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
  }

  async generateImage({ prompt, width = 1024, height = 1024, steps = null, seed = null, modelId = "flux-2-klein", signal = null }) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      const err = new Error("NVIDIA_API_KEY is not configured");
      err.code = "AUTH_MISSING";
      err.retryable = false;
      throw err;
    }

    // NVIDIA NIM FLUX.2 Klein 4B strictly enforces a maximum prompt length of 800 characters
    let cappedPrompt = prompt.trim();
    if (cappedPrompt.length > 800) {
      cappedPrompt = cappedPrompt.substring(0, 800);
    }

    // FLUX.2 Klein 4B optimal step count is 4 (supported range: 1-8)
    const finalSteps = Math.min(Math.max(Number(steps) || 4, 1), 8);

    const payload = {
      prompt: cappedPrompt,
      width,
      height,
      seed: seed !== null ? seed : Math.floor(Math.random() * 1000000),
      steps: finalSteps
    };

    const fetchOptions = {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json"
      },
      ...(signal && { signal })
    };

    const response = await fetch(NVIDIA_FLUX_URL, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      const normalizedError = this.normalizeError(response.status, errorText);
      throw normalizedError;
    }

    const data = await response.json();
    let base64 = data.image || data.b64_json;
    if (!base64 && data.artifacts && data.artifacts[0]?.base64) {
      base64 = data.artifacts[0].base64;
    }

    if (!base64) {
      throw new Error("NVIDIA response contained no image payload");
    }

    const dataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;

    return {
      imageUrl: dataUrl,
      provider: "nvidia",
      modelId
    };
  }

  normalizeError(status, bodyText) {
    let cleanDetail = "";
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed.detail && Array.isArray(parsed.detail)) {
        cleanDetail = parsed.detail.map((d) => d.msg || d.type).join("; ");
      } else if (parsed.message) {
        cleanDetail = parsed.message;
      }
    } catch {
      cleanDetail = `Status code ${status}`;
    }

    const error = new Error(`NVIDIA API HTTP ${status}${cleanDetail ? `: ${cleanDetail}` : ""}`);
    error.status = status;

    if (status === 429) {
      error.code = "RATE_LIMITED";
      error.retryable = true;
    } else if (status === 401 || status === 403) {
      error.code = "AUTH_FORBIDDEN";
      error.retryable = false;
    } else if (status >= 500) {
      error.code = "PROVIDER_SERVER_ERROR";
      error.retryable = true;
    } else {
      error.code = "PROVIDER_CLIENT_ERROR";
      error.retryable = false;
    }

    return error;
  }

  async upscaleImage(imageUrl, factor = 2) {
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
          "Accept": "application/json"
        }
      });

      if (!response.ok) return null;
      const data = await response.json();
      const b64 = data.image || data.b64_json;
      if (!b64) return null;

      const dataUrl = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
      return dataUrl;
    } catch (error) {
      console.error("NVIDIA upscaling error:", error.message);
      return null;
    }
  }
}

module.exports = new NvidiaAdapter();
