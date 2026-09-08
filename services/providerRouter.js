const { CircuitBreaker } = require("./circuitBreaker");
const nvidiaAdapter = require("./providers/nvidiaAdapter");
const pollinationsAdapter = require("./providers/pollinationsAdapter");

// Helper for exponential backoff delay
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ProviderRouter {
  constructor() {
    // Circuit Breaker for NVIDIA NIM (trip after 3 consecutive failures, 60s cooldown)
    this.nvidiaBreaker = new CircuitBreaker("nvidia-nim", {
      failureThreshold: 3,
      cooldownMs: 60000
    });
  }

  /**
   * Synthesize image with Circuit Breaker and Exponential Backoff
   */
  async synthesizeImage({
    prompt,
    resolution = "16:9",
    modelId = "flux-1-dev",
    steps = null,
    seed = null,
    signal = null
  }) {
    let width = 1024, height = 1024;
    if (resolution === "1080x1920" || resolution.includes("mobile") || resolution === "9:16") {
      width = 832;
      height = 1248;
    } else if (resolution === "1920x1080" || resolution === "16:9") {
      width = 1248;
      height = 832;
    }

    // Direct routing if client explicitly requested Pollinations
    if (modelId.startsWith("pollinations")) {
      return await pollinationsAdapter.generateImage({
        prompt,
        width,
        height,
        seed,
        modelId,
        signal
      });
    }

    // Otherwise, route through NVIDIA NIM with Circuit Breaker protection
    const fallbackToPollinations = async ({ reason, error }) => {
      console.warn(`[ProviderRouter] Routing to Pollinations failover (Reason: ${reason}).`);
      const fallbackResult = await pollinationsAdapter.generateImage({
        prompt,
        width,
        height,
        seed,
        modelId: "pollinations-flux",
        signal
      });
      return {
        ...fallbackResult,
        fallbackUsed: true,
        primaryFailureReason: reason
      };
    };

    // If NVIDIA key is not configured, skip straight to fallback
    if (!nvidiaAdapter.isConfigured()) {
      return await fallbackToPollinations({ reason: "NVIDIA_KEY_NOT_CONFIGURED" });
    }

    // Execute via Circuit Breaker
    return await this.nvidiaBreaker.execute(async () => {
      // Retry policy: If 429 / rate limited, back off once
      try {
        return await nvidiaAdapter.generateImage({
          prompt,
          width,
          height,
          steps,
          seed,
          modelId,
          signal
        });
      } catch (err) {
        if (err.retryable && err.status === 429 && !signal?.aborted) {
          console.warn("[ProviderRouter] NVIDIA rate limited (429). Backing off 1.5s before 1 retry...");
          await sleep(1500);
          return await nvidiaAdapter.generateImage({
            prompt,
            width,
            height,
            steps,
            seed,
            modelId,
            signal
          });
        }
        throw err;
      }
    }, fallbackToPollinations);
  }

  getCircuitStatus() {
    return {
      nvidia: this.nvidiaBreaker.getStatus()
    };
  }
}

module.exports = new ProviderRouter();
