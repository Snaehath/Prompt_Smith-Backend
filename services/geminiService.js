const { GoogleGenAI } = require("@google/genai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// # gemini chat service with model fallback
async function chatWithGemini(systemPrompt, userPrompt, userSchema) {
  const models = ["gemini-3-flash-preview", "gemini-2.5-flash"];
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
      return JSON.parse(textBlob);
    } catch (error) {
      console.warn(`Gemini generation failed with ${model}, trying next... Error:`, error.message);
      lastError = error;
    }
  }

  console.error("All Gemini models failed:", lastError);
  throw lastError;
}

module.exports = { chatWithGemini };
