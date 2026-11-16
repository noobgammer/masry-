import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Eye, Languages, Lock, RotateCcw, SkipForward, Turtle } from 'lucide-react';
import { api } from '../lib/api';
import { play, randomVoice, stop, type VoiceKey } from '../lib/audio';
import { useApi, usePlanBlock } from '../lib/hooks';
import { useSettings } from '../lib/store';
import { ArabicText, BookmarkButton, Empty, Mcq, PageHeader, PlayButton, SpeedControl, Spinner, Support } from '../components/ui';

const TIER_NAMES: Record<number, string> = { 2: 'Expressions', 3: 'Simple sentences', 4: 'With connectors', 5: 'Multiple clauses', 6: 'Natural responses', 7: 'Unfamiliar combos' };
const STEPS = ['Listen', 'Catch words', 'Meaning', 'Arabic', 'English', 'Breakdown', 'Follow along'];

export default function Context() {
  usePlanBlock('context');
  const [sp, setSp] = useSearchParams();
  const tier = sp.get('tier');
  const focus = sp.get('focus') || '';
  const word = sp.get('word') || '';
  const { data: levels } = useApi<any>('/context/levels');
  const q = new URLSearchParams({ ...(tier ? { tier } : {}), ...(focus ? { focus } : {}), ...(word ? { word } : {}) }).toString();
  const { data: session, loading, reload } = useApi<any[]>(`/context/session?${q}`, [q]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState({ ok: 0, n: 0 });
  useEffect(() => { setI(0); setScore({ ok: 0, n: 0 }); }, [session]);
  const s = session?.[i];
  return (
    <div>
      <PageHeader title="Words in context" ar="في سياق" sub="Knowing words isn't enough — you need to catch them inside real, fast sentences. Listen first, guess, then look.">
        {focus && <span className="chip border-sand-400 text-sand-600">Focus: {focus === 'forgotten' ? 'often-forgotten words' : focus}</span>}
      </PageHeader>
      <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setSp({})} className={`chip whitespace-nowrap ${!tier ? 'border-nile-500 bg-nile-50 text-nile-800 dark:bg-nile-950 dark:text-nile-200' : 'border-stone-200 dark:border-stone-700'}`}>Adaptive</button>
        {levels?.tiers.filter((t: any) => t.tier >= 2).map((t: any) => {
          const locked = t.tier > levels.unlocked;
          return (
            <button key={t.tier} onClick={() => setSp({ tier: String(t.tier) })} title={locked ? 'Recommended after 75% on the previous tier — you can still try it' : ''}
              className={`chip whitespace-nowrap ${tier === String(t.tier) ? 'border-nile-500 bg-nile-50 text-nile-800 dark:bg-nile-950 dark:text-nile-200' : 'border-stone-200 dark:border-stone-700'} ${locked ? 'opacity-60' : ''}`}>
              {locked && <Lock size={12} />} {t.tier}. {TIER_NAMES[t.tier]} {t.accuracy != null && <span className="text-xs text-stone-500">{t.accuracy}%</span>}
            </button>
          );
        })}
      </div>
      {loading ? <Spinner /> : !s ? (
        <Empty>
          {session?.length ? <><p className="text-lg font-semibold">Session complete: {score.ok}/{score.n} understood.</p><button className="btn-primary mt-3" onClick={reload}><RotateCcw size={16} /> New session</button></>
            : <p>No sentences for this selection yet. <Link className="text-nile-700 underline" to="/vocabulary?tab=learn">Learn some words</Link> first.</p>}
        </Empty>
      ) : (
        <>
          <div className="mb-2 text-xs text-stone-500">Sentence {i + 1} of {session!.length} · Tier {s.tier} · {TIER_NAMES[s.tier] || ''}</div>
          <Exercise key={s.id} s={s} onNext={(ok) => { setScore((x) => ({ ok: x.ok + (ok ? 1 : 0), n: x.n + 1 })); setI(i + 1); }} />
        </>
      )}
    </div>
  );
}

function Exercise({ s, onNext }: { s: any; onNext: (correct: boolean) => void }) {
  const settings = useSettings();
  const [step, setStep] = useState(0);
  const [plays, setPlays] = useState(0);
  const [speed, setSpeed] = useState(settings.defaultSpeed);
  const [voice] = useState<VoiceKey>(randomVoice());
  const [heard, setHeard] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<number | null>(null);
  const [recog, setRecog] = useState<any>(null);
  const [hl, setHl] = useState<number | undefined>();
  const t0 = useRef(Date.now());
  const correctIdx = s.options.indexOf(s.english);
  const listen = async (rate = speed) => { setPlays((p) => p + 1); try { await play(s.arabic, { voice, rate }); } catch {} };
  useEffect(() => { listen(); return () => stop(); }, []);

  const answer = async (k: number) => {
    setPicked(k);
    const r = await api('/context/answer', { sentence_id: s.id, correct: k === correctIdx, heard: [...heard], ms: Date.now() - t0.current, speed, plays });
    setRecog(r);
  };
  const followAlong = async (rate = speed) => {
    // approximate word timing by character length (audio has no word timestamps)
    const lens = s.tokens.map((t: any) => t.surface.length + 1);
    const total = lens.reduce((a: number, b: number) => a + b, 0);
    const msPerChar = 75 / rate;
    let acc = 0;
    const timers = lens.map((l: number, k: number) => { const at = acc; acc += l; return setTimeout(() => setHl(k), at * msPerChar); });
    try { await play(s.arabic, { voice, rate }); } catch {}
    timers.forEach(clearTimeout);
    setHl(undefined);
    void total;
  };
  const toggle = (id: number) => { const n = new Set(heard); n.has(id) ? n.delete(id) : n.add(id); setHeard(n); };
  const showText = step >= 3;

  return (
    <div className="space-y-4">
      <ol className="flex gap-1 overflow-x-auto text-[11px]">
        {STEPS.map((l, k) => <li key={l} className={`whitespace-nowrap rounded-full px-2.5 py-1 ${k === step ? 'bg-nile-600 text-white' : k < step ? 'bg-nile-100 text-nile-800 dark:bg-nile-900 dark:text-nile-200' : 'bg-stone-100 text-stone-500 dark:bg-stone-800'}`}>{k + 1}. {l}</li>)}
      </ol>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <PlayButton text={s.arabic} voice={voice} rate={speed} size="lg" onPlayed={() => setPlays((p) => p + 1)} />
          <button className="btn-outline" onClick={() => listen(0.7)}><Turtle size={16} /> Slow</button>
          <div className="flex-1" />
          <SpeedControl value={speed} onChange={setSpeed} />
        </div>
        <div className="mt-4 min-h-[4rem]">
          {showText ? (
            <div className="fade-in">
              <div className="flex items-start gap-2">
                <div className="flex-1"><ArabicText tokens={s.tokens} highlight={hl} className="text-3xl" context="sentence" /></div>
                <BookmarkButton itemType="sentence" itemId={s.id} arabic={s.arabic} english={s.english} />
              </div>
              {step >= 4 && <Support translit={s.translit} english={s.english} forceEnglish />}
            </div>
          ) : (
            <p className="ar blur-text select-none text-3xl" aria-hidden>{s.arabic}</p>
          )}
        </div>
        <p className="mt-2 text-xs text-stone-500">Played {plays}× · {plays <= 1 && step === 0 ? 'Listen at least twice before moving on.' : ''}</p>
      </div>

      {step === 0 && (
        <div className="flex gap-2">
          <button className="btn-primary flex-1 !py-3" onClick={() => setStep(1)}>I've listened — which words did I catch?</button>
        </div>
      )}
      {step === 1 && (
        <div className="card">
          <p className="mb-3 text-sm">Tap the words you <b>heard</b>. Some are not in the sentence.</p>
          <div className="flex flex-wrap gap-2" dir="rtl">
            {s.chips.map((c: any) => (
              <button key={c.id} onClick={() => toggle(c.id)} className={`chip ar text-lg ${heard.has(c.id) ? 'border-nile-500 bg-nile-50 dark:bg-nile-950' : 'border-stone-200 dark:border-stone-700'}`}>
                {heard.has(c.id) && <Check size={14} />}{c.arabic}
              </button>
            ))}
          </div>
          <button className="btn-primary mt-4 w-full" onClick={() => setStep(2)}>Continue</button>
        </div>
      )}
      {step === 2 && (
        <div>
          <p className="mb-2 text-sm font-semibold">What does it mean?</p>
          <Mcq options={s.options} correct={correctIdx} picked={picked} onAnswer={answer} />
          {picked != null && (
            <div className="mt-3 fade-in">
              <p className={`text-sm font-semibold ${picked === correctIdx ? 'text-nile-700' : 'text-red-600'}`}>{picked === correctIdx ? 'صح! Understood.' : 'Not quite — let\'s look at it.'}</p>
              {recog && recog.recog != null && heard.size > 0 && <p className="text-xs text-stone-500">Word catching: {Math.round(recog.recog * 100)}%{recog.missed.length ? ` · missed ${recog.missed.length}` : ''}{recog.falsePositives.length ? ` · ${recog.falsePositives.length} not actually there` : ''}</p>}
              <button className="btn-primary mt-3 w-full" onClick={() => setStep(3)}><Eye size={16} /> Reveal the Arabic</button>
            </div>
          )}
        </div>
      )}
      {step === 3 && (
        <div className="flex gap-2">
          <button className="btn-outline flex-1" onClick={() => listen()}>Listen while reading</button>
          <button className="btn-primary flex-1" onClick={() => setStep(4)}><Languages size={16} /> Reveal English</button>
        </div>
      )}
      {step === 4 && <button className="btn-primary w-full" onClick={() => setStep(5)}>Word-by-word breakdown</button>}
      {step === 5 && (
        <div className="card">
          <div className="label mb-3">Breakdown</div>
          {s.chunks && (
            <div className="mb-4 space-y-1.5">
              {s.chunks.map((c: any, k: number) => (
                <div key={k} className="flex items-baseline gap-3 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800"><span className="ar flex-1 text-lg">{c.ar}</span><span className="text-sm text-stone-600 dark:text-stone-300">{c.en}</span></div>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2" dir="rtl">
            {s.tokens.map((t: any, k: number) => (
              <div key={k} className="flex items-center gap-3 rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800">
                <span className="ar text-xl">{t.surface}</span>
                <span className="flex-1 text-start text-sm" dir="ltr">
                  {t.mwe && t.mwe.start !== t.mwe.end ? <><b>{t.mwe.english}</b> <span className="text-stone-400">(expression)</span></> : t.lemma ? <>{t.lemma.english}{t.parts.length > 1 && <span className="block text-xs text-stone-500">{t.parts.map((p: any) => `${p.text} = ${p.gloss}`).join(' + ')}</span>}</> : <span className="text-stone-400">{t.parts[0]?.gloss || '?'}</span>}
                </span>
              </div>
            ))}
          </div>
          <button className="btn-primary mt-4 w-full" onClick={() => { setStep(6); followAlong(); }}>Listen again, following the words</button>
        </div>
      )}
      {step === 6 && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => followAlong(speed)}>Follow again</button>
          <button className="btn-outline" onClick={() => followAlong(1.25)}>Fast (1.25×)</button>
          <button className="btn-primary flex-1" onClick={() => onNext(picked === correctIdx)}><SkipForward size={16} /> Next sentence</button>
        </div>
      )}
    </div>
  );
}
