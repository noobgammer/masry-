import { describe, it, expect, beforeAll } from 'vitest';
import { normalize, diffDictation, chunkBoundaries, analyzeSentence, analyzeWord } from '../server/arabic.ts';
import { schedule, newCard, knownCard } from '../server/srs.ts';
import { openDb, setDb } from '../server/db.ts';
import { seed } from '../server/seed.ts';
import { buildLexicon } from '../server/lexicon.ts';

let lex: ReturnType<typeof buildLexicon>;
beforeAll(() => {
  const d = openDb(':memory:');
  setDb(d);
  seed(d, () => {});
  lex = buildLexicon(d);
});

describe('normalize', () => {
  it('unifies alef, ta marbuta, ya and strips diacritics/punctuation', () => {
    expect(normalize('إِنتَ عايزة؟')).toBe('انت عايزه');
    expect(normalize('مستشفى')).toBe('مستشفي');
  });
});

describe('analyzer', () => {
  const parts = (w: string) => analyzeWord(lex, w).parts.map((p) => p.text);
  it('finds exact words and variants', () => {
    expect(analyzeWord(lex, 'عايزة').entry?.arabic).toBe('عايز');
    expect(analyzeWord(lex, 'علشان').entry?.arabic).toBe('عشان');
  });
  it('strips ma-...-sh negation', () => {
    const a = analyzeWord(lex, 'مكنتش');
    expect(a.entry?.arabic).toContain('كان');
    expect(parts('مكنتش')).toEqual(['م', 'كنت', 'ش']);
  });
  it('handles b- present + person prefix', () => {
    expect(analyzeWord(lex, 'بتعلم').entry?.arabic).toContain('اتعلم');
    expect(analyzeWord(lex, 'بيروح').entry?.arabic).toContain('راح');
    expect(analyzeWord(lex, 'هنروح').entry?.arabic).toContain('راح');
  });
  it('handles the article and conjunction', () => {
    expect(analyzeWord(lex, 'والموبايل').entry?.arabic).toBe('موبايل');
  });
  it('detects multi-word expressions', () => {
    const r = analyzeSentence(lex, 'لو سمحت، الحساب');
    expect(r[0].mwe?.entry.arabic).toBe('لو سمحت');
    expect(r[1].mwe?.entry.arabic).toBe('لو سمحت');
  });
  it('reports homographs as alternatives', () => {
    const a = analyzeWord(lex, 'مية');
    const all = [a.entry!, ...(a.alts || [])].map((e) => e.english);
    expect(all.some((e) => /water/.test(e))).toBe(true);
    expect(all.some((e) => /hundred/.test(e))).toBe(true);
  });
});

describe('dictation diff', () => {
  it('classifies missing, misspelled, extra and variant spellings', () => {
    const r = diffDictation('أنا كنت عايز أروح الجيم بس صحيت متأخر', 'انا عايز اروح الجم علشان صحيت متاخر', lex);
    const ops = r.ops.map((o) => o.op);
    expect(ops).toContain('missing'); // كنت
    expect(ops).toContain('misspelled'); // الجم
    expect(r.counts.match).toBeGreaterThanOrEqual(4);
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.score).toBeLessThan(1);
  });
  it('treats lemma spelling variants as matches', () => {
    const r = diffDictation('مجيتش عشان كنت تعبان', 'مجيتش علشان كنت تعبان', lex);
    expect(r.score).toBe(1);
  });
  it('perfect answer scores 1', () => {
    expect(diffDictation('خلاص، نتقابل بكره.', 'خلاص نتقابل بكرة', lex).score).toBe(1);
  });
});

describe('segmentation chunks', () => {
  it('computes boundaries', () => {
    const r = chunkBoundaries('أنا كنت عايز أروح الجيم / بس صحيت متأخر / ومكانش عندي وقت');
    expect(r.boundaries).toEqual([5, 8]);
  });
});

describe('srs', () => {
  it('graduates through learning steps then grows intervals', () => {
    const t = Date.now();
    let c = newCard(t);
    c = schedule(c, 3, t);
    expect(c.state).toBe('learning');
    c = schedule(c, 3, t);
    expect(c.state).toBe('review');
    expect(c.interval_days).toBe(1);
    const c2 = schedule(c, 3, c.due);
    expect(c2.interval_days).toBeGreaterThanOrEqual(2);
  });
  it('lapses go to relearning and count', () => {
    const t = Date.now();
    const c = schedule(knownCard(t, 10), 1, t + 10 * 86400000);
    expect(c.state).toBe('relearning');
    expect(c.lapses).toBe(1);
    expect(c.interval_days).toBe(5);
  });
});
