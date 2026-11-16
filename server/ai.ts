// Claude-powered features: conversation partner (with silent per-turn evaluation),
// unpredictable follow-up questions, end-of-conversation feedback, and draft translations for imports.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.MASRY_MODEL || 'claude-opus-5-5';
let client: Anthropic | null = null;

export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export class AIUnavailable extends Error {}

/** One JSON-structured call. Uses server-side refusal fallback and low effort (chat latency matters). */
async function jsonCall<T>(system: string, messages: Anthropic.Beta.BetaMessageParam[], schema: Record<string, unknown>, effort: 'low' | 'medium' = 'low', maxTokens = 4000): Promise<T> {
  if (!aiEnabled()) throw new AIUnavailable('ANTHROPIC_API_KEY is not set');
  const res = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { effort, format: { type: 'json_schema', schema } },
  } as any);
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Could not parse the AI response.');
  }
}

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const arr = (items: unknown) => ({ type: 'array', items });

const DIALECT_RULES = `LANGUAGE RULES (strict):
- Write ONLY Egyptian Colloquial Arabic (Cairene عامية) in Arabic script — never Modern Standard Arabic.
  Use Egyptian forms: عايز not أريد, إزاي not كيف, فين not أين, دلوقتي not الآن, مش not ليس/لا, ده/دي not هذا/هذه, إيه not ماذا, بـ-present (بيروح), هـ-future (هيروح), negation ما...ش (مبروحش).
- Spell the way young Egyptians actually write: casual, no full diacritics.
- Never translate or switch to English unless the learner explicitly asks in English for English/explanation.`;

const MODES: Record<string, string> = {
  learning: `MODE: Learning. Short turns (1–2 sentences, max ~14 words each), very common vocabulary, one clear question at a time. Still 100% natural Egyptian — just simple, not textbook.`,
  natural: `MODE: Natural. Talk like a friendly Egyptian in normal conversation: 1–3 sentences, normal fillers (يعني، بص، طب، والله) where natural, everyday idioms.`,
  challenge: `MODE: Challenge. Talk like an Egyptian friend who forgets you're a learner: fast and spontaneous, slang (يا عم، يا باشا، جامد، تحفة، فاكس — but no vulgarity), fillers, false starts, longer turns, jokes and teasing, tangents, idioms (على فكرة، ولا يهمك، إيه الحكاية). Do NOT simplify. Sometimes ask two things at once or change subject abruptly, as real people do.`,
};

export interface Evaluation {
  applicable: boolean;
  understandable: number;
  naturalness: number;
  answered_question: boolean;
  corrections: { original: string; corrected: string; explanation: string }[];
  more_natural: string;
  notes: string;
}
export interface TurnResult { reply: string; reply_translit: string; reply_en: string; evaluation: Evaluation }

const evalSchema = obj({
  applicable: bool,
  understandable: num,
  naturalness: num,
  answered_question: bool,
  corrections: arr(obj({ original: str, corrected: str, explanation: str })),
  more_natural: str,
  notes: str,
});

export async function conversationTurn(opts: { topic: string; mode: string; history: { role: 'user' | 'assistant'; content: string }[]; learnerName?: string }): Promise<TurnResult> {
  const system = `You are Youssef (يوسف), a 27-year-old from Shubra, Cairo, who works in marketing, plays five-a-side football, goes to the gym, supports Al Ahly, loves koshari and is easy-going and funny.
You are chatting with ${opts.learnerName || 'a friend'} — a Pakistani who grew up in Saudi Arabia and has been learning Egyptian Arabic for a year. Treat them as a friend, not a student.
Topic to start from: ${opts.topic}. Let the conversation drift naturally like real chats do.

${DIALECT_RULES}
${MODES[opts.mode] || MODES.natural}

CONVERSATION RULES:
- Keep the conversation going: react to what they said, share something about yourself, then ask a follow-up.
- About one turn in three, ask a follow-up they could NOT easily predict (a detail, an opinion, a hypothetical, a related tangent) — this trains real listening instead of guessing.
- Never correct their Arabic inside your reply and never comment on their language level. Corrections go only in "evaluation".
- If they write in English or say they don't understand, rephrase more simply in Egyptian Arabic (still no English unless they explicitly ask for English).
- Religion is fine to discuss respectfully; avoid vulgarity.

OUTPUT (JSON):
- reply: your message in Egyptian Arabic.
- reply_translit: Franco/Latin transliteration of your reply (3=ع, 7=ح, 2=ء/ق, 5 or kh=خ, sh=ش, gh=غ).
- reply_en: natural English translation of your reply (shown only if the learner asks).
- evaluation: assess ONLY the learner's latest message (set applicable=false if there is none or it was English):
  understandable (0–100: would an Egyptian understand it without effort?), naturalness (0–100: does it sound Egyptian rather than MSA/Gulf/translated?),
  answered_question (did it actually respond to what you asked?), corrections (grammar/wrong word/MSA→Egyptian; original fragment, corrected Egyptian, short English explanation; empty if none — ignore spelling of casual chat),
  more_natural (how an Egyptian would most naturally say the whole thing), notes (one short English tip, or "").`;
  const messages = opts.history.length ? opts.history : [{ role: 'user' as const, content: '(The learner has just joined. Open the conversation naturally about the topic.)' }];
  const schema = obj({ reply: str, reply_translit: str, reply_en: str, evaluation: evalSchema });
  return jsonCall<TurnResult>(system, messages, schema);
}

export interface UnexpectedResult {
  question: string;
  question_en: string;
  sample_answer: string;
  sample_answer_en: string;
  evaluation: { applicable: boolean; addressed: boolean; understandable: number; comment_en: string; better_answer: string };
}

export async function unexpectedNext(opts: { topic: string; history: { q: string; a: string }[]; mode: string }): Promise<UnexpectedResult> {
  const system = `You generate the next line an Egyptian would say in a casual conversation, for a listening drill that trains learners NOT to rely on predicting questions.
Topic: ${opts.topic}.
${DIALECT_RULES}
${MODES[opts.mode] || MODES.natural}
Rules for "question": it must follow naturally from the learner's last answer, but be hard to predict — pick a specific detail, a surprising angle, a hypothetical, a related tangent, or a mild tease. Avoid the generic next question a textbook would ask. Vary the form (not always a question: sometimes a statement they must react to). Max ~20 words.
Also give: question_en (English), sample_answer (a natural short Egyptian answer the learner could give), sample_answer_en.
evaluation: assess the learner's LAST answer to the previous question (applicable=false if none): addressed (did it respond to what was actually asked?), understandable (0–100), comment_en (one short English sentence), better_answer (natural Egyptian version).`;
  const transcript = opts.history.map((h, i) => `Q${i + 1}: ${h.q}\nLearner: ${h.a}`).join('\n');
  const schema = obj({
    question: str, question_en: str, sample_answer: str, sample_answer_en: str,
    evaluation: obj({ applicable: bool, addressed: bool, understandable: num, comment_en: str, better_answer: str }),
  });
  return jsonCall<UnexpectedResult>(system, [{ role: 'user', content: transcript || '(No questions yet — produce the opening question.)' }], schema);
}

export interface Summary { overall_en: string; strengths: string[]; focus_points: string[]; corrections: { original: string; corrected: string; explanation: string }[]; useful_phrases: { ar: string; en: string }[] }

export async function conversationSummary(messages: { role: string; content: string }[], evaluations: Evaluation[]): Promise<Summary> {
  const system = `You are an expert teacher of Egyptian Colloquial Arabic giving feedback AFTER a conversation (never during). The learner is an Urdu speaker fluent in English, with Saudi exposure, ~1 year of Egyptian.
Be specific and encouraging but honest. Prioritise the 3–5 most useful corrections (patterns over typos), flag MSA or Gulf forms and give the Egyptian equivalent, and pick 4–6 useful Egyptian phrases from the conversation (or that would have helped) to learn.
All Arabic must be Egyptian Colloquial. Explanations in English.`;
  const content = `Conversation:\n${messages.map((m) => `${m.role === 'user' ? 'Learner' : 'Youssef'}: ${m.content}`).join('\n')}\n\nPer-turn notes:\n${JSON.stringify(evaluations.filter((e) => e?.applicable))}`;
  const schema = obj({
    overall_en: str, strengths: arr(str), focus_points: arr(str),
    corrections: arr(obj({ original: str, corrected: str, explanation: str })),
    useful_phrases: arr(obj({ ar: str, en: str })),
  });
  return jsonCall<Summary>(system, [{ role: 'user', content }], schema, 'medium');
}

/** Draft English translations for imported transcripts. Marked unverified in the UI. */
export async function translateLines(lines: string[]): Promise<string[]> {
  const system = `Translate each line of Egyptian Colloquial Arabic into natural English. Keep slang/idioms' real meaning (not literal). Return exactly one translation per input line, same order.`;
  const schema = obj({ translations: arr(str) });
  const r = await jsonCall<{ translations: string[] }>(system, [{ role: 'user', content: lines.map((l, i) => `${i + 1}. ${l}`).join('\n') }], schema, 'low', 16000);
  return lines.map((_, i) => r.translations[i] || '');
}

/** Comprehension questions for imported content (Arabic, Egyptian). */
export async function makeQuestions(lines: string[]): Promise<{ q: string; q_en: string; options: string[]; answer: number }[]> {
  const system = `Write 3 multiple-choice comprehension questions IN EGYPTIAN COLLOQUIAL ARABIC about this transcript, testing gist and key details (not trivia). Each has 4 short options in Egyptian Arabic; put the correct option FIRST. Also give the question in English.
${DIALECT_RULES}`;
  const schema = obj({ questions: arr(obj({ q: str, q_en: str, options: arr(str) })) });
  const r = await jsonCall<{ questions: { q: string; q_en: string; options: string[] }[] }>(system, [{ role: 'user', content: lines.join('\n') }], schema, 'low', 8000);
  return r.questions.map((q) => ({ ...q, answer: 0 }));
}
