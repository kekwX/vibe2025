const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'password', // Укажите свой пароль, если он есть
    database: 'todolist',
};

// Получить все задачи
async function retrieveListItems() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items';
        const [rows] = await connection.execute(query);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

// API: Получить все задачи
async function apiGetItems(req, res) {
    try {
        const items = await retrieveListItems();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch items' }));
    }
}

// API: Добавить новую задачу
async function apiAddItem(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        try {
            const { text } = JSON.parse(body);
            if (!text || !text.trim()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Text is required' }));
                return;
            }
            const connection = await mysql.createConnection(dbConfig);
            await connection.execute('INSERT INTO items (text) VALUES (?)', [text.trim()]);
            await connection.end();
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to add item' }));
        }
    });
}

// API: Изменить задачу
async function apiUpdateItem(req, res) {
    const id = req.url.split('/').pop();
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        try {
            const { text } = JSON.parse(body);
            if (!text || !text.trim()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Text is required' }));
                return;
            }
            const connection = await mysql.createConnection(dbConfig);
            await connection.execute('UPDATE items SET text = ? WHERE id = ?', [text.trim(), id]);
            await connection.end();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to update item' }));
        }
    });
}

// Основной обработчик запросов
async function handleRequest(req, res) {
    if (req.url === '/' && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'),
                'utf8'
            );
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
    } else if (req.url === '/api/items' && req.method === 'GET') {
        await apiGetItems(req, res);
    } else if (req.url === '/api/items' && req.method === 'POST') {
        await apiAddItem(req, res);
    } else if (req.url.startsWith('/api/items/') && req.method === 'PUT') {
        await apiUpdateItem(req, res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

// Запуск сервера
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
