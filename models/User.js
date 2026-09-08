const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { isLocalMode } = require("../utils/db");
const { LocalUser } = require("../utils/localStore");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const MongooseUser = mongoose.models.User || mongoose.model("User", UserSchema);

const User = new Proxy(MongooseUser, {
  get(target, prop) {
    if (isLocalMode()) {
      if (prop in LocalUser) {
        return LocalUser[prop];
      }
    }
    return target[prop];
  }
});

User.User = User;
module.exports = User;
