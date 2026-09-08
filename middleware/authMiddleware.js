const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { getSecret } = require("../utils/jwt");

/**
 * Generate a short-lived (60s), single-purpose SSE stream ticket.
 * Scoped strictly to a specific user and jobId.
 */
const createStreamTicket = (userId, jobId, expiresIn = 60) => {
  return jwt.sign(
    {
      type: "sse_stream",
      userId: userId ? userId.toString() : null,
      jobId: jobId.toString()
    },
    getSecret(),
    { expiresIn }
  );
};

/**
 * Parse auth token from Bearer header, HttpOnly cookie, or SSE stream ticket
 */
const extractTokenAndVerify = async (req) => {
  let token = null;

  // 1. Authorization: Bearer <token>
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
    const decoded = jwt.verify(token, getSecret());
    if (decoded.id) {
      return await User.findById(decoded.id).select("-password");
    }
  }

  // 2. Cookie: token=<jwt>
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) {
      token = match[1];
      const decoded = jwt.verify(token, getSecret());
      if (decoded.id) {
        return await User.findById(decoded.id).select("-password");
      }
    }
  }

  // 3. Short-lived SSE ticket in query (?ticket=...)
  if (req.query && req.query.ticket) {
    const ticket = req.query.ticket;
    const decoded = jwt.verify(ticket, getSecret());

    if (decoded.type !== "sse_stream") {
      throw ApiError.unauthorized("Invalid ticket scope", "INVALID_TICKET_SCOPE");
    }

    if (req.params.id && decoded.jobId !== req.params.id) {
      throw ApiError.unauthorized("Ticket does not match requested generation job", "TICKET_JOB_MISMATCH");
    }

    if (decoded.userId) {
      return await User.findById(decoded.userId).select("-password");
    }
    return null; // Valid guest ticket
  }

  return null;
};

/**
 * Enforce authentication: Rejects if no valid user credentials found
 */
const protect = async (req, res, next) => {
  try {
    const user = await extractTokenAndVerify(req);
    if (!user) {
      throw ApiError.unauthorized("Authentication required", "AUTH_REQUIRED");
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return next(ApiError.unauthorized("Token expired", "TOKEN_EXPIRED"));
    }
    if (error.name === "JsonWebTokenError") {
      return next(ApiError.unauthorized("Invalid token", "INVALID_TOKEN"));
    }
    next(error);
  }
};

/**
 * Optional authentication: Associates user if credentials present, but allows guest access
 */
const optionalProtect = async (req, res, next) => {
  try {
    const user = await extractTokenAndVerify(req);
    req.user = user || null;
    next();
  } catch (error) {
    // If an explicitly malformed ticket is sent to an SSE stream, reject it
    if (req.query?.ticket) {
      return next(error);
    }
    req.user = null;
    next();
  }
};

module.exports = { protect, optionalProtect, createStreamTicket };
