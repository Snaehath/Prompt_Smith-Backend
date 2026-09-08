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

/**
 * Gemini Chat Service with automatic model fallback
 */
async function chatWithGemini(systemPrompt, userPrompt, userSchema) {
  const ai = getAIClient();
  const models = ["gemini-2.5-flash", "gemini-1.5-flash"];
  let lastError;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        systemInstruction: systemPrompt,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
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

module.exports = { chatWithGemini };
