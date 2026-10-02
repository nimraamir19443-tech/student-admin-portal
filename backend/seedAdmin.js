const User = require("./models/User");

const DEFAULT_ADMIN_EMAIL = "admin@campusdesk.local";
const DEFAULT_ADMIN_PASSWORD = "admin123";

async function seedAdminUser() {
    const email = DEFAULT_ADMIN_EMAIL;
    const existingAdmin = await User.findOne({ email });
    if (existingAdmin) return existingAdmin;

    try {
        const admin = new User({
            email,
            password: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
            role: "admin"
        });
        await admin.save();
        console.log(`Seeded default admin user: ${email}`);
        return admin;
    } catch (error) {
        if (error.code === 11000) return User.findOne({ email });
        throw error;
    }
}

module.exports = seedAdminUser;