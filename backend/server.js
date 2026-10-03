const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const mongoose = require("mongoose");
const connectDB = require("./db");
const seedAdminUser = require("./seedAdmin");
const User = require("./models/User");

const app = express();
const dataFilePath = process.env.STUDENTS_FILE_PATH || path.join(__dirname, "students.json");
const classesFilePath = process.env.CLASSES_FILE_PATH || path.join(__dirname, "classes.json");
const portalDataFilePath = process.env.PORTAL_DATA_FILE_PATH || path.join(__dirname, "portal-data.json");
const frontendPath = path.join(__dirname, "..", "frontend");

const allowedOrigins = [
    "https://studentportal.com",
    "https://www.studentportal.com",
    "https://student.namraamir788.workers.dev",
    "https://students.namraamir788.workers.dev",
    "https://portal122.nimramir19443.workers.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(process.env.FRONTEND_URL || "").split(",").map((origin) => origin.trim()).filter(Boolean)
];

const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use((err, req, res, next) => {
    if (err && err.message === "Origin is not allowed by CORS.") {
        return res.status(403).json({ message: "This origin is not permitted to access the API." });
    }
    return next(err);
});
app.use(express.json());
app.use(express.static(frontendPath));

const pool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
}) : process.env.DB_PASSWORD ? new Pool({
    user: "postgres",
    host: "localhost",
    database: "student_db",
    password: process.env.DB_PASSWORD,
    port: 5432
}) : null;

const databaseReady = pool
    ? pool.query(`
        CREATE TABLE IF NOT EXISTS students (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            student_id TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL
        )
    `).then(() => pool.query(`
        ALTER TABLE students
            ADD COLUMN IF NOT EXISTS name TEXT,
            ADD COLUMN IF NOT EXISTS student_id TEXT,
            ADD COLUMN IF NOT EXISTS roll_number TEXT,
            ADD COLUMN IF NOT EXISTS email TEXT,
            ADD COLUMN IF NOT EXISTS password TEXT,
            ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'STUDENT',
            ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
    `)).then(() => pool.query(`
        CREATE TABLE IF NOT EXISTS courses (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            duration TEXT NOT NULL,
            instructor TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `)).then(() => pool.query(`
        CREATE TABLE IF NOT EXISTS student_courses (
            id BIGSERIAL PRIMARY KEY,
            student_id TEXT NOT NULL,
            course_id BIGINT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (student_id, course_id)
        )
    `))
    : Promise.resolve();

function readJson(filePath, fallback) {
    try {
        const fileData = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(fileData);
        return parsed;
    } catch (error) {
        return fallback;
    }
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readStudents() {
    return readJson(dataFilePath, []);
}

function writeStudents(students) {
    writeJson(dataFilePath, students);
}

function publicStudent(student) {
    
    const { password, passwordHash, ...safeStudent } = student || {};
    return safeStudent;
}

const configuredTokenSecret = process.env.AUTH_TOKEN_SECRET || "";
const configuredAdminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const configuredAdminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "";
if (configuredTokenSecret && Buffer.byteLength(configuredTokenSecret) < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 bytes.");
}
if (process.env.NODE_ENV === "production" && (
    !configuredTokenSecret ||
    (!process.env.MONGODB_URI && (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredAdminEmail) ||
        !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(configuredAdminPasswordHash)
    ))
)) {
    throw new Error("Production requires AUTH_TOKEN_SECRET and either MONGODB_URI or a valid ADMIN_EMAIL and bcrypt ADMIN_PASSWORD_HASH.");
}
const tokenSecret = configuredTokenSecret || crypto.randomBytes(32).toString("hex");

const DEFAULT_ADMIN_EMAIL = "admin@campusdesk.local";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const usingDefaultAdminCredentials = process.env.NODE_ENV !== "production" && !(configuredAdminEmail && configuredAdminPasswordHash);
const effectiveAdminEmail = configuredAdminEmail || (usingDefaultAdminCredentials ? DEFAULT_ADMIN_EMAIL : "");
const effectiveAdminPasswordHash = configuredAdminPasswordHash || (usingDefaultAdminCredentials ? bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10) : "");
if (usingDefaultAdminCredentials) {
    console.log(`No ADMIN_EMAIL/ADMIN_PASSWORD_HASH set. Using default admin login for local use: ${DEFAULT_ADMIN_EMAIL} / ${DEFAULT_ADMIN_PASSWORD}`);
}

function issueToken(user) {
    const payload = Buffer.from(JSON.stringify({
        ...user,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
    })).toString("base64url");
    const signature = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}

function verifyToken(token) {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;

    const expected = crypto.createHmac("sha256", tokenSecret).update(payload).digest();
    let supplied;
    try {
        supplied = Buffer.from(signature, "base64url");
    } catch (error) {
        return null;
    }

    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

    try {
        const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return user.exp > Math.floor(Date.now() / 1000) ? user : null;
    } catch (error) {
        return null;
    }
}

function requireAuth(req, res, next) {
    const authorization = String(req.headers.authorization || "");
    const user = authorization.startsWith("Bearer ") ? verifyToken(authorization.slice(7)) : null;
    if (!user) return res.status(401).json({ message: "Please log in to continue." });
    if (user.mustChangePassword && req.path !== "/change-password") {
        return res.status(403).json({ message: "Change your temporary password before continuing.", requiresPasswordChange: true });
    }
    req.auth = user;
    next();
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.auth || req.auth.role !== role) {
            return res.status(403).json({ message: "You do not have permission to perform this action." });
        }
        next();
    };
}

function canAccessStudent(req, res, next) {
    if (req.auth.role === "ADMIN") return next();
    const requested = String(req.params.studentId || "").trim();
    if (requested && [String(req.auth.studentId || ""), String(req.auth.id || "")].includes(requested)) return next();
    return res.status(403).json({ message: "You can only access your own student record." });
}

function generateStudentEmail(name, reservedEmails) {
    const domain = String(process.env.STUDENT_EMAIL_DOMAIN || "students.campusdesk.local").toLowerCase();
    const namePart = String(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 32) || "student";
    let email;
    do {
        email = `${namePart}.${crypto.randomBytes(3).toString("hex")}@${domain}`;
    } while (reservedEmails.has(email.toLowerCase()));
    reservedEmails.add(email.toLowerCase());
    return email;
}

function generateTemporaryPassword() {
    return crypto.randomBytes(12).toString("base64url");
}

function nextPortalStudentId(students) {
    const numericIds = students.map((student) => Number(student.id)).filter(Number.isSafeInteger);
    let id = Math.max(Date.now(), ...numericIds.map((value) => value + 1));
    while (students.some((student) => String(student.id) === String(id))) id += 1;
    return id;
}

async function saveStudentAccounts(accounts) {
    if (pool) {
        await databaseReady;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const account of accounts) {
                await client.query(
                    `INSERT INTO students (name, student_id, roll_number, email, password, role, must_change_password)
                    VALUES ($1, $2, $3, $4, $5, 'STUDENT', TRUE)`,
                    [account.name, account.studentId, account.studentId, account.email, account.passwordHash]
                );
            }
            await client.query("COMMIT");
            return;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    const students = readStudents();
    const existingEmails = new Set(students.map((student) => String(student.email || "").toLowerCase()));
    const existingIds = new Set(students.map((student) => String(student.studentId || "").toLowerCase()));
    if (accounts.some((account) => existingEmails.has(account.email.toLowerCase()) || existingIds.has(account.studentId.toLowerCase()))) {
        const error = new Error("An account with this email or student ID already exists.");
        error.code = "23505";
        throw error;
    }
    writeStudents([...students, ...accounts.map((account) => ({
        id: account.id,
        name: account.name,
        studentId: account.studentId,
        email: account.email,
        passwordHash: account.passwordHash,
        role: "STUDENT",
        mustChangePassword: true
    }))]);
}

function readClasses() {
    return readJson(classesFilePath, []);
}

function writeClasses(classes) {
    writeJson(classesFilePath, classes);
}

function readPortalData() {
    const data = readJson(portalDataFilePath, null);

    if (!data) {
        const defaultData = {
            programs: [],
            students: [],
            courses: [],
            studentCourses: [],
            announcements: [],
            admissions: [],
            notifications: [],
            results: [],
            fees: { total: 0, paid: 0, remaining: 0, dueDate: "", history: [] }
        };
        writeJson(portalDataFilePath, defaultData);
        return defaultData;
    }

    data.studentCourses = Array.isArray(data.studentCourses) ? data.studentCourses : [];
    return data;
}

function writePortalData(data) {
    const normalized = { ...data, studentCourses: Array.isArray(data.studentCourses) ? data.studentCourses : [] };
    writeJson(portalDataFilePath, normalized);
}

function getStudentByIdentifier(studentIdentifier) {
    const data = readPortalData();
    const normalized = String(studentIdentifier || "").trim();
    const normalizedLower = normalized.toLowerCase();

    return data.students.find((student) => {
        if (!student) return false;
        const studentId = String(student.studentId || "").trim();
        const email = String(student.email || "").trim();
        return String(student.id) === normalized ||
            studentId.toLowerCase() === normalizedLower ||
            email.toLowerCase() === normalizedLower;
    }) || null;
}

function getStudentCourseAssignmentIds(studentIdentifier) {
    const data = readPortalData();
    const normalizedStudentId = String(studentIdentifier || "").trim();
    const student = getStudentByIdentifier(normalizedStudentId);
    const studentKey = student ? String(student.studentId || student.id || "") : normalizedStudentId;
    const assignedIds = (data.studentCourses || [])
        .filter((entry) => {
            if (!entry) return false;
            const targetStudent = String(entry.studentId || entry.student || "").trim();
            const targetStudentId = String(entry.student_id || "").trim();
            return targetStudent === studentKey || targetStudentId === studentKey ||
                (student && (String(student.id) === String(entry.studentId || entry.student || "") || String(student.studentId || student.id) === String(entry.studentId || entry.student || "")));
        })
        .map((entry) => String(entry.courseId || entry.course || entry.course_id || ""))
        .filter(Boolean);

    return [...new Set(assignedIds)];
}

function getStudentDashboard(studentId) {
    const data = readPortalData();
    const student = getStudentByIdentifier(studentId);

    if (!student) {
        return null;
    }

    const courseCatalog = data.courses || [];
    const coursesById = new Map(courseCatalog.flatMap((course) => [
        [String(course.id), { ...course, name: course.title || course.name || course.code || "Course", code: course.code || String(course.id) }],
        [String(course.code), { ...course, name: course.title || course.name || course.code || "Course", code: course.code || String(course.id) }],
        [String(course.title || ""), { ...course, name: course.title || course.name || course.code || "Course", code: course.code || String(course.id) }]
    ]));
    const enrolledCourseIds = [...new Set([
        ...(student.enrolledCourses || []),
        ...(student.currentCourses || []),
        ...getStudentCourseAssignmentIds(student.studentId || student.id)
    ])];
    const myCourses = enrolledCourseIds.map((courseId) => {
        const found = coursesById.get(String(courseId));
        return found || {
            id: String(courseId),
            code: String(courseId),
            name: String(courseId),
            title: String(courseId),
            instructor: "Not listed",
            credits: null,
            semester: null,
            schedule: "Contact administration for course details",
            enrollmentStatus: "Enrolled",
            courseDetailsAvailable: false
        };
    });

    const attendance = myCourses.map((course) => ({
        course: course.title || course.name || course.code || "Course",
        percentage: Number(student.attendance || 0)
    }));
    const timetable = myCourses.map((course) => ({
        courseCode: course.code || course.id,
        courseName: course.title || course.name || course.code || "Course",
        instructor: course.instructor || "Not listed",
        schedule: course.schedule || "Not scheduled yet"
    }));
    const studentFees = student.fees || {};
    const feeTotal = Number(student.feeTotal ?? studentFees.total ?? data.fees?.total ?? 0);
    const feePaid = Number(student.feePaid ?? studentFees.paid ?? data.fees?.paid ?? 0);

    return {
        student,
        profile: {
            name: student.name,
            studentId: student.studentId,
            program: student.program,
            semester: student.currentSemester || student.semester || 1,
            cgpa: Number(student.cgpa ?? 0),
            attendance: Number(student.attendance ?? 0),
            pendingAssignments: Number(student.pendingAssignments ?? 0),
            feeStatus: student.feeStatus || "Not available",
            feePaid: Number(student.feePaid ?? 0),
            feeTotal: Number(student.feeTotal ?? 0),
            dueDate: student.dueDate || ""
        },
        announcements: data.announcements || [],
        notifications: data.notifications || [],
        results: student.results || [],
        fees: {
            total: feeTotal,
            paid: feePaid,
            remaining: Number(student.feeRemaining ?? studentFees.remaining ?? Math.max(feeTotal - feePaid, 0)),
            dueDate: student.dueDate || studentFees.dueDate || data.fees?.dueDate || "",
            history: student.feeHistory || studentFees.history || []
        },
        courses: data.courses || [],
        myCourses,
        attendance,
        timetable,
        admissions: data.admissions || []
    };
}

function getAdminOverview() {
    const data = readPortalData();
    const studentList = data.students || [];
    const courseList = data.courses || [];
    const programList = data.programs || [];

    const totalStudents = studentList.length;
    const activeStudents = studentList.filter((student) => student.admissionStatus !== "Rejected").length;
    const newAdmissions = (data.admissions || []).filter((entry) => entry.status === "Approved").length;
    const averageGpa = studentList.length
        ? (studentList.reduce((sum, student) => sum + (student.cgpa || 0), 0) / studentList.length).toFixed(2)
        : "0.00";

    return {
        totalStudents,
        activeStudents,
        newAdmissions,
        totalCourses: courseList.length,
        averageGpa: Number(averageGpa),
        programs: programList,
        students: studentList,
        courses: courseList,
        announcements: data.announcements || [],
        admissions: data.admissions || [],
        notifications: data.notifications || []
    };
}

function nextCourseId(existingCourses) {
    const numericIds = (existingCourses || []).map((course) => Number(course.id)).filter(Number.isFinite);
    let nextId = 1;
    while (numericIds.includes(nextId)) nextId += 1;
    return nextId;
}

function normalizeCourseInput(rawCourse = {}) {
    const title = String(rawCourse.title || "").trim();
    const description = String(rawCourse.description || "").trim();
    const duration = String(rawCourse.duration || "").trim();
    const instructor = String(rawCourse.instructor || "").trim();

    if (!title || !description || !duration || !instructor) {
        throw new Error("Course title, description, duration, and instructor are required.");
    }

    if (title.length > 120 || description.length > 1000 || duration.length > 50 || instructor.length > 120) {
        throw new Error("Course title, description, duration, and instructor are too long.");
    }

    return {
        title,
        description,
        duration,
        instructor
    };
}

function getStudentCourseAssignments(studentIdentifier) {
    const data = readPortalData();
    const normalizedStudentId = String(studentIdentifier || "").trim();
    const student = getStudentByIdentifier(normalizedStudentId);
    const studentKey = student ? String(student.studentId || student.id || "") : normalizedStudentId;

    return (data.studentCourses || []).filter((entry) => {
        if (!entry) return false;
        const recordStudentId = String(entry.studentId || entry.student || entry.student_id || "").trim();
        return recordStudentId === studentKey || (student && (String(student.id) === recordStudentId || String(student.studentId || student.id) === recordStudentId));
    });
}

if (pool) {
    pool.query("SELECT NOW()", (error) => {
        if (error) {
            console.error("PostgreSQL connection failed:", error.message);
        } else {
            console.log("PostgreSQL connected successfully!");
        }
    });
} else {
    console.log("PostgreSQL disabled: set DB_PASSWORD to enable database accounts.");
}

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(frontendPath, "admin.html"));
});

app.get("/student-portal", (req, res) => {
    res.sendFile(path.join(frontendPath, "student-portal.html"));
});

app.get("/profile", (req, res) => {
    res.sendFile(path.join(frontendPath, "profile.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(frontendPath, "login.html"));
});

app.get("/api/classes", requireAuth, requireRole("ADMIN"), (req, res) => {
    res.json(readClasses());
});

app.post("/api/classes", requireAuth, requireRole("ADMIN"), (req, res) => {
    const className = String(req.body.className || "").trim();

    if (!className) {
        return res.status(400).json({ message: "Class name is required." });
    }

    const classes = readClasses();

    if (classes.some((existingClass) => existingClass.toLowerCase() === className.toLowerCase())) {
        return res.status(409).json({ message: "This class already exists." });
    }

    classes.push(className);
    writeClasses(classes);
    res.status(201).json({ message: "Class added successfully.", className });
});

app.delete("/api/classes/:className", requireAuth, requireRole("ADMIN"), (req, res) => {
    const className = decodeURIComponent(req.params.className);
    const classes = readClasses();
    const remainingClasses = classes.filter((existingClass) => existingClass !== className);

    if (remainingClasses.length === classes.length) {
        return res.status(404).json({ message: "Class not found." });
    }

    writeClasses(remainingClasses);
    res.json({ message: "Class deleted successfully." });
});

app.get("/api/students", requireAuth, requireRole("ADMIN"), (req, res) => {
    const students = readStudents();
    res.json(students.map(publicStudent));
});

app.get("/api/students/:id", requireAuth, requireRole("ADMIN"), (req, res) => {
    const student = readStudents().find((record) => record.id === Number(req.params.id));

    if (!student) {
        return res.status(404).json({ message: "Student not found." });
    }

    res.json(publicStudent(student));
});

app.post("/api/students", requireAuth, requireRole("ADMIN"), (req, res) => {
    const { name, age, subject, className, class: classValue, rollNo, roll_no, fees } = req.body;
    const selectedClass = className || classValue;
    const selectedRollNo = rollNo || roll_no;

    if (!name || !age || !subject || !selectedClass || !selectedRollNo || fees === undefined || fees === null || fees === "") {
        return res.status(400).json({
            message: "Please fill in all student fields."
        });
    }

    try {
        const students = readStudents();
        const newStudent = {
            id: Date.now(),
            name: String(name).trim(),
            age: Number(age),
            subject: String(subject).trim(),
            className: String(selectedClass).trim(),
            class: String(selectedClass).trim(),
            rollNo: Number(selectedRollNo),
            roll_no: Number(selectedRollNo),
            fees: Number(fees)
        };

        students.push(newStudent);
        writeStudents(students);

        res.status(201).json({
            message: "Student added successfully",
            student: publicStudent(newStudent)
        });
    } catch (error) {
        console.error("Student storage error:", error.message);
        res.status(500).json({ message: "Unable to save student. Check backend storage permissions." });
    }
});

app.delete("/api/students/:id", requireAuth, requireRole("ADMIN"), (req, res) => {
    const id = Number(req.params.id);
    const students = readStudents();
    const remainingStudents = students.filter((student) => student.id !== id);

    if (remainingStudents.length === students.length) {
        return res.status(404).json({ message: "Student not found." });
    }

    writeStudents(remainingStudents);
    res.json({ message: "Student deleted successfully." });
});

app.get("/api/portal-data", requireAuth, requireRole("ADMIN"), (req, res) => {
    res.json(readPortalData());
});

app.get("/api/programs", requireAuth, requireRole("ADMIN"), (req, res) => {
    res.json(readPortalData().programs || []);
});

app.get("/api/my-courses", requireAuth, (req, res) => {
    const studentIdentifier = String(req.auth.studentId || req.auth.id || "").trim();
    const data = readPortalData();
    const student = getStudentByIdentifier(studentIdentifier);

    if (!student) {
        return res.status(404).json({ message: "Student record not found." });
    }

    const assignedCourseIds = new Set(getStudentCourseAssignments(student.studentId || student.id));
    const myCourses = (data.courses || []).filter((course) => assignedCourseIds.has(String(course.id)) || assignedCourseIds.has(String(course.code)));
    res.json(myCourses);
});

app.get("/courses", requireAuth, (req, res) => {
    const data = readPortalData();
    if (req.auth.role === "ADMIN") {
        return res.json(data.courses || []);
    }

    const studentIdentifier = String(req.auth.studentId || req.auth.id || "").trim();
    const student = getStudentByIdentifier(studentIdentifier);
    if (!student) {
        return res.status(404).json({ message: "Student record not found." });
    }

    const assignedCourseIds = new Set(getStudentCourseAssignments(student.studentId || student.id));
    const myCourses = (data.courses || []).filter((course) => assignedCourseIds.has(String(course.id)) || assignedCourseIds.has(String(course.code)));
    res.json(myCourses);
});

app.get("/api/courses", requireAuth, (req, res) => {
    const data = readPortalData();
    if (req.auth.role === "ADMIN") {
        return res.json(data.courses || []);
    }

    const studentIdentifier = String(req.auth.studentId || req.auth.id || "").trim();
    const student = getStudentByIdentifier(studentIdentifier);
    if (!student) {
        return res.status(404).json({ message: "Student record not found." });
    }

    const assignedCourseIds = new Set(getStudentCourseAssignments(student.studentId || student.id));
    const myCourses = (data.courses || []).filter((course) => assignedCourseIds.has(String(course.id)) || assignedCourseIds.has(String(course.code)));
    res.json(myCourses);
});

app.get("/api/courses/:courseId", requireAuth, (req, res) => {
    const data = readPortalData();
    const course = (data.courses || []).find((item) => String(item.id) === String(req.params.courseId) || String(item.code || item.id) === String(req.params.courseId));

    if (!course) {
        return res.status(404).json({ message: "Course not found." });
    }

    if (req.auth.role !== "ADMIN") {
        const studentIdentifier = String(req.auth.studentId || req.auth.id || "").trim();
        const assignedCourseIds = new Set(getStudentCourseAssignments(studentIdentifier));
        if (!assignedCourseIds.has(String(course.id)) && !assignedCourseIds.has(String(course.code || course.id))) {
            return res.status(403).json({ message: "You can only view courses assigned to you." });
        }
    }

    res.json(course);
});

app.post("/courses", requireAuth, requireRole("ADMIN"), (req, res) => {
    try {
        const data = readPortalData();
        const courseInput = normalizeCourseInput(req.body || {});
        const duplicate = (data.courses || []).some((course) => String(course.title || "").trim().toLowerCase() === courseInput.title.toLowerCase());
        if (duplicate) {
            return res.status(409).json({ message: "A course with this title already exists." });
        }

        const newCourse = {
            id: nextCourseId(data.courses || []),
            title: courseInput.title,
            description: courseInput.description,
            duration: courseInput.duration,
            instructor: courseInput.instructor,
            code: `CRS-${String(nextCourseId(data.courses || [])).padStart(3, "0")}`
        };

        data.courses = [...(data.courses || []), newCourse];
        writePortalData(data);
        res.status(201).json({ message: "Course created successfully.", course: newCourse });
    } catch (error) {
        res.status(400).json({ message: error.message || "Unable to create course." });
    }
});

app.put("/courses/:id", requireAuth, requireRole("ADMIN"), (req, res) => {
    try {
        const data = readPortalData();
        const courseId = String(req.params.id || "").trim();
        const courseIndex = (data.courses || []).findIndex((course) => String(course.id) === courseId || String(course.code || course.id) === courseId);

        if (courseIndex === -1) {
            return res.status(404).json({ message: "Course not found." });
        }

        const courseInput = normalizeCourseInput(req.body || {});
        const duplicate = (data.courses || []).some((course, index) => index !== courseIndex && String(course.title || "").trim().toLowerCase() === courseInput.title.toLowerCase());
        if (duplicate) {
            return res.status(409).json({ message: "A course with this title already exists." });
        }

        const updatedCourse = {
            ...data.courses[courseIndex],
            title: courseInput.title,
            description: courseInput.description,
            duration: courseInput.duration,
            instructor: courseInput.instructor,
            code: data.courses[courseIndex].code || `CRS-${String(data.courses[courseIndex].id).padStart(3, "0")}`
        };

        data.courses[courseIndex] = updatedCourse;
        writePortalData(data);
        res.json({ message: "Course updated successfully.", course: updatedCourse });
    } catch (error) {
        res.status(400).json({ message: error.message || "Unable to update course." });
    }
});

app.delete("/courses/:id", requireAuth, requireRole("ADMIN"), (req, res) => {
    const data = readPortalData();
    const courseId = String(req.params.id || "").trim();
    const beforeLength = (data.courses || []).length;

    data.courses = (data.courses || []).filter((course) => String(course.id) !== courseId && String(course.code || course.id) !== courseId);
    data.studentCourses = (data.studentCourses || []).filter((entry) => String(entry.courseId || entry.course || entry.course_id || "") !== courseId);

    (data.students || []).forEach((student) => {
        const current = new Set([...(student.enrolledCourses || []), ...(student.currentCourses || [])]);
        if (current.delete(courseId)) {
            student.enrolledCourses = [...current].filter((item) => String(item) !== courseId);
            student.currentCourses = [...current].filter((item) => String(item) !== courseId);
        }
    });

    if ((data.courses || []).length === beforeLength) {
        return res.status(404).json({ message: "Course not found." });
    }

    writePortalData(data);
    res.json({ message: "Course deleted successfully." });
});

app.post("/assign-course", requireAuth, requireRole("ADMIN"), (req, res) => {
    try {
        const { studentId, courseId } = req.body || {};
        const normalizedStudentId = String(studentId || "").trim();
        const normalizedCourseId = String(courseId || "").trim();

        if (!normalizedStudentId || !normalizedCourseId) {
            return res.status(400).json({ message: "Student ID and course ID are required." });
        }

        const data = readPortalData();
        const student = getStudentByIdentifier(normalizedStudentId);
        const course = (data.courses || []).find((item) => String(item.id) === normalizedCourseId || String(item.code || item.id) === normalizedCourseId);

        if (!student) {
            return res.status(404).json({ message: "Student not found." });
        }

        if (!course) {
            return res.status(404).json({ message: "Course not found." });
        }

        const studentKey = String(student.studentId || student.id);
        const assignmentExists = (data.studentCourses || []).some((entry) => {
            const entryStudentKey = String(entry.studentId || entry.student || entry.student_id || "").trim();
            const entryCourseKey = String(entry.courseId || entry.course || entry.course_id || "").trim();
            return entryStudentKey === studentKey && entryCourseKey === String(course.id);
        });

        if (!assignmentExists) {
            data.studentCourses = [...(data.studentCourses || []), {
                studentId: studentKey,
                courseId: String(course.id)
            }];
        }

        const studentIndex = (data.students || []).findIndex((entry) => String(entry.studentId || entry.id) === String(student.studentId || student.id));
        if (studentIndex >= 0) {
            const enrolled = new Set([...(data.students[studentIndex].enrolledCourses || []), ...(data.students[studentIndex].currentCourses || [])]);
            enrolled.add(String(course.id));
            data.students[studentIndex].enrolledCourses = [...enrolled];
            data.students[studentIndex].currentCourses = [...enrolled];
        }

        writePortalData(data);
        res.status(assignmentExists ? 200 : 201).json({
            message: assignmentExists ? "Course already assigned to this student." : "Course assigned to student successfully.",
            assignment: { studentId: studentKey, courseId: String(course.id) }
        });
    } catch (error) {
        res.status(400).json({ message: error.message || "Unable to assign course." });
    }
});

app.get("/api/student-dashboard/:studentId", requireAuth, canAccessStudent, (req, res) => {
    const dashboard = getStudentDashboard(req.params.studentId);
    if (!dashboard) {
        return res.status(404).json({ message: "Student dashboard not found." });
    }
    res.json(dashboard);
});

app.get("/api/admin-overview", requireAuth, requireRole("ADMIN"), (req, res) => {
    res.json(getAdminOverview());
});

app.post("/api/admin/students", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const {
        name,
        studentId,
        program,
        semester,
        cgpa,
        attendance,
        pendingAssignments,
        feeStatus,
        feePaid,
        feeTotal,
        dueDate,
        careerInterest,
        interests,
        admissionStatus
    } = req.body || {};

    const normalizedName = String(name || "").trim();
    const normalizedStudentId = String(studentId || "").trim();
    const normalizedProgram = String(program || "").trim();
    const numericSemester = Number(semester);
    const numericCgpa = Number(cgpa);
    const numericAttendance = Number(attendance);

    if (!normalizedName || !normalizedStudentId || !normalizedProgram) {
        return res.status(400).json({ message: "Name, student ID, and program are required." });
    }

    if (normalizedName.length > 120 || normalizedStudentId.length > 32 || !/^[A-Za-z0-9-]+$/.test(normalizedStudentId) || normalizedProgram.length > 120) {
        return res.status(400).json({ message: "Name, student ID, or program has an invalid format or is too long." });
    }

    if (!Number.isInteger(numericSemester) || numericSemester < 1) {
        return res.status(400).json({ message: "Semester must be a positive whole number." });
    }

    if (!Number.isFinite(numericCgpa) || numericCgpa < 0 || numericCgpa > 4) {
        return res.status(400).json({ message: "CGPA must be between 0 and 4." });
    }

    if (!Number.isFinite(numericAttendance) || numericAttendance < 0 || numericAttendance > 100) {
        return res.status(400).json({ message: "Attendance must be between 0 and 100." });
    }

    const optionalAmounts = [pendingAssignments, feePaid, feeTotal];
    if (optionalAmounts.some((value) => value !== undefined && value !== null && value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
        return res.status(400).json({ message: "Assignments and fee amounts must be non-negative numbers." });
    }

    const data = readPortalData();
    const students = data.students || [];
    const existingAccounts = readStudents();
    const duplicate = [...students, ...existingAccounts].some((student) =>
        String(student.studentId || "").toLowerCase() === normalizedStudentId.toLowerCase()
    );

    if (duplicate) {
        return res.status(409).json({ message: "A student with this ID or email already exists." });
    }

    const reservedEmails = new Set([...students, ...existingAccounts].map((student) => String(student.email || "").toLowerCase()));
    const normalizedEmail = generateStudentEmail(normalizedName, reservedEmails);
    const temporaryPassword = generateTemporaryPassword();
    const newStudent = {
        id: nextPortalStudentId(students),
        name: normalizedName,
        email: normalizedEmail,
        studentId: normalizedStudentId,
        program: normalizedProgram,
        semester: numericSemester,
        currentSemester: numericSemester,
        cgpa: numericCgpa,
        attendance: numericAttendance,
        pendingAssignments: Number.isFinite(Number(pendingAssignments)) ? Number(pendingAssignments) : 0,
        feeStatus: String(feeStatus || "Pending").trim(),
        feePaid: Number.isFinite(Number(feePaid)) ? Number(feePaid) : 0,
        feeTotal: Number.isFinite(Number(feeTotal)) ? Number(feeTotal) : 0,
        dueDate: String(dueDate || "").trim(),
        careerInterest: String(careerInterest || "").trim(),
        interests: String(interests || "").split(",").map((interest) => interest.trim()).filter(Boolean),
        completedCourses: [],
        currentCourses: [],
        enrolledCourses: [],
        admissionStatus: String(admissionStatus || "Approved").trim(),
        role: "STUDENT"
    };

    try {
        if (pool) {
            await databaseReady;
            const duplicateInDatabase = await pool.query("SELECT 1 FROM students WHERE LOWER(student_id) = LOWER($1) OR LOWER(roll_number) = LOWER($1) OR LOWER(email) = LOWER($2)", [normalizedStudentId, normalizedEmail]);
            if (duplicateInDatabase.rows.length) return res.status(409).json({ message: "A student with this ID or generated email already exists." });
        }

        const account = {
            id: newStudent.id,
            name: normalizedName,
            studentId: normalizedStudentId,
            email: normalizedEmail,
            passwordHash: await bcrypt.hash(temporaryPassword, 10)
        };
        data.students = [...students, newStudent];
        writePortalData(data);
        try {
            await saveStudentAccounts([account]);
        } catch (error) {
            data.students = students;
            writePortalData(data);
            throw error;
        }

        res.status(201).json({
            message: "Student added. Share these credentials with the student; the temporary password will not be shown again.",
            student: newStudent,
            credentials: { studentId: normalizedStudentId, email: normalizedEmail, password: temporaryPassword }
        });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "A student with this ID or generated email already exists." });
        console.error("Admin student creation error:", error.message);
        res.status(500).json({ message: "Unable to create the student account." });
    }
});

app.post("/api/admin/students/bulk", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const records = Array.isArray(req.body) ? req.body : req.body && req.body.students;

    if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: "Provide at least one student record." });
    }

    if (records.length > 100) {
        return res.status(400).json({ message: "You can add a maximum of 100 students at once." });
    }

    const data = readPortalData();
    const students = data.students || [];
    const existingIds = new Set([...students, ...readStudents()].map((student) => String(student.studentId || "").toLowerCase()));
    const batchIds = new Set();
    const reservedEmails = new Set([...students, ...readStudents()].map((student) => String(student.email || "").toLowerCase()));
    const errors = [];
    const newStudents = [];

    records.forEach((record, index) => {
        const row = index + 2;
        const normalizedName = String(record.name || "").trim();
        const normalizedStudentId = String(record.studentId || "").trim();
        const normalizedProgram = String(record.program || "").trim();
        const numericSemester = Number(record.semester);
        const numericCgpa = Number(record.cgpa);
        const numericAttendance = Number(record.attendance);
        const rowErrors = [];

        if (!normalizedName || !normalizedStudentId || !normalizedProgram) {
            rowErrors.push("name, studentId, and program are required");
        }
        if (normalizedName.length > 120 || normalizedStudentId.length > 32 || !/^[A-Za-z0-9-]+$/.test(normalizedStudentId) || normalizedProgram.length > 120) rowErrors.push("name, student ID, or program has an invalid format or is too long");
        if (!Number.isInteger(numericSemester) || numericSemester < 1) rowErrors.push("semester must be a positive whole number");
        if (!Number.isFinite(numericCgpa) || numericCgpa < 0 || numericCgpa > 4) rowErrors.push("cgpa must be between 0 and 4");
        if (!Number.isFinite(numericAttendance) || numericAttendance < 0 || numericAttendance > 100) rowErrors.push("attendance must be between 0 and 100");
        if (existingIds.has(normalizedStudentId.toLowerCase()) || batchIds.has(normalizedStudentId.toLowerCase())) rowErrors.push("student ID already exists");

        if (rowErrors.length) {
            errors.push(`Row ${row}: ${rowErrors.join("; ")}.`);
            return;
        }

        batchIds.add(normalizedStudentId.toLowerCase());
        const email = generateStudentEmail(normalizedName, reservedEmails);
        const temporaryPassword = generateTemporaryPassword();
        const id = nextPortalStudentId([...students, ...newStudents]);
        newStudents.push({
            id,
            name: normalizedName,
            email,
            studentId: normalizedStudentId,
            program: normalizedProgram,
            semester: numericSemester,
            currentSemester: numericSemester,
            cgpa: numericCgpa,
            attendance: numericAttendance,
            pendingAssignments: 0,
            feeStatus: "Pending",
            completedCourses: [],
            currentCourses: [],
            enrolledCourses: [],
            interests: [],
            admissionStatus: "Approved",
            role: "STUDENT",
            temporaryPassword
        });
    });

    if (errors.length) {
        return res.status(400).json({ message: "No students were added. Fix the following rows:", errors });
    }

    try {
        if (pool) {
            await databaseReady;
            const ids = await pool.query("SELECT LOWER(COALESCE(student_id, roll_number)) AS student_id FROM students");
            const databaseIds = new Set(ids.rows.map((row) => row.student_id));
            if (newStudents.some((student) => databaseIds.has(student.studentId.toLowerCase()))) {
                return res.status(409).json({ message: "A student ID already exists in the account database. No students were added." });
            }
        }

        const accounts = await Promise.all(newStudents.map(async (student) => ({
            id: student.id,
            name: student.name,
            studentId: student.studentId,
            email: student.email,
            passwordHash: await bcrypt.hash(student.temporaryPassword, 10)
        })));
        const studentRecords = newStudents.map(({ temporaryPassword, ...student }) => student);
        data.students = [...students, ...studentRecords];
        writePortalData(data);
        try {
            await saveStudentAccounts(accounts);
        } catch (error) {
            data.students = students;
            writePortalData(data);
            throw error;
        }

        res.status(201).json({
            message: `${studentRecords.length} students added. Share these credentials; temporary passwords will not be shown again.`,
            students: studentRecords,
            credentials: newStudents.map((student) => ({ studentId: student.studentId, email: student.email, password: student.temporaryPassword }))
        });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ message: "A student ID or generated email already exists. No students were added." });
        console.error("Bulk student creation error:", error.message);
        res.status(500).json({ message: "Unable to create student accounts." });
    }
});

app.delete("/api/admin/students/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
    const requestedIdentifier = String(req.params.id || "").trim();
    const data = readPortalData();
    const students = data.students || [];
    let removedStudent = students.find((student) =>
        String(student.id) === requestedIdentifier ||
        String(student.studentId || "").toLowerCase() === requestedIdentifier.toLowerCase()
    );

    try {
        if (pool) {
            await databaseReady;
            if (!removedStudent) {
                const byStudentId = await pool.query(
                    "SELECT id, student_id, roll_number FROM students WHERE LOWER(student_id) = LOWER($1) OR LOWER(roll_number) = LOWER($2) LIMIT 1",
                    [requestedIdentifier, requestedIdentifier]
                );
                let databaseStudent = byStudentId.rows[0];
                if (!databaseStudent && /^\d+$/.test(requestedIdentifier)) {
                    const byDatabaseId = await pool.query(
                        "SELECT id, student_id, roll_number FROM students WHERE id = $1 LIMIT 1",
                        [requestedIdentifier]
                    );
                    databaseStudent = byDatabaseId.rows[0];
                }
                if (databaseStudent) {
                    removedStudent = {
                        id: databaseStudent.id,
                        studentId: databaseStudent.student_id || databaseStudent.roll_number
                    };
                }
            }
            if (!removedStudent) return res.status(404).json({ message: "Student not found." });
            await pool.query(
                "DELETE FROM students WHERE LOWER(student_id) = LOWER($1) OR LOWER(roll_number) = LOWER($2)",
                [removedStudent.studentId, removedStudent.studentId]
            );
        } else if (!removedStudent) {
            return res.status(404).json({ message: "Student not found." });
        }
        const accounts = readStudents().filter((student) =>
            String(student.id) !== String(removedStudent.id) &&
            String(student.studentId || "").toLowerCase() !== String(removedStudent.studentId || "").toLowerCase()
        );
        writeStudents(accounts);
        data.students = students.filter((student) =>
            String(student.id) !== String(removedStudent.id) &&
            String(student.studentId || "").toLowerCase() !== String(removedStudent.studentId || "").toLowerCase()
        );
        writePortalData(data);
        res.json({ message: "Student deleted successfully." });
    } catch (error) {
        console.error("Student deletion error:", error.message);
        res.status(500).json({ message: "Unable to delete student account." });
    }
});

app.get("/api/announcements", (req, res) => {
    res.json(readPortalData().announcements || []);
});

app.get("/api/notifications", (req, res) => {
    res.json(readPortalData().notifications || []);
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !password || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ message: "Please enter email and password." });
    }

    if (mongoose.connection.readyState === 1) {
        try {
            const databaseAdmin = await User.findOne({ email: normalizedEmail }).select("+password");
            if (databaseAdmin && await databaseAdmin.comparePassword(password)) {
                const admin = {
                    id: String(databaseAdmin._id),
                    name: "Administrator",
                    email: databaseAdmin.email,
                    role: "ADMIN",
                    mustChangePassword: false
                };
                return res.json({ message: "Login successful!", student: admin, accessToken: issueToken(admin) });
            }
        } catch (error) {
            console.error("MongoDB admin login error:", error.message);
            return res.status(500).json({ message: "Unable to verify login right now." });
        }
    }

    const adminEmail = effectiveAdminEmail;
    const adminPasswordHash = effectiveAdminPasswordHash;
    if (adminEmail && adminPasswordHash && normalizedEmail === adminEmail && await bcrypt.compare(password, adminPasswordHash)) {
        const admin = { id: "admin", name: "Administrator", email: adminEmail, role: "ADMIN", mustChangePassword: false };
        return res.json({
            message: "Login successful!",
            student: admin,
            accessToken: issueToken(admin)
        });
    }

    const localStudent = readStudents().find((student) => String(student.email || "").toLowerCase() === normalizedEmail);
    const localPasswordHash = localStudent && (localStudent.passwordHash || localStudent.password);
    if (localStudent && localPasswordHash && await bcrypt.compare(password, localPasswordHash)) {
        const student = {
            id: localStudent.id,
            name: localStudent.name,
            studentId: localStudent.studentId || localStudent.rollNo,
            email: localStudent.email,
            role: localStudent.role || "STUDENT",
            mustChangePassword: Boolean(localStudent.mustChangePassword)
        };
        return res.json({
            message: "Login successful!",
            student: { ...student, requiresPasswordChange: student.mustChangePassword },
            accessToken: issueToken(student)
        });
    }

    if (!pool) {
        return res.status(401).json({ message: "Invalid email or password" });
    }

    try {
        await databaseReady;
        const result = await pool.query("SELECT * FROM students WHERE LOWER(email) = LOWER($1)", [normalizedEmail]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const student = result.rows[0];

        if (!await bcrypt.compare(password, student.password)) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        res.json({
            message: "Login successful!",
            student: {
                id: student.id,
                name: student.name,
                studentId: student.student_id || student.roll_number,
                email: student.email,
                role: student.role || "STUDENT",
                requiresPasswordChange: Boolean(student.must_change_password)
            },
                accessToken: issueToken({
                    id: student.id,
                    name: student.name,
                    studentId: student.student_id || student.roll_number,
                    email: student.email,
                    role: student.role || "STUDENT",
                    mustChangePassword: Boolean(student.must_change_password)
                })
        });
    } catch (error) {
        console.error("Database error:", error.message);
        res.status(500).json({ message: "Database error" });
    }
});

app.post("/change-password", requireAuth, async (req, res) => {
    if (!req.auth.mustChangePassword) {
        return res.status(403).json({ message: "Password changes are only available during first login." });
    }
    const newPassword = String((req.body || {}).newPassword || "");
    if (newPassword.length < 12 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return res.status(400).json({ message: "New password must be 12-128 characters and include a letter and a number." });
    }

    try {
        const passwordHash = await bcrypt.hash(newPassword, 10);
        if (req.auth.role === "ADMIN") {
            return res.status(403).json({ message: "Administrator password changes must be managed through deployment configuration." });
        }

        const localAccounts = readStudents();
        const localAccountIndex = localAccounts.findIndex((student) => String(student.id) === String(req.auth.id) && String(student.email || "").toLowerCase() === String(req.auth.email).toLowerCase());
        if (localAccountIndex >= 0) {
            localAccounts[localAccountIndex] = { ...localAccounts[localAccountIndex], passwordHash, mustChangePassword: false };
            delete localAccounts[localAccountIndex].password;
            writeStudents(localAccounts);
        } else if (pool) {
            await databaseReady;
            const updated = await pool.query(
                "UPDATE students SET password = $1, must_change_password = FALSE WHERE id = $2 AND LOWER(email) = LOWER($3) RETURNING id",
                [passwordHash, req.auth.id, req.auth.email]
            );
            if (!updated.rowCount) throw new Error("Student account was not found.");
        } else {
            throw new Error("Student account was not found.");
        }

        const student = { id: req.auth.id, name: req.auth.name, studentId: req.auth.studentId, email: req.auth.email, role: req.auth.role, mustChangePassword: false };
        res.json({ message: "Password updated successfully.", student, accessToken: issueToken(student) });
    } catch (error) {
        console.error("Password update error:", error.message);
        res.status(500).json({ message: "Unable to update the password." });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.get("/api/database-status", async (req, res) => {
    if (!pool) {
        return res.status(503).json({ connected: false, message: "PostgreSQL is not configured." });
    }

    try {
        const result = await pool.query("SELECT NOW() AS server_time, COUNT(*)::int AS student_count FROM students");
        res.json({
            connected: true,
            serverTime: result.rows[0].server_time,
            studentCount: result.rows[0].student_count
        });
    } catch (error) {
        console.error("Database status error:", error.message);
        res.status(503).json({ connected: false, message: "PostgreSQL query failed." });
    }
});

const port = process.env.PORT || 3000;

if (require.main === module) {
    (async () => {
        try {
            if (await connectDB()) await seedAdminUser();
        } catch (error) {
            console.error("MongoDB admin setup failed:", error.message);
        }
        app.listen(port, "0.0.0.0", () => {
            console.log(`CampusDesk backend running on port ${port}`);
        });
    })();
}

module.exports = app;