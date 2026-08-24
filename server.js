const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const dataFilePath = path.join(__dirname, "students.json");
const classesFilePath = path.join(__dirname, "classes.json");

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "student_db",
    password: "1527",
    port: 5432
});

function readStudents() {
    try {
        const fileData = fs.readFileSync(dataFilePath, "utf8");
        return JSON.parse(fileData);
    } catch (error) {
        return [];
    }
}

function writeStudents(students) {
    fs.writeFileSync(dataFilePath, JSON.stringify(students, null, 2));
}

function readClasses() {
    try {
        return JSON.parse(fs.readFileSync(classesFilePath, "utf8"));
    } catch (error) {
        return [];
    }
}

function writeClasses(classes) {
    fs.writeFileSync(classesFilePath, JSON.stringify(classes, null, 2));
}

// Test PostgreSQL connection
pool.query("SELECT NOW()", (error) => {
    if (error) {
        console.error("PostgreSQL connection failed:", error.message);
    } else {
        console.log("PostgreSQL connected successfully!");
    }
});

// FRONTEND
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/student-portal", (req, res) => {
    res.sendFile(path.join(__dirname, "student-portal.html"));
});

app.get("/profile", (req, res) => {
    res.sendFile(path.join(__dirname, "profile.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/signup", (req, res) => {
    res.sendFile(path.join(__dirname, "signup.html"));
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
    res.json(students);
});

app.get("/api/students/:id", (req, res) => {
    const student = readStudents().find((record) => record.id === Number(req.params.id));

    if (!student) {
        return res.status(404).json({ message: "Student not found." });
    }

    res.json(student);
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

// SIGN UP
app.post("/signup", async (req, res) => {
    console.log("Data received:", req.body);

    const { name, studentId, email, password } = req.body;

    if (!name || !studentId || !email || !password) {
        return res.status(400).json({
            message: "Please fill in all fields."
        });
    }

    try {
        const existingStudent = await pool.query(
            "SELECT * FROM students WHERE email = $1 OR student_id = $2",
            [email, studentId]
        );

        if (existingStudent.rows.length > 0) {
            return res.status(400).json({
                message: "Email or Student ID already exists."
            });
        }

        const result = await pool.query(
            `INSERT INTO students
            (name, student_id, email, password)
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
        res.status(500).json({
            message: "Database error"
        });
    }
});

// LOGIN
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Please enter email and password."
        });
    }

    const localStudent = readStudents().find((student) => student.email === email);

    if (localStudent && localStudent.passwordHash && await bcrypt.compare(password, localStudent.passwordHash)) {
        return res.json({
            message: "Login successful!",
            student: {
                id: localStudent.id,
                name: localStudent.name,
                studentId: localStudent.studentId || localStudent.rollNo,
                email: localStudent.email
            }
        });
    }

    try {
        const result = await pool.query(
            "SELECT * FROM students WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const student = result.rows[0];

        if (student.password !== password) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        res.json({
            message: "Login successful!",
            student: {
                id: student.id,
                name: student.name,
                studentId: student.student_id,
                email: student.email
            }
        });
    } catch (error) {
        console.error("Database error:", error.message);
        res.status(500).json({
            message: "Database error"
        });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(3000, () => {
    console.log("Server running at http://localhost:3000");
});