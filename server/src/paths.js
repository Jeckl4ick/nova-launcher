// Общие пути хранилища. Вынесено отдельно, чтобы не было цикла require.
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'news'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'icons'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'avatars'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'submissions'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'updates'), { recursive: true });

module.exports = { DATA_DIR };
