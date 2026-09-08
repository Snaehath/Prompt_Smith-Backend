const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const NVIDIA_MODELS = {
  "flux-1-dev": {
    url: "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
    steps: 50,
    maxPromptLength: 800
  },
  "flux-1-schnell": {
    url: "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell",
    steps: 4,
    maxPromptLength: 800
  },
  "flux-2-klein": {
    url: "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b",
    steps: 4,
    maxPromptLength: 800
  }
};

class NvidiaAdapter {
  constructor() {
    this.name = "nvidia";
  }

  isConfigured() {
    return Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
  }

  async generateImage({ prompt, width = 1024, height = 1024, steps = null, seed = null, modelId = "flux-1-dev", signal = null }) {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      const err = new Error("NVIDIA_API_KEY is not configured");
      err.code = "AUTH_MISSING";
      err.retryable = false;
      throw err;
    }

    const model = NVIDIA_MODELS[modelId] || NVIDIA_MODELS["flux-1-dev"];
    let cappedPrompt = prompt.trim();
    if (model.maxPromptLength && cappedPrompt.length > model.maxPromptLength) {
      cappedPrompt = cappedPrompt.substring(0, model.maxPromptLength - 10);
    }

    const payload = {
      prompt: cappedPrompt,
      width,
      height,
      seed: seed !== null ? seed : Math.floor(Math.random() * 1000000),
      steps: steps || model.steps || 50
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

    const response = await fetch(model.url, fetchOptions);

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

    return {
      imageUrl: `data:image/png;base64,${base64}`,
      provider: "nvidia",
      modelId
    };
  }

  normalizeError(status, bodyText) {
    const error = new Error(`NVIDIA API HTTP ${status}: ${bodyText}`);
    error.status = status;

    if (status === 429) {
      error.code = "RATE_LIMITED";
      error.retryable = true;
    } else if (status === 401 || status === 403) {
      error.code = "AUTH_FORBIDDEN";
      error.retryable = false; // Never blindly retry auth/quota failures
    } else if (status >= 500) {
      error.code = "PROVIDER_SERVER_ERROR";
      error.retryable = true;
    } else {
      error.code = "PROVIDER_CLIENT_ERROR";
      error.retryable = false;
    }

    return error;
  }
}

module.exports = new NvidiaAdapter();
