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

