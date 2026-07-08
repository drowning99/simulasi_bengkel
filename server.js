const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session (gunakan MemoryStore, untuk produksi ganti dengan Redis)
app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia_bengkel_smk',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // true jika pakai HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 1 hari
  }
}));

// ---------- Persiapan Folder ----------
const dirs = ['uploads', 'data'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// ---------- Fungsi Baca/Tulis JSON ----------
const readJSON = (file) => {
  try {
    return JSON.parse(fs.readFileSync(`./data/${file}.json`, 'utf8'));
  } catch {
    return [];
  }
};
const writeJSON = (file, data) => {
  fs.writeFileSync(`./data/${file}.json`, JSON.stringify(data, null, 2));
};

// ---------- Inisialisasi Data Default ----------
if (readJSON('users').length === 0) {
  writeJSON('users', [
    { id: 'g1', name: 'Pak Andi', role: 'guru', password: 'guru123', kelas: '-' },
    { id: 's1', name: 'Budi', role: 'siswa', password: 'siswa123', kelas: 'TKR 1' },
    { id: 's2', name: 'Ani', role: 'siswa', password: 'siswa123', kelas: 'TKR 1' }
  ]);
}
if (readJSON('tasks').length === 0) writeJSON('tasks', []);
if (readJSON('submissions').length === 0) writeJSON('submissions', []);

// ---------- Konfigurasi Multer ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// ---------- Middleware Auth ----------
const isAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Silakan login' });
  next();
};
const isGuru = (req, res, next) => {
  if (req.session.user?.role !== 'guru') return res.status(403).json({ error: 'Akses hanya untuk guru' });
  next();
};
const isSiswa = (req, res, next) => {
  if (req.session.user?.role !== 'siswa') return res.status(403).json({ error: 'Akses hanya untuk siswa' });
  next();
};

// ---------- ROUTES ----------

// --- Registrasi ---
app.post('/api/register', (req, res) => {
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
    password, // Untuk demo, sebaiknya hash di produksi
    role,
    kelas: role === 'siswa' ? (kelas || '-') : '-'
  };
  users.push(newUser);
  writeJSON('users', users);
  res.status(201).json({ success: true, message: 'Akun berhasil dibuat, silakan login' });
});

// --- Login ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = readJSON('users');
  const user = users.find(u => u.id === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Username atau password salah' });
  req.session.user = user;
  res.json({ role: user.role, name: user.name });
});

// --- Logout ---
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// --- Data user yang login ---
app.get('/api/me', isAuth, (req, res) => {
  res.json(req.session.user);
});

// --- GURU: Buat tugas ---
app.post('/api/tasks', isAuth, isGuru, upload.single('file'), (req, res) => {
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
  res.json({ success: true, task: newTask });
});

// --- Semua user: lihat tugas (dengan status untuk siswa) ---
app.get('/api/tasks', isAuth, (req, res) => {
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

// --- Detail tugas (untuk siswa saat akan mengerjakan) ---
app.get('/api/tasks/:id', isAuth, (req, res) => {
  const tasks = readJSON('tasks');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Tugas tidak ditemukan' });
  res.json(task);
});

// --- SISWA: Kumpulkan tugas ---
app.post('/api/submissions', isAuth, isSiswa, upload.single('file'), (req, res) => {
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
  res.json({ success: true });
});

// --- GURU: Lihat semua jawaban untuk suatu tugas ---
app.get('/api/submissions/task/:taskId', isAuth, isGuru, (req, res) => {
  const submissions = readJSON('submissions');
  const filtered = submissions.filter(s => s.taskId === req.params.taskId);
  res.json(filtered);
});

// --- GURU: Beri nilai ---
app.put('/api/submissions/grade', isAuth, isGuru, (req, res) => {
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
  res.json({ success: true, message: 'Nilai berhasil disimpan' });
});

// --- SISWA: Riwayat nilainya sendiri ---
app.get('/api/my-submissions', isAuth, isSiswa, (req, res) => {
  const submissions = readJSON('submissions');
  const mine = submissions.filter(s => s.studentId === req.session.user.id);
  res.json(mine);
});

// ---------- SERVE HTML (dengan redirect otomatis jika sudah login) ----------
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'guru' ? '/guru' : '/siswa');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'guru' ? '/guru' : '/siswa');
  }
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/guru', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'guru') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard-guru.html'));
});

app.get('/siswa', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'siswa') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard-siswa.html'));
});

// ---------- START SERVER ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚗 Bengkel Digital running on port ${PORT}`);
});