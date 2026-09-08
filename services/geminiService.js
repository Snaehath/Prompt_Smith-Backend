const { GoogleGenAI } = require("@google/genai");

let aiClient = null;

const getAIClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    const error = new Error("GEMINI_API_KEY environment variable is not configured");
    error.code = "AUTH_MISSING";
    error.statusCode = 500;
    error.retryable = false;
    throw error;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: apiKey.trim() });
  }
  return aiClient;
};

// Gemini Chat Service with automatic model fallback (Structured JSON Output)
async function chatWithGemini(systemPrompt, userPrompt, userSchema) {
  const ai = getAIClient();
  const models = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];
  let lastError;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: userSchema,
          temperature: 0.8,
        },
      });

      const textBlob = response.text;
      if (!textBlob) {
        throw new Error("Gemini returned empty text response");
      }
      return JSON.parse(textBlob);
    } catch (error) {
      console.warn(`[GeminiService] Generation failed with ${model}, trying next... Error:`, error.message);
      lastError = error;
    }
  }

  console.error("[GeminiService] All Gemini models failed:", lastError);
  const normalizedError = new Error(lastError?.message || "Failed to generate prompt blueprint with Gemini");
  normalizedError.code = "GEMINI_INFERENCE_FAILED";
  normalizedError.retryable = true;
  throw normalizedError;
}

// Generate a complete prompt from a creative seed idea
async function generatePromptFromIdea(topic = "a surreal fantasy landscape", style = "") {
  const ai = getAIClient();
  const models = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];
  let lastError;

  const systemInstruction = `You are a Lead Prompt Architect and Art Director for high-end generative AI image models (FLUX, Midjourney, SDXL).
Given the user's creative seed: "${topic}" ${style ? `and style directive: "${style}"` : ""}, craft an ultra-detailed, evocative, production-ready image generation prompt.
Describe sensory details: focal subject, environmental atmosphere, camera optics/lens (e.g. 35mm, 85mm f/1.4), lighting setup (e.g. volumetric, rim lighting, chiaroscuro), and material textures.
Output ONLY the final image generation prompt text directly without commentary, explanations, quotes, or markdown code fences.`;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: `Craft a master prompt for: ${topic}` }] }],
        config: {
          systemInstruction,
          temperature: 0.85,
        }
      });

      const text = response.text ? response.text.trim().replace(/^["']|["']$/g, "") : null;
      if (text) {
        return {
          prompt: text,
          title: topic.slice(0, 32).trim(),
          style: style || undefined
        };
      }
    } catch (error) {
      console.warn(`[GeminiService] Prompt generation failed with ${model}, trying next... Error:`, error.message);
      lastError = error;
    }
  }

  console.error("[GeminiService] All Gemini models failed for generatePromptFromIdea:", lastError);
  const normalizedError = new Error(lastError?.message || "Failed to generate prompt with Gemini");
  normalizedError.code = "GEMINI_INFERENCE_FAILED";
  normalizedError.retryable = true;
  throw normalizedError;
}

// Enhance an existing draft prompt with rich cinematography details
async function enhanceExistingPrompt(prompt, style = "") {
  const ai = getAIClient();
  const models = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];
  let lastError;

  const systemInstruction = `You are a Master Prompt Enhancer for generative AI models.
Take the user's existing prompt: "${prompt}" ${style ? `with style modifier: "${style}"` : ""}.
Upgrade it by weaving in cinematic lighting (volumetric rays, dynamic contrast), camera optics (lens focal length, aperture, depth of field), atmospheric depth, and textural fidelity.
CRITICAL: Preserve the user's original core subject and intent.
Output ONLY the enhanced prompt string without commentary, explanations, quotes, or markdown code blocks.`;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: `Enhance this prompt: ${prompt}` }] }],
        config: {
          systemInstruction,
          temperature: 0.8,
        }
      });

      const text = response.text ? response.text.trim().replace(/^["']|["']$/g, "") : null;
      if (text) {
        return {
          enhancedPrompt: text,
          originalPrompt: prompt,
          style: style || undefined
        };
      }
    } catch (error) {
      console.warn(`[GeminiService] Prompt enhancement failed with ${model}, trying next... Error:`, error.message);
      lastError = error;
    }
  }

  console.error("[GeminiService] All Gemini models failed for enhanceExistingPrompt:", lastError);
  const normalizedError = new Error(lastError?.message || "Failed to enhance prompt with Gemini");
  normalizedError.code = "GEMINI_INFERENCE_FAILED";
  normalizedError.retryable = true;
  throw normalizedError;
}

module.exports = {
  chatWithGemini,
  generatePromptFromIdea,
  enhanceExistingPrompt
};
