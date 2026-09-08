const express = require("express");
const router = express.Router();
const { registerUser, loginUser, createDummyAccount } = require("../controllers/authController");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post(["/demo-account", "/quick-account", "/generate-dummy"], createDummyAccount);

module.exports = router;
