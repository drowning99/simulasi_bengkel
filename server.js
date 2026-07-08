const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== ERROR HANDLER GLOBAL ==========
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  console.error('Stack:', err.stack);
});

// ========== MIDDLEWARE ==========
console.log('⚙️  Configuring middleware...');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia_bengkel_smk',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set false agar bisa diakses via HTTP
    maxAge: 1000 * 60 * 60 * 24 // 1 hari
  }
}));

// ========== PERSIAPAN FOLDER ==========
console.log('📂 Creating folders...');
const dirs = ['uploads', 'data'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    console.log(`✅ Folder ${dir} created`);
  } else {
    console.log(`📁 Folder ${dir} already exists`);
  }
});

// ========== FUNGSI BACA/TULIS JSON ==========
console.log('📄 Setting up JSON functions...');

const readJSON = (file) => {
  try {
    const filePath = `./data/${file}.json`;
    if (!fs.existsSync(filePath)) {
      console.log(`📄 File ${file}.json not found, returning empty array`);
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`❌ Error reading ${file}.json:`, err.message);
    return [];
  }
};

const writeJSON = (file, data) => {
  try {
    const filePath = `./data/${file}.json`;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✅ ${file}.json saved successfully (${data.length} records)`);
    return true;
  } catch (err) {
    console.error(`❌ Error writing ${file}.json:`, err.message);
    return false;
  }
};

// ========== INISIALISASI DATA DEFAULT ==========
console.log('📂 Initializing default data...');

// Users
let users = readJSON('users');
if (users.length === 0) {
  console.log('📝 Creating default users...');
  users = [
    { id: 'g1', name: 'Pak Andi', role: 'guru', password: 'guru123', kelas: '-' },
    { id: 's1', name: 'Budi', role: 'siswa', password: 'siswa123', kelas: 'TKR 1' },
    { id: 's2', name: 'Ani', role: 'siswa', password: 'siswa123', kelas: 'TKR 1' }
  ];
  writeJSON('users', users);
} else {
  console.log(`✅ Users loaded: ${users.length} records`);
}

// Tasks
let tasks = readJSON('tasks');
if (tasks.length === 0) {
  console.log('📝 Creating empty tasks...');
  writeJSON('tasks', []);
} else {
  console.log(`✅ Tasks loaded: ${tasks.length} records`);
}

// Submissions
let submissions = readJSON('submissions');
if (submissions.length === 0) {
  console.log('📝 Creating empty submissions...');
  writeJSON('submissions', []);
} else {
  console.log(`✅ Submissions loaded: ${submissions.length} records`);
}

console.log('✅ All data ready!');

// ========== KONFIGURASI MULTER (UPLOAD FILE) ==========
console.log('📤 Configuring Multer...');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});
console.log('✅ Multer configured');

// ========== MIDDLEWARE AUTH ==========
const isAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Silakan login' });
  }
  next();
};

const isGuru = (req, res, next) => {
  if (req.session.user?.role !== 'guru') {
    return res.status(403).json({ error: 'Akses hanya untuk guru' });
  }
  next();
};

const isSiswa = (req, res, next) => {
  if (req.session.user?.role !== 'siswa') {
    return res.status(403).json({ error: 'Akses hanya untuk siswa' });
  }
  next();
};

// ========== ROUTES ==========
console.log('🛣️  Setting up routes...');

// --- Registrasi ---
app.post('/api/register', (req, res) => {
  console.log('📝 Register attempt:', req.body.username);
  const { username, name, password, role, kelas } = req.body;
  
  if (!username || !name || !password || !role) {
    return res.status(400).json({ error: 'Semua field wajib diisi' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }
  if (!['siswa', 'guru'].includes(role)) {
    return res.status(400).json({ error: 'Peran tidak valid' });
  }

  const users = readJSON('users');
  if (users.find(u => u.id === username)) {
    return res.status(400).json({ error: 'Username sudah terdaftar' });
  }

  const newUser = {
    id: username,
    name,
    password,
    role,
    kelas: role === 'siswa' ? (kelas || '-') : '-'
  };
  
  users.push(newUser);
  const saved = writeJSON('users', users);
  
  if (!saved) {
    return res.status(500).json({ error: 'Gagal menyimpan data' });
  }
  
  console.log('✅ User registered:', username);
  res.status(201).json({ success: true, message: 'Akun berhasil dibuat, silakan login' });
});

// --- Login ---
app.post('/api/login', (req, res) => {
  console.log('🔐 Login attempt:', req.body.username);
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }
  
  const users = readJSON('users');
  const user = users.find(u => u.id === username && u.password === password);
  
  if (!user) {
    console.log('❌ Login failed:', username);
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  
  req.session.user = user;
  console.log('✅ Login success:', username);
  res.json({ role: user.role, name: user.name });
});

// --- Logout ---
app.get('/api/logout', (req, res) => {
  console.log('👋 Logout:', req.session.user?.id);
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/');
  });
});

// --- Data user yang login ---
app.get('/api/me', isAuth, (req, res) => {
  res.json(req.session.user);
});

// --- DEBUG: Lihat daftar user (HANYA UNTUK TESTING) ---
app.get('/api/debug-users', (req, res) => {
  const users = readJSON('users');
  const safe = users.map(u => ({ 
    id: u.id, 
    name: u.name, 
    role: u.role, 
    kelas: u.kelas,
    hasPassword: !!u.password 
  }));
  res.json({ total: safe.length, users: safe });
});

// --- GURU: Buat tugas ---
app.post('/api/tasks', isAuth, isGuru, upload.single('file'), (req, res) => {
  console.log('📝 Creating task:', req.body.title);
  const tasks = readJSON('tasks');
  const newTask = {
    id: uuidv4(),
    title: req.body.title,
    description: req.body.description,
    deadline: req.body.deadline,
    fileRef: req.file ? req.file.filename : null,
    createdBy: req.session.user.id,
    createdAt: new Date().toISOString()
  };
  tasks.push(newTask);
  writeJSON('tasks', tasks);
  console.log('✅ Task created:', newTask.id);
  res.json({ success: true, task: newTask });
});

// --- Semua user: lihat tugas (dengan status untuk siswa) ---
app.get('/api/tasks', isAuth, (req, res) => {
  console.log('📋 Fetching tasks for:', req.session.user.id);
  const tasks = readJSON('tasks');
  if (req.session.user.role === 'siswa') {
    const submissions = readJSON('submissions');
    const userId = req.session.user.id;
    const enriched = tasks.map(task => {
      const sub = submissions.find(s => s.taskId === task.id && s.studentId === userId);
      return {
        ...task,
        status: sub ? sub.status : 'Belum dikerjakan',
        score: sub ? sub.score : null
      };
    });
    return res.json(enriched);
  }
  res.json(tasks);
});

// --- Detail tugas ---
app.get('/api/tasks/:id', isAuth, (req, res) => {
  const tasks = readJSON('tasks');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Tugas tidak ditemukan' });
  res.json(task);
});

// --- SISWA: Kumpulkan tugas ---
app.post('/api/submissions', isAuth, isSiswa, upload.single('file'), (req, res) => {
  console.log('📤 Submission from:', req.session.user.id, 'for task:', req.body.taskId);
  const submissions = readJSON('submissions');
  const { taskId, textAnswer } = req.body;
  const studentId = req.session.user.id;

  const existing = submissions.findIndex(s => s.taskId === taskId && s.studentId === studentId);
  const data = {
    taskId,
    studentId,
    studentName: req.session.user.name,
    textAnswer: textAnswer || '',
    filePath: req.file ? req.file.filename : null,
    submittedAt: new Date().toISOString(),
    status: 'pending',
    score: null,
    feedback: null
  };

  if (existing > -1) {
    submissions[existing] = { ...submissions[existing], ...data, status: 'pending' };
  } else {
    submissions.push(data);
  }
  writeJSON('submissions', submissions);
  console.log('✅ Submission saved');
  res.json({ success: true });
});

// --- GURU: Lihat semua jawaban untuk suatu tugas ---
app.get('/api/submissions/task/:taskId', isAuth, isGuru, (req, res) => {
  console.log('📋 Fetching submissions for task:', req.params.taskId);
  const submissions = readJSON('submissions');
  const filtered = submissions.filter(s => s.taskId === req.params.taskId);
  res.json(filtered);
});

// --- GURU: Beri nilai ---
app.put('/api/submissions/grade', isAuth, isGuru, (req, res) => {
  console.log('📝 Grading submission for task:', req.body.taskId, 'student:', req.body.studentId);
  const { taskId, studentId, score, feedback } = req.body;
  if (!taskId || !studentId || score === undefined) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }
  const submissions = readJSON('submissions');
  const idx = submissions.findIndex(s => s.taskId === taskId && s.studentId === studentId);
  if (idx === -1) return res.status(404).json({ error: 'Submission tidak ditemukan' });

  submissions[idx].score = parseInt(score);
  submissions[idx].feedback = feedback || '';
  submissions[idx].status = 'reviewed';
  writeJSON('submissions', submissions);
  console.log('✅ Grade saved');
  res.json({ success: true, message: 'Nilai berhasil disimpan' });
});

// --- SISWA: Riwayat nilainya sendiri ---
app.get('/api/my-submissions', isAuth, isSiswa, (req, res) => {
  console.log('📊 Fetching scores for:', req.session.user.id);
  const submissions = readJSON('submissions');
  const mine = submissions.filter(s => s.studentId === req.session.user.id);
  res.json(mine);
});

// ========== SERVE HTML ==========
console.log('🌐 Setting up HTML routes...');

// Halaman utama (login)
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'guru' ? '/guru' : '/siswa');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Halaman registrasi
app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'guru' ? '/guru' : '/siswa');
  }
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Halaman dashboard guru
app.get('/guru', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'guru') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard-guru.html'));
});

// Halaman dashboard siswa
app.get('/siswa', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'siswa') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard-siswa.html'));
});

// ========== HEALTH CHECK (untuk Railway) ==========
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// ========== ERROR HANDLER TERAKHIR ==========
app.use((err, req, res, next) => {
  console.error('❌ Express error:', err);
  console.error('Stack:', err.stack);
  res.status(500).json({ 
    error: 'Terjadi kesalahan server', 
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ========== START SERVER ==========
console.log('🚀 Starting server...');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚗 Bengkel Digital running on port ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📂 Static files: ${path.join(__dirname, 'public')}`);
});

// Log semua route yang terdaftar
console.log('✅ Routes registered:');
console.log('   GET  /');
console.log('   GET  /register');
console.log('   GET  /guru');
console.log('   GET  /siswa');
console.log('   POST /api/register');
console.log('   POST /api/login');
console.log('   GET  /api/me');
console.log('   GET  /api/debug-users');
console.log('   GET  /api/tasks');
console.log('   POST /api/tasks');
console.log('   GET  /api/tasks/:id');
console.log('   POST /api/submissions');
console.log('   GET  /api/submissions/task/:taskId');
console.log('   PUT  /api/submissions/grade');
console.log('   GET  /api/my-submissions');
console.log('   GET  /health');