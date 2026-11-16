import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { openDb, setDb } from '../server/db.ts';
import { seed } from '../server/seed.ts';
import { createApp } from '../server/app.ts';

let server: Server, base = '', cookie = '';
const api = async (path: string, body?: unknown, method?: string) => {
  const r = await fetch(base + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AZURE_SPEECH_KEY;
  const d = openDb(':memory:');
  setDb(d);
  seed(d, () => {});
  await new Promise<void>((res) => { server = createApp().listen(0, () => res()); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

describe('auth', () => {
  it('rejects anonymous access and allows register/login', async () => {
    expect((await api('/api/me')).status).toBe(401);
    expect((await api('/api/auth/register', { username: 'bilal', password: 'secret1', name: 'Bilal' })).status).toBe(200);
    const me = await api('/api/me');
    expect(me.json.username).toBe('bilal');
    expect(me.json.settings.newPerDay).toBe(15);
  });
});

describe('phase 1: vocabulary + SRS', () => {
  it('lists frequency levels', async () => {
    const r = await api('/api/vocab/levels');
    expect(r.json[0]).toMatchObject({ level: 1, total: 100 });
    const v = await api('/api/vocab?level=1');
    expect(v.json).toHaveLength(100);
    expect(v.json[0]).toMatchObject({ arabic: 'أنا', rank: 1 });
  });
  it('word detail includes contextual ladder', async () => {
    const list = await api('/api/vocab?q=عايز');
    const w = await api(`/api/vocab/${list.json[0].id}`);
    expect(w.json.ladder.length).toBeGreaterThanOrEqual(4);
    expect(w.json.ladder[0].tokens.length).toBeGreaterThan(0);
  });
  it('introduces words, creates read+listen cards, and schedules answers', async () => {
    const news = await api('/api/srs/new');
    expect(news.json).toHaveLength(15);
    for (const w of news.json.slice(0, 5)) await api('/api/srs/introduce', { vocab_id: w.id });
    const q = await api('/api/srs/queue?mode=read');
    expect(q.json.length).toBe(5);
    expect(q.json[0].options).toHaveLength(4);
    const a = await api('/api/srs/answer', { vocab_id: q.json[0].vocab.id, skill: 'read', rating: 3, ms: 1800 });
    expect(a.json.state).toBe('learning');
    const stats = await api('/api/srs/stats');
    expect(stats.json.newToday).toBe(5);
  });
  it('placement fast-tracks known words with separate listening cards', async () => {
    const p = await api('/api/srs/placement?level=1');
    const ids = p.json.slice(0, 40).map((w: any) => w.id);
    await api('/api/srs/placement', { known: ids });
    const v = await api('/api/vocab?level=1');
    const known = v.json.filter((w: any) => ids.includes(w.id));
    expect(known.every((w: any) => w.read?.state === 'review' && w.listen)).toBe(true);
    // placement must not consume the daily new-word quota
    const stats = await api('/api/srs/stats');
    expect(stats.json.newToday).toBe(5);
  });
});

describe('phase 2: context', () => {
  it('builds a session with options and word chips, and records answers', async () => {
    const s = await api('/api/context/session');
    expect(s.json.length).toBeGreaterThan(3);
    const first = s.json[0];
    expect(first.options).toContain(first.english);
    expect(first.chips.some((c: any) => c.inSentence)).toBe(true);
    const heard = first.chips.filter((c: any) => c.inSentence).map((c: any) => c.id);
    const r = await api('/api/context/answer', { sentence_id: first.id, correct: true, heard, ms: 4000, speed: 1, plays: 2 });
    expect(r.json.recog).toBe(1);
    const lv = await api('/api/context/levels');
    expect(lv.json.unlocked).toBeGreaterThanOrEqual(3);
  });
  it('glosses arbitrary text', async () => {
    const g = await api('/api/gloss', { text: 'مكنتش عايز أروح' });
    expect(g.json[0].lemma.arabic).toContain('كان');
  });
});

describe('phase 3: comprehensible input', () => {
  it('lists items with coverage and recommendation, grades answers server-side', async () => {
    const l = await api('/api/input');
    expect(l.json.items.length).toBeGreaterThanOrEqual(15);
    expect(l.json.items[0].coverage).toBeGreaterThan(0);
    expect(l.json.recommended).not.toBeNull();
    const d = await api(`/api/input/${l.json.items[0].id}`);
    expect(d.json.lines[0].tokens.length).toBeGreaterThan(0);
    expect(d.json.questions[0]).not.toHaveProperty('answer');
    // answer every question with the option whose original index k === 0 (stored correct answer)
    const answers = d.json.questions.map((q: any) => q.options.find((o: any) => o.k === 0).k);
    const g = await api(`/api/input/${d.json.id}/answers`, { answers, listenedBlind: true });
    expect(g.json.score).toBe(1);
    expect(g.json.advice).toBe('up');
  });
});

describe('phase 4: listening lab', () => {
  it('dictation diff', async () => {
    const s = await api('/api/lab/dictation');
    expect(s.json.id).toBeTruthy();
    const r = await api('/api/lab/dictation', { sentence_id: s.json.id, typed: 'انا', plays: 3 });
    expect(r.json.ops.length).toBeGreaterThan(0);
    expect(r.json.sentence.arabic).toBeTruthy();
  });
  it('segmentation scoring', async () => {
    const s = await api('/api/lab/segmentation');
    expect(s.json.chunkCount).toBeGreaterThanOrEqual(2);
    const wrong = await api('/api/lab/segmentation', { sentence_id: s.json.id, boundaries: [] });
    const perfect = await api('/api/lab/segmentation', { sentence_id: s.json.id, boundaries: wrong.json.truth });
    expect(perfect.json.score).toBe(1);
    expect(wrong.json.score).toBe(0);
  });
  it('word recognition + fast speech + scenarios', async () => {
    const r = await api('/api/lab/recognition');
    expect(r.json.candidates.length).toBeGreaterThan(3);
    const g = await api('/api/lab/recognition', { sentence_id: r.json.id, selected: [], candidates: r.json.candidates.map((c: any) => c.id) });
    expect(g.json.score).toBe(0);
    const f = await api('/api/lab/fast');
    for (const sp of [0.8, 1, 1.2]) await api('/api/lab/fast', { sentence_id: f.json.id, speed: sp, understood: sp < 1.2, session: 's1' });
    const f2 = await api('/api/lab/fast', { sentence_id: f.json.id, speed: 1.4, understood: false, session: 's1' });
    expect(f2.json.comfortable).toBe(1);
    const sc = await api('/api/lab/scenarios');
    const run1 = await api(`/api/lab/scenarios/${sc.json[0].slug}`);
    expect(run1.json.turns.length).toBeGreaterThan(3);
    expect(run1.json.turns.some((t: any) => t.curveball)).toBe(true);
  });
});

describe('phase 5: conversations without AI key', () => {
  it('returns a clear 503', async () => {
    const r = await api('/api/conversations', { topic: 'football', mode: 'natural' });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('ai_unavailable');
  });
});

describe('phase 6: reading + analytics', () => {
  it('reading items include Franco and lookups are tracked', async () => {
    const l = await api('/api/reading');
    const franco = l.json.items.find((i: any) => i.slug === 'chat-franco-late');
    const d = await api(`/api/reading/${franco.id}`);
    expect(d.json.lines[0].franco).toMatch(/fein/);
    const lemma = d.json.lines[0].tokens.find((t: any) => t.lemma).lemma;
    await api('/api/lookup', { vocab_id: lemma.id, context: 'reading' });
    const st = await api('/api/reading-struggles');
    expect(st.json[0].id).toBe(lemma.id);
  });
  it('dashboard and progress aggregate everything', async () => {
    await api('/api/exposure', { kind: 'audio', seconds: 120 });
    await api('/api/plan/tick', { block: 'vocab', seconds: 60 });
    const d = await api('/api/dashboard');
    expect(d.json.plan).toHaveLength(5);
    expect(d.json.plan[0].done).toBe(1);
    expect(d.json.streak.current).toBe(1);
    expect(d.json.words.introduced).toBeGreaterThan(40);
    expect(d.json.exposure.todayMinutes).toBe(2);
    const p = await api('/api/progress');
    expect(p.json.skills).toHaveLength(8);
    expect(p.json.insights.length).toBeGreaterThan(0);
    const pass = await api('/api/passive');
    expect(pass.json.length).toBeGreaterThan(0);
  });
  it('weakness detector reports read-vs-listen gap', async () => {
    const q = await api('/api/srs/queue');
    const items = q.json.slice(0, 10);
    for (let i = 0; i < 12; i++) {
      const w = items[i % items.length];
      await api('/api/srs/answer', { vocab_id: w.vocab.id, skill: 'read', rating: 3, ms: 1500 });
      await api('/api/srs/answer', { vocab_id: w.vocab.id, skill: 'listen', rating: 1, ms: 6000 });
    }
    const p = await api('/api/progress');
    expect(p.json.insights.map((i: any) => i.id)).toContain('read-vs-listen');
  });
});
