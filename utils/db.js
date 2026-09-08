const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    console.log("Connecting to:", uri ? "URI FOUND" : "URI MISSING");
    await mongoose.connect(uri);
    console.log("Neural Database Link Established (Mongoose)");
  } catch (error) {
    console.error("Neural Database Link Failure:", error);
    process.exit(1);
  }
};

module.exports = { connectDB };
