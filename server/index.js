import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API Routes
// Get all students
app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get student by ID
app.get('/api/students/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Create student
app.post('/api/students', async (req, res) => {
  const { name, email, roll_number, grade } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO students (name, email, roll_number, grade, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [name, email, roll_number, grade]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update student
app.put('/api/students/:id', async (req, res) => {
  const { name, email, roll_number, grade } = req.body;
  try {
    const result = await pool.query(
      'UPDATE students SET name = $1, email = $2, roll_number = $3, grade = $4, updated_at = NOW() WHERE id = $5 RETURNING *',
      [name, email, roll_number, grade, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete student
app.delete('/api/students/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json({ message: 'Student deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Serve frontend
app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

