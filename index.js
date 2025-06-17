const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'password', // <-- Set your MySQL password if needed
    database: 'todolist',
};

async function retrieveListItems() {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT id, text FROM items');
    await connection.end();
    return rows;
}

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

async function apiDeleteItem(req, res) {
    const id = req.url.split('/').pop();
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM items WHERE id = ?', [id]);
        await connection.end();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to delete item' }));
    }
}

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
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
    } else if (req.url === '/api/items' && req.method === 'GET') {
        await apiGetItems(req, res);
    } else if (req.url === '/api/items' && req.method === 'POST') {
        await apiAddItem(req, res);
    } else if (req.url.startsWith('/api/items/') && req.method === 'PUT') {
        await apiUpdateItem(req, res);
    } else if (req.url.startsWith('/api/items/') && req.method === 'DELETE') {
        await apiDeleteItem(req, res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
