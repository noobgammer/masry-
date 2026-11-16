// Arabic text utilities: normalization, tokenization, a light Egyptian
// morphological analyzer (clitic stripping against the lexicon) and the
// word-level dictation diff. Pure functions — shared by server and tests.

const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g; // tashkeel + tatweel
const PUNCT = /[،؛؟٪-٭۔.,!?;:"'«»()\[\]{}…\-–—_*\/\\|~`@#$%^&+=<>]/g;

/** Normalize for matching: strip diacritics, unify alef/ya/ta-marbuta/hamza seats. */
export function normalize(s: string): string {
  return s
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Token {
  text: string; // surface incl. attached punctuation
  core: string; // without punctuation
  norm: string; // normalized
}

export function tokenize(s: string): Token[] {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => {
      const core = text.replace(PUNCT, '');
      return { text, core, norm: normalize(core) };
    })
    .filter((t) => t.core.length > 0 || t.text.length > 0);
}

export const isArabic = (s: string) => /[؀-ۿ]/.test(s);

// ---------------------------------------------------------------------------
// Morphological analyzer
// ---------------------------------------------------------------------------

export interface LexEntry {
  id: number;
  arabic: string;
  translit: string;
  english: string;
  pos: string;
  rank: number;
}

export interface Lexicon {
  /** normalized form -> entries */
  forms: Map<string, LexEntry[]>;
  /** normalized multi-word expressions -> entry (key is space-joined) */
  mwe: Map<string, LexEntry>;
  maxMweLen: number;
}

export interface Part {
  text: string;
  gloss: string;
  role: 'prefix' | 'stem' | 'suffix';
}

export interface Analysis {
  surface: string;
  norm: string;
  entry: LexEntry | null;
  parts: Part[];
  /** exact = whole word in lexicon; derived = via clitic stripping; unknown */
  kind: 'exact' | 'derived' | 'unknown';
  /** other lexicon entries with the same written form (homographs, e.g. مية = water / hundred) */
  alts?: LexEntry[];
  /** index span when part of a multi-word expression */
  mwe?: { start: number; end: number; entry: LexEntry };
}

// Proclitics (normalized). Order matters only for gloss text.
const PREFIXES: { p: string; gloss: string; verbOnly?: boolean; nounOnly?: boolean }[] = [
  { p: 'و', gloss: 'and' },
  { p: 'ف', gloss: 'so / then' },
  { p: 'ه', gloss: 'will (future ha-)', verbOnly: true },
  { p: 'ح', gloss: 'will (future ḥa-)', verbOnly: true },
  { p: 'ب', gloss: 'b- (habitual/present) · or "with / in"' },
  { p: 'م', gloss: 'ma- (negation, with -sh)' },
  { p: 'ما', gloss: 'ma- (negation)' },
  { p: 'ل', gloss: 'to / for' },
  { p: 'ك', gloss: 'like / as' },
  { p: 'ع', gloss: '3a- (on / to, short for على)' },
  { p: 'ال', gloss: 'the', nounOnly: true },
  { p: 'لل', gloss: 'to the / for the', nounOnly: true },
];

const SUFFIXES: { s: string; gloss: string }[] = [
  { s: 'ش', gloss: '-sh (negation, with ma-)' },
  { s: 'ني', gloss: 'me' },
  { s: 'نا', gloss: 'us / we' },
  { s: 'ك', gloss: 'you / your' },
  { s: 'كي', gloss: 'you / your (f.)' },
  { s: 'كو', gloss: 'you / your (pl.)' },
  { s: 'كم', gloss: 'you / your (pl.)' },
  { s: 'ه', gloss: 'him / his / it  ·  or feminine -a' },
  { s: 'ها', gloss: 'her / it' },
  { s: 'هم', gloss: 'them / their' },
  { s: 'ي', gloss: 'my / me  ·  or feminine "you"' },
  { s: 'يا', gloss: 'me / my (after a vowel)' },
  { s: 'ايا', gloss: 'me / my (after a vowel)' },
  { s: 'اك', gloss: 'you / your (after a vowel)' },
  { s: 'اه', gloss: 'him / it (after a vowel)' },
  { s: 'اها', gloss: 'her (after a vowel)' },
  { s: 'اهم', gloss: 'them (after a vowel)' },
  { s: 'انا', gloss: 'us (after a vowel)' },
  { s: 'لي', gloss: 'to me / for me' },
  { s: 'ليا', gloss: 'to me / for me' },
  { s: 'لك', gloss: 'to you' },
  { s: 'له', gloss: 'to him' },
  { s: 'لو', gloss: 'to him' },
  { s: 'لها', gloss: 'to her' },
  { s: 'ليها', gloss: 'to her' },
  { s: 'لنا', gloss: 'to us' },
  { s: 'لينا', gloss: 'to us' },
  { s: 'لهم', gloss: 'to them' },
  { s: 'ليهم', gloss: 'to them' },
  { s: 'ليكو', gloss: 'to you (pl.)' },
  { s: 'و', gloss: '-u (they / plural)' },
  { s: 'وا', gloss: '-u (they / plural)' },
  { s: 'ين', gloss: '-iin (plural / feminine)' },
  { s: 'ات', gloss: '-aat (plural)' },
  { s: 'ت', gloss: '-t (I / you, past)' },
  { s: 'تي', gloss: '-ti (you f., past · or "my" on -a nouns)' },
  { s: 'تو', gloss: '-tu (you pl., past)' },
];

const VERBISH = (pos: string) => /verb|aux|modal/i.test(pos);
const NOUNISH = (pos: string) => /noun|adj|number|name|place/i.test(pos);

function prefixCombos(word: string): { rest: string; parts: Part[]; verbOnly: boolean; nounOnly: boolean }[] {
  const out: { rest: string; parts: Part[]; verbOnly: boolean; nounOnly: boolean }[] = [
    { rest: word, parts: [], verbOnly: false, nounOnly: false },
  ];
  // up to 3 stacked proclitics (e.g. و+ب+ال = "wa-bi-l")
  for (let depth = 0; depth < 3; depth++) {
    const next: typeof out = [];
    for (const c of out) {
      if (c.parts.length !== depth) continue;
      for (const pr of PREFIXES) {
        if (c.rest.startsWith(pr.p) && c.rest.length - pr.p.length >= 2) {
          next.push({
            rest: c.rest.slice(pr.p.length),
            parts: [...c.parts, { text: pr.p, gloss: pr.gloss, role: 'prefix' }],
            verbOnly: c.verbOnly || !!pr.verbOnly,
            nounOnly: c.nounOnly || !!pr.nounOnly,
          });
        }
      }
    }
    out.push(...next);
  }
  return out;
}

function suffixCombos(word: string): { rest: string; parts: Part[] }[] {
  const out: { rest: string; parts: Part[] }[] = [{ rest: word, parts: [] }];
  for (let depth = 0; depth < 2; depth++) {
    const next: typeof out = [];
    for (const c of out) {
      if (c.parts.length !== depth) continue;
      for (const sf of SUFFIXES) {
        if (c.rest.endsWith(sf.s) && c.rest.length - sf.s.length >= 2) {
          next.push({ rest: c.rest.slice(0, -sf.s.length), parts: [{ text: sf.s, gloss: sf.gloss, role: 'suffix' }, ...c.parts] });
        }
      }
    }
    out.push(...next);
  }
  return out;
}

function lookupStem(lex: Lexicon, stem: string): LexEntry[] {
  const direct = lex.forms.get(stem);
  if (direct) return direct;
  // construct state: عربيت (+ي) -> عربيه
  if (stem.endsWith('ت')) {
    const e = lex.forms.get(stem.slice(0, -1) + 'ه');
    if (e) return e;
  }
  // final vowel lengthening before a suffix: مبتصحاش (تصحى -> تصحا), نسيتها
  if (stem.endsWith('ا')) {
    const e = lex.forms.get(stem.slice(0, -1) + 'ي') || lex.forms.get(stem.slice(0, -1) + 'ه');
    if (e) return e;
  }
  return [];
}

function best(entries: LexEntry[], verbOnly: boolean, nounOnly: boolean): LexEntry | null {
  const ok = entries.filter((e) => (!verbOnly || VERBISH(e.pos)) && (!nounOnly || !VERBISH(e.pos)));
  // "the" + a verb lemma is usually its verbal noun (الأكل = the food) — accept verbs as a fallback
  const pool = ok.length ? ok : nounOnly && !verbOnly ? entries : [];
  if (!pool.length) return null;
  return pool.reduce((a, b) => (a.rank <= b.rank ? a : b));
}

export const NAMES = new Set<string>();
const SPECIAL: [RegExp, string][] = [
  [/^ه{3,}$/, 'haha (laughter)'],
  [/^[\u0660-\u0669\d]+$/, '(number)'],
];

export function analyzeWord(lex: Lexicon, surface: string): Analysis {
  const norm = normalize(surface);
  for (const [re, gloss] of SPECIAL) if (re.test(norm)) return { surface, norm, entry: null, parts: [{ text: norm, gloss, role: 'stem' }], kind: 'exact' };
  if (NAMES.has(norm) || (norm.startsWith('و') && NAMES.has(norm.slice(1))))
    return { surface, norm, entry: null, parts: [{ text: norm, gloss: '(name)', role: 'stem' }], kind: 'exact' };
  const exact = lex.forms.get(norm);
  if (exact && exact.length) {
    const sorted = [...exact].sort((a, b) => a.rank - b.rank);
    const entry = sorted[0];
    const alts = sorted.slice(1).filter((e) => e.id !== entry.id);
    return { surface, norm, entry, parts: [{ text: norm, gloss: entry.english, role: 'stem' }], kind: 'exact', ...(alts.length ? { alts } : {}) };
  }
  let bestCand: { entry: LexEntry; parts: Part[]; score: number } | null = null;
  for (const pc of prefixCombos(norm)) {
    for (const sc of suffixCombos(pc.rest)) {
      const stem = sc.rest;
      if (stem.length < 2) continue;
      let entries = lookupStem(lex, stem);
      let personPart: Part | null = null;
      // imperfect person prefix after b-/ha-: بيروح = ب + ي + روح
      if (!entries.length && /^[يتنا]/.test(stem) && stem.length >= 3) {
        const e2 = lookupStem(lex, stem.slice(1));
        if (e2.some((e) => VERBISH(e.pos))) {
          entries = e2.filter((e) => VERBISH(e.pos));
          const person = { ي: 'he / they (y-)', ت: 'you / she (t-)', ن: 'we (n-)', ا: 'I (a-)' }[stem[0] as 'ي'];
          personPart = { text: stem[0], gloss: person, role: 'prefix' };
        }
      }
      if (!entries.length) continue;
      const e = best(entries, pc.verbOnly, pc.nounOnly);
      if (!e) continue;
      const affixes = pc.parts.length + sc.parts.length + (personPart ? 1 : 0);
      // fewer affixes and longer stems win; frequent lemmas break ties
      const score = stem.length * 3 - affixes * 3 - e.rank / 5000;
      if (!bestCand || score > bestCand.score) {
        const suffixParts = sc.parts.map((p) => fixSuffixGloss(p, e, pc.parts));
        bestCand = {
          entry: e,
          score,
          parts: [...pc.parts.map((p) => fixPrefixGloss(p, e, sc.parts)), ...(personPart ? [personPart] : []), { text: personPart ? stem.slice(1) : stem, gloss: e.english, role: 'stem' }, ...suffixParts],
        };
      }
    }
  }
  if (bestCand) return { surface, norm, entry: bestCand.entry, parts: bestCand.parts, kind: 'derived' };
  return { surface, norm, entry: null, parts: [], kind: 'unknown' };
}

function fixPrefixGloss(p: Part, e: LexEntry, suffixes: Part[]): Part {
  if (p.text === 'ب') return { ...p, gloss: VERBISH(e.pos) ? 'b- (present / habitual)' : 'with / in / by' };
  if (p.text === 'م' && suffixes.some((s) => s.text === 'ش')) return { ...p, gloss: 'ma- … -sh = NOT' };
  if (p.text === 'م' && !suffixes.some((s) => s.text === 'ش')) return { ...p, gloss: 'm- (participle / negation)' };
  return p;
}
function fixSuffixGloss(p: Part, e: LexEntry, prefixes: Part[]): Part {
  if (p.text === 'ه') return { ...p, gloss: NOUNISH(e.pos) && !VERBISH(e.pos) ? '-a (feminine) · or "his"' : 'him / it (-uh)' };
  if (p.text === 'ش' && prefixes.some((x) => x.text === 'م')) return { ...p, gloss: 'ma- … -sh = NOT' };
  return p;
}

/** Analyze a whole sentence, marking multi-word expressions. */
export function analyzeSentence(lex: Lexicon, text: string): Analysis[] {
  const toks = tokenize(text);
  const res = toks.map((t) => analyzeWord(lex, t.core || t.text));
  res.forEach((r, i) => (r.surface = toks[i].text));
  for (let i = 0; i < toks.length; i++) {
    for (let len = Math.min(lex.maxMweLen, toks.length - i); len >= 2; len--) {
      const key = toks.slice(i, i + len).map((t) => t.norm).join(' ');
      const e = lex.mwe.get(key);
      if (e) {
        for (let k = i; k < i + len; k++) res[k].mwe = { start: i, end: i + len - 1, entry: e };
        i += len - 1;
        break;
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Dictation diff
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export type DiffOp =
  | { op: 'match'; ref: string; got: string; variant?: boolean }
  | { op: 'misspelled'; ref: string; got: string }
  | { op: 'confused'; ref: string; got: string; gotMeaning?: string }
  | { op: 'wrong'; ref: string; got: string }
  | { op: 'missing'; ref: string }
  | { op: 'extra'; got: string };

export interface DictationResult {
  ops: DiffOp[];
  score: number; // 0..1
  counts: Record<'match' | 'misspelled' | 'confused' | 'wrong' | 'missing' | 'extra', number>;
}

const isSpellingSlip = (a: string, b: string) => {
  const d = levenshtein(a, b);
  return d > 0 && d <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3));
};

/**
 * Align what the learner typed against the reference transcript (token level).
 * Spelling variants that map to the same lexicon entry (e.g. عشان / علشان) count as matches.
 */
export function diffDictation(reference: string, typed: string, lex?: Lexicon): DictationResult {
  const R = tokenize(reference).filter((t) => t.norm);
  const T = tokenize(typed).filter((t) => t.norm);
  const sameLemma = (a: string, b: string) => {
    if (!lex) return false;
    const ea = analyzeWord(lex, a).entry, eb = analyzeWord(lex, b).entry;
    return !!ea && !!eb && ea.id === eb.id && analyzeWord(lex, a).parts.length === analyzeWord(lex, b).parts.length;
  };
  const subCost = (r: string, t: string) => (r === t ? 0 : sameLemma(r, t) ? 0.1 : isSpellingSlip(r, t) ? 0.6 : 1.2);
  const m = R.length, n = T.length;
  const D: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) D[i][0] = i;
  for (let j = 1; j <= n; j++) D[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + subCost(R[i - 1].norm, T[j - 1].norm));
  const ops: DiffOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + subCost(R[i - 1].norm, T[j - 1].norm))) < 1e-9) {
      const r = R[i - 1], t = T[j - 1];
      if (r.norm === t.norm) ops.push({ op: 'match', ref: r.core, got: t.core });
      else if (sameLemma(r.norm, t.norm)) ops.push({ op: 'match', ref: r.core, got: t.core, variant: true });
      else if (isSpellingSlip(r.norm, t.norm)) ops.push({ op: 'misspelled', ref: r.core, got: t.core });
      else {
        const a = lex ? analyzeWord(lex, t.norm) : null;
        if (a && a.entry) ops.push({ op: 'confused', ref: r.core, got: t.core, gotMeaning: a.entry.english });
        else ops.push({ op: 'wrong', ref: r.core, got: t.core });
      }
      i--; j--;
    } else if (i > 0 && (j === 0 || Math.abs(D[i][j] - (D[i - 1][j] + 1)) < 1e-9)) {
      ops.push({ op: 'missing', ref: R[i - 1].core });
      i--;
    } else {
      ops.push({ op: 'extra', got: T[j - 1].core });
      j--;
    }
  }
  ops.reverse();
  const counts = { match: 0, misspelled: 0, confused: 0, wrong: 0, missing: 0, extra: 0 };
  ops.forEach((o) => counts[o.op]++);
  const score = m ? Math.max(0, (counts.match + 0.6 * counts.misspelled - 0.25 * counts.extra) / m) : 0;
  return { ops, counts, score: Math.min(1, score) };
}

/** Chunk boundaries for segmentation: returns indices of tokens that START a new chunk (excluding 0). */
export function chunkBoundaries(chunked: string): { text: string; boundaries: number[] } {
  const chunks = chunked.split('/').map((c) => c.trim()).filter(Boolean);
  const boundaries: number[] = [];
  let count = 0;
  chunks.forEach((c, k) => {
    if (k > 0) boundaries.push(count);
    count += tokenize(c).length;
  });
  return { text: chunks.join(' '), boundaries };
}
