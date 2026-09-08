require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { connectDB } = require("./utils/db");
const { globalLimiter } = require("./middleware/rateLimiter");
const { requestIdMiddleware } = require("./middleware/requestId");

const app = express();
const port = process.env.PORT || 5000;

// Request tracing & Security
app.use(requestIdMiddleware);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  exposedHeaders: ["X-Request-ID"]
}));
app.use(express.json({ limit: "10mb" }));
app.use(globalLimiter);

// Routes
const authRoutes = require("./routes/authRoutes");
const promptRoutes = require("./routes/promptRoutes");
const promptNeuralRoute = require("./routes/promptRoute");
const generationRoutes = require("./routes/generationRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/prompts", promptRoutes);
app.use("/api/prompt", promptNeuralRoute);
app.use("/api/generations", generationRoutes);


// System Health & Observability Probes
app.get("/health/live", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "promptsmith-backend",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get("/health/ready", (req, res) => {
  const mongoose = require("mongoose");
  const providerRouter = require("./services/providerRouter");
  const isDbConnected = mongoose.connection.readyState === 1;

  const checks = {
    database: isDbConnected ? "connected" : "disconnected",
    circuits: providerRouter.getCircuitStatus()
  };

  if (!isDbConnected) {
    return res.status(503).json({
      status: "degraded",
      message: "Database connection not ready",
      checks
    });
  }

  res.status(200).json({
    status: "ready",
    uptimeSeconds: Math.floor(process.uptime()),
    checks
  });
});

app.get("/api/status", (req, res) => {
  res.json({ 
    status: "online", 
    version: "2.2.0",
    service: "PromptSmith Production AI Gateway",
    requestId: req.id,
    features: ["Gemini-Reasoning", "NVIDIA-FLUX", "Pollinations-Failover", "Async-Job-Queue", "SSE-Telemetry", "Circuit-Breaker"]
  });
});

// 404 Catch-all handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Cannot ${req.method} ${req.originalUrl}`,
      requestId: req.id,
      retryable: false
    }
  });
});

// Centralized structured error handling
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const isServerFault = statusCode >= 500;

  if (isServerFault) {
    console.error(`[Error] [${req.id}] ${req.method} ${req.originalUrl}:`, err);
  }

  res.status(statusCode).json({
    error: {
      code: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "An unexpected error occurred",
      requestId: req.id,
      retryable: typeof err.retryable === "boolean" ? err.retryable : false,
      ...(err.details ? { details: err.details } : {})
    }
  });
});

const startServer = async () => {
  try {
    await connectDB();

    // Reconcile and recover any jobs interrupted by previous server lifecycle
    const { generationQueue } = require("./services/generationQueue");
    await generationQueue.reconcileZombieJobs();

    app.listen(port, () => {
      console.log(`🚀 PromptSmith Engine listening on port ${port}`);
    });
  } catch (err) {
    console.error("PromptSmith startup failure:", err);
  }
};

startServer();
