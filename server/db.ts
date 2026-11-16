import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.MASRY_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY,
  rank INTEGER UNIQUE NOT NULL,
  level INTEGER NOT NULL,
  arabic TEXT NOT NULL,
  translit TEXT NOT NULL,
  english TEXT NOT NULL,
  pos TEXT NOT NULL,
  category TEXT NOT NULL,
  variants TEXT NOT NULL DEFAULT '[]',
  example_ar TEXT,
  example_en TEXT,
  notes TEXT,
  verified INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'seed'
);
CREATE INDEX IF NOT EXISTS vocab_level ON vocab(level);

CREATE TABLE IF NOT EXISTS lexicon (
  form TEXT NOT NULL,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  PRIMARY KEY (form, vocab_id)
);

CREATE TABLE IF NOT EXISTS sentences (
  id INTEGER PRIMARY KEY,
  arabic TEXT NOT NULL,
  translit TEXT,
  english TEXT NOT NULL,
  complexity INTEGER NOT NULL,           -- 1..7 listening complexity tier
  target_vocab_id INTEGER REFERENCES vocab(id),
  tokens TEXT NOT NULL DEFAULT '[]',     -- [{ar, tr, en}]
  chunks TEXT,                           -- [{ar, en}] phrase segmentation
  notes TEXT,
  verified INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sentence_vocab (
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  PRIMARY KEY (sentence_id, vocab_id)
);
CREATE INDEX IF NOT EXISTS sv_vocab ON sentence_vocab(vocab_id);

CREATE TABLE IF NOT EXISTS content_items (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  section TEXT NOT NULL,                 -- 'input' | 'reading' | 'scenario'
  kind TEXT NOT NULL,                    -- 'dialogue' | 'story' | 'chat' | 'video' | 'scenario'
  title TEXT NOT NULL,
  title_ar TEXT,
  difficulty INTEGER NOT NULL,           -- 1 beginner .. 5 advanced
  topic TEXT,
  body TEXT NOT NULL,                    -- JSON lines
  questions TEXT NOT NULL DEFAULT '[]',
  youtube_id TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- null = shared library
  verified INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS srs_cards (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,                   -- 'read' | 'listen'
  state TEXT NOT NULL DEFAULT 'learning',-- learning | review | relearning
  step INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL,
  interval_days REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  last_ms INTEGER,
  avg_ms REAL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'learn',  -- learn | placement | saved
  PRIMARY KEY (user_id, vocab_id, skill)
);
CREATE INDEX IF NOT EXISTS srs_due ON srs_cards(user_id, due);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,       -- exercise type (srs, context, input, dictation, segmentation, recognition, fastspeech, unexpected, reading, conversation)
  skill TEXT NOT NULL,      -- metric: vocab_read, vocab_listen, sentence, fast_speech, reading, dictation, speaking, spontaneous, input
  item_type TEXT,
  item_id INTEGER,
  score REAL NOT NULL,      -- 0..1
  response_ms INTEGER,
  speed REAL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id, skill, ts);

CREATE TABLE IF NOT EXISTS word_events (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  modality TEXT NOT NULL,   -- read | listen
  context TEXT NOT NULL,    -- isolated | sentence | reading | input
  correct INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS we_user ON word_events(user_id, vocab_id);

CREATE TABLE IF NOT EXISTS content_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  best_score REAL,
  last_score REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  listened_blind INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS saved_words (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  vocab_id INTEGER REFERENCES vocab(id),
  context TEXT,
  source TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, text)
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,  -- sentence | line
  item_id INTEGER NOT NULL,
  line_idx INTEGER NOT NULL DEFAULT -1,
  arabic TEXT NOT NULL,
  english TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, item_type, item_id, line_idx)
);
CREATE TABLE IF NOT EXISTS exposure (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,       -- audio | reading | conversation | passive
  seconds REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);
CREATE TABLE IF NOT EXISTS plan_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  block TEXT NOT NULL,
  seconds REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, block)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  mode TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  evaluations TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS native_audio (
  text_norm TEXT NOT NULL,
  speaker TEXT NOT NULL,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (text_norm, speaker)
);
CREATE TABLE IF NOT EXISTS content_flags (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  arabic TEXT,
  suggestion TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audio_cache (
  key TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

let _db: DatabaseSync | null = null;

export function openDb(file = process.env.MASRY_DB || path.join(DATA_DIR, 'masry.db')): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // lightweight migrations for databases created by earlier versions
  try { db.exec("ALTER TABLE srs_cards ADD COLUMN source TEXT NOT NULL DEFAULT 'learn'"); } catch { /* exists */ }
  return db;
}

export function db(): DatabaseSync {
  if (!_db) _db = openDb();
  return _db;
}

export function setDb(d: DatabaseSync) {
  _db = d;
}

/** Run fn in a transaction. */
export function tx<T>(d: DatabaseSync, fn: () => T): T {
  d.exec('BEGIN');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Date.now();
export const today = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function levelForRank(rank: number): number {
  if (rank <= 100) return 1;
  if (rank <= 300) return 2;
  if (rank <= 500) return 3;
  if (rank <= 1000) return 4;
  if (rank <= 1500) return 5;
  return 6;
}
