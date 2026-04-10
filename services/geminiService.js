const { GoogleGenAI } = require("@google/genai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// # gemini chat service
async function chatWithGemini(userPrompt, userSchema) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: userPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: userSchema,
      temperature: 0.8,
    },
  });
  return response.text;
}

module.exports = { chatWithGemini };
