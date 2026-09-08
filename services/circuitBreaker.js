// Three-state circuit breaker: CLOSED, OPEN, HALF_OPEN
const CircuitState = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN"
};

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3; // Consecutive failures to trip
    this.cooldownMs = options.cooldownMs || 60000; // 60s probe cooldown
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  // Execute action with circuit protection and automatic fallback
  async execute(action, fallback) {
    const now = Date.now();

    // Check if cooldown has elapsed while in OPEN state
    if (this.state === CircuitState.OPEN) {
      if (now - this.lastFailureTime >= this.cooldownMs) {
        console.log(`[CircuitBreaker:${this.name}] Cooldown expired. Entering HALF_OPEN state to test probe.`);
        this.state = CircuitState.HALF_OPEN;
      } else {
        const remainingSec = Math.ceil((this.cooldownMs - (now - this.lastFailureTime)) / 1000);
        console.warn(`[CircuitBreaker:${this.name}] Circuit is OPEN. Fast-failing to fallback (${remainingSec}s cooldown remaining).`);
        return await fallback({ reason: "CIRCUIT_OPEN", cooldownRemainingSec: remainingSec });
      }
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      if (fallback) {
        console.warn(`[CircuitBreaker:${this.name}] Execution failed, dispatching to fallback... Error: ${error.message}`);
        return await fallback({ reason: "EXECUTION_FAILURE", error });
      }
      throw error;
    }
  }

  recordSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      console.log(`[CircuitBreaker:${this.name}] Probe succeeded! Circuit recovered. Resetting to CLOSED.`);
      this.state = CircuitState.CLOSED;
      this.failureCount = 0;
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
    this.successCount++;
  }

  recordFailure(error) {
    // Client errors (4xx other than 429) do NOT indicate provider unhealthiness
    if (error && error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
      console.log(`[CircuitBreaker:${this.name}] Ignoring client-side error (HTTP ${error.status}) for circuit tripping.`);
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      console.warn(`[CircuitBreaker:${this.name}] Probe failed in HALF_OPEN state. Re-opening circuit.`);
      this.state = CircuitState.OPEN;
    } else if (this.failureCount >= this.failureThreshold) {
      console.warn(
        `[CircuitBreaker:${this.name}] Failure threshold (${this.failureThreshold}) exceeded. Opening circuit for ${this.cooldownMs / 1000}s.`
      );
      this.state = CircuitState.OPEN;
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      cooldownMs: this.cooldownMs
    };
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}

module.exports = { CircuitBreaker, CircuitState };
