const express = require('express');
const session = require('express-session');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session (sederhana untuk login)
app.use(session({
  secret: 'rahasia_bengkel_smk',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // set true jika pakai https
}));

// Setup folder upload & data
const uploadDir = './uploads';
const dataDir = './data';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Konfigurasi Multer (upload file)
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

// ========== FUNGSI BACA/TULIS JSON (Database Sederhana) ==========
const readJSON = (file) => {
  try {
    const data = fs.readFileSync(`./data/${file}.json`, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
};
const writeJSON = (file, data) => {
  fs.writeFileSync(`./data/${file}.json`, JSON.stringify(data, null, 2));
};

// Inisialisasi data default jika kosong
if (readJSON('users').length === 0) {
  writeJSON('users', [
    { id: 'g1', name: 'Pak Andi', role: 'guru', password: 'guru123' },
    { id: 's1', name: 'Budi', role: 'siswa', password: 'siswa123', kelas: 'TKR 1' },
    { id: 's2', name: 'Ani', role: 'siswa', password: 'siswa123', kelas: 'TKR 1' }
  ]);
}
if (readJSON('tasks').length === 0) {
  writeJSON('tasks', []);
}
if (readJSON('submissions').length === 0) {
  writeJSON('submissions', []);
}

// ========== MIDDLEWARE AUTH ==========
const isAuthenticated = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Silakan login' });
  next();
};

// ========== ROUTES / API ==========

// --- Login ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = readJSON('users');
  const user = users.find(u => u.id === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'ID atau password salah!' });
  
  req.session.user = user;
  res.json({ role: user.role, name: user.name });
});

// --- Logout ---
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// --- GET data user yang login ---
app.get('/api/me', isAuthenticated, (req, res) => {
  res.json(req.session.user);
});

// --- GURU: Buat Tugas Baru ---
app.post('/api/tasks', isAuthenticated, upload.single('file'), (req, res) => {
  if (req.session.user.role !== 'guru') {
    return res.status(403).json({ error: 'Hanya guru!' });
  }
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

// --- SISWA & GURU: Lihat semua tugas ---
app.get('/api/tasks', isAuthenticated, (req, res) => {
  const tasks = readJSON('tasks');
  const submissions = readJSON('submissions');
  
  if (req.session.user.role === 'siswa') {
    const userId = req.session.user.id;
    const tasksWithStatus = tasks.map(task => {
      const sub = submissions.find(s => s.taskId === task.id && s.studentId === userId);
      return {
        ...task,
        status: sub ? sub.status : 'Belum dikerjakan',
        score: sub ? sub.score : null
      };
    });
    return res.json(tasksWithStatus);
  }
  res.json(tasks);
});

// --- SISWA: Detail 1 Tugas ---
app.get('/api/tasks/:id', isAuthenticated, (req, res) => {
  const tasks = readJSON('tasks');
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Tugas tidak ditemukan' });
  res.json(task);
});

// --- SISWA: Kumpulkan Tugas (Upload Jawaban) ---
app.post('/api/submissions', isAuthenticated, upload.single('file'), (req, res) => {
  if (req.session.user.role !== 'siswa') {
    return res.status(403).json({ error: 'Hanya siswa!' });
  }
  const submissions = readJSON('submissions');
  const { taskId, textAnswer } = req.body;
  const studentId = req.session.user.id;

  const existingIndex = submissions.findIndex(s => s.taskId === taskId && s.studentId === studentId);
  
  const submissionData = {
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

  if (existingIndex > -1) {
    submissions[existingIndex] = { ...submissions[existingIndex], ...submissionData, status: 'pending' };
  } else {
    submissions.push(submissionData);
  }

  writeJSON('submissions', submissions);
  res.json({ success: true });
});

// --- GURU: Lihat semua jawaban siswa untuk suatu tugas ---
app.get('/api/submissions/task/:taskId', isAuthenticated, (req, res) => {
  if (req.session.user.role !== 'guru') {
    return res.status(403).json({ error: 'Hanya guru!' });
  }
  const submissions = readJSON('submissions');
  const filtered = submissions.filter(s => s.taskId === req.params.taskId);
  res.json(filtered);
});

// --- GURU: Beri nilai & feedback (ENDPOINT YANG SUDAH DIPERBAIKI) ---
app.put('/api/submissions/grade', isAuthenticated, (req, res) => {
  if (req.session.user.role !== 'guru') {
    return res.status(403).json({ error: 'Hanya guru!' });
  }
  
  const { taskId, studentId, score, feedback } = req.body;
  if (!taskId || !studentId || score === undefined) {
    return res.status(400).json({ error: 'Data tidak lengkap (taskId, studentId, score)' });
  }

  const submissions = readJSON('submissions');
  const index = submissions.findIndex(s => s.taskId === taskId && s.studentId === studentId);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Submission tidak ditemukan' });
  }

  submissions[index].score = parseInt(score);
  submissions[index].feedback = feedback || '';
  submissions[index].status = 'reviewed';
  
  writeJSON('submissions', submissions);
  res.json({ success: true, message: 'Nilai berhasil disimpan!' });
});

// --- SISWA: Lihat riwayat nilainya sendiri ---
app.get('/api/my-submissions', isAuthenticated, (req, res) => {
  if (req.session.user.role !== 'siswa') return res.status(403).json({ error: 'Akses ditolak' });
  const submissions = readJSON('submissions');
  const mine = submissions.filter(s => s.studentId === req.session.user.id);
  res.json(mine);
});

// ========== SERVE HTML ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/guru', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard-guru.html')));
app.get('/siswa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard-siswa.html')));

// Start server
app.listen(PORT, () => console.log(`🚗 Bengkel Digital running on port ${PORT}`));