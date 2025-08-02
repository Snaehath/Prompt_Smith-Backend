const express = require("express");
const router = express.Router();
const { chatWithGemini } = require("../models/geminiClient");

// Generate prompt
router.get("/generate-prompt", async (req, res) => {
  const prompt = `
You are a world-class visual prompt writer.

Write a single prompt in EXACTLY two lines (two sentences, separated by a newline).
Style: concise, cinematic, vivid, and specific; no camera jargon, no model tags, no lists, no quotes.
Target length: 28–55 words total across both lines.

Line 1: Subject + artistic lineage/technique + setting + key design elements (what/where/how it looks).
Line 2: Sky/backdrop + lighting + color palette + texture/motion cues (how it feels visually).

Constraints:
- Vary the subject matter — do NOT focus on any one culture or theme (e.g. samurais, knights, astronauts).
- Prefer diverse scenes from nature, architecture, surrealism, sci-fi, history, fantasy, abstract, everyday life, etc.
- Avoid cultural stereotypes or overused tropes.
- No prefixes or headings; output only those two lines.
- Do not include aspect ratios, version flags, or hashtags.
- Prefer concrete nouns and physical descriptors over abstract moods.

Return ONLY the two lines.
`;

  try {
    const result = await chatWithGemini(prompt);
    res.json({ prompt: result.trim() });
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

  const finalPrompt = `Your are a professional artist agent with experience of generating arts that compete with the best artists in the world. Generate a visually stunning image based on the prompt: ${prompt}`;

  const pollinationsURL = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    finalPrompt
  )}?seed=${seed}&private=${private}&nologo=${nologo}&width=3840&height=2160`;

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

router.post("/generate-poem", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid 'prompt' parameter" });
  }

  try {
    const result = await chatWithGemini(prompt);
    res.json({ poem: result.trim() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate poem" });
  }
});

module.exports = router;
