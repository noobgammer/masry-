// Drafts additional frequency vocabulary (levels 4–6) with Claude, written to content/vocab/90-draft-*.txt.
// Every drafted entry is stored as UNVERIFIED (shown with a badge) until a native speaker reviews it —
// move reviewed lines into a non-"draft" file and re-run `npm run seed`.
// Usage: ANTHROPIC_API_KEY=... npx tsx scripts/draft-vocab.ts --count 250 --batch 50
import '../server/env.ts';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { parseVocab } from '../server/seed.ts';
import { ROOT } from '../server/db.ts';

const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? Number(process.argv[i + 1]) : d; };
const total = arg('count', 250), batch = arg('batch', 50);
const client = new Anthropic();
const existing = parseVocab();
const known = new Set(existing.map((v) => v.arabic));
const out = path.join(ROOT, 'content/vocab', `90-draft-${Date.now()}.txt`);
fs.writeFileSync(out, '# AI-drafted vocabulary — UNVERIFIED. Review with a native speaker before moving to a normal file.\n');

for (let made = 0; made < total; made += batch) {
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: `You are an expert lexicographer of Egyptian Colloquial Arabic (Cairene). You produce frequency-ordered vocabulary of SPOKEN Egyptian Arabic — never MSA-only words.`,
    messages: [{ role: 'user', content: `The learner already has these ${known.size} words (most frequent first): ${[...known].join('، ')}

Give the next ${batch} most frequent words/expressions of everyday spoken Egyptian Arabic that are NOT in that list, in descending frequency.
Output ONLY lines in this exact pipe format (9 fields, no header):
arabic | translit (Franco: 3=ع 7=ح 2=ء/ق kh sh gh) | english | pos | category | comma-separated common inflected forms | natural Egyptian example sentence | English translation | usage notes / alternative meanings` }],
  } as any);
  if ((res as any).stop_reason === 'refusal') throw new Error('refused');
  const text = (res.content as any[]).map((b) => (b.type === 'text' ? b.text : '')).join('');
  const lines = text.split('\n').filter((l) => l.split('|').length === 9 && !known.has(l.split('|')[0].trim()));
  lines.forEach((l) => known.add(l.split('|')[0].trim()));
  fs.appendFileSync(out, lines.join('\n') + '\n');
  console.log(`+${lines.length} (total ${known.size})`);
}
console.log(`Wrote ${out}. Run "npm run seed" to load (entries appear as unverified).`);
