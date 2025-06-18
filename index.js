const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = 3000;

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'password', // <-- your MySQL password here
  database: 'todolist',
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'your_secret_key_here', // change to a secure secret
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Register user
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
    await connection.end();
    res.status(201).json({ message: 'User registered' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Login user
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
    await connection.end();

    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ message: 'Logged in' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout user
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out' });
  });
});

// Get ToDo items for logged-in user
app.get('/api/items', isAuthenticated, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [items] = await connection.execute('SELECT id, text FROM items WHERE user_id = ?', [req.session.userId]);
    await connection.end();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Add ToDo item
app.post('/api/items', isAuthenticated, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('INSERT INTO items (user_id, text) VALUES (?, ?)', [req.session.userId, text.trim()]);
    await connection.end();
    res.status(201).json({ message: 'Item added' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Update ToDo item
app.put('/api/items/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
      'UPDATE items SET text = ? WHERE id = ? AND user_id = ?',
      [text.trim(), id, req.session.userId]
    );
    await connection.end();

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Item not found' });

    res.json({ message: 'Item updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Delete ToDo item
app.delete('/api/items/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;

  try {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
      'DELETE FROM items WHERE id = ? AND user_id = ?',
      [id, req.session.userId]
    );
    await connection.end();

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Item not found' });

    res.json({ message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Serve frontend HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
