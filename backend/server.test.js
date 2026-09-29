const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const bcrypt = require("bcryptjs");

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
fs.writeFileSync(classesPath, "[]");
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

        const claimedExistingStudent = await request("/signup", {
            method: "POST",
            body: { name: "Impersonator", studentId: "STU-001", email: "existing@example.test", password: "Password123!" }
        });
        assert.equal(claimedExistingStudent.response.status, 409);

        const adminLogin = await request("/login", { method: "POST", body: { email: "admin@example.test", password: "AdminPass123!" } });
        assert.equal(adminLogin.response.status, 200);
        assert.equal(adminLogin.data.student.role, "ADMIN");

        const unauthenticatedCreate = await request("/api/admin/students", {
            method: "POST",
            body: { name: "Test Student", studentId: "TEST-100", program: "Computer Science", semester: 1, cgpa: 3.2, attendance: 90 }
        });
        assert.equal(unauthenticatedCreate.response.status, 401);

        const invalidStudent = await request("/api/admin/students", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: { name: "Test Student", studentId: "BAD ID", program: "Computer Science", semester: 1, cgpa: 3.2, attendance: 90 }
        });
        assert.equal(invalidStudent.response.status, 400);

        const created = await request("/api/admin/students", {
            method: "POST",
            token: adminLogin.data.accessToken,
            body: { name: "Test Student", studentId: "TEST-100", program: "Computer Science", semester: 1, cgpa: 3.2, attendance: 90 }
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
            body: { students: [{ name: "Bulk Student", studentId: "TEST-101", program: "Computer Science", semester: 1, cgpa: 2.8, attendance: 84 }] }
        });
        assert.equal(bulkCreated.response.status, 201);
        assert.equal(bulkCreated.data.credentials.length, 1);
        assert.equal(bulkCreated.data.credentials[0].studentId, "TEST-101");

        const oldPasswordLogin = await request("/login", {
            method: "POST",
            body: { email: created.data.credentials.email, password: created.data.credentials.password }
        });
        assert.equal(oldPasswordLogin.response.status, 401);
    });
});