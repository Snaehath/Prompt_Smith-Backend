const rateLimit = require("express-rate-limit");

// General global rate limiter for general endpoints (100 requests per 15 minutes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests from this IP, please try again after 15 minutes.",
        requestId: req.id || null,
        retryable: true
      }
    });
  }
});

// Dedicated rate limiter for expensive AI endpoints (20 requests per minute)
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "AI_RATE_LIMITED",
        message: "AI synthesis rate limit reached. Please wait a moment before initiating another generation.",
        requestId: req.id || null,
        retryable: true
      }
    });
  }
});

module.exports = { globalLimiter, aiRateLimiter };
