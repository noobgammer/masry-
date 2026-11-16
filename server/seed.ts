// Loads human-editable content files (content/**) into SQLite.
// Idempotent: vocab keyed by rank, sentences by Arabic text, content by slug. User progress is preserved.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, levelForRank, openDb, tx, type DB } from './db.ts';
import { normalize, chunkBoundaries, analyzeSentence, NAMES } from './arabic.ts';
import { buildLexicon, vocabIdsIn } from './lexicon.ts';

const CONTENT = path.join(ROOT, 'content');
const lines = (f: string) => fs.readFileSync(f, 'utf8').split(/\r?\n/);
const files = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => path.join(dir, f)) : [];

export interface VocabRow {
  rank: number;
  arabic: string;
  translit: string;
  english: string;
  pos: string;
  category: string;
  variants: string[];
  example_ar: string;
  example_en: string;
  notes: string;
  verified: number;
  source: string;
}

export function parseVocab(): VocabRow[] {
  const out: VocabRow[] = [];
  for (const f of files(path.join(CONTENT, 'vocab'))) {
    const unverified = f.includes('draft');
    for (const l of lines(f)) {
      if (!l.trim() || l.startsWith('#')) continue;
      const p = l.split('|').map((s) => s.trim());
      if (p.length < 9) throw new Error(`Bad vocab line in ${path.basename(f)}: ${l}`);
      out.push({
        rank: out.length + 1,
        arabic: p[0], translit: p[1], english: p[2], pos: p[3], category: p[4],
        variants: p[5] ? p[5].split(',').map((s) => s.trim()).filter(Boolean) : [],
        example_ar: p[6], example_en: p[7], notes: p[8],
        verified: unverified ? 0 : 1,
        source: unverified ? 'ai-draft' : 'seed',
      });
    }
  }
  return out;
}

export interface SentenceRow {
  head: string | null;
  tier: number;
  arabic: string;
  translit: string;
  english: string;
  chunks: { ar: string; en: string }[] | null;
  notes: string;
}

export function parseSentences(): SentenceRow[] {
  const out: SentenceRow[] = [];
  let head: string | null = null;
  for (const l of lines(path.join(CONTENT, 'sentences.txt'))) {
    if (!l.trim() || l.startsWith('#')) continue;
    if (l.startsWith('@')) {
      const h = l.slice(1).trim();
      head = h === '*' ? null : h;
      continue;
    }
    const p = l.split('|').map((s) => s.trim());
    const tier = Number(p[0]);
    const rawAr = p[1], rawEn = p[3] || '';
    let chunks: SentenceRow['chunks'] = null;
    if (rawAr.includes('/')) {
      const ar = rawAr.split('/').map((s) => s.trim());
      const en = rawEn.split('/').map((s) => s.trim());
      chunks = ar.map((a, i) => ({ ar: a, en: en[i] || '' }));
    }
    out.push({
      head, tier,
      arabic: chunks ? chunkBoundaries(rawAr).text : rawAr,
      translit: (p[2] || '').replace(/\s*\/\s*/g, ' '),
      english: rawEn.replace(/\s*\/\s*/g, ' '),
      chunks, notes: p[4] || '',
    });
  }
  return out;
}

export interface Line { speaker: string; gender: 'm' | 'f'; ar: string; en: string; franco?: string; para: number }
export interface Question { q: string; q_en: string; options: string[]; answer: number }
export interface ContentRow {
  slug: string; section: string; kind: string; title: string; title_ar: string;
  difficulty: number; topic: string; lines: Line[]; questions: Question[]; me?: string;
}

function parseQuestions(block: string[]): Question[] {
  return block.filter((l) => l.startsWith('?')).map((l) => {
    const p = l.slice(1).split('|').map((s) => s.trim());
    // options are stored with the correct answer first; shuffled at serve time
    return { q: p[0], q_en: p[1], options: p.slice(2), answer: 0 };
  });
}

function splitBlocks(f: string): { slug: string; headers: Record<string, string>; body: string[]; tail: string[] }[] {
  const out: { slug: string; headers: Record<string, string>; body: string[]; tail: string[] }[] = [];
  let cur: (typeof out)[number] | null = null;
  let part = 0;
  for (const raw of lines(f)) {
    const l = raw.trimEnd();
    if (l.startsWith('#')) continue;
    if (l.startsWith('===')) {
      cur = { slug: l.slice(3).trim(), headers: {}, body: [], tail: [] };
      out.push(cur);
      part = 0;
      continue;
    }
    if (!cur) continue;
    if (l.trim() === '---') { part++; continue; }
    if (part === 0) {
      const m = l.match(/^(\w+):\s*(.*)$/);
      if (m) cur.headers[m[1]] = m[2];
    } else if (part === 1) cur.body.push(l);
    else cur.tail.push(l);
  }
  return out;
}

export function parseInput(): ContentRow[] {
  const out: ContentRow[] = [];
  for (const f of files(path.join(CONTENT, 'input'))) {
    for (const b of splitBlocks(f)) {
      const ls: Line[] = [];
      let para = 0;
      for (const l of b.body) {
        if (!l.trim()) { if (ls.length) para++; continue; }
        const m = l.match(/^([^:(]+)\((m|f)\):\s*(.+)$/);
        if (!m) throw new Error(`Bad line in ${b.slug}: ${l}`);
        const [ar, en] = m[3].split('|').map((s) => s.trim());
        ls.push({ speaker: m[1].trim(), gender: m[2] as 'm' | 'f', ar, en: en || '', para });
      }
      out.push({
        slug: b.slug, section: 'input', kind: b.headers.kind || 'dialogue', title: b.headers.title, title_ar: b.headers.title_ar || '',
        difficulty: Number(b.headers.difficulty || 1), topic: b.headers.topic || '', lines: ls, questions: parseQuestions(b.tail),
      });
    }
  }
  return out;
}

export function parseChats(): ContentRow[] {
  const out: ContentRow[] = [];
  for (const f of files(path.join(CONTENT, 'reading'))) {
    for (const b of splitBlocks(f)) {
      const me = b.headers.me || '';
      const ls: Line[] = b.body.filter((l) => l.trim()).map((l) => {
        const i = l.indexOf(':');
        const speaker = l.slice(0, i).trim();
        const rest = l.slice(i + 1).trim();
        const [msg, en] = rest.split(' | ').map((s) => s.trim());
        let ar = msg, franco: string | undefined;
        if (msg.includes('>>')) {
          const [fr, a] = msg.split('>>').map((s) => s.trim());
          franco = fr; ar = a;
        }
        return { speaker, gender: 'm', ar, en: en || '', franco, para: 0 };
      });
      out.push({
        slug: b.slug, section: 'reading', kind: 'chat', title: b.headers.title, title_ar: b.headers.title_ar || '',
        difficulty: Number(b.headers.difficulty || 1), topic: b.headers.topic || '', lines: ls, questions: parseQuestions(b.tail), me,
      });
    }
  }
  return out;
}

export interface ScenarioTurn { ar: string; en: string; sample_ar: string; sample_en: string }
export function parseScenarios(): { slug: string; title: string; title_ar: string; topic: string; turns: ScenarioTurn[][]; curveballs: ScenarioTurn[] }[] {
  const out: ReturnType<typeof parseScenarios> = [];
  for (const b of splitBlocks(path.join(CONTENT, 'scenarios.txt'))) {
    const turns: ScenarioTurn[][] = [];
    const curveballs: ScenarioTurn[] = [];
    for (const l of b.body) {
      if (!l.trim()) continue;
      const mark = l[0];
      const [ar, en, sample_ar, sample_en] = l.slice(1).split('|').map((s) => s.trim());
      const t = { ar, en, sample_ar: sample_ar || '', sample_en: sample_en || '' };
      if (mark === '>') turns.push([t]);
      else if (mark === '~') turns[turns.length - 1].push(t);
      else if (mark === '!') curveballs.push(t);
    }
    out.push({ slug: b.slug, title: b.headers.title, title_ar: b.headers.title_ar || '', topic: b.headers.topic || '', turns, curveballs });
  }
  return out;
}

export function loadNames() {
  const f = path.join(CONTENT, 'names.txt');
  if (!fs.existsSync(f)) return;
  for (const l of lines(f)) if (l.trim() && !l.startsWith('#')) for (const n of l.split(/[,،\s]+/)) if (n) NAMES.add(normalize(n));
}

export function seed(d: DB, log = console.log) {
  loadNames();
  const vocab = parseVocab();
  const sentences = parseSentences();
  const input = parseInput();
  const chats = parseChats();
  const scenarios = parseScenarios();

  tx(d, () => {
    const up = d.prepare(`INSERT INTO vocab (id, rank, level, arabic, translit, english, pos, category, variants, example_ar, example_en, notes, verified, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET rank=excluded.rank, level=excluded.level, arabic=excluded.arabic, translit=excluded.translit,
        english=excluded.english, pos=excluded.pos, category=excluded.category, variants=excluded.variants, example_ar=excluded.example_ar,
        example_en=excluded.example_en, notes=excluded.notes, verified=excluded.verified, source=excluded.source`);
    // ranks may shift when files are edited; clear unique rank collisions first
    d.exec('UPDATE vocab SET rank = -id');
    for (const v of vocab) {
      up.run(v.rank, v.rank, levelForRank(v.rank), v.arabic, v.translit, v.english, v.pos, v.category, JSON.stringify(v.variants),
        v.example_ar || null, v.example_en || null, v.notes || null, v.verified, v.source);
    }
    d.prepare('DELETE FROM vocab WHERE rank < 0').run();

    d.exec('DELETE FROM lexicon');
    const lx = d.prepare('INSERT OR IGNORE INTO lexicon (form, vocab_id) VALUES (?, ?)');
    for (const v of vocab) {
      const forms = new Set<string>();
      for (const a of v.arabic.split('/')) forms.add(normalize(a));
      for (const a of v.variants) forms.add(normalize(a));
      // index imperfect stems (يتعلم -> تعلم) so b-/ha-/person prefixes can be stripped
      if (/verb/.test(v.pos)) for (const f of [...forms]) if (f.startsWith('ي') && f.length >= 4) forms.add(f.slice(1));
      for (const f of forms) if (f) lx.run(f, v.rank);
    }
  });
  const lex = buildLexicon(d);
  const byHead = new Map<string, number>();
  for (const v of vocab) byHead.set(normalize(v.arabic), v.rank);

  tx(d, () => {
    const keep = new Set<string>();
    const ins = d.prepare(`INSERT INTO sentences (arabic, translit, english, complexity, target_vocab_id, chunks, notes)
      VALUES (?,?,?,?,?,?,?)`);
    const upd = d.prepare('UPDATE sentences SET translit=?, english=?, complexity=?, target_vocab_id=?, chunks=?, notes=? WHERE id=?');
    const find = d.prepare('SELECT id FROM sentences WHERE arabic = ?');
    const link = d.prepare('INSERT OR IGNORE INTO sentence_vocab (sentence_id, vocab_id) VALUES (?, ?)');
    for (const s of sentences) {
      const target = s.head ? byHead.get(normalize(s.head)) ?? null : null;
      if (s.head && target == null) log(`  ! sentence head not in vocab: ${s.head}`);
      const ex = find.get(s.arabic) as { id: number } | undefined;
      let id: number;
      if (ex) {
        upd.run(s.translit, s.english, s.tier, target, s.chunks ? JSON.stringify(s.chunks) : null, s.notes, ex.id);
        id = ex.id;
      } else {
        id = Number(ins.run(s.arabic, s.translit, s.english, s.tier, target, s.chunks ? JSON.stringify(s.chunks) : null, s.notes).lastInsertRowid);
      }
      keep.add(s.arabic);
      d.prepare('DELETE FROM sentence_vocab WHERE sentence_id = ?').run(id);
      for (const vid of vocabIdsIn(s.arabic, lex)) link.run(id, vid);
      if (target) link.run(id, target);
    }
    const all = d.prepare('SELECT id, arabic FROM sentences').all() as { id: number; arabic: string }[];
    for (const r of all) if (!keep.has(r.arabic)) d.prepare('DELETE FROM sentences WHERE id = ?').run(r.id);

    const upC = d.prepare(`INSERT INTO content_items (slug, section, kind, title, title_ar, difficulty, topic, body, questions, verified, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,?)
      ON CONFLICT(slug) DO UPDATE SET section=excluded.section, kind=excluded.kind, title=excluded.title, title_ar=excluded.title_ar,
        difficulty=excluded.difficulty, topic=excluded.topic, body=excluded.body, questions=excluded.questions`);
    for (const c of [...input, ...chats]) {
      upC.run(c.slug, c.section, c.kind, c.title, c.title_ar, c.difficulty, c.topic, JSON.stringify({ lines: c.lines, me: c.me }), JSON.stringify(c.questions), Date.now());
    }
    for (const s of scenarios) {
      upC.run(s.slug, 'scenario', 'scenario', s.title, s.title_ar, 2, s.topic, JSON.stringify({ turns: s.turns, curveballs: s.curveballs }), '[]', Date.now());
    }
  });
  log(`Seeded ${vocab.length} vocab, ${sentences.length} sentences, ${input.length} input items, ${chats.length} chats, ${scenarios.length} scenarios.`);
  return { lex, vocab: vocab.length };
}

/** Report Arabic tokens in all content that the analyzer cannot gloss (content QA). */
export function coverageReport(d: DB) {
  loadNames();
  const lex = buildLexicon(d);
  const texts: string[] = [];
  for (const s of parseSentences()) texts.push(s.arabic);
  for (const c of [...parseInput(), ...parseChats()]) for (const l of c.lines) texts.push(l.ar);
  const unknown = new Map<string, number>();
  let total = 0;
  for (const t of texts) {
    for (const a of analyzeSentence(lex, t)) {
      if (!a.norm || !/[\u0621-\u064A]/.test(a.norm)) continue;
      total++;
      if (!a.entry && !a.mwe && a.kind !== 'exact') unknown.set(a.norm, (unknown.get(a.norm) || 0) + 1);
    }
  }
  return { total, unknown: [...unknown.entries()].sort((a, b) => b[1] - a[1]) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = openDb();
  seed(d);
  if (process.argv.includes('--coverage')) {
    const r = coverageReport(d);
    const unk = r.unknown.reduce((s, [, c]) => s + c, 0);
    console.log(`Token coverage: ${(100 * (1 - unk / r.total)).toFixed(1)}% of ${r.total} tokens. Unknown forms: ${r.unknown.length}`);
    console.log(r.unknown.map(([w, c]) => `${w}(${c})`).join(' '));
  }
}
