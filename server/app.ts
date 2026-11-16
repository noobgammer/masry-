import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, now, today, ROOT, tx } from './db.ts';
import { analyzeSentence, diffDictation, normalize, tokenize, type Analysis } from './arabic.ts';
import { gloss, lexicon, vocabIdsIn } from './lexicon.ts';
import { knownCard, newCard, ratingScore, schedule, type Card, type Rating, type Skill } from './srs.ts';
import * as A from './analytics.ts';
import * as AI from './ai.ts';
import { loadNames } from './seed.ts';
import { VOICES, azureAudio, azureEnabled, nativeFor, saveNative } from './tts.ts';

type Row = Record<string, any>;
type Req = Request & { uid: number; user: Row };

const DEFAULT_SETTINGS = { showTranslit: true, showEnglish: true, newPerDay: 15, listenNewPerDay: 25, defaultSpeed: 0.9, voice: 'mixed', name: '' };

// ---------------------------------------------------------------- helpers
const all = (sql: string, ...p: any[]) => db().prepare(sql).all(...p) as Row[];
const get = (sql: string, ...p: any[]) => db().prepare(sql).get(...p) as Row | undefined;
const run = (sql: string, ...p: any[]) => db().prepare(sql).run(...p);
const J = <T = any>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function hashPw(pw: string, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPw(pw: string, stored: string) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function recordAttempt(uid: number, a: { kind: string; skill: string; item_type?: string; item_id?: number; score: number; response_ms?: number | null; speed?: number | null; meta?: unknown }) {
  run('INSERT INTO attempts (user_id, ts, kind, skill, item_type, item_id, score, response_ms, speed, meta) VALUES (?,?,?,?,?,?,?,?,?,?)',
    uid, now(), a.kind, a.skill, a.item_type ?? null, a.item_id ?? null, clamp01(a.score), a.response_ms ?? null, a.speed ?? null, a.meta ? JSON.stringify(a.meta) : null);
}
function wordEvent(uid: number, vocabId: number, modality: 'read' | 'listen', context: string, correct: boolean) {
  run('INSERT INTO word_events (user_id, vocab_id, ts, modality, context, correct) VALUES (?,?,?,?,?,?)', uid, vocabId, now(), modality, context, correct ? 1 : 0);
}

function knownIds(uid: number): Set<number> {
  return new Set(all('SELECT DISTINCT vocab_id FROM srs_cards WHERE user_id=? AND (reps>0 OR state=\'review\')', uid).map((r) => r.vocab_id));
}

function vocabOut(v: Row) {
  return { id: v.id, rank: v.rank, level: v.level, arabic: v.arabic, translit: v.translit, english: v.english, pos: v.pos, category: v.category,
    variants: J(v.variants, []), example_ar: v.example_ar, example_en: v.example_en, notes: v.notes, verified: !!v.verified };
}

function tokensOut(an: Analysis[]) {
  return an.map((a) => ({
    surface: a.surface, kind: a.kind,
    lemma: a.entry ? { id: a.entry.id, arabic: a.entry.arabic, translit: a.entry.translit, english: a.entry.english, pos: a.entry.pos } : null,
    parts: a.parts.map((p) => ({ text: p.text, gloss: p.gloss, role: p.role })),
    alts: a.alts?.map((e) => ({ id: e.id, arabic: e.arabic, english: e.english })),
    mwe: a.mwe ? { start: a.mwe.start, end: a.mwe.end, id: a.mwe.entry.id, arabic: a.mwe.entry.arabic, english: a.mwe.entry.english, translit: a.mwe.entry.translit } : undefined,
  }));
}

function sentenceOut(s: Row) {
  return { id: s.id, arabic: s.arabic, translit: s.translit, english: s.english, tier: s.complexity, target_vocab_id: s.target_vocab_id,
    chunks: J(s.chunks, null), verified: !!s.verified, tokens: tokensOut(gloss(s.arabic)) };
}

const glossCache = new Map<string, Analysis[]>();
function cachedGloss(t: string) {
  let g = glossCache.get(t);
  if (!g) { g = gloss(t); glossCache.set(t, g); }
  return g;
}

function coverage(lines: { ar: string }[], known: Set<number>) {
  let total = 0, k = 0;
  for (const l of lines) for (const a of cachedGloss(l.ar)) {
    if (a.kind === 'exact' && !a.entry) continue; // names, numbers, laughter
    total++;
    const id = a.mwe?.entry.id ?? a.entry?.id;
    if (id != null && known.has(id)) k++;
  }
  return total ? Math.round((100 * k) / total) : 0;
}

// ---------------------------------------------------------------- app
export function createApp() {
  loadNames();
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const cookie = (req: Request, name: string) => {
    const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
  };
  const startSession = (res: Response, uid: number) => {
    const token = crypto.randomBytes(24).toString('hex');
    run('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)', token, uid, now());
    res.setHeader('Set-Cookie', `masry_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
  };

  // --- auth (public)
  app.post('/api/auth/register', (req, res) => {
    const { username, password, name } = req.body || {};
    if (!username || !password || String(password).length < 4) return res.status(400).json({ error: 'Username and a password of 4+ characters are required.' });
    if (get('SELECT id FROM users WHERE username=?', String(username).toLowerCase())) return res.status(409).json({ error: 'That username is taken.' });
    const r = run('INSERT INTO users (username, pw_hash, settings, created_at) VALUES (?,?,?,?)', String(username).toLowerCase(), hashPw(String(password)),
      JSON.stringify({ ...DEFAULT_SETTINGS, name: name || username }), now());
    startSession(res, Number(r.lastInsertRowid));
    res.json({ ok: true });
  });
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const u = get('SELECT * FROM users WHERE username=?', String(username || '').toLowerCase());
    if (!u || !checkPw(String(password || ''), u.pw_hash)) return res.status(401).json({ error: 'Wrong username or password.' });
    startSession(res, u.id);
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    const t = cookie(req, 'masry_session');
    if (t) run('DELETE FROM sessions WHERE token=?', t);
    res.setHeader('Set-Cookie', 'masry_session=; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // audio is public-cacheable (no user data) so <audio src> works without auth edge cases
  app.get('/api/audio/status', (_req, res) => {
    res.json({ azure: azureEnabled(), ai: AI.aiEnabled(), voices: Object.entries(VOICES).map(([k, v]) => ({ key: k, label: v.label, gender: v.gender })),
      native: (get('SELECT COUNT(*) n FROM native_audio') as Row).n });
  });
  app.get('/api/audio', async (req, res) => {
    const text = String(req.query.text || '').slice(0, 1000);
    const voice = String(req.query.voice || 'f');
    const rate = Number(req.query.rate || 1);
    if (!text) return res.status(400).end();
    const native = req.query.native !== '0' ? nativeFor(text) : null;
    if (native) {
      res.setHeader('X-Audio-Source', `native:${native.speaker}`);
      res.setHeader('X-Rendered-Rate', '1');
      res.setHeader('Content-Type', native.mime);
      return res.sendFile(native.file);
    }
    if (!azureEnabled()) return res.status(204).setHeader('X-Audio-Fallback', 'browser').end();
    try {
      const f = await azureAudio(text, VOICES[voice] ? voice : 'f', rate);
      res.setHeader('X-Audio-Source', 'azure');
      res.setHeader('X-Rendered-Rate', String(rate <= 0.85 ? 0.75 : rate >= 1.2 ? 1.25 : 1));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.sendFile(f);
    } catch (e: any) {
      console.error(e.message);
      res.status(502).json({ fallback: 'browser', error: e.message });
    }
  });

  // --- auth gate
  app.use('/api', (req, res, next) => {
    const t = cookie(req, 'masry_session');
    const s = t ? get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', t) : undefined;
    if (!s) return res.status(401).json({ error: 'Not logged in' });
    (req as Req).uid = s.id;
    (req as Req).user = s;
    next();
  });
  const h = (fn: (req: Req, res: Response) => any) => async (req: Request, res: Response, next: NextFunction) => {
    try { await fn(req as Req, res); } catch (e: any) {
      if (e instanceof AI.AIUnavailable) return res.status(503).json({ error: 'AI features need ANTHROPIC_API_KEY on the server.', code: 'ai_unavailable' });
      console.error(e);
      res.status(500).json({ error: e.message || 'Server error' });
    }
  };
  const settings = (req: Req) => ({ ...DEFAULT_SETTINGS, ...J(req.user.settings, {}) });

  app.get('/api/me', h((req, res) => res.json({ id: req.uid, username: req.user.username, settings: settings(req) })));
  app.put('/api/settings', h((req, res) => {
    const s = { ...settings(req), ...req.body };
    run('UPDATE users SET settings=? WHERE id=?', JSON.stringify(s), req.uid);
    res.json(s);
  }));

  // ------------------------------------------------------------ gloss
  app.post('/api/gloss', h((req, res) => res.json(tokensOut(gloss(String(req.body.text || '').slice(0, 2000))))));

  // ------------------------------------------------------------ vocabulary
  app.get('/api/vocab', h((req, res) => {
    const where: string[] = [], p: any[] = [req.uid, req.uid];
    if (req.query.level) { where.push('v.level=?'); p.push(Number(req.query.level)); }
    if (req.query.category) { where.push('v.category=?'); p.push(String(req.query.category)); }
    if (req.query.q) { where.push('(v.arabic LIKE ? OR v.english LIKE ? OR v.translit LIKE ?)'); const q = `%${req.query.q}%`; p.push(q, q, q); }
    const rows = all(`SELECT v.*, r.state rstate, r.interval_days rivl, r.lapses rlapses, r.avg_ms rms, l.state lstate, l.interval_days livl, l.lapses llapses
      FROM vocab v LEFT JOIN srs_cards r ON r.vocab_id=v.id AND r.user_id=? AND r.skill='read'
      LEFT JOIN srs_cards l ON l.vocab_id=v.id AND l.user_id=? AND l.skill='listen'
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.rank LIMIT 2500`, ...p);
    res.json(rows.map((v) => ({ ...vocabOut(v),
      read: v.rstate ? { state: v.rstate, interval: v.rivl, lapses: v.rlapses, avg_ms: v.rms } : null,
      listen: v.lstate ? { state: v.lstate, interval: v.livl, lapses: v.llapses } : null })));
  }));
  app.get('/api/vocab/levels', h((req, res) => {
    const rows = all(`SELECT v.level, COUNT(*) total, SUM(CASE WHEN c.vocab_id IS NOT NULL THEN 1 ELSE 0 END) started,
        SUM(CASE WHEN c.state='review' THEN 1 ELSE 0 END) learned
      FROM vocab v LEFT JOIN srs_cards c ON c.vocab_id=v.id AND c.user_id=? AND c.skill='read' GROUP BY v.level ORDER BY v.level`, req.uid);
    res.json(rows);
  }));
  app.get('/api/vocab/:id', h((req, res) => {
    const v = get('SELECT * FROM vocab WHERE id=?', Number(req.params.id));
    if (!v) return res.status(404).json({ error: 'Not found' });
    const cards = all('SELECT * FROM srs_cards WHERE user_id=? AND vocab_id=?', req.uid, v.id);
    const ladder = all('SELECT * FROM sentences WHERE target_vocab_id=? ORDER BY complexity', v.id);
    const more = all(`SELECT s.* FROM sentences s JOIN sentence_vocab sv ON sv.sentence_id=s.id WHERE sv.vocab_id=? AND (s.target_vocab_id IS NULL OR s.target_vocab_id<>?)
      ORDER BY s.complexity LIMIT 12`, v.id, v.id);
    const lines: Row[] = [];
    for (const c of all("SELECT id, title, section, body FROM content_items WHERE section IN ('input','reading') AND (owner_id IS NULL OR owner_id=?)", req.uid)) {
      J<any>(c.body, { lines: [] }).lines.forEach((l: Row, i: number) => {
        if (lines.length < 12 && vocabIdsIn(l.ar).includes(v.id)) lines.push({ item_id: c.id, title: c.title, section: c.section, line: i, ar: l.ar, en: l.en });
      });
    }
    const ev = all('SELECT modality, context, SUM(correct) ok, COUNT(*) n FROM word_events WHERE user_id=? AND vocab_id=? GROUP BY modality, context', req.uid, v.id);
    res.json({ ...vocabOut(v), cards, ladder: ladder.map(sentenceOut), sentences: more.map(sentenceOut), lines, evidence: ev });
  }));

  // ------------------------------------------------------------ SRS
  const cardRow = (uid: number, vid: number, skill: Skill) => get('SELECT * FROM srs_cards WHERE user_id=? AND vocab_id=? AND skill=?', uid, vid, skill);
  const saveCard = (uid: number, vid: number, skill: Skill, c: Card, source = 'learn') => {
    run(`INSERT INTO srs_cards (user_id, vocab_id, skill, state, step, due, interval_days, ease, reps, lapses, last_review, last_ms, avg_ms, created_at, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id, vocab_id, skill) DO UPDATE SET state=excluded.state, step=excluded.step, due=excluded.due,
      interval_days=excluded.interval_days, ease=excluded.ease, reps=excluded.reps, lapses=excluded.lapses, last_review=excluded.last_review,
      last_ms=excluded.last_ms, avg_ms=excluded.avg_ms`,
      uid, vid, skill, c.state, c.step, c.due, c.interval_days, c.ease, c.reps, c.lapses, c.last_review, c.last_ms, c.avg_ms, now(), source);
  };
  const introducedToday = (uid: number) => (get(`SELECT COUNT(*) n FROM srs_cards WHERE user_id=? AND skill='read' AND source='learn' AND created_at>=?`, uid, new Date(today() + 'T00:00:00').getTime()) as Row).n as number;

  app.get('/api/srs/stats', h((req, res) => {
    const s = settings(req);
    const due = all(`SELECT skill, COUNT(*) n FROM srs_cards WHERE user_id=? AND due<=? GROUP BY skill`, req.uid, now());
    const newToday = introducedToday(req.uid);
    const nextNew = get(`SELECT v.* FROM vocab v WHERE NOT EXISTS (SELECT 1 FROM srs_cards c WHERE c.user_id=? AND c.vocab_id=v.id) ORDER BY v.rank LIMIT 1`, req.uid);
    res.json({ due: Object.fromEntries(due.map((r) => [r.skill, r.n])), newToday, newPerDay: s.newPerDay, newLeft: Math.max(0, s.newPerDay - newToday), nextRank: nextNew?.rank ?? null });
  }));

  app.get('/api/srs/new', h((req, res) => {
    const s = settings(req);
    const level = req.query.level ? Number(req.query.level) : null;
    const left = req.query.extra ? 10 : Math.max(0, s.newPerDay - introducedToday(req.uid));
    const rows = all(`SELECT v.* FROM vocab v WHERE NOT EXISTS (SELECT 1 FROM srs_cards c WHERE c.user_id=? AND c.vocab_id=v.id)
      ${level ? 'AND v.level=?' : ''} ORDER BY v.rank LIMIT ?`, ...(level ? [req.uid, level, left] : [req.uid, left]));
    res.json(rows.map((v) => {
      const ladder = all('SELECT * FROM sentences WHERE target_vocab_id=? ORDER BY complexity LIMIT 3', v.id);
      return { ...vocabOut(v), ladder: ladder.map((x) => ({ id: x.id, arabic: x.arabic, english: x.english, tier: x.complexity })) };
    }));
  }));

  app.post('/api/srs/introduce', h((req, res) => {
    const vid = Number(req.body.vocab_id);
    const t = now();
    tx(db(), () => {
      if (!cardRow(req.uid, vid, 'read')) saveCard(req.uid, vid, 'read', newCard(t));
      // the listening card starts slightly later so the learner first meets the sound in the learn step
      if (!cardRow(req.uid, vid, 'listen')) saveCard(req.uid, vid, 'listen', { ...newCard(t), due: t + 5 * 60_000 });
    });
    res.json({ ok: true });
  }));

  // placement / fast-track: words the learner already knows
  app.get('/api/srs/placement', h((req, res) => {
    const level = Number(req.query.level || 1);
    const rows = all(`SELECT v.* FROM vocab v WHERE v.level=? AND NOT EXISTS (SELECT 1 FROM srs_cards c WHERE c.user_id=? AND c.vocab_id=v.id) ORDER BY v.rank LIMIT 60`, level, req.uid);
    res.json(rows.map(vocabOut));
  }));
  app.post('/api/srs/placement', h((req, res) => {
    const known: number[] = req.body.known || [];
    const t = now();
    tx(db(), () => {
      known.forEach((vid, i) => {
        if (!cardRow(req.uid, vid, 'read')) saveCard(req.uid, vid, 'read', knownCard(t, 6 + (i % 8)), 'placement');
        // known by sight ≠ known by ear: listening cards are tested soon, staggered ~30/day
        if (!cardRow(req.uid, vid, 'listen')) saveCard(req.uid, vid, 'listen', { ...knownCard(t, 1), due: t + Math.floor(i / 30) * 86_400_000 }, 'placement');
      });
    });
    res.json({ ok: true, added: known.length });
  }));

  app.get('/api/srs/queue', h((req, res) => {
    const mode = String(req.query.mode || 'all');
    const skillFilter = mode === 'listen' ? "AND c.skill='listen'" : mode === 'read' ? "AND c.skill='read'" : '';
    const s = settings(req);
    // cap listening learning-cards so a big placement doesn't flood the queue
    const rows = all(`SELECT c.*, v.* , c.state cstate FROM srs_cards c JOIN vocab v ON v.id=c.vocab_id
      WHERE c.user_id=? AND c.due<=? ${skillFilter} ORDER BY c.due LIMIT 200`, req.uid, now() + 60_000);
    let listenNew = 0;
    const items = rows.filter((r) => !(r.skill === 'listen' && r.reps === 0 && ++listenNew > s.listenNewPerDay)).slice(0, 80);
    const pool = all('SELECT id, english FROM vocab ORDER BY RANDOM() LIMIT 300');
    res.json(shuffle(items).map((r) => {
      const opts = shuffle([r.english, ...shuffle(pool.filter((p) => p.id !== r.vocab_id && p.english !== r.english)).slice(0, 3).map((p) => p.english)]);
      return { vocab: vocabOut({ ...r, id: r.vocab_id }), skill: r.skill, state: r.cstate, lapses: r.lapses, interval: r.interval_days, options: opts };
    }));
  }));

  app.post('/api/srs/answer', h((req, res) => {
    const { vocab_id, skill, rating, ms } = req.body as { vocab_id: number; skill: Skill; rating: Rating; ms?: number };
    const row = cardRow(req.uid, vocab_id, skill);
    const card: Card = row ? (row as unknown as Card) : newCard(now());
    const next = schedule(card, rating, now(), ms);
    saveCard(req.uid, vocab_id, skill, next);
    recordAttempt(req.uid, { kind: 'srs', skill: skill === 'read' ? 'vocab_read' : 'vocab_listen', item_type: 'vocab', item_id: vocab_id, score: ratingScore(rating), response_ms: ms });
    wordEvent(req.uid, vocab_id, skill === 'read' ? 'read' : 'listen', 'isolated', rating >= 3);
    res.json({ due: next.due, interval: next.interval_days, state: next.state });
  }));

  // ------------------------------------------------------------ contextual learning
  const tierStats = (uid: number) => {
    const rows = A.tierAccuracy(db(), uid);
    const m = new Map(rows.map((r) => [r.tier, r]));
    const tiers = [];
    let unlocked = 3;
    for (let t = 1; t <= 7; t++) {
      const r = m.get(t);
      if (t > 3 && t <= 7) {
        const prev = m.get(t - 1);
        if (prev && prev.n >= 6 && prev.acc >= 0.75 && unlocked === t - 1) unlocked = t;
      }
      tiers.push({ tier: t, accuracy: r ? Math.round(r.acc * 100) : null, n: r?.n || 0 });
    }
    return { tiers, unlocked };
  };
  app.get('/api/context/levels', h((req, res) => res.json(tierStats(req.uid))));

  app.get('/api/context/session', h((req, res) => {
    const known = knownIds(req.uid);
    const { unlocked } = tierStats(req.uid);
    const tier = req.query.tier ? Number(req.query.tier) : null;
    const focus = String(req.query.focus || '');
    let focusIds: Set<number> | null = null;
    if (focus === 'forgotten') focusIds = new Set(A.wordBuckets(db(), req.uid).forgotten.map((w) => w.id));
    if (focus === 'isolated') focusIds = new Set(A.wordBuckets(db(), req.uid).isolatedOnly.map((w) => w.id));
    if (req.query.word) focusIds = new Set([Number(req.query.word)]);
    const seen = new Map(all(`SELECT item_id, AVG(score) s, COUNT(*) n, MAX(ts) t FROM attempts WHERE user_id=? AND skill='sentence' AND item_type='sentence' GROUP BY item_id`, req.uid).map((r) => [r.item_id, r]));
    const sents = all('SELECT * FROM sentences');
    const links = all('SELECT sentence_id, vocab_id FROM sentence_vocab');
    const bySent = new Map<number, number[]>();
    for (const l of links) { const a = bySent.get(l.sentence_id) || []; a.push(l.vocab_id); bySent.set(l.sentence_id, a); }
    const scored = sents.filter((s) => (tier ? s.complexity === tier : s.complexity <= unlocked)).map((s) => {
      const ids = bySent.get(s.id) || [];
      const knownShare = ids.length ? ids.filter((i) => known.has(i)).length / ids.length : 0;
      const st = seen.get(s.id);
      let score = knownShare * 3 + (s.target_vocab_id && known.has(s.target_vocab_id) ? 1.5 : 0) + Math.random();
      if (focusIds) score += ids.some((i) => focusIds!.has(i)) ? 10 : -10;
      if (st) score -= st.s >= 0.99 ? 3 : 1; // prefer unseen / previously-missed
      if (!tier) score += s.complexity === unlocked ? 1 : 0;
      return { s, score };
    }).sort((a, b) => b.score - a.score).slice(0, Number(req.query.n || 10));
    const all_en = sents.map((s) => ({ id: s.id, en: s.english, tier: s.complexity }));
    const vocabPool = all('SELECT id, arabic, english FROM vocab WHERE level<=3 ORDER BY RANDOM() LIMIT 200');
    res.json(scored.map(({ s }) => {
      const out = sentenceOut(s);
      const near = shuffle(all_en.filter((x) => x.id !== s.id && Math.abs(x.tier - s.complexity) <= 1)).slice(0, 3).map((x) => x.en);
      const inSent = [...new Map(out.tokens.filter((t) => t.lemma).map((t) => [t.lemma!.id, t.lemma!])).values()];
      const distractors = shuffle(vocabPool.filter((v) => !inSent.some((w) => w.id === v.id))).slice(0, Math.max(3, Math.ceil(inSent.length * 0.7)));
      return { ...out, options: shuffle([s.english, ...near]),
        chips: shuffle([...inSent.map((w) => ({ id: w.id, arabic: w.arabic, english: w.english, inSentence: true })), ...distractors.map((v) => ({ id: v.id, arabic: v.arabic, english: v.english, inSentence: false }))]) };
    }));
  }));

  app.post('/api/context/answer', h((req, res) => {
    const { sentence_id, correct, heard = [], ms, speed, plays, revealedBeforeAnswer } = req.body;
    const s = get('SELECT * FROM sentences WHERE id=?', sentence_id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const ids = all('SELECT vocab_id FROM sentence_vocab WHERE sentence_id=?', s.id).map((r) => r.vocab_id);
    // word-chip recognition (precision-weighted) + meaning choice
    const heardSet = new Set<number>(heard);
    const hits = ids.filter((i) => heardSet.has(i)).length;
    const falsePos = [...heardSet].filter((i) => !ids.includes(i)).length;
    const recog = heard.length || ids.length ? clamp01((hits - falsePos * 0.5) / Math.max(1, ids.length)) : null;
    recordAttempt(req.uid, { kind: 'context', skill: 'sentence', item_type: 'sentence', item_id: s.id, score: correct ? 1 : 0, response_ms: ms, speed,
      meta: { tier: s.complexity, plays, recog, revealedBeforeAnswer: !!revealedBeforeAnswer } });
    if (heard.length) for (const i of ids) wordEvent(req.uid, i, 'listen', 'sentence', heardSet.has(i));
    else for (const i of ids) wordEvent(req.uid, i, 'listen', 'sentence', !!correct);
    res.json({ ok: true, recog, missed: ids.filter((i) => !heardSet.has(i)), falsePositives: [...heardSet].filter((i) => !ids.includes(i)) });
  }));

  // ------------------------------------------------------------ comprehensible input + reading (shared)
  const itemVisible = (uid: number) => '(owner_id IS NULL OR owner_id=' + Number(uid) + ')';
  const listItems = (req: Req, section: string) => {
    const known = knownIds(req.uid);
    const prog = new Map(all('SELECT * FROM content_progress WHERE user_id=?', req.uid).map((r) => [r.item_id, r]));
    const items = all(`SELECT * FROM content_items WHERE section=? AND ${itemVisible(req.uid)} ORDER BY difficulty, id`, section);
    // adaptive target difficulty from recent comprehension
    const skill = section === 'input' ? 'input' : 'reading';
    const recent = all(`SELECT a.score, c.difficulty FROM attempts a JOIN content_items c ON c.id=a.item_id WHERE a.user_id=? AND a.skill=? ORDER BY a.ts DESC LIMIT 5`, req.uid, skill);
    let target = 1;
    if (recent.length) {
      const avg = recent.reduce((s, r) => s + r.score, 0) / recent.length;
      const lvl = Math.round(recent.reduce((s, r) => s + r.difficulty, 0) / recent.length);
      target = avg >= 0.85 ? lvl + 1 : avg < 0.5 ? lvl - 1 : lvl;
    }
    target = Math.max(1, Math.min(5, target));
    const out = items.map((c) => {
      const body = J<any>(c.body, { lines: [] });
      const p = prog.get(c.id);
      const cov = coverage(body.lines, known);
      return { id: c.id, slug: c.slug, title: c.title, title_ar: c.title_ar, difficulty: c.difficulty, topic: c.topic, kind: c.kind, youtube_id: c.youtube_id,
        lines: body.lines.length, coverage: cov, own: !!c.owner_id, verified: !!c.verified,
        progress: p ? { best: p.best_score, last: p.last_score, attempts: p.attempts, completed: !!p.completed_at } : null };
    });
    const candidates = out.filter((i) => !i.progress?.completed);
    const rec = candidates.sort((a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target) || Math.abs(92 - a.coverage) - Math.abs(92 - b.coverage))[0];
    return { items: out, targetDifficulty: target, recommended: rec?.id ?? null };
  };
  const itemDetail = (req: Req, id: number) => {
    const c = get(`SELECT * FROM content_items WHERE id=? AND ${itemVisible(req.uid)}`, id);
    if (!c) return null;
    const body = J<any>(c.body, { lines: [] });
    const qs = J<any[]>(c.questions, []).map((q, i) => ({ i, q: q.q, q_en: q.q_en, options: shuffle(q.options.map((o: string, k: number) => ({ k, text: o }))) }));
    const bms = new Set(all("SELECT line_idx FROM bookmarks WHERE user_id=? AND item_type='line' AND item_id=?", req.uid, id).map((r) => r.line_idx));
    return { id: c.id, slug: c.slug, title: c.title, title_ar: c.title_ar, difficulty: c.difficulty, topic: c.topic, kind: c.kind, section: c.section,
      youtube_id: c.youtube_id, verified: !!c.verified, me: body.me,
      lines: body.lines.map((l: Row, i: number) => ({ ...l, i, bookmarked: bms.has(i), tokens: tokensOut(cachedGloss(l.ar)) })), questions: qs };
  };
  const gradeItem = (req: Req, id: number, skill: string) => {
    const c = get(`SELECT * FROM content_items WHERE id=? AND ${itemVisible(req.uid)}`, id);
    if (!c) return null;
    const qs = J<any[]>(c.questions, []);
    const answers: number[] = req.body.answers || [];
    const results = qs.map((q, i) => ({ i, correct: answers[i] === q.answer, answer: q.answer, answerText: q.options[q.answer] }));
    const score = qs.length ? results.filter((r) => r.correct).length / qs.length : 1;
    recordAttempt(req.uid, { kind: skill, skill, item_type: 'content', item_id: id, score, response_ms: req.body.ms,
      meta: { revealedEnglish: !!req.body.revealedEnglish, revealedTranscript: !!req.body.revealedTranscript, listenedBlind: !!req.body.listenedBlind, difficulty: c.difficulty } });
    const p = get('SELECT * FROM content_progress WHERE user_id=? AND item_id=?', req.uid, id);
    run(`INSERT INTO content_progress (user_id, item_id, best_score, last_score, attempts, listened_blind, completed_at) VALUES (?,?,?,?,1,?,?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET best_score=MAX(COALESCE(best_score,0), excluded.best_score), last_score=excluded.last_score,
      attempts=attempts+1, listened_blind=MAX(listened_blind, excluded.listened_blind), completed_at=COALESCE(completed_at, excluded.completed_at)`,
      req.uid, id, score, score, req.body.listenedBlind ? 1 : 0, score >= 0.6 ? now() : null);
    // words in the item count as heard/read in context (weakly: success if overall score is good)
    const body = J<any>(c.body, { lines: [] });
    const ids = new Set<number>();
    for (const l of body.lines) for (const v of vocabIdsIn(l.ar)) ids.add(v);
    const known = knownIds(req.uid);
    for (const v of ids) if (known.has(v)) wordEvent(req.uid, v, skill === 'reading' ? 'read' : 'listen', skill === 'reading' ? 'reading' : 'input', score >= 0.67);
    const advice = score >= 0.9 ? 'up' : score < 0.5 ? 'down' : 'stay';
    return { score, results, advice, firstAttempt: !p };
  };

  app.get('/api/input', h((req, res) => res.json(listItems(req, 'input'))));
  app.get('/api/input/:id', h((req, res) => { const d = itemDetail(req, Number(req.params.id)); d ? res.json(d) : res.status(404).json({ error: 'Not found' }); }));
  app.post('/api/input/:id/answers', h((req, res) => { const r = gradeItem(req, Number(req.params.id), 'input'); r ? res.json(r) : res.status(404).json({ error: 'Not found' }); }));
  app.post('/api/input/import', h(async (req, res) => {
    const { title, text, youtube, difficulty = 5, translate = true } = req.body;
    if (!title || !text) return res.status(400).json({ error: 'Title and transcript are required.' });
    const ytId = youtube ? (String(youtube).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1] || (String(youtube).length === 11 ? youtube : null)) : null;
    const lines: Row[] = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 400).map((l) => {
      const m = l.match(/^\[?(?:(\d+):)?(\d{1,2}):(\d{2})\]?\s*(.+)$/);
      if (m) return { ar: m[4], en: '', start: (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) };
      const [ar, en] = l.split('|').map((s) => s.trim());
      return { ar, en: en || '' };
    }).map((l, i) => ({ speaker: 'S', gender: i % 2 ? 'f' : 'm', para: Math.floor(i / 6), ...l }));
    let questions: Row[] = [];
    let aiNote = '';
    if (translate && AI.aiEnabled()) {
      try {
        const need = lines.filter((l) => !l.en);
        if (need.length) { const tr = await AI.translateLines(need.map((l) => l.ar)); need.forEach((l, i) => (l.en = tr[i])); }
        questions = await AI.makeQuestions(lines.map((l) => l.ar));
      } catch (e: any) { aiNote = e.message; }
    }
    const r = run(`INSERT INTO content_items (slug, section, kind, title, title_ar, difficulty, topic, body, questions, youtube_id, owner_id, verified, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`, `import-${req.uid}-${Date.now()}`, 'input', ytId ? 'video' : 'story', title, '', Number(difficulty), 'imported',
      JSON.stringify({ lines }), JSON.stringify(questions), ytId, req.uid, now());
    res.json({ id: Number(r.lastInsertRowid), aiNote });
  }));
  app.delete('/api/input/:id', h((req, res) => { run('DELETE FROM content_items WHERE id=? AND owner_id=?', Number(req.params.id), req.uid); res.json({ ok: true }); }));

  app.get('/api/reading', h((req, res) => res.json(listItems(req, 'reading'))));
  app.get('/api/reading/:id', h((req, res) => { const d = itemDetail(req, Number(req.params.id)); d ? res.json(d) : res.status(404).json({ error: 'Not found' }); }));
  app.post('/api/reading/:id/answers', h((req, res) => { const r = gradeItem(req, Number(req.params.id), 'reading'); r ? res.json(r) : res.status(404).json({ error: 'Not found' }); }));
  // a click on a word while reading = evidence of struggle with that word
  app.post('/api/lookup', h((req, res) => {
    const { vocab_id, context } = req.body;
    if (vocab_id) wordEvent(req.uid, Number(vocab_id), context === 'reading' ? 'read' : 'listen', context || 'reading', false);
    res.json({ ok: true });
  }));
  app.get('/api/reading-struggles', h((req, res) => {
    res.json(all(`SELECT v.id, v.arabic, v.translit, v.english, COUNT(*) n FROM word_events w JOIN vocab v ON v.id=w.vocab_id
      WHERE w.user_id=? AND w.context='reading' AND w.correct=0 GROUP BY v.id ORDER BY n DESC LIMIT 40`, req.uid));
  }));

  // ------------------------------------------------------------ listening lab
  const pickSentence = (uid: number, opts: { minTier: number; maxTier: number; skill: string; needChunks?: boolean }) => {
    const known = knownIds(uid);
    const done = new Map(all(`SELECT item_id, MAX(score) s FROM attempts WHERE user_id=? AND skill=? AND item_type='sentence' GROUP BY item_id`, uid, opts.skill).map((r) => [r.item_id, r.s]));
    const rows = all(`SELECT * FROM sentences WHERE complexity BETWEEN ? AND ? ${opts.needChunks ? 'AND chunks IS NOT NULL' : ''}`, opts.minTier, opts.maxTier);
    const links = all('SELECT sentence_id, vocab_id FROM sentence_vocab');
    const by = new Map<number, number[]>();
    for (const l of links) { const a = by.get(l.sentence_id) || []; a.push(l.vocab_id); by.set(l.sentence_id, a); }
    const scored = rows.map((s) => {
      const ids = by.get(s.id) || [];
      const ks = ids.length ? ids.filter((i) => known.has(i)).length / ids.length : 0;
      const d = done.get(s.id);
      return { s, score: ks * 2 + Math.random() * 1.5 - (d != null ? (d >= 0.9 ? 2 : 0.5) : 0) };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.s;
  };
  const labTier = (uid: number, skill: string, base: [number, number]) => {
    const r = get(`SELECT AVG(score) a, COUNT(*) n FROM (SELECT score FROM attempts WHERE user_id=? AND skill=? ORDER BY ts DESC LIMIT 10)`, uid, skill);
    if (!r || r.n < 5) return base;
    if (r.a >= 0.85) return [Math.min(base[0] + 1, 6), Math.min(base[1] + 2, 7)] as [number, number];
    if (r.a < 0.5) return [2, 3] as [number, number];
    return base;
  };

  // audio text for blind-listening drills (the client plays it without displaying it)
  app.get('/api/sentences/:id/audio-text', h((req, res) => {
    const s = get('SELECT arabic FROM sentences WHERE id=?', Number(req.params.id));
    s ? res.json({ arabic: s.arabic }) : res.status(404).json({ error: 'not found' });
  }));
  app.get('/api/lab/dictation', h((req, res) => {
    const [a, b] = labTier(req.uid, 'dictation', [2, 4]);
    const s = req.query.id ? get('SELECT * FROM sentences WHERE id=?', Number(req.query.id)) : pickSentence(req.uid, { minTier: a, maxTier: b, skill: 'dictation' });
    res.json(s ? { id: s.id, tier: s.complexity, arabic_hidden: true, wordCount: tokenize(s.arabic).length } : null);
  }));
  app.post('/api/lab/dictation', h((req, res) => {
    const s = get('SELECT * FROM sentences WHERE id=?', Number(req.body.sentence_id));
    if (!s) return res.status(404).json({ error: 'not found' });
    const r = diffDictation(s.arabic, String(req.body.typed || ''), lexicon());
    recordAttempt(req.uid, { kind: 'dictation', skill: 'dictation', item_type: 'sentence', item_id: s.id, score: r.score, response_ms: req.body.ms, speed: req.body.speed,
      meta: { counts: r.counts, refLen: tokenize(s.arabic).length, plays: req.body.plays } });
    // words missed by ear
    const an = cachedGloss(s.arabic);
    let k = 0;
    for (const op of r.ops) {
      if (op.op === 'extra') continue;
      const a2 = an[k++];
      if (a2?.entry) wordEvent(req.uid, a2.entry.id, 'listen', 'sentence', op.op === 'match' || op.op === 'misspelled');
    }
    res.json({ ...r, sentence: sentenceOut(s) });
  }));

  app.get('/api/lab/segmentation', h((req, res) => {
    const s = req.query.id ? get('SELECT * FROM sentences WHERE id=?', Number(req.query.id)) : pickSentence(req.uid, { minTier: 4, maxTier: 7, skill: 'segmentation', needChunks: true });
    if (!s) return res.json(null);
    const out = sentenceOut(s);
    res.json({ id: s.id, tier: s.complexity, words: tokenize(s.arabic).map((t) => t.text), english: s.english, translit: s.translit, tokens: out.tokens, chunkCount: (J<any[]>(s.chunks, [])).length });
  }));
  app.post('/api/lab/segmentation', h((req, res) => {
    const s = get('SELECT * FROM sentences WHERE id=?', Number(req.body.sentence_id));
    if (!s) return res.status(404).json({ error: 'not found' });
    const chunks = J<{ ar: string; en: string }[]>(s.chunks, []);
    const truth: number[] = [];
    let c = 0;
    chunks.forEach((ch, i) => { if (i > 0) truth.push(c); c += tokenize(ch.ar).length; });
    const got: number[] = (req.body.boundaries || []).map(Number);
    const near = (b: number) => truth.some((t) => Math.abs(t - b) <= 0);
    const tp = got.filter(near).length;
    const precision = got.length ? tp / got.length : 0, recall = truth.length ? tp / truth.length : 1;
    const score = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    recordAttempt(req.uid, { kind: 'segmentation', skill: 'sentence', item_type: 'segmentation', item_id: s.id, score, meta: { tier: 5, truth, got } });
    res.json({ score, truth, chunks: chunks.map((ch) => ({ ...ch, tokens: tokensOut(cachedGloss(ch.ar)) })) });
  }));

  app.get('/api/lab/recognition', h((req, res) => {
    const known = knownIds(req.uid);
    const s = pickSentence(req.uid, { minTier: 3, maxTier: 6, skill: 'vocab_listen_ctx' });
    if (!s) return res.json(null);
    const ids = [...new Set(all('SELECT vocab_id FROM sentence_vocab WHERE sentence_id=?', s.id).map((r) => r.vocab_id))];
    const inSent = all(`SELECT id, arabic, english FROM vocab WHERE id IN (${ids.join(',') || 0})`);
    // distractors: known words that sound/look similar-ish (same first letter) else random known words
    const firsts = new Set(inSent.map((v) => normalize(v.arabic)[0]));
    const pool = all(`SELECT id, arabic, english FROM vocab WHERE level<=4 ORDER BY RANDOM() LIMIT 400`).filter((v) => !ids.includes(v.id));
    const similar = pool.filter((v) => firsts.has(normalize(v.arabic)[0]) && known.has(v.id));
    const distract = [...similar, ...pool.filter((v) => known.has(v.id)), ...pool].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i).slice(0, Math.max(4, inSent.length));
    res.json({ id: s.id, tier: s.complexity, candidates: shuffle([...inSent, ...distract]).map((v) => ({ id: v.id, arabic: v.arabic, english: v.english })) });
  }));
  app.post('/api/lab/recognition', h((req, res) => {
    const s = get('SELECT * FROM sentences WHERE id=?', Number(req.body.sentence_id));
    if (!s) return res.status(404).json({ error: 'not found' });
    const ids = new Set(all('SELECT vocab_id FROM sentence_vocab WHERE sentence_id=?', s.id).map((r) => r.vocab_id));
    const sel = new Set<number>((req.body.selected || []).map(Number));
    const cands: number[] = (req.body.candidates || []).map(Number);
    const tp = [...sel].filter((i) => ids.has(i)).length;
    const fp = [...sel].filter((i) => !ids.has(i)).length;
    const relevant = cands.filter((i) => ids.has(i)).length || ids.size;
    const score = clamp01((tp - fp * 0.5) / Math.max(1, relevant));
    recordAttempt(req.uid, { kind: 'recognition', skill: 'vocab_listen', item_type: 'sentence', item_id: s.id, score, meta: { tp, fp, relevant } });
    recordAttempt(req.uid, { kind: 'recognition', skill: 'vocab_listen_ctx', item_type: 'sentence', item_id: s.id, score });
    for (const i of cands) if (ids.has(i)) wordEvent(req.uid, i, 'listen', 'sentence', sel.has(i));
    res.json({ score, inSentence: [...ids], sentence: sentenceOut(s) });
  }));

  app.get('/api/lab/fast', h((req, res) => {
    // a sentence the learner already understood (correct context answer), else an easy one
    const understood = all(`SELECT DISTINCT item_id FROM attempts WHERE user_id=? AND skill='sentence' AND item_type='sentence' AND score>=1`, req.uid).map((r) => r.item_id);
    let s: Row | undefined;
    if (understood.length) s = get(`SELECT * FROM sentences WHERE id IN (${understood.join(',')}) ORDER BY RANDOM() LIMIT 1`);
    if (!s) s = get('SELECT * FROM sentences WHERE complexity BETWEEN 3 AND 5 ORDER BY RANDOM() LIMIT 1');
    res.json({ ...sentenceOut(s!), fromUnderstood: understood.length > 0, comfortable: A.comfortableSpeed(db(), req.uid) });
  }));
  app.post('/api/lab/fast', h((req, res) => {
    const { sentence_id, speed, understood, session } = req.body;
    recordAttempt(req.uid, { kind: 'fastspeech', skill: 'fast_speech', item_type: 'sentence', item_id: sentence_id, score: understood ? 1 : 0, speed: Number(speed), meta: { session } });
    res.json({ ok: true, comfortable: A.comfortableSpeed(db(), req.uid) });
  }));

  app.get('/api/lab/scenarios', h((_req, res) => res.json(all("SELECT id, slug, title, title_ar, topic FROM content_items WHERE section='scenario' ORDER BY id"))));
  app.get('/api/lab/scenarios/:slug', h((req, res) => {
    const c = get("SELECT * FROM content_items WHERE section='scenario' AND slug=?", req.params.slug);
    if (!c) return res.status(404).json({ error: 'not found' });
    const b = J<any>(c.body, { turns: [], curveballs: [] });
    const turns = b.turns.map((alts: Row[]) => alts[Math.floor(Math.random() * alts.length)]);
    // inject one curveball at a random position (not first) so the sequence can't be memorised
    if (b.curveballs.length) {
      const cb = b.curveballs[Math.floor(Math.random() * b.curveballs.length)];
      turns.splice(1 + Math.floor(Math.random() * turns.length), 0, { ...cb, curveball: true });
    }
    res.json({ title: c.title, title_ar: c.title_ar, topic: c.topic, turns });
  }));
  app.post('/api/lab/unexpected/ai', h(async (req, res) => {
    const r = await AI.unexpectedNext({ topic: String(req.body.topic || 'daily life'), history: req.body.history || [], mode: req.body.mode || 'natural' });
    if (r.evaluation.applicable) recordAttempt(req.uid, { kind: 'unexpected', skill: 'spontaneous', score: (r.evaluation.addressed ? 0.6 : 0) + 0.4 * (r.evaluation.understandable / 100), response_ms: req.body.ms, meta: { ai: true } });
    res.json(r);
  }));
  app.post('/api/lab/unexpected/result', h((req, res) => {
    const { understood, answered, ms } = req.body;
    // offline self-assessment: understood the question (60%) + gave a relevant reply (40%), penalise slow starts
    let score = (understood ? 0.6 : 0) + (answered ? 0.4 : 0);
    if (ms && ms > 15000) score *= 0.85;
    recordAttempt(req.uid, { kind: 'unexpected', skill: 'spontaneous', score, response_ms: ms, meta: { ai: false, curveball: !!req.body.curveball } });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ conversations (AI partner)
  app.get('/api/conversations', h((req, res) => res.json(all('SELECT id, topic, mode, created_at, updated_at, json_array_length(messages) n, summary IS NOT NULL ended FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 30', req.uid))));
  app.post('/api/conversations', h(async (req, res) => {
    const { topic = 'daily life', mode = 'natural' } = req.body;
    const r = await AI.conversationTurn({ topic, mode, history: [], learnerName: settings(req).name });
    const msgs = [{ role: 'assistant', content: r.reply, translit: r.reply_translit, en: r.reply_en, ts: now() }];
    const ins = run('INSERT INTO conversations (user_id, topic, mode, messages, evaluations, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', req.uid, topic, mode, JSON.stringify(msgs), '[]', now(), now());
    res.json({ id: Number(ins.lastInsertRowid), topic, mode, messages: msgs });
  }));
  app.get('/api/conversations/:id', h((req, res) => {
    const c = get('SELECT * FROM conversations WHERE id=? AND user_id=?', Number(req.params.id), req.uid);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json({ id: c.id, topic: c.topic, mode: c.mode, messages: J(c.messages, []), evaluations: J(c.evaluations, []), summary: J(c.summary, null) });
  }));
  app.post('/api/conversations/:id/message', h(async (req, res) => {
    const c = get('SELECT * FROM conversations WHERE id=? AND user_id=?', Number(req.params.id), req.uid);
    if (!c) return res.status(404).json({ error: 'not found' });
    const msgs = J<Row[]>(c.messages, []);
    const text = String(req.body.text || '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'Empty message' });
    msgs.push({ role: 'user', content: text, via: req.body.via || 'text', ms: req.body.ms ?? null, ts: now() });
    const history = msgs.slice(-30).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    if (history[0]?.role === 'assistant') history.unshift({ role: 'user', content: '(conversation start)' });
    const r = await AI.conversationTurn({ topic: c.topic, mode: c.mode, history, learnerName: settings(req).name });
    msgs.push({ role: 'assistant', content: r.reply, translit: r.reply_translit, en: r.reply_en, ts: now() });
    const evals = J<Row[]>(c.evaluations, []);
    const ev = { ...r.evaluation, turn: msgs.length - 2, said: text };
    evals.push(ev);
    run('UPDATE conversations SET messages=?, evaluations=?, updated_at=? WHERE id=?', JSON.stringify(msgs), JSON.stringify(evals), now(), c.id);
    if (r.evaluation.applicable) {
      recordAttempt(req.uid, { kind: 'conversation', skill: 'speaking', item_type: 'conversation', item_id: c.id,
        score: (0.6 * r.evaluation.understandable + 0.4 * r.evaluation.naturalness) / 100, response_ms: req.body.ms, meta: { via: req.body.via, mode: c.mode } });
      recordAttempt(req.uid, { kind: 'conversation', skill: 'spontaneous', item_type: 'conversation', item_id: c.id,
        score: (r.evaluation.answered_question ? 0.6 : 0.1) + 0.4 * (r.evaluation.understandable / 100), response_ms: req.body.ms, meta: { mode: c.mode } });
    }
    // corrections are NOT returned inline — only a count, so the conversation isn't interrupted
    res.json({ reply: msgs[msgs.length - 1], pendingCorrections: evals.filter((e) => e.corrections?.length).length });
  }));
  app.get('/api/conversations/:id/feedback', h((req, res) => {
    const c = get('SELECT * FROM conversations WHERE id=? AND user_id=?', Number(req.params.id), req.uid);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json(J<Row[]>(c.evaluations, []).filter((e) => e.applicable));
  }));
  app.post('/api/conversations/:id/end', h(async (req, res) => {
    const c = get('SELECT * FROM conversations WHERE id=? AND user_id=?', Number(req.params.id), req.uid);
    if (!c) return res.status(404).json({ error: 'not found' });
    const msgs = J<Row[]>(c.messages, []);
    if (msgs.filter((m) => m.role === 'user').length === 0) return res.json({ summary: null });
    const summary = await AI.conversationSummary(msgs as any, J(c.evaluations, []));
    run('UPDATE conversations SET summary=?, updated_at=? WHERE id=?', JSON.stringify(summary), now(), c.id);
    res.json({ summary });
  }));

  // ------------------------------------------------------------ saved words, bookmarks, flags
  app.get('/api/saved', h((req, res) => res.json(all(`SELECT s.*, v.translit, v.english FROM saved_words s LEFT JOIN vocab v ON v.id=s.vocab_id WHERE s.user_id=? ORDER BY s.created_at DESC`, req.uid))));
  app.post('/api/saved', h((req, res) => {
    const { text, vocab_id, context, source } = req.body;
    run('INSERT OR IGNORE INTO saved_words (user_id, text, vocab_id, context, source, created_at) VALUES (?,?,?,?,?,?)', req.uid, String(text), vocab_id ?? null, context ?? null, source ?? null, now());
    // saving a known lemma pulls it into the SRS if it isn't there yet
    if (vocab_id && !cardRow(req.uid, vocab_id, 'read')) { saveCard(req.uid, vocab_id, 'read', newCard(now()), 'saved'); saveCard(req.uid, vocab_id, 'listen', newCard(now()), 'saved'); }
    res.json({ ok: true });
  }));
  app.delete('/api/saved/:id', h((req, res) => { run('DELETE FROM saved_words WHERE id=? AND user_id=?', Number(req.params.id), req.uid); res.json({ ok: true }); }));
  app.get('/api/bookmarks', h((req, res) => res.json(all('SELECT * FROM bookmarks WHERE user_id=? ORDER BY created_at DESC', req.uid))));
  app.post('/api/bookmarks', h((req, res) => {
    const { item_type, item_id, line_idx = -1, arabic, english, remove } = req.body;
    if (remove) run('DELETE FROM bookmarks WHERE user_id=? AND item_type=? AND item_id=? AND line_idx=?', req.uid, item_type, item_id, line_idx);
    else run('INSERT OR IGNORE INTO bookmarks (user_id, item_type, item_id, line_idx, arabic, english, created_at) VALUES (?,?,?,?,?,?,?)', req.uid, item_type, item_id, line_idx, arabic, english ?? null, now());
    res.json({ ok: true });
  }));
  app.post('/api/flags', h((req, res) => {
    const { item_type, item_id, arabic, suggestion, comment } = req.body;
    run('INSERT INTO content_flags (user_id, item_type, item_id, arabic, suggestion, comment, created_at) VALUES (?,?,?,?,?,?,?)', req.uid, item_type, item_id, arabic, suggestion, comment, now());
    res.json({ ok: true });
  }));
  app.get('/api/flags', h((_req, res) => res.json(all("SELECT * FROM content_flags WHERE status='open' ORDER BY created_at DESC"))));

  // ------------------------------------------------------------ native speaker studio
  app.get('/api/studio/queue', h((req, res) => {
    const have = new Set(all('SELECT text_norm FROM native_audio').map((r) => r.text_norm));
    const items: Row[] = [];
    for (const s of all('SELECT id, arabic, english, complexity FROM sentences ORDER BY complexity, id')) items.push({ type: 'sentence', id: s.id, arabic: s.arabic, english: s.english, recorded: have.has(normalize(s.arabic)) });
    for (const c of all("SELECT id, title, body FROM content_items WHERE section='input' AND owner_id IS NULL ORDER BY difficulty, id"))
      J<any>(c.body, { lines: [] }).lines.forEach((l: Row, i: number) => items.push({ type: 'line', id: c.id, line: i, title: c.title, arabic: l.ar, english: l.en, recorded: have.has(normalize(l.ar)) }));
    const filter = String(req.query.filter || 'todo');
    res.json({ total: items.length, recorded: items.filter((i) => i.recorded).length, items: items.filter((i) => (filter === 'todo' ? !i.recorded : true)).slice(0, 200) });
  }));
  app.post('/api/audio/native', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '15mb' }), h((req, res) => {
    const text = String(req.query.text || '');
    const speaker = String(req.query.speaker || 'native').slice(0, 40);
    if (!text || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'text and audio body required' });
    saveNative(text, speaker, String(req.headers['content-type'] || 'audio/webm'), req.body);
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ exposure, plan, dashboard, progress
  app.post('/api/exposure', h((req, res) => {
    const secs = Math.max(0, Math.min(600, Number(req.body.seconds) || 0));
    const kind = ['audio', 'reading', 'conversation', 'passive'].includes(req.body.kind) ? req.body.kind : 'audio';
    if (secs) run('INSERT INTO exposure (user_id, day, kind, seconds) VALUES (?,?,?,?) ON CONFLICT(user_id, day, kind) DO UPDATE SET seconds=seconds+excluded.seconds', req.uid, today(), kind, secs);
    res.json({ ok: true });
  }));
  app.post('/api/plan/tick', h((req, res) => {
    const secs = Math.max(0, Math.min(120, Number(req.body.seconds) || 0));
    const block = String(req.body.block);
    if (secs && A.PLAN_BLOCKS.some((b) => b.key === block))
      run('INSERT INTO plan_progress (user_id, day, block, seconds) VALUES (?,?,?,?) ON CONFLICT(user_id, day, block) DO UPDATE SET seconds=seconds+excluded.seconds', req.uid, today(), block, secs);
    res.json({ ok: true });
  }));

  app.get('/api/dashboard', h((req, res) => {
    const d = db();
    const scores = A.skillScores(d, req.uid);
    const buckets = A.wordBuckets(d, req.uid);
    const insights = A.weaknesses(d, req.uid, scores, buckets);
    const due = (get('SELECT COUNT(*) n FROM srs_cards WHERE user_id=? AND due<=?', req.uid, now()) as Row).n;
    res.json({
      name: settings(req).name || req.user.username,
      plan: A.planToday(d, req.uid), streak: A.streak(d, req.uid), exposure: A.exposureStats(d, req.uid), due,
      words: { introduced: buckets.introduced, learned: buckets.learned, instant: buckets.instantCount, forgotten: buckets.counts.forgotten, total: (get('SELECT COUNT(*) n FROM vocab') as Row).n },
      scores, insights: insights.slice(0, 3), recommendations: A.recommendations(d, req.uid, insights), comfortableSpeed: A.comfortableSpeed(d, req.uid),
      audio: { azure: azureEnabled(), ai: AI.aiEnabled() },
    });
  }));
  app.get('/api/progress', h((req, res) => {
    const d = db();
    const scores = A.skillScores(d, req.uid);
    const buckets = A.wordBuckets(d, req.uid);
    const history = all(`SELECT skill, date(ts/1000,'unixepoch','localtime') day, AVG(score) s, COUNT(*) n FROM attempts WHERE user_id=? AND ts>? GROUP BY skill, day ORDER BY day`, req.uid, now() - 30 * 86_400_000);
    res.json({ skills: A.SKILLS.map((s) => ({ ...s, ...scores[s.key] })), input: scores.input, buckets, tiers: A.tierAccuracy(d, req.uid), exposure: A.exposureStats(d, req.uid),
      speed: A.comfortableSpeed(d, req.uid), response: A.avgResponseMs(d, req.uid), streak: A.streak(d, req.uid), insights: A.weaknesses(d, req.uid, scores, buckets), history,
      levels: all(`SELECT v.level, COUNT(*) total, SUM(CASE WHEN r.state='review' THEN 1 ELSE 0 END) read, SUM(CASE WHEN l.state='review' THEN 1 ELSE 0 END) listen
        FROM vocab v LEFT JOIN srs_cards r ON r.vocab_id=v.id AND r.user_id=? AND r.skill='read' LEFT JOIN srs_cards l ON l.vocab_id=v.id AND l.user_id=? AND l.skill='listen' GROUP BY v.level`, req.uid, req.uid) });
  }));

  // passive listening playlist: completed input items, bookmarked lines, learned-word sentences
  app.get('/api/passive', h((req, res) => {
    const done = all(`SELECT c.id, c.title, c.body FROM content_items c JOIN content_progress p ON p.item_id=c.id AND p.user_id=? WHERE c.section='input' ORDER BY p.completed_at DESC`, req.uid);
    const tracks = done.map((c) => ({ id: `item-${c.id}`, title: c.title, lines: J<any>(c.body, { lines: [] }).lines.map((l: Row) => ({ ar: l.ar, en: l.en, gender: l.gender })) }));
    const bm = all("SELECT arabic, english FROM bookmarks WHERE user_id=? ORDER BY created_at DESC LIMIT 60", req.uid);
    if (bm.length) tracks.unshift({ id: 'bookmarks', title: 'Bookmarked sentences', lines: bm.map((b) => ({ ar: b.arabic, en: b.english, gender: 'm' })) });
    const learned = all(`SELECT DISTINCT s.arabic, s.english FROM attempts a JOIN sentences s ON s.id=a.item_id WHERE a.user_id=? AND a.skill='sentence' AND a.item_type='sentence' ORDER BY a.ts DESC LIMIT 60`, req.uid);
    if (learned.length) tracks.push({ id: 'sentences', title: 'Sentences you have practised', lines: learned.map((s, i) => ({ ar: s.arabic, en: s.english, gender: i % 2 ? 'f' : 'm' })) });
    res.json(tracks);
  }));

  // ------------------------------------------------------------ static SPA
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
