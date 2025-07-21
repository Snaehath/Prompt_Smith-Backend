const express = require("express");
const router = express.Router();
const { chatWithGemini } = require("../models/geminiClient");

// Generate suggestions
router.post("/generate-suggestions", async (req, res) => {
  const { subject, category = "Image Generation" } = req.body;
  if (!subject) return res.status(400).json({ error: "Subject is required" });

  const prompt = `
    You are an AI assistant that inspires creativity. The user wants to generate a prompt for "${category}" based on the subject "${subject}".

    Your task is to generate three distinct sets of creative keywords. Each set should combine elements like mood, setting, style, and action.
    The result should be a concise, comma-separated list of keywords. These will be presented to the user as options to choose from.
    Each string in the output array should represent one of these creative directions.

    Example for subject "a futuristic city" and category "Image Generation":
    A good creative direction is a comma-separated list of keywords like: "Cyberpunk metropolis, neon-drenched streets, flying vehicles, massive holographic ads, rain-slicked pavement, dystopian mood".
  `;
  try {
    const rawText = await chatWithGemini(prompt);
    const suggestions = rawText
      .split("\n")
      .map(
        (line) =>
          line
            .replace(/^"+|"+$/g, "") // remove leading/trailing quotes
            .replace(/[\[\]`]/g, "") // remove [, ], and backticks
            .replace(/json/gi, "") // remove "json" case-insensitively
            .trim() // remove any extra spaces
      )
      .filter((line) => line.trim() !== "")
      .map(
        (line) => line.split(",").map((item) => item.trim()) // split each line into items
      );

    const trimmed = suggestions.slice(1);

    const cleanedSuggestions = trimmed.map((group) => {
      const [first, ...rest] = group;
      const cleanedFirst = first.replace(/^\d+\.\s*/, "");

      return [cleanedFirst, ...rest]
        .map((item) => item.trim().split(/\s+/).slice(0, 3).join(" "))
        .filter((item) => item !== "");
    });
    // console.log(cleanedSuggestions);
    res.json({ suggestions: cleanedSuggestions }); // Send the suggestions as a JSON response
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate suggestions" });
  }
});

// Generate prompt
router.post("/generate-prompt", async (req, res) => {
  const { subject, keywords } = req.body;
  if (!subject) return res.status(400).json({ error: "Subject is required" });
  if (!keywords) return res.status(400).json({ error: "keywords is required" });

  const prompt = `
Generate a richly detailed, professional cinematic prompt suitable for high-end AI image generation models such as Midjourney, DALL·E, or Leonardo.ai.

The concept is: "${subject}"

Use the following descriptive keywords to enrich the worldbuilding: ${keywords}.

Structure the prompt in detailed thematic sections, similar to a high-end visual matte painting or National Geographic aerial documentary storyboard. Include categories such as:
- Geographic zones and landmarks (ordered spatially)
- Environmental features
- Human activity
- Lighting and atmosphere
- Visual style and tone

Use clear section headers and rich descriptions with bullet points under each. Include emojis to visually distinguish sections like 📍🏛🌿🌇🎨, but keep the style cinematic and factual. Use visual storytelling language — not abstract mood terms. Do not include technical model tags (like --ar or --v). Just return the full visual prompt.
`;
  try {
    const fullPrompt = await chatWithGemini(prompt);
    res.json({ prompt: fullPrompt.trim() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate prompt" });
  }
});

// Fetch AI-generated image from Pollinations
router.post("/generate-image", async (req, res) => {
  const { prompt } = req.body;
  const { seed = "-1", nologo = "true", private = "true" } = req.query;

  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid 'prompt' parameter" });
  }

  const pollinationsURL = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?seed=${seed}&private=${private}&nologo=${nologo}`;

  try {
    const response = await fetch(pollinationsURL);

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "Pollinations API error" });
    }

    // Set proper content-type and return the image
    res.setHeader("Content-Type", "image/jpeg");
    const buffer = await response.arrayBuffer();
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error("Image generation error:", error);
    res.status(500).json({ error: "Failed to generate image" });
  }
});

module.exports = router;
