const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    role: {
        type: String,
        enum: ["admin"],
        required: true,
        default: "admin"
    }
}, { timestamps: true });

userSchema.pre("save", async function hashModifiedPassword() {
    if (!this.isModified("password")) return;
    this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function comparePassword(password) {
    return bcrypt.compare(password, this.password);
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);