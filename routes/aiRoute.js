const express = require("express");
const router = express.Router();
const { chatWithGemini } = require("../models/geminiClient");
const promptSchema = require("../schemas/promptSchema");

// Generate prompt
router.get("/generate-prompt", async (req, res) => {
  const prompt = `
You are a world-class visual prompt writer.

Write a single prompt in EXACTLY two lines (two sentences, separated by a newline).  
Style: bold, cinematic, vivid, and specific; no camera jargon, no model tags, no lists, no quotes.  
Target length: 28–55 words total across both lines.

Line 1: Animal subject + stylized artistic approach + full-body or symbolic composition + key visual elements.  
Line 2: Environment or background motifs  + color palette (only red and black) + texture, motion, or surreal elements.

Constraints:  
- Focus ONLY on animals — full-body, or face..  
- Use ONLY red and black as the color palette.  
- Avoid realistic rendering or soft/cute aesthetics.  
- Style should feel intense, graphic, or otherworldly — like a poster or wallpaper.  
- Return ONLY the two lines.
`;

  try {
    const result = await chatWithGemini(prompt, promptSchema);
    res.send(result);
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

  const finalPrompt = `You're a professional artist agent with experience generating artworks that compete with the best artists in the world. Generate a visually stunning image based on the prompt: ${prompt}`;

  const pollinationsURL = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    finalPrompt
  )}?seed=${seed}&private=${private}&nologo=${nologo}&width=1920&height=1080`;

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
  const finalPrompt = `Your are a professional poet with experience of generating poems that compete with the best poets in the world. 
                        Generate a visually stunning and attractive poem based on the prompt: ${prompt}`;

  try {
    const result = await chatWithGemini(finalPrompt);
    res.json({ poem: result.trim() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate poem" });
  }
});

module.exports = router;
