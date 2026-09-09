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
// 업로드 파일도 data 폴더 안의 하위 폴더에 저장한다 — 그러면 Volume을
// /app/data 딱 하나만 연결해도 게시글 DB와 첨부파일이 함께 보존된다.
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
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
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// 이미 배포되어 실제 게시글이 쌓여있는 기존 데이터베이스에도 안전하게 컬럼을
// 추가하기 위한 간단한 마이그레이션 (컬럼이 이미 있으면 조용히 건너뜀).
function ensureColumn(table, column, ddl) {
  const cols = db.prepare("PRAGMA table_info(" + table + ")").all();
  const exists = cols.some(function (c) { return c.name === column; });
  if (!exists) {
    db.exec("ALTER TABLE " + table + " ADD COLUMN " + ddl);
    console.log("[gm-board] 마이그레이션: " + table + "." + column + " 컬럼 추가");
  }
}
ensureColumn("posts", "pinned", "pinned INTEGER DEFAULT 0");
ensureColumn("posts", "views", "views INTEGER DEFAULT 0");
ensureColumn("posts", "likes", "likes INTEGER DEFAULT 0");
ensureColumn("comments", "nickname", "nickname TEXT DEFAULT 'GM'");
ensureColumn("comments", "parent_id", "parent_id INTEGER");

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
  const commentCountRow = db.prepare("SELECT COUNT(*) AS c FROM comments WHERE post_id = ?").get(row.id);
  return {
    id: row.id,
    type: row.type,
    writer: row.writer,
    gameName: row.game_name || "",
    title: row.title,
    content: row.content,
    files: JSON.parse(row.files || "[]"),
    pinned: !!row.pinned,
    views: row.views || 0,
    likes: row.likes || 0,
    commentCount: commentCountRow.c,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null
  };
}

app.get("/api/posts", function (req, res) {
  // 상단 고정 글이 먼저, 그 안에서는 최신순
  const rows = db.prepare("SELECT * FROM posts ORDER BY pinned DESC, id DESC").all();
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
    `INSERT INTO posts (type, writer, password, game_name, title, content, files, pinned, views, likes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,0,0,?,NULL)`
  ).run(
    b.type, b.writer, b.password, b.gameName || "", b.title, b.content,
    JSON.stringify(b.files || []), b.pinned ? 1 : 0, now
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
    `UPDATE posts SET type=?, writer=?, game_name=?, title=?, content=?, files=?, pinned=?, updated_at=? WHERE id=?`
  ).run(
    b.type, b.writer, b.gameName || "", b.title, b.content,
    JSON.stringify(b.files || []), b.pinned ? 1 : 0, now, req.params.id
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
  db.prepare("DELETE FROM comments WHERE post_id = ?").run(req.params.id);
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// 조회수 +1 (게시글 보기 화면에 들어갈 때 클라이언트가 한 번 호출)
app.post("/api/posts/:id/view", function (req, res) {
  const row = db.prepare("SELECT id FROM posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(req.params.id);
  const updated = db.prepare("SELECT views FROM posts WHERE id = ?").get(req.params.id);
  res.json({ views: updated.views });
});

// 추천 +1 (한 사람이 여러 번 누르는 것은 클라이언트에서 브라우저 저장소로 막는다)
app.post("/api/posts/:id/like", function (req, res) {
  const row = db.prepare("SELECT id FROM posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE posts SET likes = likes + 1 WHERE id = ?").run(req.params.id);
  const updated = db.prepare("SELECT likes FROM posts WHERE id = ?").get(req.params.id);
  res.json({ likes: updated.likes });
});

function rowToComment(row) {
  return {
    id: row.id,
    postId: row.post_id,
    content: row.content,
    nickname: row.nickname || "GM",
    parentId: row.parent_id || null,
    createdAt: row.created_at
  };
}

app.get("/api/posts/:id/comments", function (req, res) {
  const rows = db.prepare("SELECT * FROM comments WHERE post_id = ? ORDER BY id ASC").all(req.params.id);
  res.json(rows.map(rowToComment));
});

app.post("/api/posts/:id/comments", function (req, res) {
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  const content = (b.content || "").toString().trim();
  const nickname = ((b.nickname || "").toString().trim()) || "GM";
  let parentId = null;
  if (b.parentId) {
    const parent = db.prepare("SELECT id FROM comments WHERE id = ? AND post_id = ?").get(b.parentId, req.params.id);
    if (parent) parentId = parent.id;
  }
  if (!content || !/^[0-9]{4}$/.test(b.password || "")) {
    return res.status(400).json({ error: "invalid payload" });
  }
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO comments (post_id, content, password, nickname, parent_id, created_at) VALUES (?,?,?,?,?,?)`
  ).run(req.params.id, content, b.password, nickname, parentId, now);
  const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(info.lastInsertRowid);
  res.json(rowToComment(row));
});

app.delete("/api/comments/:id", function (req, res) {
  const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const password = (req.body && req.body.password) || "";
  if (row.password !== password && password !== MASTER_PASSWORD) {
    return res.status(403).json({ error: "invalid password" });
  }
  db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, function () {
  console.log("GM 인사이트 게시판 서버가 " + PORT + "번 포트에서 실행 중입니다.");
});

