const User = require("../models/User");
const { generateToken } = require("../utils/jwt");
const ApiError = require("../utils/ApiError");

/**
 * @desc    Register new user
 * @route   POST /api/auth/register
 */
exports.registerUser = async (req, res, next) => {
  const { name, email, password } = req.body;

  try {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw ApiError.badRequest("Name is required", "INVALID_NAME");
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw ApiError.badRequest("A valid email address is required", "INVALID_EMAIL");
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      throw ApiError.badRequest("Password must be at least 6 characters long", "INVALID_PASSWORD");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      throw ApiError.conflict("User with this email already exists", "USER_EXISTS");
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Authenticate user & retrieve token
 * @route   POST /api/auth/login
 */
exports.loginUser = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      throw ApiError.badRequest("Email and password are required", "INVALID_CREDENTIALS");
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user || !(await user.comparePassword(password))) {
      throw ApiError.unauthorized("Invalid email or password", "AUTH_FAILED");
    }

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Generate a 1-click temporary demo/dummy account with credentials
 * @route   POST /api/auth/demo-account (also /quick-account, /generate-dummy)
 */
exports.createDummyAccount = async (req, res, next) => {
  try {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const email = `pilot_${randomSuffix}@promptsmith.local`;
    const password = `Smith#${randomSuffix}!`;
    const name = `Neural Pilot #${randomSuffix}`;

    const user = await User.create({
      name,
      email,
      password
    });

    const token = generateToken(user._id);

    res.status(201).json({
      message: "Temporary account generated successfully. Keep these credentials to log in anytime.",
      credentials: {
        email,
        password
      },
      user: {
        _id: user._id,
        name: user.name,
        email: user.email
      },
      token
    });
  } catch (error) {
    next(error);
  }
};
