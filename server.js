const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Подключаем базу данных (создаст файл gala.db)
const db = new Database('gala.db');
db.pragma('journal_mode = WAL');

// Создаём таблицы
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

        CREATE TABLE IF NOT EXISTS dresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        price_per_day INTEGER NOT NULL,
        image_url TEXT,
        sizes TEXT NOT NULL,
        category TEXT DEFAULT 'wedding',
        status TEXT DEFAULT 'active',
        sort_order INTEGER DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        dress TEXT NOT NULL,
        size TEXT NOT NULL,
        date_start TEXT NOT NULL,
        date_end TEXT NOT NULL,
        days INTEGER NOT NULL,
        total TEXT NOT NULL,
        commission TEXT NOT NULL DEFAULT '0',
        status TEXT DEFAULT 'new',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

console.log('✅ База данных готова!');

// Настройки сервера
app.use(express.json());
app.use(express.static('public'));
// Отдача главной страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(session({
    secret: 'gala-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({ storage: storage });

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/register', async (req, res) => {
    const { full_name, email, phone, password } = req.body;

    if (!full_name || !email || !password) {
        return res.json({ success: false, message: 'Заполните ФИО, Email и Пароль' });
    }

    const userExists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (userExists) {
        return res.json({ success: false, message: 'Пользователь с таким email уже существует' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const result = db.prepare(
            'INSERT INTO users (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?)'
        ).run(full_name, email, phone || '', hashedPassword);

        req.session.userId = result.lastInsertRowid;
        req.session.userName = full_name;

        console.log(`✅ Новый пользователь: ${full_name} (${email})`);
        res.json({ success: true, message: 'Регистрация успешна!' });
    } catch (err) {
        console.error('Ошибка регистрации:', err);
        res.json({ success: false, message: 'Ошибка сервера при регистрации' });
    }
});

// ========== ВХОД ==========
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
        return res.json({ success: false, message: 'Неверный email или пароль' });
    }

    try {
        const match = await bcrypt.compare(password, user.password_hash);

        if (!match) {
            return res.json({ success: false, message: 'Неверный email или пароль' });
        }

        req.session.userId = user.id;
        req.session.userName = user.full_name;

        console.log(`🔑 Вход: ${user.full_name} (${user.email})`);
        res.json({ success: true, message: 'Вход выполнен!', user: { id: user.id, name: user.full_name } });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.json({ success: false, message: 'Ошибка сервера при входе' });
    }
});

// ========== ПРОВЕРИТЬ АВТОРИЗАЦИЮ ==========
app.get('/api/me', (req, res) => {
    if (req.session.userId) {
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
        res.json({ loggedIn: true, user: { id: req.session.userId, name: req.session.userName, role: user ? user.role : 'user' } });
    } else {
        res.json({ loggedIn: false });
    }
});

// ========== ПРОВЕРИТЬ РОЛЬ АДМИНА ==========
app.get('/api/admin/check', (req, res) => {
    if (!req.session.userId) {
        return res.json({ admin: false, message: 'Не авторизован' });
    }

    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    
    if (user && user.role === 'admin') {
        res.json({ admin: true });
    } else {
        res.json({ admin: false, message: 'Доступ запрещён' });
    }
});

// ========== ВЫХОД ==========
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Вы вышли' });
});

// ========== СОЗДАТЬ БРОНИРОВАНИЕ ==========
app.post('/api/bookings', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Нужно войти или зарегистрироваться' });
    }

    const { dress, size, date_start, date_end, days, total } = req.body;

    // Считаем комиссию 15%
    const totalNum = parseInt(total.replace(/[^0-9]/g, ''));
    const commission = Math.round(totalNum * 0.15);
    const commissionStr = commission.toLocaleString('ru-RU') + ' ₽';

    const result = db.prepare(
        'INSERT INTO bookings (user_id, dress, size, date_start, date_end, days, total, commission, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.session.userId, dress, size, date_start, date_end, days, total, commissionStr, 'new');

    console.log(`📦 Бронь #${result.lastInsertRowid}: ${dress} | Комиссия: ${commissionStr} | ${req.session.userName}`);
    res.json({ 
        success: true, 
        message: 'Бронирование создано!', 
        bookingId: result.lastInsertRowid,
        commission: commissionStr
    });
});

// ========== ПОЛУЧИТЬ БРОНИРОВАНИЯ ==========
app.get('/api/bookings', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, bookings: [] });
    }

    const bookings = db.prepare(
        'SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.session.userId);

    res.json({ success: true, bookings });
});

// ========== УДАЛИТЬ БРОНИРОВАНИЕ ==========
app.delete('/api/bookings/:id', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    db.prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);

    console.log(`🗑️ Удалена бронь #${req.params.id}`);
    res.json({ success: true, message: 'Бронирование удалено' });
});

// ========== АДМИН: ИЗМЕНИТЬ СТАТУС БРОНИ ==========
app.put('/api/admin/bookings/:id', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.json({ success: false, message: 'Доступ запрещён' });
    }

    const { status } = req.body;
    
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);

    console.log(`🔄 Админ изменил статус брони #${req.params.id} на "${status}"`);
    res.json({ success: true, message: 'Статус обновлён!' });
});

// ========== ДОБАВИТЬ НАРЯД ==========
app.post('/api/dresses', upload.single('image'), (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const { title, description, price_per_day, sizes, category } = req.body;
    const image_url = req.file ? '/uploads/' + req.file.filename : null;

    if (!title || !description || !price_per_day || !sizes) {
        return res.json({ success: false, message: 'Заполните все обязательные поля' });
    }

    const result = db.prepare(
        'INSERT INTO dresses (seller_id, title, description, price_per_day, image_url, sizes, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.session.userId, title, description, parseInt(price_per_day), image_url, sizes, category || 'wedding');

    console.log(`👗 Новый наряд #${result.lastInsertRowid}: ${title} от пользователя #${req.session.userId}`);
    res.json({ success: true, message: 'Наряд добавлен!', dressId: result.lastInsertRowid });
});

// ========== МОИ НАРЯДЫ ==========
app.get('/api/my-dresses', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, dresses: [] });
    }

    const dresses = db.prepare('SELECT * FROM dresses WHERE seller_id = ? ORDER BY created_at DESC').all(req.session.userId);
    res.json({ success: true, dresses });
});

// ========== УДАЛИТЬ НАРЯД ==========
app.delete('/api/dresses/:id', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const dress = db.prepare('SELECT * FROM dresses WHERE id = ? AND seller_id = ?').get(req.params.id, req.session.userId);
    if (!dress) {
        return res.json({ success: false, message: 'Наряд не найден' });
    }

    db.prepare('DELETE FROM dresses WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Наряд удалён' });
});

// ========== РЕДАКТИРОВАТЬ НАРЯД ==========
app.put('/api/dresses/:id', upload.single('image'), (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const dress = db.prepare('SELECT * FROM dresses WHERE id = ? AND seller_id = ?').get(req.params.id, req.session.userId);
    if (!dress) {
        return res.json({ success: false, message: 'Наряд не найден' });
    }

    const { title, description, price_per_day, sizes, category } = req.body;
    const image_url = req.file ? '/uploads/' + req.file.filename : dress.image_url;

    if (!title || !description || !price_per_day || !sizes) {
        return res.json({ success: false, message: 'Заполните все обязательные поля' });
    }

    db.prepare(
        'UPDATE dresses SET title = ?, description = ?, price_per_day = ?, image_url = ?, sizes = ?, category = ? WHERE id = ?'
    ).run(title, description, parseInt(price_per_day), image_url, sizes, category || 'wedding', req.params.id);

    console.log(`✏️ Наряд #${req.params.id} обновлён: ${title}`);
    res.json({ success: true, message: 'Наряд обновлён!' });
});

// ========== ОБНОВИТЬ КАТАЛОГ (для главной) ==========
app.get('/api/dresses', (req, res) => {
    const dresses = db.prepare('SELECT * FROM dresses WHERE status = ? ORDER BY sort_order, created_at DESC').all('active');
    res.json(dresses);
});



// ========== ПОЛУЧИТЬ QR-КОД ДЛЯ ОПЛАТЫ ==========
app.get('/api/bookings/:id/qr', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);

    if (!booking) {
        return res.json({ success: false, message: 'Бронирование не найдено' });
    }

    // Данные для QR-кода
    const qrData = `Заказ #${booking.id}\nПлатье: ${booking.dress}\nСумма: ${booking.total}\nКомиссия: ${booking.commission}`;

    QRCode.toDataURL(qrData, { width: 250, margin: 2 }, (err, url) => {
        if (err) {
            return res.json({ success: false, message: 'Ошибка генерации QR-кода' });
        }
        res.json({ success: true, qr: url });
    });
});

// ========== ОПЛАТА БРОНИРОВАНИЯ ==========
app.post('/api/bookings/:id/pay', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);

    if (!booking) {
        return res.json({ success: false, message: 'Бронирование не найдено' });
    }

    if (booking.status === 'paid') {
        return res.json({ success: false, message: 'Бронирование уже оплачено' });
    }

    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run('paid', req.params.id);

    console.log(`💰 Бронь #${req.params.id} оплачена! Комиссия: ${booking.commission}`);
    res.json({ success: true, message: 'Оплата подтверждена! Спасибо за заказ!' });
});

// ========== АДМИН: ВСЕ ПОЛЬЗОВАТЕЛИ ==========
app.get('/api/admin/users', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.json({ success: false, message: 'Доступ запрещён' });
    }

    const users = db.prepare(`
        SELECT u.*, COUNT(b.id) as order_count 
        FROM users u 
        LEFT JOIN bookings b ON u.id = b.user_id 
        GROUP BY u.id 
        ORDER BY u.created_at DESC
    `).all();

    res.json({ success: true, users });
});

// ========== АДМИН: ВСЕ БРОНИ ==========
app.get('/api/admin/bookings', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== 'admin') {
        return res.json({ success: false, message: 'Доступ запрещён' });
    }

    const bookings = db.prepare(`
        SELECT bookings.*, users.full_name, users.email 
        FROM bookings 
        JOIN users ON bookings.user_id = users.id 
        ORDER BY bookings.created_at DESC
    `).all();

    // Статистика
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
        FROM bookings
    `).get();

    res.json({ success: true, bookings, stats });
});

// ========== АДМИН: СДЕЛАТЬ ПОЛЬЗОВАТЕЛЯ АДМИНОМ ==========
app.put('/api/admin/users/:id/role', (req, res) => {
    if (!req.session.userId) {
        return res.json({ success: false, message: 'Не авторизован' });
    }

    const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || admin.role !== 'admin') {
        return res.json({ success: false, message: 'Доступ запрещён' });
    }

    const { role } = req.body;
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
    
    res.json({ success: true, message: 'Роль обновлена!' });
});

// Запуск
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
    console.log(`📊 Все брони: http://localhost:${PORT}/api/admin/bookings`);
});