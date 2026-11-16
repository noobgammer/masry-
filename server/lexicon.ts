import type { DB } from './db.ts';
import { db } from './db.ts';
import { analyzeSentence, analyzeWord, normalize, type Analysis, type LexEntry, type Lexicon } from './arabic.ts';

let cached: Lexicon | null = null;

export function buildLexicon(d: DB): Lexicon {
  const rows = d
    .prepare('SELECT l.form, v.id, v.arabic, v.translit, v.english, v.pos, v.rank FROM lexicon l JOIN vocab v ON v.id = l.vocab_id')
    .all() as unknown as (LexEntry & { form: string })[];
  const forms = new Map<string, LexEntry[]>();
  const mwe = new Map<string, LexEntry>();
  let maxMweLen = 1;
  for (const r of rows) {
    const e: LexEntry = { id: r.id, arabic: r.arabic, translit: r.translit, english: r.english, pos: r.pos, rank: r.rank };
    if (r.form.includes(' ')) {
      const prev = mwe.get(r.form);
      if (!prev || prev.rank > e.rank) mwe.set(r.form, e);
      maxMweLen = Math.max(maxMweLen, r.form.split(' ').length);
    } else {
      const list = forms.get(r.form) || [];
      list.push(e);
      forms.set(r.form, list);
    }
  }
  return { forms, mwe, maxMweLen };
}

export function lexicon(): Lexicon {
  if (!cached) cached = buildLexicon(db());
  return cached;
}
export function resetLexicon() {
  cached = null;
}

export function gloss(text: string): Analysis[] {
  return analyzeSentence(lexicon(), text);
}
export function glossWord(word: string): Analysis {
  return analyzeWord(lexicon(), word);
}

/** Vocab ids that occur in a text (via analyzer + MWEs). */
export function vocabIdsIn(text: string, lex: Lexicon = lexicon()): number[] {
  const ids = new Set<number>();
  for (const a of analyzeSentence(lex, text)) {
    if (a.entry) ids.add(a.entry.id);
    if (a.mwe) ids.add(a.mwe.entry.id);
  }
  return [...ids];
}

export { normalize };
