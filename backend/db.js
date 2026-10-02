const mongoose = require("mongoose");

const connectDB = async (connectionString = process.env.MONGODB_URI) => {
  if (!connectionString) return false;

  await mongoose.connect(connectionString);
  console.log("MongoDB connected successfully");
  return true;
};

module.exports = connectDB;