const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect("YOUR_MONGODB_CONNECTION_STRING");
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;