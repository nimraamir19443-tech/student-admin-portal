# Student Admin Portal

A full-stack web application for managing student records with a modern, responsive interface.

## Features

- 📚 View all student records
- ➕ Add new students with name, email, roll number, and grade
- ✏️ Edit existing student information
- 🗑️ Delete student records
- 🎨 Beautiful, responsive UI with gradient design
- 🗄️ PostgreSQL database for persistent storage
- 🔄 RESTful API backend built with Express.js

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL
- **Deployment**: Railway

## Project Structure

```
student-admin-portal/
├── server/
│   ├── index.js           # Express server and API routes
│   └── db/
│       └── init.js        # Database initialization script
├── public/
│   └── index.html         # Frontend UI
├── package.json
└── README.md
```

## Getting Started

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/nimraamir19443-tech/student-admin-portal.git
   cd student-admin-portal
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your database URL
   ```

4. Initialize the database:
   ```bash
   npm run build
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open your browser to `http://localhost:3000`

### Admin Login and Student Credentials

Configure these environment variables for the backend before deploying:

- `ADMIN_EMAIL`: the administrator's login email.
- `ADMIN_PASSWORD_HASH`: a bcrypt hash of the administrator password. Generate one with `node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" "your-admin-password"`.
- `AUTH_TOKEN_SECRET`: a random signing secret. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and keep it stable between restarts.
- `STUDENT_EMAIL_DOMAIN` (optional): domain used for generated student usernames. Defaults to `students.campusdesk.local`.

Production startup requires `ADMIN_EMAIL`, a valid bcrypt `ADMIN_PASSWORD_HASH`, and an `AUTH_TOKEN_SECRET` of at least 32 bytes. Configure the same signing secret on every backend instance.

Admins sign in through `/login`. Creating a student generates a unique email-style username and a random temporary password. The password is bcrypt-hashed in the account store and returned only in the creation response for the admin to share. Students must choose a new password at first login before any student APIs can be used. Login tokens expire after eight hours.

Run the focused authentication and account-flow tests with `npm test`.

## API Endpoints

- `GET /api/students` - Get all students
- `GET /api/students/:id` - Get a specific student
- `POST /api/students` - Create a new student
- `PUT /api/students/:id` - Update a student
- `DELETE /api/students/:id` - Delete a student

## Database Schema

```sql
CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  roll_number VARCHAR(50) UNIQUE NOT NULL,
  grade VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Deployment on Railway

The application is configured to deploy on Railway with a PostgreSQL database.

1. Push to GitHub
2. Connect your repository to Railway
3. Add PostgreSQL service
4. Set `DATABASE_URL` environment variable
5. Deploy!

## License

MIT

