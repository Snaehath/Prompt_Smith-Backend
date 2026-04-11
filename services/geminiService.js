const { GoogleGenAI } = require("@google/genai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// # gemini chat service
async function chatWithGemini(systemPrompt, userPrompt, userSchema) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
    console.error("Gemini AI error:", error);
    throw error;
  }
}

module.exports = { chatWithGemini };
