const express = require("express");
const router = express.Router();
const { chatWithGemini } = require("../models/geminiClient");

// Generate suggestions
router.post("/generate-suggestions", async (req, res) => {
  const { subject, category } = req.body;
  if (!subject) return res.status(400).json({ error: "Subject is required" });
  if (!category) {
    return res.status(400).json({ error: "Category is required" });
  }
  const imagePrompt = `
    You are an AI assistant that inspires creativity and artistic ideas. The user wants to generate a prompt for "${category}" based on the subject "${subject}".

    Your task is to generate three distinct sets of creative keywords. Each set should combine elements like mood, setting, style, and action.
    The result should be a concise, comma-separated list of keywords. These will be presented to the user as options to choose from.
    Each string in the output array should represent one of these creative directions.

    Example for subject "a futuristic city" and category "Image Generation":
    A good creative direction is a comma-separated list of keywords like: "Cyberpunk metropolis, neon-drenched streets, flying vehicles, massive holographic ads, rain-slicked pavement, dystopian mood".
  `;
  const textGenPrompt = `
You are an AI assistant that inspires creativity and writing ideas. The user wants to generate a prompt for "${category}" based on the subject "${subject}".

Your task is to generate three distinct sets of creative keywords. Each set should combine elements relevant to storytelling, such as genre, tone, setting, character archetypes, themes, or conflicts.
The result should be a concise, comma-separated list of keywords. These will be used to guide AI-generated writing.

Each string in the output array should represent one unique creative direction for a story.

Example for subject "a forgotten library" and category "Text Generation":
"Dark academia, dusty tomes, hidden knowledge, ancient curse, introverted scholar, gothic tone"
"Urban fantasy, secret society, magical realism, candlelit halls, whispered spells, mystery"
"Post-apocalyptic, abandoned archives, crumbling knowledge, lone survivor, AI prophecy, survival theme"
`;

  const prompt = category === "Image Generation" ? imagePrompt : textGenPrompt;

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
  const { subject, keywords, category } = req.body;
  if (!subject) return res.status(400).json({ error: "Subject is required" });
  if (!keywords) return res.status(400).json({ error: "keywords is required" });

  const imagePrompt = `
Your are an Professional AI artist agent. Generate a richly detailed, professional cinematic prompt suitable for high-end AI image generation models such as Midjourney, DALL·E, or Leonardo.ai.

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
  const textGenPrompt = `
You are a professional writer and creative assistant that generates **rich, imaginative prompts** for AI-based content generation. This content may be a story, lore, world-building concept, character background, or scene description.

📘 Subject: "${subject}"

🧠 Keywords to use or draw inspiration from: ${keywords}

🎯 Instructions:
- Create **one vivid paragraph-style prompt** that sets up a compelling creative concept.
- The prompt should suggest a setting, theme, idea, or central tension — something that can inspire deeper generation by an AI.
- Weave the keywords **naturally** into the paragraph; don’t list them.
- Focus on creativity, atmosphere, and narrative potential — not on writing an actual story.
- Avoid cliches, generic language, or vague ideas.
- Output only the final paragraph. No lists, no labels, no extra commentary.
`;

  const prompt = category === "Image Generation" ? imagePrompt : textGenPrompt;

  try {
    const fullPrompt = await chatWithGemini(prompt);
    let finalResult = fullPrompt;
    if(category === "Image Generation") {
      finalResult = await optimizePrompt(fullPrompt);
    }
    res.json({ prompt: finalResult.trim() });
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

router.post("/generate-text", async (req, res) => {
  const { prompt } = req.body;
  const { seed = "-1", private = "true" } = req.query;
  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid 'prompt' parameter" });
  }

  const finalPrompt = `Your are a professional writer with experience that competes with the best writers in the world. generate story using the following prompt total of 15 paragraphs each paragraph has 15 lines. finish the story with the 12 paragraphs,it should have puzzles, questions, answers and it should be immersive: ${prompt}`;

  const pollinationsURL = `https://text.pollinations.ai/prompt/${encodeURIComponent(
    finalPrompt
  )}?seed=${seed}&private=${private}`;

  try {
    const response = await fetch(pollinationsURL);
    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "Pollinations API error" });
    }

    const text = await response.text();
    res.json({ text: text.trim() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate text" });
  }
});


const optimizePrompt = async (prompt) => {

  const finalPrompt = `You are a professional artist. Your job is to expand the base prompt into a richly detailed, cinematic description — like something you’d use in concept art or visual world-building — and then compress it into an optimized prompt suitable for image generation (Midjourney, DALL·E, etc.) return only the compressed prompt alone.
  Here is the base prompt: ${prompt}`
  const optimizedPrompt = await chatWithGemini(finalPrompt);
  return optimizedPrompt;
};

module.exports = router;
