const Prompt = require("../models/Prompt");

// @desc    Create a new prompt
// @route   POST /api/prompts
exports.createPrompt = async (req, res) => {
  const { title, rawContent, variables, category, tags } = req.body;

  try {
    const prompt = await Prompt.create({
      title,
      rawContent,
      variables,
      category,
      tags,
      userId: req.user._id,
      versions: [{ content: rawContent }],
    });

    res.status(201).json(prompt);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all user prompts
// @route   GET /api/prompts
exports.getPrompts = async (req, res) => {
  try {
    const prompts = await Prompt.find({ userId: req.user._id }).sort({ updatedAt: -1 });
    res.json(prompts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update a prompt (creates a new version)
// @route   PUT /api/prompts/:id
exports.updatePrompt = async (req, res) => {
  const { title, rawContent, variables, category, tags, parameters } = req.body;

  try {
    const prompt = await Prompt.findById(req.params.id);

    if (!prompt) {
      return res.status(404).json({ message: "Prompt not found" });
    }

    if (prompt.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "User not authorized" });
    }

    // Push current state to versions history before updating
    const newVersion = {
      content: prompt.rawContent,
      createdAt: new Date(),
    };

    prompt.title = title || prompt.title;
    prompt.rawContent = rawContent || prompt.rawContent;
    prompt.variables = variables || prompt.variables;
    prompt.category = category || prompt.category;
    prompt.tags = tags || prompt.tags;
    
    // Add the previous state to history
    prompt.versions.push(newVersion);

    const updatedPrompt = await prompt.save();
    res.json(updatedPrompt);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a prompt
// @route   DELETE /api/prompts/:id
exports.deletePrompt = async (req, res) => {
  try {
    const prompt = await Prompt.findById(req.params.id);

    if (!prompt) {
      return res.status(404).json({ message: "Prompt not found" });
    }

    if (prompt.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "User not authorized" });
    }

    await prompt.deleteOne();
    res.json({ message: "Prompt removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
