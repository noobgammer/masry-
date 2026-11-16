// Progress analytics: 8 independent skill scores, word buckets, weakness detection,
// recommendations and the daily plan. Everything derives from attempts / srs_cards / word_events.
import type { DB } from './db.ts';
import { today } from './db.ts';
import { isInstant, strength } from './srs.ts';

export const SKILLS = [
  { key: 'vocab_read', label: 'Vocabulary — reading', desc: 'Recognising words when you see them' },
  { key: 'vocab_listen', label: 'Vocabulary — listening', desc: 'Recognising words when you hear them' },
  { key: 'sentence', label: 'Sentence comprehension', desc: 'Understanding whole spoken sentences' },
  { key: 'fast_speech', label: 'Fast speech', desc: 'Following natural and fast speed' },
  { key: 'reading', label: 'Reading comprehension', desc: 'Messages, chats, Franco' },
  { key: 'dictation', label: 'Dictation accuracy', desc: 'Writing exactly what you hear' },
  { key: 'speaking', label: 'Speaking', desc: 'Being understood, natural phrasing' },
  { key: 'spontaneous', label: 'Spontaneous conversation', desc: 'Handling unexpected questions' },
] as const;

export const PLAN_BLOCKS = [
  { key: 'vocab', label: 'Frequency vocabulary', minutes: 10, path: '/vocabulary' },
  { key: 'context', label: 'Words in context', minutes: 15, path: '/context' },
  { key: 'input', label: 'Comprehensible input', minutes: 20, path: '/input' },
  { key: 'lab', label: 'Listening lab', minutes: 10, path: '/lab' },
  { key: 'speaking', label: 'Speaking practice', minutes: 5, path: '/conversations' },
] as const;

type Row = Record<string, any>;

export function skillScores(d: DB, uid: number) {
  const out: Record<string, { score: number | null; n: number; trend: number | null; recent: number | null }> = {};
  const WEEK = 7 * 86_400_000;
  const now = Date.now();
  for (const s of [...SKILLS.map((x) => x.key), 'input']) {
    const rows = d.prepare('SELECT score, ts FROM attempts WHERE user_id=? AND skill=? ORDER BY ts DESC LIMIT 200').all(uid, s) as Row[];
    if (!rows.length) { out[s] = { score: null, n: 0, trend: null, recent: null }; continue; }
    // recency-weighted mean (half-life 60 attempts)
    let w = 0, sum = 0;
    rows.forEach((r, i) => { const wi = Math.pow(0.5, i / 60); w += wi; sum += wi * r.score; });
    const thisWeek = rows.filter((r) => r.ts > now - WEEK);
    const lastWeek = rows.filter((r) => r.ts <= now - WEEK && r.ts > now - 2 * WEEK);
    const mean = (a: Row[]) => (a.length ? a.reduce((x, r) => x + r.score, 0) / a.length : null);
    const tw = mean(thisWeek), lw = mean(lastWeek);
    out[s] = { score: Math.round((100 * sum) / w), n: rows.length, trend: tw != null && lw != null ? Math.round(100 * (tw - lw)) : null, recent: tw != null ? Math.round(100 * tw) : null };
  }
  return out;
}

export function wordBuckets(d: DB, uid: number) {
  const cards = d.prepare(`SELECT c.*, v.arabic, v.english, v.translit, v.rank FROM srs_cards c JOIN vocab v ON v.id=c.vocab_id WHERE c.user_id=?`).all(uid) as Row[];
  const byWord = new Map<number, { read?: Row; listen?: Row; arabic: string; english: string; translit: string; rank: number }>();
  for (const c of cards) {
    const w = byWord.get(c.vocab_id) || { arabic: c.arabic, english: c.english, translit: c.translit, rank: c.rank };
    (w as any)[c.skill] = c;
    byWord.set(c.vocab_id, w);
  }
  const ctx = d.prepare(`SELECT vocab_id, SUM(correct) ok, COUNT(*) n FROM word_events WHERE user_id=? AND context IN ('sentence','input','reading') GROUP BY vocab_id`).all(uid) as Row[];
  const ctxMap = new Map(ctx.map((r) => [r.vocab_id, r]));
  const pick = (id: number) => { const w = byWord.get(id)!; return { id, arabic: w.arabic, english: w.english, translit: w.translit, rank: w.rank }; };
  const forgotten: Row[] = [], instant: Row[] = [], readNotHeard: Row[] = [], isolatedOnly: Row[] = [];
  let learned = 0, introduced = 0, instantListen = 0;
  for (const [id, w] of byWord) {
    introduced++;
    if (w.read?.state === 'review' || w.listen?.state === 'review') learned++;
    const lapses = (w.read?.lapses || 0) + (w.listen?.lapses || 0);
    if (lapses >= 3) forgotten.push({ ...pick(id), lapses });
    if (w.read && isInstant(w.read as any)) instant.push(pick(id));
    if (w.listen && isInstant(w.listen as any)) instantListen++;
    const rs = strength(w.read as any), ls = strength(w.listen as any);
    if (rs >= 0.45 && (rs - ls >= 0.3 || (w.listen?.lapses || 0) >= 2)) readNotHeard.push({ ...pick(id), read: Math.round(rs * 100), listen: Math.round(ls * 100) });
    const c = ctxMap.get(id);
    if (Math.max(rs, ls) >= 0.45 && c && c.n >= 3 && c.ok / c.n < 0.6) isolatedOnly.push({ ...pick(id), contextAccuracy: Math.round((100 * c.ok) / c.n) });
  }
  const byRank = (a: Row, b: Row) => a.rank - b.rank;
  return {
    introduced, learned, instantCount: instant.length, instantListen,
    forgotten: forgotten.sort((a, b) => b.lapses - a.lapses).slice(0, 50),
    instant: instant.sort(byRank).slice(0, 50),
    readNotHeard: readNotHeard.sort(byRank).slice(0, 50),
    isolatedOnly: isolatedOnly.sort(byRank).slice(0, 50),
    counts: { forgotten: forgotten.length, readNotHeard: readNotHeard.length, isolatedOnly: isolatedOnly.length },
  };
}

export function streak(d: DB, uid: number) {
  const days = new Set<string>();
  for (const r of d.prepare('SELECT DISTINCT ts FROM attempts WHERE user_id=? AND ts > ?').all(uid, Date.now() - 400 * 86_400_000) as Row[]) days.add(today(r.ts));
  for (const r of d.prepare('SELECT day FROM exposure WHERE user_id=? AND seconds > 30').all(uid) as Row[]) days.add(r.day);
  let n = 0;
  const cur = new Date();
  if (!days.has(today(cur.getTime()))) cur.setDate(cur.getDate() - 1); // today not done yet: streak continues from yesterday
  while (days.has(today(cur.getTime()))) { n++; cur.setDate(cur.getDate() - 1); }
  const last30: { day: string; active: boolean }[] = [];
  const c2 = new Date();
  for (let i = 0; i < 30; i++) { const k = today(c2.getTime()); last30.unshift({ day: k, active: days.has(k) }); c2.setDate(c2.getDate() - 1); }
  return { current: n, doneToday: days.has(today()), last30 };
}

export function exposureStats(d: DB, uid: number) {
  const total = (d.prepare('SELECT COALESCE(SUM(seconds),0) s FROM exposure WHERE user_id=?').get(uid) as Row).s as number;
  const todayS = (d.prepare('SELECT COALESCE(SUM(seconds),0) s FROM exposure WHERE user_id=? AND day=?').get(uid, today()) as Row).s as number;
  const byKind = d.prepare('SELECT kind, SUM(seconds) s FROM exposure WHERE user_id=? GROUP BY kind').all(uid) as Row[];
  const daily = d.prepare('SELECT day, SUM(seconds) s FROM exposure WHERE user_id=? GROUP BY day ORDER BY day DESC LIMIT 14').all(uid) as Row[];
  return { totalHours: total / 3600, todayMinutes: todayS / 60, byKind, daily: daily.reverse() };
}

export function comfortableSpeed(d: DB, uid: number): number | null {
  // highest speed understood (score >= .8) in recent fast-speech sessions — median of last 5 sessions
  const rows = d.prepare(`SELECT json_extract(meta,'$.session') s, MAX(speed) sp FROM attempts
    WHERE user_id=? AND skill='fast_speech' AND score>=0.8 AND speed IS NOT NULL GROUP BY s ORDER BY MAX(ts) DESC LIMIT 5`).all(uid) as Row[];
  if (!rows.length) return null;
  const v = rows.map((r) => r.sp).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

export function avgResponseMs(d: DB, uid: number) {
  const r = d.prepare(`SELECT AVG(response_ms) a, COUNT(*) n FROM attempts WHERE user_id=? AND response_ms IS NOT NULL AND response_ms < 60000 AND ts > ?`).get(uid, Date.now() - 14 * 86_400_000) as Row;
  const listen = d.prepare(`SELECT AVG(response_ms) a FROM attempts WHERE user_id=? AND skill='vocab_listen' AND response_ms < 60000 AND ts > ?`).get(uid, Date.now() - 14 * 86_400_000) as Row;
  return { overall: r.a ? Math.round(r.a) : null, listen: listen.a ? Math.round(listen.a) : null, n: r.n };
}

export function tierAccuracy(d: DB, uid: number) {
  return d.prepare(`SELECT CAST(json_extract(meta,'$.tier') AS INTEGER) tier, AVG(score) acc, COUNT(*) n FROM attempts
    WHERE user_id=? AND skill='sentence' AND json_extract(meta,'$.tier') IS NOT NULL GROUP BY tier ORDER BY tier`).all(uid) as Row[];
}

export interface Insight { id: string; severity: 'high' | 'medium' | 'info'; text: string; action?: { label: string; path: string } }

export function weaknesses(d: DB, uid: number, scores = skillScores(d, uid), buckets = wordBuckets(d, uid)): Insight[] {
  const out: Insight[] = [];
  const s = (k: string) => scores[k];
  const ok = (k: string, n = 8) => s(k) && s(k).n >= n && s(k).score != null;

  if (ok('vocab_read') && ok('vocab_listen') && s('vocab_read').score! - s('vocab_listen').score! >= 12) {
    out.push({ id: 'read-vs-listen', severity: 'high',
      text: `You recognise ${s('vocab_read').score}% of your vocabulary when reading, but only ${s('vocab_listen').score}% when listening.`,
      action: { label: 'Listening-only review', path: '/vocabulary?mode=listen' } });
  }
  if (buckets.counts.readNotHeard >= 5) {
    out.push({ id: 'read-not-heard', severity: 'medium',
      text: `${buckets.counts.readNotHeard} words are strong in reading but weak by ear (e.g. ${buckets.readNotHeard.slice(0, 3).map((w) => w.arabic).join('، ')}).`,
      action: { label: 'Word recognition drill', path: '/lab/recognition' } });
  }
  const tiers = tierAccuracy(d, uid);
  const simple = tiers.filter((t) => t.tier <= 3 && t.n >= 3), complex = tiers.filter((t) => t.tier >= 5 && t.n >= 3);
  if (simple.length && complex.length) {
    const sa = (100 * simple.reduce((a, t) => a + t.acc * t.n, 0)) / simple.reduce((a, t) => a + t.n, 0);
    const ca = (100 * complex.reduce((a, t) => a + t.acc * t.n, 0)) / complex.reduce((a, t) => a + t.n, 0);
    if (sa >= 70 && sa - ca >= 15) out.push({ id: 'clauses', severity: 'high',
      text: `You understand individual sentences well (${Math.round(sa)}%) but struggle when they contain multiple clauses (${Math.round(ca)}%).`,
      action: { label: 'Sentence segmentation', path: '/lab/segmentation' } });
  }
  const sp = comfortableSpeed(d, uid);
  if (sp != null && sp < 1.0) out.push({ id: 'speed', severity: 'high',
    text: `Your comfortable listening speed is ${sp.toFixed(2)}× — normal Egyptian speech is 1.0× and casual speech is often faster.`,
    action: { label: 'Fast speech trainer', path: '/lab/fast' } });
  if (ok('sentence') && ok('input', 4) && s('sentence').score! - s('input').score! >= 15) out.push({ id: 'long-input', severity: 'medium',
    text: `Single sentences go well (${s('sentence').score}%) but full conversations drop to ${s('input').score}%. Your stamina for continuous Arabic needs work.`,
    action: { label: 'Comprehensible input', path: '/input' } });
  const dict = d.prepare(`SELECT SUM(json_extract(meta,'$.counts.missing')) miss, SUM(json_extract(meta,'$.counts.misspelled')) mis,
      SUM(json_extract(meta,'$.counts.confused')+json_extract(meta,'$.counts.wrong')) wrong, SUM(json_extract(meta,'$.refLen')) total
      FROM attempts WHERE user_id=? AND skill='dictation' AND ts > ?`).get(uid, Date.now() - 30 * 86_400_000) as Row;
  if (dict.total >= 30 && dict.miss / dict.total > 0.15) out.push({ id: 'dict-missing', severity: 'medium',
    text: `In dictation you miss ${Math.round((100 * dict.miss) / dict.total)}% of words entirely — usually short, unstressed words that get swallowed in connected speech.`,
    action: { label: 'Dictation', path: '/lab/dictation' } });
  if (ok('speaking', 4) && ok('spontaneous', 4) && s('speaking').score! - s('spontaneous').score! >= 15) out.push({ id: 'spontaneous', severity: 'high',
    text: `You can express yourself (${s('speaking').score}%) but unexpected questions trip you up (${s('spontaneous').score}%).`,
    action: { label: 'Unexpected responses', path: '/lab/unexpected' } });
  const reveals = d.prepare(`SELECT AVG(CASE WHEN json_extract(meta,'$.revealedEnglish') THEN 1.0 ELSE 0 END) r, COUNT(*) n FROM attempts
      WHERE user_id=? AND skill IN ('reading','input') AND ts > ?`).get(uid, Date.now() - 14 * 86_400_000) as Row;
  if (reveals.n >= 4 && reveals.r > 0.5) out.push({ id: 'english-reliance', severity: 'medium',
    text: `You opened the English translation before answering in ${Math.round(reveals.r * 100)}% of recent texts. Try answering from the Arabic alone first — guessing from context is the skill you're building.` });
  if (buckets.counts.forgotten >= 5) out.push({ id: 'forgotten', severity: 'medium',
    text: `${buckets.counts.forgotten} words keep slipping away (3+ lapses), e.g. ${buckets.forgotten.slice(0, 3).map((w) => w.arabic).join('، ')}. Meeting them in context will make them stick better than more flashcards.`,
    action: { label: 'Practise them in context', path: '/context?focus=forgotten' } });
  if (buckets.counts.isolatedOnly >= 3) out.push({ id: 'isolated', severity: 'medium',
    text: `${buckets.counts.isolatedOnly} words you know in isolation are not recognised inside sentences (e.g. ${buckets.isolatedOnly.slice(0, 3).map((w) => w.arabic).join('، ')}).`,
    action: { label: 'Contextual listening', path: '/context' } });
  if (!out.length) out.push({ id: 'none', severity: 'info', text: 'Not enough data yet for a reliable diagnosis — complete a few sessions in each section and the app will start pinpointing weaknesses.' });
  return out;
}

export function planToday(d: DB, uid: number) {
  const rows = d.prepare('SELECT block, seconds FROM plan_progress WHERE user_id=? AND day=?').all(uid, today()) as Row[];
  const m = new Map(rows.map((r) => [r.block, r.seconds]));
  return PLAN_BLOCKS.map((b) => ({ ...b, done: Math.min(b.minutes, (m.get(b.key) || 0) / 60) }));
}

export function recommendations(d: DB, uid: number, insights: Insight[]) {
  const recs: { label: string; reason: string; path: string }[] = [];
  const due = (d.prepare('SELECT COUNT(*) n FROM srs_cards WHERE user_id=? AND due<=?').get(uid, Date.now()) as Row).n;
  if (due > 0) recs.push({ label: `Review ${due} due cards`, reason: 'Spaced repetition is time-sensitive.', path: '/vocabulary?mode=review' });
  for (const i of insights) if (i.action && recs.length < 4) recs.push({ label: i.action.label, reason: i.text, path: i.action.path });
  const plan = planToday(d, uid);
  for (const b of plan) if (b.done < b.minutes && recs.length < 5) recs.push({ label: b.label, reason: `${Math.ceil(b.minutes - b.done)} min left in today's plan.`, path: b.path });
  return recs;
}
