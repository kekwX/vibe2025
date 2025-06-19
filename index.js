require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  cookie: { maxAge: 86400000 },
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));

function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Регистрация
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

// Логин
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

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out' });
  });
});

// Получить задачи
app.get('/api/items', isAuthenticated, async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [items] = await connection.execute('SELECT id, text FROM items WHERE user_id = ?', [req.session.userId]);
    await connection.end();
    res.json(items);
  } catch {
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Добавить задачу
app.post('/api/items', isAuthenticated, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('INSERT INTO items (user_id, text) VALUES (?, ?)', [req.session.userId, text.trim()]);
    await connection.end();
    res.status(201).json({ message: 'Item added' });
  } catch {
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Редактировать задачу
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
  } catch {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Удалить задачу
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
  } catch {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Telegram Bot ---

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const telegramSessions = new Map();

async function query(sql, params) {
  const conn = await mysql.createConnection(dbConfig);
  const [rows] = await conn.execute(sql, params);
  await conn.end();
  return rows;
}

bot.onText(/\/register (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const [username, password] = match[1].split(' ');
  if (!username || !password) {
    bot.sendMessage(chatId, 'Используйте: /register username password');
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);
    bot.sendMessage(chatId, 'Регистрация успешна. Теперь войдите через /login');
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      bot.sendMessage(chatId, 'Пользователь с таким именем уже существует');
    } else {
      bot.sendMessage(chatId, 'Ошибка сервера');
    }
  }
});

bot.onText(/\/login (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const [username, password] = match[1].split(' ');
  if (!username || !password) {
    bot.sendMessage(chatId, 'Используйте: /login username password');
    return;
  }
  try {
    const rows = await query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      bot.sendMessage(chatId, 'Неверный логин или пароль');
      return;
    }
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      bot.sendMessage(chatId, 'Неверный логин или пароль');
      return;
    }
    telegramSessions.set(chatId, user.id);
    bot.sendMessage(chatId, `Вы вошли как ${username}`);
  } catch {
    bot.sendMessage(chatId, 'Ошибка сервера');
  }
});

bot.onText(/\/logout/, (msg) => {
  const chatId = msg.chat.id;
  if (telegramSessions.has(chatId)) {
    telegramSessions.delete(chatId);
    bot.sendMessage(chatId, 'Вы вышли из системы');
  } else {
    bot.sendMessage(chatId, 'Вы не вошли');
  }
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = telegramSessions.get(chatId);
  if (!userId) {
    bot.sendMessage(chatId, 'Пожалуйста, войдите через /login');
    return;
  }
  try {
    const items = await query('SELECT id, text FROM items WHERE user_id = ?', [userId]);
    if (items.length === 0) {
      bot.sendMessage(chatId, 'Список пуст');
      return;
    }
    const list = items.map((item, index) => `${index + 1}. ${item.text}`).join('\n');
    bot.sendMessage(chatId, `Ваш список:\n${list}`);
  } catch {
    bot.sendMessage(chatId, 'Ошибка сервера');
  }
});

bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = telegramSessions.get(chatId);
  if (!userId) {
    bot.sendMessage(chatId, 'Пожалуйста, войдите через /login');
    return;
  }
  const text = match[1];
  try {
    await query('INSERT INTO items (user_id, text) VALUES (?, ?)', [userId, text]);
    bot.sendMessage(chatId, `Добавлено: ${text}`);
  } catch {
    bot.sendMessage(chatId, 'Ошибка сервера');
  }
});

bot.onText(/\/edit (\d+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = telegramSessions.get(chatId);
  if (!userId) {
    return bot.sendMessage(chatId, 'Пожалуйста, войдите через /login');
  }
  const listNumber = parseInt(match[1], 10);
  const newText = match[2].trim();
  if (isNaN(listNumber) || !newText) {
    return bot.sendMessage(chatId, 'Используйте: /edit <номер_в_списке> <новый текст>');
  }
  try {
    const items = await query('SELECT id, text FROM items WHERE user_id = ? ORDER BY id', [userId]);
    if (listNumber < 1 || listNumber > items.length) {
      return bot.sendMessage(chatId, 'Нет задачи с таким номером в вашем списке');
    }
    const itemId = items[listNumber - 1].id;
    const result = await query('UPDATE items SET text = ? WHERE id = ? AND user_id = ?', [newText, itemId, userId]);
    if (result.affectedRows === 0) {
      bot.sendMessage(chatId, 'Задача не найдена или не принадлежит вам');
    } else {
      bot.sendMessage(chatId, `Задача №${listNumber} обновлена`);
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Ошибка сервера');
  }
});

bot.onText(/\/delete (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = telegramSessions.get(chatId);
  if (!userId) {
    bot.sendMessage(chatId, 'Пожалуйста, войдите через /login');
    return;
  }
  const listNumber = parseInt(match[1], 10);
  if (isNaN(listNumber)) {
    return bot.sendMessage(chatId, 'Используйте: /delete <номер_в_списке>');
  }
  try {
    const items = await query('SELECT id, text FROM items WHERE user_id = ? ORDER BY id', [userId]);
    if (listNumber < 1 || listNumber > items.length) {
      return bot.sendMessage(chatId, 'Нет задачи с таким номером в вашем списке');
    }
    const itemId = items[listNumber - 1].id;
    const result = await query('DELETE FROM items WHERE id = ? AND user_id = ?', [itemId, userId]);
    if (result.affectedRows === 0) {
      bot.sendMessage(chatId, 'Задача не найдена или не принадлежит вам');
    } else {
      bot.sendMessage(chatId, `Задача №${listNumber} удалена`);
    }
  } catch {
    bot.sendMessage(chatId, 'Ошибка сервера');
  }
});

bot.on('message', (msg) => {
  if (!msg.text.startsWith('/')) {
    bot.sendMessage(msg.chat.id, 'Используйте команды: /register, /login, /logout, /list, /add, /edit, /delete');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
