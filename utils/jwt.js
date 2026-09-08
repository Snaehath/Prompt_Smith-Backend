const jwt = require("jsonwebtoken");

const getSecret = () => process.env.JWT_SECRET || "promptsmith-dev-secret-key-2026";

const generateToken = (id) => {
  return jwt.sign({ id }, getSecret(), {
    expiresIn: "30d",
  });
};

const verifyToken = (token) => {
  return jwt.verify(token, getSecret());
};

module.exports = { generateToken, verifyToken, getSecret };
