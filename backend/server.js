const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const dataFilePath = path.join(__dirname, "students.json");
const classesFilePath = path.join(__dirname, "classes.json");
const portalDataFilePath = path.join(__dirname, "portal-data.json");
const frontendPath = path.join(__dirname, "..", "frontend");

app.use(cors());
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
            announcements: [],
            admissions: [],
            notifications: [],
            results: [],
            fees: { total: 0, paid: 0, remaining: 0, dueDate: "", history: [] }
        };
        writeJson(portalDataFilePath, defaultData);
        return defaultData;
    }

    return data;
}

function writePortalData(data) {
    writeJson(portalDataFilePath, data);
}

function getStudentByIdentifier(studentIdentifier) {
    const data = readPortalData();
    const normalized = String(studentIdentifier || "").trim();

    return data.students.find((student) => {
        if (!student) return false;
        return String(student.id) === normalized || student.studentId === normalized || student.email === normalized;
    }) || null;
}

function courseMatchScore(student, course) {
    let score = 0;
    const reasons = [];

    if (course.program === student.program) {
        score += 35;
        reasons.push("Required for your program");
    }

    if (course.semester && course.semester <= (student.currentSemester || student.semester || 1) + 1) {
        score += 15;
        reasons.push("Suitable for your current academic stage");
    }

    const completed = new Set(student.completedCourses || []);
    const current = new Set(student.currentCourses || []);
    const enrolled = new Set(student.enrolledCourses || []);
    const prereqList = Array.isArray(course.prerequisites) ? course.prerequisites : [];
    const hasPrereqs = prereqList.length === 0 || prereqList.every((prereq) => completed.has(prereq) || current.has(prereq) || enrolled.has(prereq));

    if (hasPrereqs) {
        score += 20;
        reasons.push("You have the prerequisite foundation");
    } else {
        const missing = prereqList.filter((prereq) => !completed.has(prereq) && !current.has(prereq) && !enrolled.has(prereq));
        if (missing.length) {
            score -= Math.min(20, missing.length * 8);
            reasons.push(`Missing prerequisite: ${missing.join(", ")}`);
        }
    }

    const tagMatches = (course.tags || []).filter((tag) => (student.interests || []).some((interest) => interest.toLowerCase() === tag.toLowerCase()));
    if (tagMatches.length) {
        score += 10;
        reasons.push("Matches your interests");
    }

    if (student.careerInterest && (course.tags || []).some((tag) => tag.toLowerCase() === String(student.careerInterest).toLowerCase())) {
        score += 10;
        reasons.push("Aligned with your career interest");
    }

    if (Array.isArray(course.unlocks) && course.unlocks.some((unlock) => [...(student.completedCourses || []), ...(student.currentCourses || [])].includes(unlock))) {
        score += 10;
        reasons.push("Builds toward future learning goals");
    }

    return {
        score: Math.max(10, Math.min(98, Math.round(score))),
        reasons: reasons.slice(0, 4)
    };
}

function getRecommendations(student) {
    const data = readPortalData();
    const candidateCourses = data.courses.filter((course) => {
        if (!course) return false;
        const completed = new Set(student.completedCourses || []);
        const current = new Set(student.currentCourses || []);
        const enrolled = new Set(student.enrolledCourses || []);
        return !completed.has(course.id) && !current.has(course.id) && !enrolled.has(course.id);
    });

    return candidateCourses
        .map((course) => {
            const match = courseMatchScore(student, course);
            return {
                ...course,
                matchScore: match.score,
                reasons: match.reasons
            };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 6);
}

function getStudentDashboard(studentId) {
    const data = readPortalData();
    const student = getStudentByIdentifier(studentId) || data.students[0];

    if (!student) {
        return null;
    }

    const recommendations = getRecommendations(student);
    const nextCourses = recommendations.slice(0, 3).map((course) => ({
        ...course,
        explanation: course.reasons.join(" • ")
    }));

    const myCourses = (data.courses || []).filter((course) => {
        const courseId = course.id;
        return (student.enrolledCourses || []).includes(courseId) || (student.currentCourses || []).includes(courseId);
    });

    const attendance = data.courses
        .filter((course) => (student.enrolledCourses || []).includes(course.id) || (student.currentCourses || []).includes(course.id))
        .map((course) => ({
            course: course.name,
            percentage: course.semester % 2 === 0 ? 95 : 92
        }));

    return {
        student,
        profile: {
            name: student.name,
            studentId: student.studentId,
            program: student.program,
            semester: student.currentSemester || student.semester || 1,
            cgpa: student.cgpa || 3.5,
            attendance: student.attendance || 90,
            pendingAssignments: student.pendingAssignments || 3,
            feeStatus: student.feeStatus || "Paid",
            feePaid: student.feePaid || 0,
            feeTotal: student.feeTotal || 0,
            dueDate: student.dueDate || "2026-09-15"
        },
        announcements: data.announcements || [],
        notifications: data.notifications || [],
        results: data.results || [],
        fees: data.fees || { total: 0, paid: 0, remaining: 0, dueDate: "", history: [] },
        courses: data.courses || [],
        myCourses,
        attendance,
        recommendations,
        nextCourses,
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

    const courseCounts = courseList.reduce((acc, course) => {
        acc[course.name] = (acc[course.name] || 0) + 1;
        return acc;
    }, {});

    const mostEnrolledCourses = Object.entries(courseCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const attendanceStats = courseList.map((course) => ({
        name: course.name,
        value: Math.min(98, Math.max(60, 85 + (course.semester % 5) * 2))
    }));

    return {
        totalStudents,
        activeStudents,
        newAdmissions,
        totalCourses: courseList.length,
        mostEnrolledCourses,
        averageGpa: Number(averageGpa),
        attendanceStats,
        programs: programList,
        students: studentList,
        courses: courseList,
        announcements: data.announcements || [],
        admissions: data.admissions || [],
        notifications: data.notifications || []
    };
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

app.get("/signup", (req, res) => {
    res.sendFile(path.join(frontendPath, "signup.html"));
});

app.get("/api/classes", (req, res) => {
    res.json(readClasses());
});

app.post("/api/classes", (req, res) => {
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

app.delete("/api/classes/:className", (req, res) => {
    const className = decodeURIComponent(req.params.className);
    const classes = readClasses();
    const remainingClasses = classes.filter((existingClass) => existingClass !== className);

    if (remainingClasses.length === classes.length) {
        return res.status(404).json({ message: "Class not found." });
    }

    writeClasses(remainingClasses);
    res.json({ message: "Class deleted successfully." });
});

app.get("/api/students", (req, res) => {
    const students = readStudents();
    res.json(students.map(publicStudent));
});

app.get("/api/students/:id", (req, res) => {
    const student = readStudents().find((record) => record.id === Number(req.params.id));

    if (!student) {
        return res.status(404).json({ message: "Student not found." });
    }

    res.json(publicStudent(student));
});

app.post("/api/students", (req, res) => {
    const { name, age, subject, className, class: classValue, rollNo, roll_no, fees } = req.body;
    const selectedClass = className || classValue;
    const selectedRollNo = rollNo || roll_no;

    if (!name || !age || !subject || !selectedClass || !selectedRollNo || !fees) {
        return res.status(400).json({
            message: "Please fill in all student fields."
        });
    }

    const students = readStudents();
    const newStudent = {
        id: Date.now(),
        name,
        age: Number(age),
        subject,
        className: selectedClass,
        class: selectedClass,
        rollNo: Number(selectedRollNo),
        roll_no: Number(selectedRollNo),
        fees: Number(fees)
    };

    students.push(newStudent);
    writeStudents(students);

    res.status(201).json({
        message: "Student added successfully",
        student: newStudent
    });
});

app.delete("/api/students/:id", (req, res) => {
    const id = Number(req.params.id);
    const students = readStudents();
    const remainingStudents = students.filter((student) => student.id !== id);

    if (remainingStudents.length === students.length) {
        return res.status(404).json({ message: "Student not found." });
    }

    writeStudents(remainingStudents);
    res.json({ message: "Student deleted successfully." });
});

app.get("/api/portal-data", (req, res) => {
    res.json(readPortalData());
});

app.get("/api/course-recommendation-rules", (req, res) => {
    res.json(readPortalData().courseRecommendationRules || []);
});

app.post("/api/course-recommendation-rules", (req, res) => {
    const { source, target } = req.body || {};

    if (!source || !target) {
        return res.status(400).json({ message: "Both source and target course are required." });
    }

    const data = readPortalData();
    const rules = data.courseRecommendationRules || [];
    const nextRules = [...rules, { source, target }];
    data.courseRecommendationRules = nextRules;
    writePortalData(data);

    res.status(201).json({ message: "Recommendation rule saved successfully.", rule: { source, target } });
});

app.get("/api/programs", (req, res) => {
    res.json(readPortalData().programs || []);
});

app.get("/api/courses", (req, res) => {
    res.json(readPortalData().courses || []);
});

app.get("/api/courses/:courseId", (req, res) => {
    const course = (readPortalData().courses || []).find((item) => item.id === req.params.courseId || item.code === req.params.courseId);

    if (!course) {
        return res.status(404).json({ message: "Course not found." });
    }

    res.json(course);
});

app.get("/api/student-dashboard/:studentId", (req, res) => {
    const dashboard = getStudentDashboard(req.params.studentId);
    if (!dashboard) {
        return res.status(404).json({ message: "Student dashboard not found." });
    }
    res.json(dashboard);
});

app.get("/api/recommendations/:studentId", (req, res) => {
    const student = getStudentByIdentifier(req.params.studentId);

    if (!student) {
        return res.status(404).json({ message: "Student not found." });
    }

    res.json(getRecommendations(student));
});

app.get("/api/next-courses/:studentId", (req, res) => {
    const student = getStudentByIdentifier(req.params.studentId);

    if (!student) {
        return res.status(404).json({ message: "Student not found." });
    }

    const nextCourses = getRecommendations(student).slice(0, 3).map((course) => ({
        ...course,
        explanation: course.reasons.join(" • ")
    }));

    res.json(nextCourses);
});

app.post("/api/courses/:courseId/enroll", (req, res) => {
    const data = readPortalData();
    const studentId = req.body.studentId || req.query.studentId || "STU-001";
    const course = (data.courses || []).find((item) => item.id === req.params.courseId || item.code === req.params.courseId);
    const student = getStudentByIdentifier(studentId) || data.students[0];

    if (!course) {
        return res.status(404).json({ message: "Course not found." });
    }

    if (!student) {
        return res.status(404).json({ message: "Student not found." });
    }

    const completed = new Set(student.completedCourses || []);
    const current = new Set(student.currentCourses || []);
    const enrolled = new Set(student.enrolledCourses || []);
    const missingPrerequisites = (course.prerequisites || []).filter((prereq) => !completed.has(prereq) && !current.has(prereq) && !enrolled.has(prereq));

    if (missingPrerequisites.length > 0) {
        return res.status(400).json({
            message: "You cannot enroll yet.",
            missingPrerequisites,
            status: "prerequisite_blocked"
        });
    }

    if (!student.enrolledCourses) student.enrolledCourses = [];
    if (!student.currentCourses) student.currentCourses = [];
    if (!student.enrolledCourses.includes(course.id)) student.enrolledCourses.push(course.id);
    if (!student.currentCourses.includes(course.id)) student.currentCourses.push(course.id);

    data.students = data.students.map((item) => item.id === student.id ? student : item);
    writePortalData(data);

    res.json({
        message: "Course successfully added!",
        course,
        student: {
            id: student.id,
            name: student.name,
            studentId: student.studentId
        },
        status: "enrolled"
    });
});

app.get("/api/admin-overview", (req, res) => {
    res.json(getAdminOverview());
});

app.get("/api/announcements", (req, res) => {
    res.json(readPortalData().announcements || []);
});

app.get("/api/notifications", (req, res) => {
    res.json(readPortalData().notifications || []);
});

app.post("/signup", async (req, res) => {
    const { name, studentId, email, password } = req.body;

    if (!name || !studentId || !email || !password) {
        return res.status(400).json({ message: "Please fill in all fields." });
    }

    if (!pool) {
        const existing = readStudents().find((student) => student.email === email || student.studentId === studentId);
        if (existing) {
            return res.status(400).json({ message: "Email or Student ID already exists." });
        }

        const students = readStudents();
        const newStudent = {
            id: Date.now(),
            name,
            email,
            studentId,
            passwordHash: bcrypt.hashSync(password, 10),
            role: "STUDENT",
            program: "BS Computer Science",
            semester: 3,
            currentSemester: 3,
            cgpa: 3.78,
            attendance: 92,
            pendingAssignments: 4,
            feeStatus: "Paid",
            currentCourses: ["CS201", "CS204", "DB101"],
            enrolledCourses: ["CS201", "CS204", "DB101", "WEB101"],
            completedCourses: ["CS101", "MTH101"],
            interests: ["Web Development", "Artificial Intelligence"],
            careerInterest: "Software Engineering"
        };
        students.push(newStudent);
        writeStudents(students);
        return res.status(201).json({ message: "Account created successfully!", student: { id: newStudent.id, name, studentId, email } });
    }

    try {
        const existingStudent = await pool.query(
            "SELECT * FROM students WHERE email = $1 OR student_id = $2",
            [email, studentId]
        );

        if (existingStudent.rows.length > 0) {
            return res.status(400).json({ message: "Email or Student ID already exists." });
        }

        const result = await pool.query(
            `INSERT INTO students (name, student_id, email, password)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, student_id, email`,
            [name, studentId, email, password]
        );

        res.status(201).json({
            message: "Account created successfully!",
            student: result.rows[0]
        });
    } catch (error) {
        console.error("Database error:", error.message);
        res.status(500).json({ message: "Database error" });
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Please enter email and password." });
    }

    const localStudent = readStudents().find((student) => student.email === email);
    if (localStudent && localStudent.passwordHash && await bcrypt.compare(password, localStudent.passwordHash)) {
        return res.json({
            message: "Login successful!",
            student: { id: localStudent.id, name: localStudent.name, studentId: localStudent.studentId || localStudent.rollNo, email: localStudent.email, role: localStudent.role || "STUDENT" }
        });
    }

    if (!pool) {
        return res.status(401).json({ message: "Invalid email or password." });
    }

    try {
        const result = await pool.query("SELECT * FROM students WHERE email = $1", [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        const student = result.rows[0];

        if (student.password !== password) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        res.json({
            message: "Login successful!",
            student: {
                id: student.id,
                name: student.name,
                studentId: student.student_id,
                email: student.email,
                role: "STUDENT"
            }
        });
    } catch (error) {
        console.error("Database error:", error.message);
        res.status(500).json({ message: "Database error" });
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

app.listen(port, () => {
    console.log(`CampusDesk backend running on port ${port}`);
});