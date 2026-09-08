const crypto = require("crypto");

/**
 * Request ID Middleware
 * Assigns a unique X-Request-ID to every incoming request for distributed tracing and observability.
 * Respects existing X-Request-ID from upstream proxies/clients if provided.
 */
const requestIdMiddleware = (req, res, next) => {
  const incomingId = req.headers["x-request-id"];
  const requestId = (typeof incomingId === "string" && incomingId.trim().length > 0)
    ? incomingId.trim()
    : `req_${crypto.randomUUID()}`;

  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
};

module.exports = { requestIdMiddleware };
