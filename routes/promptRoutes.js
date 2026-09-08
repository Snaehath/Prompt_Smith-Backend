const express = require("express");
const router = express.Router();
const { createPrompt, getPrompts, updatePrompt, deletePrompt } = require("../controllers/promptController");
const { protect } = require("../middleware/authMiddleware");

router.route("/")
  .post(protect, createPrompt)
  .get(protect, getPrompts);

router.route("/:id")
  .put(protect, updatePrompt)
  .delete(protect, deletePrompt);

module.exports = router;
