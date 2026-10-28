// Хранилище данных Nova Launcher на базе node:sqlite (встроено в Node 22).
// Файл БД и загрузки лежат в DATA_DIR — на хостинге это постоянная папка.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./paths');

const db = new DatabaseSync(path.join(DATA_DIR, 'nova.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    verified      INTEGER NOT NULL DEFAULT 0,
    banned        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS news (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT 'Обновления',
    image_url  TEXT,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS programs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'Другое',
    icon_url     TEXT,
    download_url TEXT,
    version      TEXT NOT NULL DEFAULT '1.0.0',
    featured     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    version    TEXT NOT NULL,
    file_name  TEXT NOT NULL,
    size       INTEGER NOT NULL DEFAULT 0,
    notes      TEXT NOT NULL DEFAULT '',
    forced     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER,
    username      TEXT NOT NULL DEFAULT '',
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL DEFAULT 'Другое',
    file_name     TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    size          INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending',
    comment       TEXT NOT NULL DEFAULT '',
    program_id    INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---- Первичные данные ------------------------------------------------------

const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const { hashPassword } = require('./auth');
  const { hash, salt } = hashPassword('admin123');
  db.prepare(
    'INSERT INTO users (username, email, password_hash, salt, role, verified) VALUES (?, ?, ?, ?, ?, 1)'
  ).run('admin', 'admin@nova.local', hash, salt, 'admin');
  console.log('[seed] Создан администратор: admin / admin123  (смените пароль!)');
}

// Первичный администратор от разработчика: Jeckl4ick (админ + верификация).
const devUser = db.prepare('SELECT * FROM users WHERE username = ?').get('Jeckl4ick');
if (!devUser) {
  const { hashPassword } = require('./auth');
  const { hash, salt } = hashPassword('145405');
  db.prepare(
    'INSERT INTO users (username, email, password_hash, salt, role, verified) VALUES (?, ?, ?, ?, ?, 1)'
  ).run('Jeckl4ick', 'jeckl4ick@nova.local', hash, salt, 'admin');
  console.log('[seed] Создан администратор: Jeckl4ick / 145405');
}

const newsCount = db.prepare('SELECT COUNT(*) AS c FROM news').get().c;
if (newsCount === 0) {
  const insert = db.prepare(
    'INSERT INTO news (title, body, category, pinned) VALUES (?, ?, ?, ?)'
  );
  insert.run(
    'Добро пожаловать в Nova Launcher! 🚀',
    'Это первый выпуск новостей. Здесь будут появляться обновления лаунчера, события и анонсы.\n\nСледите за категориями — они вверху ленты.',
    'Обновления',
    1
  );
  insert.run(
    'Живые обои: 20 пресетов уже в лаунчере',
    'В разделе «Обои» доступно 20 анимированных пресетов. Можно загрузить и свои: картинку или видео.',
    'Новости',
    0
  );
  insert.run(
    'Проверьте свой аккаунт',
    'Владельцы могут выдать верификацию в админ-панели. Значок ✅ появится рядом с вашим ником.',
    'Сообщество',
    0
  );
}

const progCount = db.prepare('SELECT COUNT(*) AS c FROM programs').get().c;
if (progCount === 0) {
  const insert = db.prepare(
    'INSERT INTO programs (name, description, category, download_url, version, featured) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insert.run('Notepad++', 'Мощный текстовый редактор для программистов.', 'Софт', 'https://notepad-plus-plus.org/', '8.7.9', 1);
  insert.run('VLC Media Player', 'Универсальный плеер для любых форматов.', 'Медиа', 'https://www.videolan.org/', '3.0.21', 1);
  insert.run('GIMP', 'Бесплатный редактор изображений.', 'Софт', 'https://www.gimp.org/', '2.10.38', 0);
  insert.run('7-Zip', 'Архатор с лучшим сжатием.', 'Утилиты', 'https://www.7-zip.org/', '24.09', 0);
}

module.exports = { db, DATA_DIR };
