const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const MASTER_PASSWORD = "4505";

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "board.sqlite");
const isFirstRun = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    writer TEXT NOT NULL,
    password TEXT NOT NULL,
    game_name TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    files TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
`);
if (isFirstRun) {
  console.log("[gm-board] 새 데이터베이스 파일을 생성했습니다: " + DB_PATH);
} else {
  const row = db.prepare("SELECT COUNT(*) AS c FROM posts").get();
  console.log("[gm-board] 기존 데이터베이스를 불러왔습니다. 게시글 " + row.c + "건.");
}

app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d" }));
app.use(express.static(path.join(__dirname, "public")));

const storageEngine = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "") || "";
    const safe = crypto.randomBytes(8).toString("hex");
    cb(null, Date.now() + "-" + safe + ext);
  }
});
const upload = multer({
  storage: storageEngine,
  limits: { fileSize: 20 * 1024 * 1024 }
});

// 이미지(본문 삽입용)든 일반 첨부 파일이든 이 엔드포인트 하나로 업로드하고,
// 실제 서버 URL을 돌려받는다.
app.post("/api/upload", upload.single("file"), function (req, res) {
  if (!req.file) return res.status(400).json({ error: "no file" });
  res.json({
    url: "/uploads/" + req.file.filename,
    name: req.file.originalname,
    size: req.file.size
  });
});

function rowToPost(row) {
  return {
    id: row.id,
    type: row.type,
    writer: row.writer,
    gameName: row.game_name || "",
    title: row.title,
    content: row.content,
    files: JSON.parse(row.files || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at || null
  };
}

app.get("/api/posts", function (req, res) {
  const rows = db.prepare("SELECT * FROM posts ORDER BY id DESC").all();
  res.json(rows.map(rowToPost));
});

app.get("/api/posts/:id", function (req, res) {
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(rowToPost(row));
});

app.post("/api/posts", function (req, res) {
  const b = req.body || {};
  if (!b.type || !b.writer || !b.title || !b.content || !/^[0-9]{4}$/.test(b.password || "")) {
    return res.status(400).json({ error: "invalid payload" });
  }
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO posts (type, writer, password, game_name, title, content, files, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,NULL)`
  ).run(
    b.type, b.writer, b.password, b.gameName || "", b.title, b.content,
    JSON.stringify(b.files || []), now
  );
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(info.lastInsertRowid);
  res.json(rowToPost(row));
});

app.post("/api/posts/:id/verify", function (req, res) {
  const password = (req.body && req.body.password) || "";
  if (password === MASTER_PASSWORD) return res.json({ ok: true });
  const row = db.prepare("SELECT password FROM posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ ok: false });
  res.json({ ok: row.password === password });
});

app.put("/api/posts/:id", function (req, res) {
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  const password = b.password || "";
  if (row.password !== password && password !== MASTER_PASSWORD) {
    return res.status(403).json({ error: "invalid password" });
  }
  if (!b.type || !b.writer || !b.title || !b.content) {
    return res.status(400).json({ error: "invalid payload" });
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE posts SET type=?, writer=?, game_name=?, title=?, content=?, files=?, updated_at=? WHERE id=?`
  ).run(
    b.type, b.writer, b.gameName || "", b.title, b.content,
    JSON.stringify(b.files || []), now, req.params.id
  );
  const updated = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  res.json(rowToPost(updated));
});

app.delete("/api/posts/:id", function (req, res) {
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const password = (req.body && req.body.password) || "";
  if (row.password !== password && password !== MASTER_PASSWORD) {
    return res.status(403).json({ error: "invalid password" });
  }
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, function () {
  console.log("GM 인사이트 게시판 서버가 " + PORT + "번 포트에서 실행 중입니다.");
});
