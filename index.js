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


// System Health & Status
app.get("/api/status", (req, res) => {
  res.json({ 
    status: "online", 
    version: "2.1.0",
    service: "PromptSmith AI Gateway",
    requestId: req.id,
    features: ["Gemini-Reasoning", "NVIDIA-FLUX", "Pollinations-Failover", "SSE-Streaming"]
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
    app.listen(port, () => {
      console.log(`🚀 PromptSmith Engine listening on port ${port}`);
    });
  } catch (err) {
    console.error("PromptSmith startup failure:", err);
  }
};

startServer();
