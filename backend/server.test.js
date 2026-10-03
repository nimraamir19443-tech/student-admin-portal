const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "campusdesk-auth-test-"));
const studentsPath = path.join(tempDirectory, "students.json");
const classesPath = path.join(tempDirectory, "classes.json");
const portalDataPath = path.join(tempDirectory, "portal-data.json");

process.env.STUDENTS_FILE_PATH = studentsPath;
process.env.CLASSES_FILE_PATH = classesPath;
process.env.PORTAL_DATA_FILE_PATH = portalDataPath;
process.env.AUTH_TOKEN_SECRET = "test-only-token-secret-with-sufficient-length";
process.env.NODE_ENV = "test";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("AdminPass123!", 10);
process.env.STUDENT_EMAIL_DOMAIN = "students.example.test";
delete process.env.DATABASE_URL;
delete process.env.DB_PASSWORD;

fs.writeFileSync(studentsPath, "[]");

function admission(name, studentId, overrides = {}) {
    return { name, fatherName: "Test Father", studentId, program: "Computer Science", dateOfBirth: "2005-05-20", phone: "03001234567", address: "House 1, Lahore", previousSchool: "City School", ...overrides };
}fs.writeFileSync(classesPath, "[]");
fs.writeFileSync(portalDataPath, JSON.stringify({
    programs: [],
    students: [{
        id: 1,
        name: "Existing Student",
        email: "existing@example.test",
        studentId: "STU-001",
        program: "Computer Science",
        semester: 1,
        currentSemester: 1,
        cgpa: 3,
        attendance: 90,
        role: "STUDENT"
    }],
    courses: [],
    announcements: [],
    admissions: [],
    notifications: [],
    results: [],
    fees: { total: 0, paid: 0, remaining: 0, dueDate: "", history: [] }
}));

const app = require("./server");
let server;
let baseUrl;

describe("Mongoose admin user model", () => {
    it("hashes the password before save and compares credentials with bcrypt", async () => {
        const user = new User({ email: "admin@campusdesk.local", password: "admin123", role: "admin" });
        await new Promise((resolve, reject) => {
            User.schema.s.hooks.execPre("save", user, (error) => error ? reject(error) : resolve());
        });


        assert.notEqual(user.password, "admin123");
        assert.match(user.password, /^\$2[aby]\$\d{2}\$/);
        assert.equal(user.role, "admin");
        assert.equal(await user.comparePassword("admin123"), true);
        assert.equal(await user.comparePassword("wrong"), false);
    });
});

async function request(endpoint, { method = "GET", body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, data: await response.json() };
}

describe("admin-created student accounts", () => {
    before(async () => {
        server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    it("issues one-time credentials, forces a password update, and enforces roles", async () => {
        const anonymousOverview = await request("/api/admin-overview");
        assert.equal(anonymousOverview.response.status, 401);

        const wrongAdminLogin = await request("/login", { method: "POST", body: { email: "admin@example.test", password: "wrong" } });
        assert.equal(wrongAdminLogin.response.status, 401);

        const adminLogin = await request("/login", { method: "POST", body: { email: "admin@example.test", password: "AdminPass123!" } });
        assert.equal(adminLogin.response.status, 200);
        assert.equal(adminLogin.data.student.role, "ADMIN");

        const claimedExistingStudent = await request("/api/admin/students", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: admission("Impersonator", "STU-001")
        });
        assert.equal(claimedExistingStudent.response.status, 409);

        const unauthenticatedCreate = await request("/api/admin/students", {
            method: "POST",
            body: admission("Test Student", "TEST-100")
        });
        assert.equal(unauthenticatedCreate.response.status, 401);

        const invalidStudent = await request("/api/admin/students", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: admission("Test Student", "BAD ID")
        });
        assert.equal(invalidStudent.response.status, 400);

        for (const overrides of [{ fatherName: "" }, { phone: "abc" }, { dateOfBirth: "2999-01-01" }, { address: "" }]) {
            const rejected = await request("/api/admin/students", {
                method: "POST",
                token: adminLogin.data.accessToken,
                body: admission("Invalid Student", "INVALID-1", overrides)
            });
            assert.equal(rejected.response.status, 400);
        }

        const created = await request("/api/admin/students", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: admission("Test Student", "TEST-100")
        });
        assert.equal(created.response.status, 201);
        assert.match(created.data.credentials.email, /^test\.student\.[a-f0-9]+@students\.example\.test$/);
        assert.ok(created.data.credentials.password.length >= 16);

        const storedAccounts = JSON.parse(fs.readFileSync(studentsPath, "utf8"));
        const storedAccount = storedAccounts.find((student) => student.email === created.data.credentials.email);
        assert.ok(storedAccount.passwordHash);
        assert.equal(storedAccount.mustChangePassword, true);
        assert.equal(JSON.stringify(storedAccounts).includes(created.data.credentials.password), false);

        const studentLogin = await request("/login", {
            method: "POST",
            body: { email: created.data.credentials.email, password: created.data.credentials.password }
        });
        assert.equal(studentLogin.response.status, 200);
        assert.equal(studentLogin.data.student.requiresPasswordChange, true);

        const blockedDashboard = await request(`/api/student-dashboard/${encodeURIComponent(created.data.student.studentId)}`, {
            token: studentLogin.data.accessToken
        });
        assert.equal(blockedDashboard.response.status, 403);
        assert.equal(blockedDashboard.data.requiresPasswordChange, true);

        const blockedAdminApi = await request("/api/admin-overview", { token: studentLogin.data.accessToken });
        assert.equal(blockedAdminApi.response.status, 403);

        const changedPassword = await request("/change-password", {
            method: "POST",
            token: studentLogin.data.accessToken,
            body: { newPassword: "UpdatedStudent123!" }
        });
        assert.equal(changedPassword.response.status, 200);

        const ownDashboard = await request(`/api/student-dashboard/${encodeURIComponent(created.data.student.studentId)}`, {
            token: changedPassword.data.accessToken
        });
        assert.equal(ownDashboard.response.status, 200);
        assert.equal(ownDashboard.data.student.email, created.data.credentials.email);

        const repeatedPasswordChange = await request("/change-password", {
            method: "POST",
            token: changedPassword.data.accessToken,
            body: { newPassword: "AnotherStudent123!" }
        });
        assert.equal(repeatedPasswordChange.response.status, 403);

        const otherDashboard = await request("/api/student-dashboard/STU-001", { token: changedPassword.data.accessToken });
        assert.equal(otherDashboard.response.status, 403);

        const bulkCreated = await request("/api/admin/students/bulk", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: { students: [admission("Bulk Student", "TEST-101")] }
        });
        assert.equal(bulkCreated.response.status, 201);
        assert.equal(bulkCreated.data.credentials.length, 1);
        assert.equal(bulkCreated.data.credentials[0].studentId, "TEST-101");

        const oldPasswordLogin = await request("/login", {
            method: "POST",
            body: { email: created.data.credentials.email, password: created.data.credentials.password }
        });
        assert.equal(oldPasswordLogin.response.status, 401);

        const deleted = await request(`/api/admin/students/${encodeURIComponent(created.data.student.studentId)}`, {
            method: "DELETE",
            token: adminLogin.data.accessToken
        });
        assert.equal(deleted.response.status, 200);
    });

    it("resolves student dashboards case-insensitively by studentId", async () => {
        const adminLogin = await request("/login", {
            method: "POST",
            body: { email: "admin@example.test", password: "AdminPass123!" }
        });
        assert.equal(adminLogin.response.status, 200);

        const dashboard = await request("/api/student-dashboard/stu-001", {
            token: adminLogin.data.accessToken
        });
        assert.equal(dashboard.response.status, 200);
        assert.equal(dashboard.data.student.studentId, "STU-001");
    });

    it("supports course management and student course assignment", async () => {
        const adminLogin = await request("/login", {
            method: "POST",
            body: { email: "admin@example.test", password: "AdminPass123!" }
        });
        assert.equal(adminLogin.response.status, 200);

        const createCourse = await request("/courses", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: {
                title: "Introduction to Algorithms",
                description: "Core algorithm design concepts.",
                duration: "8 weeks",
                instructor: "Dr. Khan"
            }
        });
        assert.equal(createCourse.response.status, 201);
        assert.equal(createCourse.data.course.title, "Introduction to Algorithms");

        const listCourses = await request("/api/courses", { token: adminLogin.data.accessToken });
        assert.equal(listCourses.response.status, 200);
        assert.ok(listCourses.data.some((course) => course.title === "Introduction to Algorithms"));

        const createdStudent = await request("/api/admin/students", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: admission("Course Student", "COURSE-100")
        });
        assert.equal(createdStudent.response.status, 201);

        const assignCourse = await request("/assign-course", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: {
                studentId: "COURSE-100",
                courseId: String(createCourse.data.course.id)
            }
        });
        assert.equal(assignCourse.response.status, 201);

        const studentDashboard = await request(`/api/student-dashboard/${encodeURIComponent("COURSE-100")}`, {
            token: adminLogin.data.accessToken
        });
        assert.equal(studentDashboard.response.status, 200);
        assert.ok(studentDashboard.data.myCourses.some((course) => course.title === "Introduction to Algorithms"));

        const deleteCourse = await request(`/courses/${encodeURIComponent(createCourse.data.course.id)}`, {
            method: "DELETE",
            token: adminLogin.data.accessToken
        });
        assert.equal(deleteCourse.response.status, 200);
    });
});