const Prompt = require("../models/Prompt");
const ApiError = require("../utils/ApiError");

// @desc    Create a new prompt template
// @route   POST /api/prompts
exports.createPrompt = async (req, res, next) => {
  const { title, rawContent, variables, category, tags } = req.body;

  try {
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      throw ApiError.badRequest("Title is required", "INVALID_TITLE");
    }
    if (!rawContent || typeof rawContent !== "string" || rawContent.trim().length === 0) {
      throw ApiError.badRequest("Raw content is required", "INVALID_CONTENT");
    }

    const prompt = await Prompt.create({
      title: title.trim(),
      rawContent: rawContent.trim(),
      variables: Array.isArray(variables) ? variables : [],
      category: category ? category.trim() : "General",
      tags: Array.isArray(tags) ? tags : [],
      userId: req.user._id,
      versions: [{ content: rawContent.trim() }]
    });

    res.status(201).json(prompt);
  } catch (error) {
    next(error);
  }
};

// @desc    Get all user prompts (Paginated)
// @route   GET /api/prompts
exports.getPrompts = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id };

    const [prompts, total] = await Promise.all([
      Prompt.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).select("-__v"),
      Prompt.countDocuments(filter)
    ]);

    res.status(200).json({
      items: prompts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a prompt (Creates a new version in history)
// @route   PUT /api/prompts/:id
exports.updatePrompt = async (req, res, next) => {
  const { title, rawContent, variables, category, tags } = req.body;

  try {
    // Atomic ownership check preventing IDOR
    const prompt = await Prompt.findOne({ _id: req.params.id, userId: req.user._id });

    if (!prompt) {
      throw ApiError.notFound("Prompt not found or access denied", "PROMPT_NOT_FOUND");
    }

    // Push previous state into version history before updating
    if (rawContent && rawContent !== prompt.rawContent) {
      prompt.versions.push({
        content: prompt.rawContent,
        createdAt: new Date()
      });
      prompt.rawContent = rawContent.trim();
    }

    if (title) prompt.title = title.trim();
    if (variables) prompt.variables = variables;
    if (category) prompt.category = category.trim();
    if (tags) prompt.tags = tags;

    const updatedPrompt = await prompt.save();
    res.status(200).json(updatedPrompt);
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a prompt
// @route   DELETE /api/prompts/:id
exports.deletePrompt = async (req, res, next) => {
  try {
    // Atomic ownership check preventing IDOR
    const prompt = await Prompt.findOneAndDelete({ _id: req.params.id, userId: req.user._id });

    if (!prompt) {
      throw ApiError.notFound("Prompt not found or access denied", "PROMPT_NOT_FOUND");
    }

    res.status(200).json({ message: "Prompt removed successfully" });
  } catch (error) {
    next(error);
  }
};
