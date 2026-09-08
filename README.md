# 🛠️ PromptSmith Backend — Production AI Gateway & API Specification

> **PromptSmith Backend** is an enterprise-grade Generative AI orchestration gateway. It decouples generation job creation from real-time telemetry streaming, protects external provider quotas via an automated Three-State Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`), enforces request idempotency, and delivers real-time progress via safe Server-Sent Events (SSE).

🔗 **Companion Frontend Repository:** [https://github.com/Snaehath/Prompt_Smith-Frontend](https://github.com/Snaehath/Prompt_Smith-Frontend)

---

## 📑 Table of Contents
1. [Architecture & System Design](#-architecture--system-design)
2. [Environment Configuration](#-environment-configuration)
3. [Getting Started](#-getting-started)
4. [Model Registry & Providers](#-model-registry--providers)
5. [Asynchronous Generation Lifecycle](#-asynchronous-generation-lifecycle)
6. [API Endpoints Reference](#-api-endpoints-reference)
   - [Health & Observability Probes](#1-health--observability-probes)
   - [Asynchronous Generation Job API](#2-asynchronous-generation-job-api)
   - [Neural Expansion (Synchronous Blueprint)](#3-neural-expansion-synchronous-blueprint)
   - [Prompt Library CRUD (Protected)](#4-prompt-library-crud-protected)
6. [Frontend Integration Contract (Next.js / TypeScript)](#-frontend-integration-contract-nextjs)
   - [TypeScript Interfaces](#typescript-interfaces)
   - [Asynchronous Generation Hook (`useGenerationJob`)](#asynchronous-generation-hook-usegenerationjob)
7. [Resilience: Three-State Circuit Breaker](#-resilience-three-state-circuit-breaker)
8. [Error Handling Contract](#-error-handling-contract)
9. [Resume & Engineering Showcase Highlights](#-resume--engineering-showcase-highlights)

---

## 🏗️ Architecture & System Design

```
                          ┌──────────────────────────┐
                          │   Client Application     │
                          └─────────────┬────────────┘
                                        │
                         POST /api/generations (Idempotent)
                                        │
                                        ▼
                          ┌──────────────────────────┐
                          │   Generation Controller  │
                          └─────────────┬────────────┘
                                        │
                                ┌───────┴───────┐
                                │ Enqueue Job   │
                                ▼               ▼
                      ┌──────────────────┐  ┌─────────────────────┐
                      │ MongoDB Record   │  │  GenerationQueue    │
                      │ (Status: QUEUED) │  │  (Concurrency: 4)   │
                      └──────────────────┘  └──────────┬──────────┘
                                                       │
                                              Job Worker Thread
                                                       │
                           ┌───────────────────────────┴───────────────────────────┐
                           │                                                       │
                           ▼                                                       ▼
                ┌─────────────────────┐                                 ┌─────────────────────┐
                │ Gemini Reasoning    │ (Few-shot expansion)            │ ProviderRouter      │
                └──────────┬──────────┘                                 └──────────┬──────────┘
                           │                                                       │
                           ▼                                                       ▼
                Structured Blueprint                                    ┌─────────────────────┐
                                                                        │ Circuit Breaker     │
                                                                        │ CLOSED/OPEN/HALF    │
                                                                        └──────────┬──────────┘
                                                                                   │
                                                                       ┌───────────┴───────────┐
                                                                       ▼                       ▼
                                                                Primary: NVIDIA       Failover: Pollinations
                                                                       │                       │
                                                                       └───────────┬───────────┘
                                                                                   │
                                                                            Image Synthesis
                                                                                   │
                                                                                   ▼
                                                                        Emit SSE 'complete' Event
                                                                                   │
                                                                                   ▼
                                                                        Close Client Stream
```

---

## ⚙️ Environment Configuration

Configure `.env` in the `backend/` directory:

```env
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/promptsmith?retryWrites=true&w=majority
JWT_SECRET=your_super_secret_jwt_key
GEMINI_API_KEY=AIzaSy...
NVIDIA_API_KEY=nvapi-... # Optional: If missing/exhausted, circuit router automatically routes to Pollinations
```

---

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Running the Server
```bash
# Start server in production mode
npm start

# Start server in development mode (hot-reload with nodemon)
npm run dev
```

---

## 🧠 Model Registry & Providers

Query `GET /api/prompt/models` to retrieve available engines:

| Model ID | Provider | Steps | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`flux-2-klein`** | NVIDIA NIM | 4 | ✅ Yes | Next-gen ultra-fast distilled neural synthesis (4 steps) |

---

## 🔄 Asynchronous Generation Lifecycle

The generation pipeline is split into **Job Creation** and **Telemetry Listening**:

1. **Job Creation (`POST /api/generations`)**: Validates parameters, checks `Idempotency-Key` (preventing duplicate billing/renders on retry), creates the job record in MongoDB, and enqueues it. Returns `{ jobId, status: "queued", eventsUrl }` immediately.
2. **Telemetry Stream (`GET /api/generations/:id/events`)**: Connects to pure read-only Server-Sent Events (SSE). Reconnecting to this endpoint **NEVER** re-triggers generation.
3. **Cancellation (`POST /api/generations/:id/cancel`)**: Aborts the job via `AbortController`, terminates in-flight network requests to NVIDIA/Pollinations, and transitions state to `cancelled`.

### State Transitions:
```
[queued] ➔ [running] ➔ [blueprinting] ➔ [rendering] ➔ [archiving] ➔ [completed]
   │           │               │              │             │
   └───────────┴───────────────┴──────────────┴─────────────┴──➔ [cancelled] / [failed]
```

---

## 📡 API Endpoints Reference

Base URL: `http://localhost:5000`

### 1. Health & Observability Probes

#### `GET /health/live`
Lightweight liveness probe for load balancers.
- **Response (200 OK):**
  ```json
  {
    "status": "ok",
    "service": "promptsmith-backend",
    "uptimeSeconds": 142,
    "timestamp": "2026-09-08T11:00:00.000Z"
  }
  ```

#### `GET /health/ready`
Deep readiness probe checking database connectivity and circuit breaker status.
- **Response (200 OK / 503 Degraded):**
  ```json
  {
    "status": "ready",
    "uptimeSeconds": 142,
    "checks": {
      "database": "connected",
      "circuits": {
        "nvidia": {
          "name": "nvidia-nim",
          "state": "CLOSED",
          "failureCount": 0,
          "cooldownMs": 60000
        }
      }
    }
  }
  ```

---

### 2. Asynchronous Generation Job API

#### `POST /api/generations`
Creates an asynchronous generation job.
- **Headers:**
  - `Content-Type: application/json`
  - `Idempotency-Key: <unique-uuid>` *(Recommended to prevent duplicate billing)*
  - `Authorization: Bearer <token>` *(Optional: associates job with user account)*
- **Body:**
  ```json
  {
    "subject": "Cyberpunk Ronin",
    "action": "drawing a plasma katana in the rain",
    "style": "Cinematic neo-Tokyo realism",
    "context": "Dark alley reflecting neon puddles",
    "complexity": 4,
    "resolution": "16:9",
    "modelId": "flux-1-dev",
    "seed": 42198
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "jobId": "67ce1a0f8b72...",
    "status": "queued",
    "stage": "queued",
    "progress": 0,
    "eventsUrl": "/api/generations/67ce1a0f8b72.../events"
  }
  ```

#### `GET /api/generations/:id/events`
Server-Sent Events (SSE) telemetry stream for a generation job.
- **Connection Details:**
  - Emits monotonic event IDs (`id: 1`, `id: 2`, ...)
  - Automatically sends `: heartbeat` ping every 15s to keep connection alive.
  - Sends immediate snapshot if connecting after job already started or finished.
- **Event Output Format:**
  ```http
  id: 1
  event: stage
  data: {"generationId":"...","stage":"blueprint_synthesis","progress":20,"message":"Expanding visual blueprint with Gemini reasoning engine..."}

  id: 2
  event: blueprint
  data: {"title":"Neon Ronin Awakening","prompt":"Full-body portrait of a cyborg samurai..."}

  id: 3
  event: stage
  data: {"generationId":"...","stage":"visual_rendering","progress":50,"message":"Synthesizing canvas using flux-1-dev engine..."}

  id: 4
  event: stage
  data: {"generationId":"...","stage":"archiving","progress":85,"message":"Persisting blueprint and image artifacts..."}

  id: 5
  event: complete
  data: {"generationId":"...","status":"completed","progress":100,"imageUrl":"data:image/jpeg;base64,...","durationMs":6820}
  ```

#### `POST /api/generations/:id/cancel`
Aborts an in-flight or queued generation job.
- **Response (200 OK):**
  ```json
  {
    "jobId": "67ce1a0f8b72...",
    "status": "cancelled",
    "success": true
  }
  ```

#### `GET /api/generations/:id`
Polling fallback endpoint returning full job state document.

#### `GET /api/generations?page=1&limit=20`
Paginated generation history for user or guest sessions.

---

### 3. Neural Expansion (Synchronous Blueprint)

#### `POST /api/prompt/expand`
Transforms 4 raw inputs into a master art director blueprint using Gemini few-shot reasoning.
- **Body:** `{ "subject": "Cyberpunk Ronin", "complexity": 4 }`
- **Response (200 OK):** Blueprint JSON with title, prompt, description.

---

### 4. Prompt Library CRUD (Protected)

Requires `Authorization: Bearer <token>`
- `GET /api/prompts?page=1&limit=20`: User saved prompt templates.
- `POST /api/prompts`: Save a new prompt template.
- `PUT /api/prompts/:id`: Update prompt (creates version history record; IDOR protected).
- `DELETE /api/prompts/:id`: Delete prompt (IDOR protected).

---

## 💻 Frontend Integration Contract (Next.js)

> **Frontend Project:** [https://github.com/Snaehath/Prompt_Smith-Frontend](https://github.com/Snaehath/Prompt_Smith-Frontend)

### TypeScript Interfaces

Save as `types/generation.ts`:

```typescript
export type GenerationStatus =
  | "queued"
  | "running"
  | "blueprinting"
  | "rendering"
  | "archiving"
  | "completed"
  | "failed"
  | "cancelled";

export interface CreateGenerationPayload {
  subject: string;
  action?: string;
  style?: string;
  context?: string;
  complexity?: number;
  resolution?: "16:9" | "1:1" | "9:16" | "1080x1920" | "1920x1080";
  modelId?: string;
  seed?: number;
}

export interface GenerationJobResponse {
  jobId: string;
  status: GenerationStatus;
  stage: string;
  progress: number;
  eventsUrl: string;
  isDuplicate?: boolean;
}

export interface PromptBlueprint {
  title: string;
  subject: string;
  action: string;
  style: string;
  context: string;
  description: string;
  prompt: string;
}

export interface GenerationCompleteEvent {
  generationId: string;
  status: "completed";
  progress: 100;
  imageUrl: string;
  blueprint: PromptBlueprint;
  durationMs: number;
}
```

### Asynchronous Generation Hook (`useGenerationJob`)

Save as `hooks/useGenerationJob.ts`:

```typescript
import { useState, useRef } from "react";
import { CreateGenerationPayload, GenerationJobResponse, GenerationCompleteEvent, PromptBlueprint } from "@/types/generation";

export function useGenerationJob() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [blueprint, setBlueprint] = useState<PromptBlueprint | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const startGeneration = async (payload: CreateGenerationPayload, token?: string) => {
    try {
      setStatus("submitting");
      setProgress(5);
      setStatusMessage("Enqueuing generation job...");
      setError(null);
      setImageUrl(null);

      // Generate unique idempotency key for this generation attempt
      const idempotencyKey = crypto.randomUUID();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // 1. Post job to backend
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/generations`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || "Failed to create generation job");
      }

      const job: GenerationJobResponse = await res.json();
      setJobId(job.jobId);
      setStatus(job.status);
      setProgress(10);
      setStatusMessage("Job enqueued. Connecting to telemetry stream...");

      // 2. Connect to pure read-only SSE stream
      const sseUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${job.eventsUrl}`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.addEventListener("stage", (e) => {
        const data = JSON.parse(e.data);
        setProgress(data.progress || 30);
        setStatusMessage(data.message || "Synthesizing artwork...");
      });

      es.addEventListener("blueprint", (e) => {
        const bp: PromptBlueprint = JSON.parse(e.data);
        setBlueprint(bp);
      });

      es.addEventListener("complete", (e) => {
        const data: GenerationCompleteEvent = JSON.parse(e.data);
        setProgress(100);
        setStatus("completed");
        setStatusMessage("Generation complete!");
        setImageUrl(data.imageUrl);
        es.close();
      });

      es.addEventListener("failed", (e) => {
        const data = JSON.parse(e.data);
        setStatus("failed");
        setError(data.message || "Generation failed");
        es.close();
      });

      es.addEventListener("cancelled", (e) => {
        setStatus("cancelled");
        setStatusMessage("Generation cancelled");
        es.close();
      });

      es.onerror = () => {
        // SSE handles reconnection automatically with retry: 3000
        console.warn("SSE connection interrupted, retrying...");
      };
    } catch (err: any) {
      setStatus("failed");
      setError(err.message || "An error occurred");
    }
  };

  const cancelJob = async (token?: string) => {
    if (!jobId) return;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/generations/${jobId}/cancel`, {
        method: "POST",
        headers
      });

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      setStatus("cancelled");
      setStatusMessage("Generation cancelled by user.");
    } catch (err) {
      console.error("Cancel request failed:", err);
    }
  };

  return {
    startGeneration,
    cancelJob,
    jobId,
    status,
    progress,
    statusMessage,
    blueprint,
    imageUrl,
    error
  };
}
```

---

## 🛡️ Resilience: Three-State Circuit Breaker

The backend protects against cascading failures and quota depletion:

```
           ┌──────────────────────┐
           │   CLOSED (Healthy)   │ ◄─────── Probe Succeeded
           └──────────┬───────────┘
                      │
           3 Consecutive Failures
                      │
                      ▼
           ┌──────────────────────┐
           │     OPEN (Tripped)   │ ───────► Immediate failover to Pollinations
           └──────────┬───────────┘          (No calls dispatched to primary)
                      │
           60s Cooldown Elapsed
                      │
                      ▼
           ┌──────────────────────┐
           │      HALF_OPEN       │ ───────► Probe Request Dispatched
           └──────────┬───────────┘
                      │
               Probe Failed
                      │
                      ▼
             Re-enter OPEN State
```

---

## 🚨 Error Handling Contract

All error responses return structured JSON:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Invalid input parameters provided",
    "requestId": "req_5f2c418a-9e58-4a61-8280-928d32be6a24",
    "retryable": false,
    "details": [
      { "field": "subject", "message": "Subject is required and cannot be empty" }
    ]
  }
}
```

### Machine-Readable Error Codes:
- `VALIDATION_FAILED`: Request payload schema invalid.
- `RATE_LIMITED` / `AI_RATE_LIMITED`: Rate limits reached.
- `UNAUTHORIZED` / `AUTH_FORBIDDEN`: JWT missing, expired, or resource belongs to another user.
- `JOB_NOT_FOUND`: Specified `jobId` does not exist.
- `PROVIDER_TIMEOUT`: Primary AI engine timed out.
- `GENERATION_CANCELLED`: Job aborted by user.
- `INTERNAL_SERVER_ERROR`: Unhandled server exception.

---

## 🏆 Resume & Engineering Showcase Highlights

- **Asynchronous Decoupled AI Pipeline:**
  > *"Architected a decoupled Generative AI job engine separating job dispatch (`POST /api/generations`) from Server-Sent Events telemetry (`GET /events`), preventing duplicate inferences during browser network reconnections."*
- **Idempotency & Concurrency Management:**
  > *"Implemented distributed request idempotency with MongoDB sparse indexing and an in-process concurrency-limited queue, eliminating duplicate billing and throttling risks."*
- **Three-State Circuit Breaker & Automatic Failover:**
  > *"Engineered a formal Three-State Circuit Breaker (`CLOSED`, `OPEN`, `HALF_OPEN`) with exponential backoff and automatic failover from NVIDIA NIM to Pollinations FLUX, ensuring zero-downtime availability."*
- **Enterprise Observability & Security:**
  > *"Integrated distributed request tracing (`X-Request-ID`), Kubernetes-compatible liveness/readiness probes (`/health/live`, `/health/ready`), and atomic IDOR ownership validation."*
