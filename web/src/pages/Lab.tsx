import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Check, ChevronRight, Gauge, Keyboard, Mic, MicOff, Scissors, Shuffle, Sparkles, Turtle, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { play, randomVoice, stop, type VoiceKey } from '../lib/audio';
import { useApi, usePlanBlock, useSpeechRecognition } from '../lib/hooks';
import { useApp, useSettings } from '../lib/store';
import { ArabicText, ErrorBox, Notice, PageHeader, PlayButton, SpeedControl, Spinner, Support } from '../components/ui';

const DRILLS = [
  { to: 'dictation', icon: Keyboard, title: 'Dictation', ar: 'إملاء', desc: 'Hear a sentence, type exactly what you heard. See missing, misheard and confused words.' },
  { to: 'segmentation', icon: Scissors, title: 'Sentence segmentation', ar: 'تقطيع الجملة', desc: 'Split a long sentence into its phrases — learn how Egyptians chain clauses.' },
  { to: 'unexpected', icon: Shuffle, title: 'Unexpected responses', ar: 'رد مش متوقع', desc: "Follow-up questions you can't predict. Stops you guessing instead of listening." },
  { to: 'recognition', icon: Sparkles, title: 'Word recognition', ar: 'التقط الكلمات', desc: 'Which of your words were in that audio? Trains catching words inside fast speech.' },
  { to: 'fast', icon: Gauge, title: 'Fast speech trainer', ar: 'كلام سريع', desc: 'A sentence you understand, getting faster and faster. Find your comfortable speed.' },
];

export default function Lab() {
  usePlanBlock('lab');
  return (
    <Routes>
      <Route index element={<Hub />} />
      <Route path="dictation" element={<Dictation />} />
      <Route path="segmentation" element={<Segmentation />} />
      <Route path="unexpected" element={<Unexpected />} />
      <Route path="recognition" element={<Recognition />} />
      <Route path="fast" element={<Fast />} />
    </Routes>
  );
}

function Hub() {
  return (
    <div>
      <PageHeader title="Listening lab" ar="معمل السمع" sub="Short, intense drills that train your ear — the part of comprehension that reading can't build." />
      <div className="grid gap-3 sm:grid-cols-2">
        {DRILLS.map((d) => (
          <Link key={d.to} to={d.to} className="card group flex gap-4 transition hover:border-nile-400">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-nile-50 text-nile-700 dark:bg-nile-950 dark:text-nile-300"><d.icon /></div>
            <div className="flex-1">
              <div className="font-semibold">{d.title} <span className="ar ms-1 text-sm text-stone-500">{d.ar}</span></div>
              <p className="text-sm text-stone-500">{d.desc}</p>
            </div>
            <ChevronRight className="self-center text-stone-300 group-hover:text-nile-500" />
          </Link>
        ))}
      </div>
    </div>
  );
}

const Back = () => <Link to="/lab" className="text-sm text-nile-700 hover:underline dark:text-nile-400">← Listening lab</Link>;

// ---------------------------------------------------------------- dictation
function Dictation() {
  const s = useSettings();
  const [n, setN] = useState(0);
  const { data: item } = useApi<any>(`/lab/dictation?n=${n}`, [n]);
  const [typed, setTyped] = useState('');
  const [res, setRes] = useState<any>(null);
  const [plays, setPlays] = useState(0);
  const [speed, setSpeed] = useState(s.defaultSpeed);
  const [voice, setVoice] = useState<VoiceKey>('m');
  const [arabicText, setArabicText] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  useEffect(() => {
    setTyped(''); setRes(null); setPlays(0); setVoice(randomVoice()); t0.current = Date.now(); setArabicText(null);
    if (item?.id) api(`/sentences/${item.id}/audio-text`).then((r) => setArabicText(r.arabic)).catch(() => {});
  }, [item?.id]);
  const listen = async (rate = speed) => { if (!arabicText) return; setPlays((p) => p + 1); try { await play(arabicText, { voice, rate }); } catch {} };
  useEffect(() => { if (arabicText) listen(); return () => stop(); }, [arabicText]);
  const submit = async () => setRes(await api('/lab/dictation', { sentence_id: item.id, typed, plays, speed, ms: Date.now() - t0.current }));
  if (!item) return <Spinner />;
  const color: Record<string, string> = { match: 'bg-nile-100 text-nile-900 dark:bg-nile-900 dark:text-nile-100', misspelled: 'bg-sand-100 text-sand-600', confused: 'bg-red-100 text-red-800', wrong: 'bg-red-100 text-red-800', missing: 'bg-stone-200 text-stone-500 line-through', extra: 'bg-purple-100 text-purple-800' };
  return (
    <div className="space-y-4">
      <Back />
      <PageHeader title="Dictation" ar="إملاء" sub={`Type what you hear in Arabic script — ${item.wordCount} words. Casual Egyptian spelling is fine; spelling variants of the same word count as correct.`} />
      <div className="card flex flex-wrap items-center gap-3">
        {arabicText ? <PlayButton text={arabicText} voice={voice} rate={speed} size="lg" onPlayed={() => setPlays((p) => p + 1)} /> : <Spinner />}
        <button className="btn-outline" onClick={() => listen(0.7)}><Turtle size={16} /> Slow</button>
        <span className="text-xs text-stone-500">Played {plays}×</span>
        <div className="flex-1" /><SpeedControl value={speed} onChange={setSpeed} />
      </div>
      <textarea className="input ar min-h-28 text-2xl" dir="rtl" lang="ar" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="اكتب اللي سمعته…" disabled={!!res} />
      {!res ? <button className="btn-primary w-full" disabled={!typed.trim()} onClick={submit}>Check</button> : (
        <div className="card fade-in space-y-4">
          <div className="flex items-baseline gap-3"><span className="text-3xl font-bold">{Math.round(res.score * 100)}%</span><span className="text-sm text-stone-500">{res.counts.match} correct · {res.counts.misspelled} misspelled · {res.counts.missing} missing · {res.counts.confused + res.counts.wrong} misheard · {res.counts.extra} extra</span></div>
          <div className="flex flex-wrap gap-1.5" dir="rtl">
            {res.ops.map((o: any, i: number) => (
              <span key={i} className={`ar rounded-lg px-2 py-1 text-lg ${color[o.op]}`} title={o.op}>
                {o.op === 'extra' ? `+${o.got}` : o.ref}
                {(o.op === 'misspelled' || o.op === 'confused' || o.op === 'wrong') && <span className="ms-1 text-xs opacity-70">({o.got})</span>}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-stone-500" dir="ltr">
            {['match', 'misspelled', 'missing', 'confused', 'extra'].map((k) => <span key={k} className={`rounded px-1.5 ${color[k]}`}>{k === 'confused' ? 'heard as another word' : k}</span>)}
          </div>
          {res.ops.filter((o: any) => o.op === 'confused').map((o: any, i: number) => (
            <p key={i} className="text-sm">You heard <span className="ar font-semibold">{o.got}</span> ({o.gotMeaning}) but it was <span className="ar font-semibold">{o.ref}</span>.</p>
          ))}
          <div className="border-t border-stone-100 pt-3 dark:border-stone-800">
            <ArabicText tokens={res.sentence.tokens} className="text-2xl" context="sentence" />
            <Support translit={res.sentence.translit} english={res.sentence.english} forceEnglish />
          </div>
          <div className="flex gap-2"><button className="btn-outline" onClick={() => listen()}>Listen again</button><button className="btn-primary flex-1" onClick={() => setN(n + 1)}>Next sentence</button></div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- segmentation
function Segmentation() {
  const s = useSettings();
  const [n, setN] = useState(0);
  const { data: item } = useApi<any>(`/lab/segmentation?n=${n}`, [n]);
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const [res, setRes] = useState<any>(null);
  const [voice] = useState<VoiceKey>('m');
  useEffect(() => { setCuts(new Set()); setRes(null); if (item) play(item.words.join(' '), { voice, rate: s.defaultSpeed }).catch(() => {}); return () => stop(); }, [item?.id]);
  if (!item) return <Spinner />;
  const toggle = (k: number) => { if (res) return; const c = new Set(cuts); c.has(k) ? c.delete(k) : c.add(k); setCuts(c); };
  const submit = async () => setRes(await api('/lab/segmentation', { sentence_id: item.id, boundaries: [...cuts] }));
  return (
    <div className="space-y-4">
      <Back />
      <PageHeader title="Sentence segmentation" ar="تقطيع الجملة" sub={`Listen, then tap the gaps where one phrase ends and the next begins. This sentence has ${item.chunkCount} phrases.`} />
      <div className="card">
        <div className="mb-4 flex gap-2"><PlayButton text={item.words.join(' ')} voice={voice} rate={s.defaultSpeed} /><PlayButton text={item.words.join(' ')} voice={voice} rate={0.7} label="Slow" /></div>
        <div className="flex flex-wrap items-center gap-y-3" dir="rtl">
          {item.words.map((w: string, k: number) => (
            <span key={k} className="flex items-center">
              {k > 0 && (
                <button onClick={() => toggle(k)} aria-label={`Cut before word ${k + 1}`}
                  className={`mx-0.5 flex h-10 w-5 items-center justify-center rounded transition ${cuts.has(k) ? (res ? (res.truth.includes(k) ? 'bg-nile-500' : 'bg-red-400') : 'bg-sand-500') : res?.truth.includes(k) ? 'bg-nile-200 ring-2 ring-nile-500' : 'hover:bg-stone-200 dark:hover:bg-stone-700'}`}>
                  <span className={`h-6 w-0.5 ${cuts.has(k) ? 'bg-white' : 'bg-stone-300 dark:bg-stone-600'}`} />
                </button>
              )}
              <span className="ar rounded-lg px-1.5 text-2xl">{w}</span>
            </span>
          ))}
        </div>
      </div>
      {!res ? <button className="btn-primary w-full" onClick={submit}>Check my phrases</button> : (
        <div className="card fade-in space-y-3">
          <div className="text-2xl font-bold">{Math.round(res.score * 100)}%</div>
          <div className="label">How it's built</div>
          {res.chunks.map((c: any, k: number) => (
            <div key={k} className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800">
              <div className="flex items-start gap-2"><span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-nile-600 text-xs text-white">{k + 1}</span><div className="flex-1"><ArabicText tokens={c.tokens} className="text-xl" context="sentence" /><p className="text-sm text-stone-600 dark:text-stone-300">{c.en}</p></div><PlayButton text={c.ar} size="sm" voice={voice} /></div>
            </div>
          ))}
          <Support translit={item.translit} english={item.english} forceEnglish />
          <button className="btn-primary w-full" onClick={() => setN(n + 1)}>Next sentence</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- unexpected responses
function Unexpected() {
  const { status } = useApp();
  const [mode, setMode] = useState<'scripted' | 'ai'>('scripted');
  return (
    <div className="space-y-4">
      <Back />
      <PageHeader title="Unexpected responses" ar="رد مش متوقع" sub="You hear a question — no text. Answer out loud or type. The next question depends on randomness (or on the AI), so you can't coast on prediction.">
        <div className="flex rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-900">
          <button onClick={() => setMode('scripted')} className={`rounded-lg px-3 py-1.5 ${mode === 'scripted' ? 'bg-white shadow dark:bg-stone-800' : ''}`}>Scripted</button>
          <button onClick={() => setMode('ai')} className={`rounded-lg px-3 py-1.5 ${mode === 'ai' ? 'bg-white shadow dark:bg-stone-800' : ''}`}>AI partner</button>
        </div>
      </PageHeader>
      {mode === 'ai' && !status?.ai ? <Notice>AI mode needs <code>ANTHROPIC_API_KEY</code> on the server. Scripted mode works offline.</Notice> : mode === 'ai' ? <UnexpectedAI /> : <UnexpectedScripted />}
    </div>
  );
}

export function AnswerBox({ onSubmit, disabled }: { onSubmit: (text: string, ms: number, via: string) => void; disabled?: boolean }) {
  const rec = useSpeechRecognition();
  const [text, setText] = useState('');
  const t0 = useRef(Date.now());
  useEffect(() => { t0.current = Date.now(); }, []);
  const send = (t: string, via: string) => { if (!t.trim()) return; onSubmit(t.trim(), Date.now() - t0.current, via); setText(''); t0.current = Date.now(); };
  return (
    <div className="flex items-end gap-2">
      {rec.supported && (
        <button disabled={disabled} onClick={() => (rec.listening ? rec.stop() : rec.start((t) => send(t, 'voice')))} className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${rec.listening ? 'animate-pulse bg-red-500 text-white' : 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200'}`} aria-label="Speak">
          {rec.listening ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
      )}
      <textarea className="input ar min-h-12 flex-1 text-lg" dir="rtl" rows={1} placeholder={rec.listening ? rec.interim || 'بسمعك…' : 'رد بالمصري…'} value={rec.listening ? rec.interim : text} disabled={disabled}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text, 'text'); } }} />
      <button className="btn-primary h-12" disabled={disabled || !text.trim()} onClick={() => send(text, 'text')}>Send</button>
    </div>
  );
}

function UnexpectedScripted() {
  const { data: list } = useApi<any[]>('/lab/scenarios');
  const [slug, setSlug] = useState<string | null>(null);
  const [run, setRun] = useState<any>(null);
  const [k, setK] = useState(0);
  const [stage, setStage] = useState<'listen' | 'answered' | 'reveal'>('listen');
  const [answer, setAnswer] = useState<{ text: string; ms: number } | null>(null);
  const [voice] = useState<VoiceKey>(randomVoice());
  const s = useSettings();
  const start = async (sl: string) => { setSlug(sl); setRun(await api(`/lab/scenarios/${sl}`)); setK(0); setStage('listen'); };
  const turn = run?.turns[k];
  useEffect(() => { if (turn) play(turn.ar, { voice, rate: Math.max(1, s.defaultSpeed) }).catch(() => {}); return () => stop(); }, [turn?.ar]);
  if (!slug || !run) return (
    <div className="grid gap-3 sm:grid-cols-2">
      {list?.map((sc) => <button key={sc.slug} onClick={() => start(sc.slug)} className="card text-start transition hover:border-nile-400"><div className="font-semibold">{sc.title}</div><div className="ar text-nile-700 dark:text-nile-300">{sc.title_ar}</div></button>)}
    </div>
  );
  if (!turn) return (
    <div className="card text-center"><p className="text-lg font-semibold">Conversation finished.</p><div className="mt-3 flex justify-center gap-2"><button className="btn-primary" onClick={() => start(slug)}>Run it again (different questions)</button><button className="btn-outline" onClick={() => { setSlug(null); setRun(null); }}>Other scenario</button></div></div>
  );
  const grade = async (understood: boolean) => {
    await api('/lab/unexpected/result', { understood, answered: !!answer, ms: answer?.ms, curveball: turn.curveball });
    setAnswer(null); setStage('listen'); setK(k + 1);
  };
  return (
    <div className="space-y-4">
      <div className="text-xs text-stone-500">{run.title} · turn {k + 1}/{run.turns.length}{turn.curveball ? ' · curveball!' : ''}</div>
      <div className="card">
        <div className="flex items-center gap-3"><PlayButton text={turn.ar} voice={voice} rate={Math.max(1, s.defaultSpeed)} size="lg" /><button className="btn-outline" onClick={() => play(turn.ar, { voice, rate: 0.75 }).catch(() => {})}><Turtle size={16} /> Slow</button>
          <p className="text-sm text-stone-500">Listen and answer — the question is hidden on purpose.</p></div>
        {stage !== 'listen' && <div className="mt-4 fade-in"><p className="ar text-2xl">{turn.ar}</p><Support english={turn.en} forceEnglish /></div>}
      </div>
      {stage === 'listen' && (
        <>
          <AnswerBox onSubmit={(text, ms) => { setAnswer({ text, ms }); setStage('answered'); }} />
          <button className="btn-ghost w-full text-sm" onClick={() => setStage('answered')}>I couldn't answer — show me</button>
        </>
      )}
      {stage === 'answered' && (
        <div className="card fade-in space-y-3">
          {answer && <p className="text-sm">You said: <span className="ar text-lg">{answer.text}</span> <span className="text-stone-500">({(answer.ms / 1000).toFixed(1)} s)</span></p>}
          <div><div className="label">A natural answer</div><p className="ar text-xl">{turn.sample_ar}</p><p className="text-sm text-stone-500">{turn.sample_en}</p></div>
          <p className="text-sm font-semibold">Did you understand the question before seeing it?</p>
          <div className="grid grid-cols-2 gap-2"><button className="btn bg-red-500 text-white" onClick={() => grade(false)}><X size={16} /> Not really</button><button className="btn-primary" onClick={() => grade(true)}><Check size={16} /> Yes</button></div>
        </div>
      )}
    </div>
  );
}

function UnexpectedAI() {
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState('natural');
  const [hist, setHist] = useState<{ q: string; a: string; en: string; sample: string; sample_en: string; ev?: any }[]>([]);
  const [cur, setCur] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showQ, setShowQ] = useState(false);
  const [voice] = useState<VoiceKey>(randomVoice());
  const ask = async (history: { q: string; a: string }[], ms?: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/lab/unexpected/ai', { topic, mode, history, ms });
      setCur(r); setShowQ(false);
      play(r.question, { voice, rate: mode === 'challenge' ? 1.15 : mode === 'learning' ? 0.85 : 1 }).catch(() => {});
      return r;
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (!cur && !hist.length) return (
    <div className="card space-y-3">
      <input className="input" placeholder="Topic (e.g. gym, university, football, your weekend)" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <div className="flex gap-2 text-sm">{['learning', 'natural', 'challenge'].map((m) => <button key={m} onClick={() => setMode(m)} className={`chip capitalize ${mode === m ? 'border-nile-500 bg-nile-50 dark:bg-nile-950' : 'border-stone-200 dark:border-stone-700'}`}>{m}</button>)}</div>
      <ErrorBox error={err} />
      <button className="btn-primary" disabled={busy || !topic} onClick={() => ask([])}>{busy ? <Spinner /> : 'Start'}</button>
    </div>
  );
  return (
    <div className="space-y-4">
      {hist.map((h, i) => (
        <div key={i} className="card !p-4 text-sm">
          <p className="ar text-lg">{h.q}</p><p className="ar text-lg text-nile-700 dark:text-nile-300">↳ {h.a}</p>
          {h.ev?.applicable && <p className={`mt-1 text-xs ${h.ev.addressed ? 'text-nile-700' : 'text-red-600'}`}>{h.ev.addressed ? '✓ answered the question' : '✗ didn’t answer what was asked'} · {h.ev.comment_en} {h.ev.better_answer && <span className="ar">— {h.ev.better_answer}</span>}</p>}
        </div>
      ))}
      {cur && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3"><PlayButton text={cur.question} voice={voice} size="lg" /><button className="btn-outline" onClick={() => play(cur.question, { voice, rate: 0.75 }).catch(() => {})}><Turtle size={16} /> Slow</button>
            <button className="btn-ghost text-sm" onClick={() => setShowQ(!showQ)}>{showQ ? 'Hide' : 'Show'} text</button></div>
          {showQ && <div><p className="ar text-xl">{cur.question}</p><p className="text-sm text-stone-500">{cur.question_en}</p></div>}
          <AnswerBox disabled={busy} onSubmit={async (a, ms) => {
            const prev = { q: cur.question, a, en: cur.question_en, sample: cur.sample_answer, sample_en: cur.sample_answer_en };
            const history = [...hist, prev].map((h) => ({ q: h.q, a: h.a }));
            const r = await ask(history, ms);
            setHist([...hist, { ...prev, ev: r?.evaluation }]);
          }} />
          {busy && <Spinner />}
          <ErrorBox error={err} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- word recognition
function Recognition() {
  const s = useSettings();
  const [n, setN] = useState(0);
  const { data: item } = useApi<any>(`/lab/recognition?n=${n}`, [n]);
  const [text, setText] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [res, setRes] = useState<any>(null);
  const [voice, setVoice] = useState<VoiceKey>('f');
  useEffect(() => {
    setSel(new Set()); setRes(null); setText(null); setVoice(randomVoice());
    if (item?.id) api(`/sentences/${item.id}/audio-text`).then((r) => setText(r.arabic)).catch(() => {});
  }, [item?.id]);
  useEffect(() => { if (text) play(text, { voice, rate: Math.max(1, s.defaultSpeed) }).catch(() => {}); return () => stop(); }, [text]);
  if (!item) return <Spinner />;
  const toggle = (id: number) => { if (res) return; const x = new Set(sel); x.has(id) ? x.delete(id) : x.add(id); setSel(x); };
  const submit = async () => setRes(await api('/lab/recognition', { sentence_id: item.id, selected: [...sel], candidates: item.candidates.map((c: any) => c.id) }));
  return (
    <div className="space-y-4">
      <Back />
      <PageHeader title="Word recognition" ar="التقط الكلمات" sub="At natural speed. Which of these words did you hear? Some weren't there." />
      <div className="card flex items-center gap-3">{text && <PlayButton text={text} voice={voice} rate={Math.max(1, s.defaultSpeed)} size="lg" />}<span className="text-sm text-stone-500">Replay as often as you need.</span></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" dir="rtl">
        {item.candidates.map((c: any) => {
          const inS = res?.inSentence.includes(c.id);
          const state = !res ? (sel.has(c.id) ? 'border-nile-500 bg-nile-50 dark:bg-nile-950' : 'border-stone-200 dark:border-stone-700')
            : inS && sel.has(c.id) ? 'border-nile-500 bg-nile-100 dark:bg-nile-900' : inS ? 'border-sand-500 bg-sand-50 dark:bg-stone-800' : sel.has(c.id) ? 'border-red-400 bg-red-50 dark:bg-red-950' : 'border-stone-200 opacity-50 dark:border-stone-700';
          return (
            <button key={c.id} onClick={() => toggle(c.id)} className={`rounded-xl border bg-white p-3 text-center dark:bg-stone-900 ${state}`}>
              <div className="ar text-2xl">{c.arabic}</div>
              {res && <div className="text-xs text-stone-500" dir="ltr">{c.english}{inS && !sel.has(c.id) ? ' — missed' : ''}</div>}
            </button>
          );
        })}
      </div>
      {!res ? <button className="btn-primary w-full" onClick={submit}>Check</button> : (
        <div className="card fade-in">
          <div className="text-2xl font-bold">{Math.round(res.score * 100)}%</div>
          <ArabicText tokens={res.sentence.tokens} className="mt-2 text-2xl" context="sentence" />
          <Support translit={res.sentence.translit} english={res.sentence.english} forceEnglish />
          <button className="btn-primary mt-3 w-full" onClick={() => setN(n + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- fast speech
const LADDER = [0.8, 1, 1.15, 1.3, 1.45, 1.6, 1.8];
function Fast() {
  const [n, setN] = useState(0);
  const { data: item } = useApi<any>(`/lab/fast?n=${n}`, [n]);
  const [step, setStep] = useState(0);
  const [session] = useState(() => Math.random().toString(36).slice(2));
  const [result, setResult] = useState<number | null>(null);
  const [comfortable, setComfortable] = useState<number | null>(null);
  const [voice] = useState<VoiceKey>(randomVoice());
  const [show, setShow] = useState(false);
  useEffect(() => { setStep(0); setResult(null); setShow(false); }, [item?.id]);
  useEffect(() => { if (item && result == null) play(item.arabic, { voice, rate: LADDER[step] }).catch(() => {}); return () => stop(); }, [item?.id, step]);
  if (!item) return <Spinner />;
  const answer = async (ok: boolean) => {
    const r = await api('/lab/fast', { sentence_id: item.id, speed: LADDER[step], understood: ok, session: `${session}-${item.id}` });
    setComfortable(r.comfortable);
    if (!ok || step === LADDER.length - 1) setResult(ok ? LADDER[step] : step > 0 ? LADDER[step - 1] : 0);
    else setStep(step + 1);
  };
  return (
    <div className="space-y-4">
      <Back />
      <PageHeader title="Fast speech trainer" ar="كلام سريع" sub={item.fromUnderstood ? 'A sentence you already understood — now at increasing speed. Stop when it turns to noise.' : 'Do a few Context sessions first so this uses sentences you know. For now: a medium sentence.'}>
        {comfortable != null && <span className="chip border-nile-300 text-nile-700">Comfortable speed: {comfortable}×</span>}
      </PageHeader>
      <div className="card">
        <div className="mb-4 flex gap-1">{LADDER.map((s, k) => <div key={s} className={`flex-1 rounded-full py-1 text-center text-xs font-semibold ${k < step ? 'bg-nile-500 text-white' : k === step && result == null ? 'bg-sand-500 text-white' : 'bg-stone-100 text-stone-500 dark:bg-stone-800'}`}>{s}×</div>)}</div>
        <div className="flex items-center gap-3"><PlayButton text={item.arabic} voice={voice} rate={LADDER[step]} size="lg" /><button className="btn-ghost text-sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} sentence</button></div>
        {show && <div className="mt-3"><ArabicText tokens={item.tokens} className="text-2xl" context="sentence" /><Support translit={item.translit} english={item.english} /></div>}
      </div>
      {result == null ? (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn bg-red-500 !py-3 text-white" onClick={() => answer(false)}>Lost it at {LADDER[step]}×</button>
          <button className="btn-primary !py-3" onClick={() => answer(true)}>Understood at {LADDER[step]}×</button>
        </div>
      ) : (
        <div className="card fade-in text-center">
          <p className="text-lg">{result ? <>You followed this sentence up to <b>{result}×</b>.</> : 'Even 0.8× was hard — re-do it in Context first.'}</p>
          <p className="mt-1 text-sm text-stone-500">Tip: at the speed where you lost it, replay a few times with the text visible, then hide it again. Your ear learns the merged shapes of words.</p>
          <div className="mt-3 flex justify-center gap-2"><button className="btn-outline" onClick={() => { setResult(null); setStep(Math.max(0, step)); }}>Practise at {LADDER[step]}×</button><button className="btn-primary" onClick={() => setN(n + 1)}>Next sentence</button></div>
        </div>
      )}
    </div>
  );
}
