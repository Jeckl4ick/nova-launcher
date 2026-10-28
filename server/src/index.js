// Nova Launcher API server.
// Запуск: node src/index.js  (PORT берётся из окружения, по умолчанию 8080)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, DATA_DIR } = require('./db');
const { hashPassword, verifyPassword, issueToken, publicUser, requireAuth, requireAdmin } = require('./auth');

const app = express();
const PORT = process.env.PORT || 8080;
const LAUNCHER_VERSION = process.env.LAUNCHER_VERSION || '1.0.0';

app.use(express.json({ limit: '2mb' }));
// CORS — лаунчер (file://) обращается к API напрямую.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- Загрузка файлов -------------------------------------------------------

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = file.fieldname === 'update' ? 'updates'
      : file.fieldname === 'icon' ? 'uploads/icons'
      : file.fieldname === 'avatar' ? 'uploads/avatars'
      : file.fieldname === 'file' ? 'submissions'
      : 'uploads/news';
    cb(null, path.join(DATA_DIR, dir));
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10) || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // до 500 МБ (установщик лаунчера)
  fileFilter(req, file, cb) {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'application/octet-stream', 'application/x-msdownload', 'application/zip'];
    // file/avatar — пользовательские файлы-заявки и картинки: пропускаем всё,
    // иначе Windows отдаёт .exe как application/octet-stream.
    cb(null, ok.includes(file.mimetype) || file.fieldname === 'update' || file.fieldname === 'file');
  },
});

// Статика загрузок (картинки новостей, иконки программ)
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '7d' }));

// ---- Конфигурация лаунчера (аватар и т.п.) ---------------------------------

function getConfig(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setConfig(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

app.get('/api/config', (req, res) => {
  res.json({ avatar_url: getConfig('avatar_url') });
});

app.post('/api/admin/config/avatar', requireAdmin, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  if (!String(req.file.mimetype).startsWith('image/')) {
    fs.rmSync(path.join(DATA_DIR, 'uploads', 'avatars', req.file.filename), { force: true });
    return res.status(400).json({ error: 'Нужно изображение' });
  }
  const old = getConfig('avatar_url');
  if (old && old.startsWith('/uploads/')) {
    fs.rmSync(path.join(DATA_DIR, old.replace(/^\//, '')), { force: true });
  }
  const url = `/uploads/avatars/${req.file.filename}`;
  setConfig('avatar_url', url);
  res.json({ avatar_url: url });
});

app.delete('/api/admin/config/avatar', requireAdmin, (req, res) => {
  const old = getConfig('avatar_url');
  if (old && old.startsWith('/uploads/')) {
    fs.rmSync(path.join(DATA_DIR, old.replace(/^\//, '')), { force: true });
  }
  setConfig('avatar_url', '');
  res.json({ avatar_url: null });
});

// ---- Общие ---------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'Nova Launcher API', version: LAUNCHER_VERSION, time: Date.now() });
});

// ---- Auth ------------------------------------------------------------------

app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!/^[A-Za-zА-Яа-я0-9_.-]{3,24}$/.test(username || '')) {
    return res.status(400).json({ error: 'Имя: 3–24 символа (буквы, цифры, _ . -)' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
    return res.status(400).json({ error: 'Некорректный email' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }
  try {
    const { hash, salt } = hashPassword(password);
    const info = db
      .prepare('INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)')
      .run(username.trim(), email.trim().toLowerCase(), hash, salt);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Имя или email уже заняты' });
    }
    throw e;
  }
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(String(login).trim(), String(login).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  res.json({ token: issueToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---- Новости (публичные) ---------------------------------------------------

const NEWS_CATEGORIES = ['Обновления', 'Новости', 'Сообщество', 'События'];

app.get('/api/news', (req, res) => {
  const { category, search } = req.query;
  let sql = 'SELECT id, title, body, category, image_url, pinned, created_at, updated_at FROM news';
  const where = [];
  const args = [];
  if (category && category !== 'Все') {
    where.push('category = ?');
    args.push(category);
  }
  if (search) {
    where.push('(title LIKE ? OR body LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY pinned DESC, datetime(created_at) DESC';
  res.json({ categories: NEWS_CATEGORIES, items: db.prepare(sql).all(...args) });
});

app.get('/api/news/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Новость не найдена' });
  res.json(item);
});

// ---- Программы (публичные) -------------------------------------------------

app.get('/api/programs', (req, res) => {
  const { category, search } = req.query;
  let sql = 'SELECT * FROM programs';
  const where = [];
  const args = [];
  if (category && category !== 'Все') {
    where.push('category = ?');
    args.push(category);
  }
  if (search) {
    where.push('(name LIKE ? OR description LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY featured DESC, datetime(created_at) DESC';
  const items = db.prepare(sql).all(...args);
  const categories = db.prepare('SELECT DISTINCT category FROM programs ORDER BY category').all().map((r) => r.category);
  res.json({ categories: ['Все', ...categories], items });
});

// ---- Обновление лаунчера ---------------------------------------------------

app.get('/api/update/latest', (req, res) => {
  const latest = db.prepare('SELECT * FROM updates ORDER BY datetime(created_at) DESC, id DESC LIMIT 1').get();
  if (!latest) return res.json({ version: LAUNCHER_VERSION, notes: '', forced: false });
  res.json({
    version: latest.version,
    notes: latest.notes,
    forced: !!latest.forced,
    size: latest.size,
    url: `/api/update/file/${latest.id}`,
    released_at: latest.created_at,
  });
});

// Скачивание установщика (без токена — файл публичный, как и сам лаунчер)
app.get('/api/update/file/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM updates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Файл не найден' });
  const file = path.join(DATA_DIR, 'updates', row.file_name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл отсутствен на диске' });
  res.download(file, path.basename(row.file_name));
});

// ---- Аккаунты --------------------------------------------------------------

app.patch('/api/auth/profile', requireAuth, (req, res) => {
  const { email, password } = req.body || {};
  if (password !== undefined) {
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const { hash, salt } = hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, req.user.id);
  }
  if (email !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
    try {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim().toLowerCase(), req.user.id);
    } catch {
      return res.status(409).json({ error: 'Email уже занят' });
    }
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// ---- Админ: аккаунты -------------------------------------------------------

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM users';
  const args = [];
  if (search) {
    sql += ' WHERE username LIKE ? OR email LIKE ?';
    args.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY datetime(created_at) DESC';
  res.json({ items: db.prepare(sql).all(...args).map(publicUser) });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  const { verified, role, banned } = req.body || {};
  if (role !== undefined) {
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Недопустимая роль' });
    if (target.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Нельзя понизить самого себя' });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  }
  if (verified !== undefined) {
    db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(verified ? 1 : 0, target.id);
  }
  if (banned !== undefined) {
    if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });
    db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, target.id);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  res.json({ user: publicUser(user) });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

// ---- Админ: новости --------------------------------------------------------

function newsBody(req) {
  const { title, body, category, pinned, image_url } = req.body || {};
  if (!title || !String(title).trim()) return { error: 'Укажите заголовок' };
  return {
    data: {
      title: String(title).trim().slice(0, 200),
      body: String(body || '').slice(0, 20000),
      category: NEWS_CATEGORIES.includes(category) ? category : 'Обновления',
      pinned: pinned ? 1 : 0,
      image_url: image_url || null,
    },
  };
}

app.post('/api/admin/news', requireAdmin, upload.single('image'), (req, res) => {
  const { data, error } = newsBody(req);
  if (error) return res.status(400).json({ error });
  if (req.file) data.image_url = `/uploads/${req.file.filename}`;
  const info = db
    .prepare('INSERT INTO news (title, body, category, pinned, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(data.title, data.body, data.category, data.pinned, data.image_url);
  res.json(db.prepare('SELECT * FROM news WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/admin/news/:id', requireAdmin, upload.single('image'), (req, res) => {
  const old = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Новость не найдена' });
  const { data, error } = newsBody(req);
  if (error) return res.status(400).json({ error });
  if (req.file) data.image_url = `/uploads/${req.file.filename}`;
  else if (req.body.drop_image === '1') data.image_url = null;
  else data.image_url = old.image_url;
  db.prepare(
    'UPDATE news SET title = ?, body = ?, category = ?, pinned = ?, image_url = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(data.title, data.body, data.category, data.pinned, data.image_url, old.id);
  res.json(db.prepare('SELECT * FROM news WHERE id = ?').get(old.id));
});

app.delete('/api/admin/news/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Админ: программы ------------------------------------------------------

const PROGRAM_CATEGORIES = ['Софт', 'Игры', 'Медиа', 'Утилиты', 'Разработка', 'Другое'];

function programBody(req) {
  const { name, description, category, download_url, version, featured, icon_url } = req.body || {};
  if (!name || !String(name).trim()) return { error: 'Укажите название' };
  return {
    data: {
      name: String(name).trim().slice(0, 100),
      description: String(description || '').slice(0, 2000),
      category: PROGRAM_CATEGORIES.includes(category) ? category : 'Другое',
      download_url: String(download_url || '').slice(0, 500) || null,
      version: String(version || '1.0.0').slice(0, 30),
      featured: featured ? 1 : 0,
      icon_url: icon_url || null,
    },
  };
}

app.get('/api/programs/categories', (req, res) => res.json({ items: PROGRAM_CATEGORIES }));

app.post('/api/admin/programs', requireAdmin, upload.single('icon'), (req, res) => {
  const { data, error } = programBody(req);
  if (error) return res.status(400).json({ error });
  if (req.file) data.icon_url = `/uploads/${req.file.filename}`;
  const info = db
    .prepare(
      'INSERT INTO programs (name, description, category, download_url, version, featured, icon_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(data.name, data.description, data.category, data.download_url, data.version, data.featured, data.icon_url);
  res.json(db.prepare('SELECT * FROM programs WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/admin/programs/:id', requireAdmin, upload.single('icon'), (req, res) => {
  const old = db.prepare('SELECT * FROM programs WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Программа не найдена' });
  const { data, error } = programBody(req);
  if (error) return res.status(400).json({ error });
  if (req.file) data.icon_url = `/uploads/${req.file.filename}`;
  else if (req.body.drop_icon === '1') data.icon_url = null;
  else data.icon_url = old.icon_url;
  db.prepare(
    "UPDATE programs SET name = ?, description = ?, category = ?, download_url = ?, version = ?, featured = ?, icon_url = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(data.name, data.description, data.category, data.download_url, data.version, data.featured, data.icon_url, old.id);
  res.json(db.prepare('SELECT * FROM programs WHERE id = ?').get(old.id));
});

app.delete('/api/admin/programs/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM programs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Заявки пользователей (категория «Добавление») --------------------------

const SUBMISSION_CATEGORIES = ['Софт', 'Игры', 'Медиа', 'Утилиты', 'Разработка', 'Другое'];

// Пользователь отправляет свой файл на модерацию.
app.post('/api/submissions', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Укажите название' });
  const category = SUBMISSION_CATEGORIES.includes(req.body.category) ? req.body.category : 'Другое';
  const info = db
    .prepare(
      'INSERT INTO submissions (user_id, username, name, description, category, file_name, original_name, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      req.user.id, req.user.username, name,
      String(req.body.description || '').slice(0, 2000),
      category, req.file.filename,
      String(req.file.originalname || req.file.filename).slice(0, 200),
      req.file.size
    );
  res.json(db.prepare('SELECT * FROM submissions WHERE id = ?').get(info.lastInsertRowid));
});

// Свои заявки — статус и комментарий модератора.
app.get('/api/submissions/mine', requireAuth, (req, res) => {
  const items = db
    .prepare('SELECT id, name, description, category, original_name, size, status, comment, created_at FROM submissions WHERE user_id = ? ORDER BY id DESC')
    .all(req.user.id);
  res.json({ items });
});

// Публичное скачивание принятой программы.
app.get('/api/submissions/file/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!row || row.status !== 'accepted') return res.status(404).json({ error: 'Файл не найден' });
  const file = path.join(DATA_DIR, 'submissions', row.file_name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл отсутствует на диске' });
  res.download(file, row.original_name || row.file_name);
});

// ---- Админ: модерация заявок ------------------------------------------------

app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM submissions';
  const args = [];
  if (status) {
    sql += ' WHERE status = ?';
    args.push(status);
  }
  sql += " ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC";
  res.json({ items: db.prepare(sql).all(...args) });
});

// Принять: заявка превращается в программу каталога.
app.post('/api/admin/submissions/:id/accept', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
  if (row.status === 'accepted') return res.status(400).json({ error: 'Заявка уже принята' });

  const info = db
    .prepare(
      'INSERT INTO programs (name, description, category, download_url, version) VALUES (?, ?, ?, ?, ?)'
    )
    .run(row.name, row.description, row.category, `/api/submissions/file/${row.id}`, '1.0.0');
  db.prepare("UPDATE submissions SET status = 'accepted', program_id = ?, comment = '' WHERE id = ?").run(
    info.lastInsertRowid, row.id
  );
  res.json({ ok: true, program_id: info.lastInsertRowid });
});

// Отклонить: с комментарием, который увидит автор заявки.
app.post('/api/admin/submissions/:id/reject', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
  const comment = String((req.body && req.body.comment) || '').trim().slice(0, 1000);
  db.prepare("UPDATE submissions SET status = 'rejected', comment = ? WHERE id = ?").run(comment, row.id);
  res.json({ ok: true });
});

// Полное удаление заявки вместе с файлом.
app.delete('/api/admin/submissions/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (row) {
    fs.rmSync(path.join(DATA_DIR, 'submissions', row.file_name), { force: true });
    if (row.program_id) db.prepare('DELETE FROM programs WHERE id = ?').run(row.program_id);
    db.prepare('DELETE FROM submissions WHERE id = ?').run(row.id);
  }
  res.json({ ok: true });
});

// Файл заявки для админа («Открыть программу»): скачивание с авторизацией.
app.get('/api/admin/submissions/:id/file', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
  const file = path.join(DATA_DIR, 'submissions', row.file_name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл отсутствует на диске' });
  res.download(file, row.original_name || row.file_name);
});

// ---- Админ: обновления лаунчера -------------------------------------------

app.get('/api/admin/updates', requireAdmin, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM updates ORDER BY datetime(created_at) DESC').all() });
});

app.post('/api/admin/updates', requireAdmin, upload.single('update'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл установщика не получен' });
  const version = String(req.body.version || '').trim();
  if (!/^\d+(\.\d+){0,3}$/.test(version)) return res.status(400).json({ error: 'Версия вида 1.2.3' });
  const info = db
    .prepare('INSERT INTO updates (version, file_name, size, notes, forced) VALUES (?, ?, ?, ?, ?)')
    .run(version, req.file.filename, req.file.size, String(req.body.notes || '').slice(0, 5000), req.body.forced ? 1 : 0);
  res.json(db.prepare('SELECT * FROM updates WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/admin/updates/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM updates WHERE id = ?').get(req.params.id);
  if (row) {
    const file = path.join(DATA_DIR, 'updates', row.file_name);
    fs.rmSync(file, { force: true });
    db.prepare('DELETE FROM updates WHERE id = ?').run(row.id);
  }
  res.json({ ok: true });
});

// ---- Админ: статистика -----------------------------------------------------

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const count = (sql) => db.prepare(sql).get().c;
  res.json({
    users: count('SELECT COUNT(*) AS c FROM users'),
    verified: count('SELECT COUNT(*) AS c FROM users WHERE verified = 1'),
    admins: count('SELECT COUNT(*) AS c FROM users WHERE role = \'admin\''),
    news: count('SELECT COUNT(*) AS c FROM news'),
    programs: count('SELECT COUNT(*) AS c FROM programs'),
    updates: count('SELECT COUNT(*) AS c FROM updates'),
    launcher_version: LAUNCHER_VERSION,
  });
});

// ---- 404 и ошибки ----------------------------------------------------------

app.use('/api', (req, res) => res.status(404).json({ error: 'Метод не найден' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`Nova API слушает http://0.0.0.0:${PORT}`);
});
