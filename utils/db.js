const mongoose = require("mongoose");

let isLocalFallback = false;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri || uri.includes("your-mongodb-uri") || process.env.USE_LOCAL_STORAGE === "true") {
    console.log("📁 Running in Local File-Store Mode (./data) [PostgreSQL transition staging]");
    isLocalFallback = true;
    return;
  }

  try {
    console.log("Connecting to Database:", uri ? "URI FOUND" : "URI MISSING");
    // Short timeout so an unreachable remote Atlas cluster does not hang boot
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    console.log("Neural Database Link Established (Mongoose)");
  } catch (error) {
    console.warn(`⚠️  Remote MongoDB link unreachable (${error.code || error.message}).`);
    console.log("📁 Seamlessly fell back to Local File-Based Storage in ./data (Temporary until Postgres setup is complete).");
    isLocalFallback = true;
  }
};

const isLocalMode = () => isLocalFallback || mongoose.connection.readyState !== 1;

module.exports = { connectDB, isLocalMode };
