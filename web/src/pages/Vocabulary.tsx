import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Ear, Eye, RotateCcw, Search, Turtle } from 'lucide-react';
import { api } from '../lib/api';
import { play, stop } from '../lib/audio';
import { useApi, usePlanBlock } from '../lib/hooks';
import { useSettings } from '../lib/store';
import { Bar, Empty, Mcq, PageHeader, PlayButton, Spinner, Support } from '../components/ui';

const TABS = [
  { k: 'review', label: 'Review' },
  { k: 'learn', label: 'Learn new' },
  { k: 'browse', label: 'Browse 2,000' },
  { k: 'placement', label: 'Fast-track known words' },
];

export default function Vocabulary() {
  usePlanBlock('vocab');
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || (sp.get('mode') ? 'review' : 'review');
  const { data: stats, reload } = useApi<any>('/srs/stats', [tab]);
  return (
    <div>
      <PageHeader title="Frequency vocabulary" ar="الكلمات" sub="The most frequent words of spoken Egyptian Arabic, learned with spaced repetition. Every word has two separate skills: recognising it written, and recognising it by ear.">
        {stats && (
          <div className="flex gap-2 text-xs">
            <span className="chip border-stone-200 dark:border-stone-700"><Eye size={13} /> {stats.due.read || 0} due</span>
            <span className="chip border-stone-200 dark:border-stone-700"><Ear size={13} /> {stats.due.listen || 0} due</span>
            <span className="chip border-stone-200 dark:border-stone-700">{stats.newLeft} new left today</span>
          </div>
        )}
      </PageHeader>
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1 dark:bg-stone-900">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setSp({ tab: t.k })} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${tab === t.k ? 'bg-white shadow dark:bg-stone-800' : 'text-stone-500'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'review' && <Review mode={sp.get('mode') || 'all'} onDone={reload} />}
      {tab === 'learn' && <Learn onDone={() => { reload(); setSp({ tab: 'review' }); }} />}
      {tab === 'browse' && <Browse />}
      {tab === 'placement' && <Placement />}
    </div>
  );
}

// ---------------------------------------------------------------- learn
function Learn({ onDone }: { onDone: () => void }) {
  const [extra, setExtra] = useState(false);
  const { data: words, loading } = useApi<any[]>(`/srs/new${extra ? '?extra=1' : ''}`, [extra]);
  const [i, setI] = useState(0);
  const s = useSettings();
  const w = words?.[i];
  useEffect(() => { if (w) play(w.arabic, { voice: 'm', rate: s.defaultSpeed }).catch(() => {}); return () => stop(); }, [w?.id]);
  if (loading) return <Spinner />;
  if (!words?.length || !w)
    return (
      <Empty>
        <p className="mb-3">You've reached today's new-word target. Consolidating them by ear and in context matters more than adding more.</p>
        <div className="flex justify-center gap-2">
          <button className="btn-primary" onClick={onDone}>Review now</button>
          <button className="btn-outline" onClick={() => { setExtra(true); setI(0); }}>Learn 10 more anyway</button>
        </div>
      </Empty>
    );
  const next = async () => {
    await api('/srs/introduce', { vocab_id: w.id });
    if (i + 1 >= words.length) onDone(); else setI(i + 1);
  };
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-2 flex items-center justify-between text-xs text-stone-500"><span>New word {i + 1} of {words.length}</span><span>Frequency rank #{w.rank} · Level {w.level}</span></div>
      <Bar value={(100 * i) / words.length} h="h-1.5" />
      <div className="card mt-4 text-center">
        <span className="chip border-stone-200 text-xs text-stone-500 dark:border-stone-700">{w.pos} · {w.category}</span>
        <div className="ar mt-3 text-5xl font-semibold">{w.arabic}</div>
        <div className="mt-1 text-stone-500">{w.translit}</div>
        <div className="mt-3 flex justify-center gap-2">
          <PlayButton text={w.arabic.split('/')[0]} voice="m" rate={s.defaultSpeed} />
          <PlayButton text={w.arabic.split('/')[0]} voice="f" rate={0.7} label="Slow" />
        </div>
        <div className="mt-4 text-xl font-semibold">{w.english}</div>
        {w.notes && <p className="mt-2 text-sm text-stone-500">{w.notes}</p>}
        {w.variants.length > 0 && <p className="ar mt-2 text-sm text-stone-500">{w.variants.slice(0, 8).join(' · ')}</p>}
      </div>
      {(w.example_ar || w.ladder.length > 0) && (
        <div className="card mt-3 space-y-3">
          <div className="label">In real sentences</div>
          {[...(w.example_ar ? [{ arabic: w.example_ar, english: w.example_en, id: 'ex' }] : []), ...w.ladder.filter((x: any) => x.arabic !== w.example_ar)].slice(0, 3).map((x: any) => (
            <div key={x.id} className="flex items-start gap-3">
              <PlayButton text={x.arabic} size="sm" voice="f" rate={s.defaultSpeed} />
              <div className="flex-1"><p className="ar text-xl">{x.arabic}</p><Support english={x.english} /></div>
            </div>
          ))}
        </div>
      )}
      <button className="btn-primary mt-4 w-full !py-3" onClick={next}>Got it — add to my reviews</button>
    </div>
  );
}

// ---------------------------------------------------------------- review
function Review({ mode, onDone }: { mode: string; onDone: () => void }) {
  const [queue, setQueue] = useState<any[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const t0 = useRef(Date.now());
  const msRef = useRef<number | null>(null);
  const s = useSettings();
  const load = async () => { const q = await api<any[]>(`/srs/queue?mode=${mode}`); setQueue(q); setIdx(0); };
  useEffect(() => { load(); }, [mode]);
  const item = queue?.[idx];
  const correctIdx = useMemo(() => (item ? item.options.indexOf(item.vocab.english) : -1), [item]);
  useEffect(() => {
    if (!item) return;
    setRevealed(false); setPicked(null); msRef.current = null; t0.current = Date.now();
    if (item.skill === 'listen') play(item.vocab.arabic.split('/')[0], { voice: Math.random() < 0.5 ? 'm' : 'f', rate: Math.max(1, s.defaultSpeed) }).catch(() => {});
    return () => stop();
  }, [item?.vocab.id, item?.skill, idx]);
  if (!queue) return <Spinner />;
  if (!item)
    return (
      <Empty>
        <p className="text-lg font-semibold">{done ? `Nice — ${done} reviews done.` : 'Nothing due right now.'}</p>
        <p className="mt-1 text-sm">Words in their first learning steps come back in a few minutes.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn-outline" onClick={load}><RotateCcw size={16} /> Check again</button>
          <Link className="btn-primary" to="/vocabulary?tab=learn">Learn new words</Link>
          <Link className="btn-outline" to="/context">Practise in context</Link>
        </div>
      </Empty>
    );
  const reveal = () => { if (msRef.current == null) msRef.current = Date.now() - t0.current; setRevealed(true); if (item.skill === 'read') play(item.vocab.arabic.split('/')[0], { voice: 'm', rate: s.defaultSpeed }).catch(() => {}); };
  const rate = async (rating: number) => {
    await api('/srs/answer', { vocab_id: item.vocab.id, skill: item.skill, rating, ms: msRef.current });
    setDone(done + 1);
    if (idx + 1 >= queue.length) { await load(); onDone(); } else setIdx(idx + 1);
  };
  const isListen = item.skill === 'listen';
  const w = item.vocab;
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-2 flex items-center justify-between text-xs text-stone-500">
        <span className="flex items-center gap-1 font-semibold">{isListen ? <><Ear size={14} /> Listening card</> : <><Eye size={14} /> Reading card</>}{item.state !== 'review' && <span className="ms-1 rounded bg-sand-100 px-1.5 text-sand-600">learning</span>}</span>
        <span>{idx + 1} / {queue.length}</span>
      </div>
      <div className="card text-center">
        {isListen ? (
          <div className="py-4">
            <p className="mb-4 text-sm text-stone-500">What did you hear? Don't look for the spelling — understand the sound.</p>
            <div className="flex justify-center gap-3">
              <PlayButton text={w.arabic.split('/')[0]} size="lg" voice="f" rate={Math.max(1, s.defaultSpeed)} />
              <button onClick={() => play(w.arabic.split('/')[0], { voice: 'm', rate: 0.7 }).catch(() => {})} className="btn-outline self-center" title="Slow replay"><Turtle size={16} /> Slow</button>
            </div>
            {revealed && <div className="ar mt-5 text-4xl font-semibold fade-in">{w.arabic}</div>}
          </div>
        ) : (
          <div className="ar py-4 text-5xl font-semibold">{w.arabic}</div>
        )}
        {revealed && (
          <div className="fade-in border-t border-stone-100 pt-4 dark:border-stone-800">
            <div className="text-sm text-stone-500">{w.translit}</div>
            <div className="text-xl font-semibold">{w.english}</div>
            {w.example_ar && <div className="mt-3 flex items-center justify-center gap-2"><PlayButton text={w.example_ar} size="sm" /><span className="ar text-lg">{w.example_ar}</span></div>}
            {w.example_en && <Support english={w.example_en} />}
          </div>
        )}
      </div>
      {isListen && !revealed && (
        <div className="mt-4">
          <Mcq options={item.options} correct={correctIdx} picked={picked} onAnswer={(i) => { setPicked(i); reveal(); }} />
          <button className="btn-ghost mt-2 w-full text-sm" onClick={reveal}>I don't know — show me</button>
        </div>
      )}
      {!isListen && !revealed && <button className="btn-primary mt-4 w-full !py-3" onClick={reveal}>Show meaning</button>}
      {revealed && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[
            { r: 1, l: 'Again', c: 'bg-red-500 hover:bg-red-600' },
            { r: 2, l: 'Hard', c: 'bg-sand-500 hover:bg-sand-600' },
            { r: 3, l: 'Good', c: 'bg-nile-600 hover:bg-nile-700' },
            { r: 4, l: 'Instant', c: 'bg-nile-800 hover:bg-nile-900' },
          ].map((b) => {
            const suggested = picked != null && ((picked === correctIdx && b.r === 3) || (picked !== correctIdx && b.r === 1));
            return <button key={b.r} onClick={() => rate(b.r)} className={`btn !py-3 text-white ${b.c} ${suggested ? 'ring-4 ring-offset-2 ring-nile-300 dark:ring-offset-stone-950' : ''}`}>{b.l}</button>;
          })}
        </div>
      )}
      <div className="mt-4 flex justify-center gap-2 text-xs">
        {['all', 'listen', 'read'].map((m) => (
          <Link key={m} to={`/vocabulary?tab=review&mode=${m}`} className={`chip ${mode === m ? 'border-nile-500 text-nile-700' : 'border-stone-200 text-stone-500 dark:border-stone-700'}`}>{m === 'all' ? 'Mixed' : m === 'listen' ? 'Listening only' : 'Reading only'}</Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- browse
function Browse() {
  const [level, setLevel] = useState(1);
  const [q, setQ] = useState('');
  const { data: levels } = useApi<any[]>('/vocab/levels');
  const { data: words, loading } = useApi<any[]>(`/vocab?${q ? `q=${encodeURIComponent(q)}` : `level=${level}`}`, [level, q]);
  const ranges = ['1–100', '100–300', '300–500', '500–1,000', '1,000–1,500', '1,500–2,000'];
  const dot = (c: any) => <span className={`inline-block h-2.5 w-2.5 rounded-full ${!c ? 'bg-stone-200 dark:bg-stone-700' : c.state === 'review' ? (c.lapses >= 3 ? 'bg-red-400' : 'bg-nile-500') : 'bg-sand-400'}`} title={!c ? 'not started' : `${c.state}${c.lapses ? `, ${c.lapses} lapses` : ''}`} />;
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((l) => {
          const r = levels?.find((x) => x.level === l);
          return (
            <button key={l} onClick={() => { setLevel(l); setQ(''); }} className={`rounded-xl border p-3 text-start ${level === l && !q ? 'border-nile-500 bg-nile-50 dark:bg-nile-950' : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'}`}>
              <div className="text-sm font-semibold">Level {l}</div>
              <div className="text-xs text-stone-500">{ranges[l - 1]}</div>
              {r ? <div className="mt-2"><Bar value={(100 * r.learned) / r.total} h="h-1" /><div className="mt-1 text-[10px] text-stone-500">{r.learned}/{r.total} learned</div></div>
                : <div className="mt-2 text-[10px] text-stone-400">not seeded yet — see README (draft-vocab)</div>}
            </button>
          );
        })}
      </div>
      <div className="relative mb-3">
        <Search size={16} className="absolute start-3 top-3.5 text-stone-400" />
        <input className="input ps-9" placeholder="Search Arabic, English or transliteration…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mb-2 flex gap-4 text-xs text-stone-500"><span>Dots: <b>read</b> · <b>listen</b></span><span className="flex items-center gap-1">{dot({ state: 'review' })} known</span><span className="flex items-center gap-1">{dot({ state: 'learning' })} learning</span><span className="flex items-center gap-1">{dot({ state: 'review', lapses: 3 })} often forgotten</span></div>
      {loading ? <Spinner /> : (
        <div className="card divide-y divide-stone-100 !p-0 dark:divide-stone-800">
          {words?.map((w) => (
            <Link key={w.id} to={`/vocabulary/${w.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 dark:hover:bg-stone-800/50">
              <span className="w-10 text-xs text-stone-400">#{w.rank}</span>
              <span className="flex gap-1">{dot(w.read)}{dot(w.listen)}</span>
              <span className="ar w-36 truncate text-xl">{w.arabic}</span>
              <span className="hidden w-32 truncate text-sm text-stone-500 sm:block">{w.translit}</span>
              <span className="flex-1 truncate text-sm">{w.english}</span>
              <span className="hidden text-xs text-stone-400 md:block">{w.pos}</span>
              {!w.verified && <span className="rounded bg-sand-100 px-1.5 text-[10px] text-sand-600">unverified</span>}
            </Link>
          ))}
          {!words?.length && <p className="p-4 text-sm text-stone-500">No words.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- placement
function Placement() {
  const [level, setLevel] = useState(1);
  const { data: words, loading, reload } = useApi<any[]>(`/srs/placement?level=${level}`, [level]);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState('');
  const toggle = (id: number) => { const n = new Set(known); n.has(id) ? n.delete(id) : n.add(id); setKnown(n); };
  const submit = async () => {
    const r = await api('/srs/placement', { known: [...known] });
    setMsg(`${r.added} words fast-tracked. Their reading cards are scheduled days out; their listening cards will start testing you by ear right away.`);
    setKnown(new Set()); reload();
  };
  return (
    <div>
      <p className="mb-4 text-sm text-stone-500">You already know many common words. Tap every word you understand <b>instantly</b> when reading. Only the reading skill is fast-tracked — hearing a word quickly is a separate skill, so its listening card will still be tested.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((l) => <button key={l} onClick={() => setLevel(l)} className={`chip ${level === l ? 'border-nile-500 bg-nile-50 text-nile-800 dark:bg-nile-950 dark:text-nile-200' : 'border-stone-200 dark:border-stone-700'}`}>Level {l}</button>)}
      </div>
      {msg && <div className="mb-4 rounded-xl bg-nile-50 p-3 text-sm text-nile-800 dark:bg-nile-950 dark:text-nile-200">{msg}</div>}
      {loading ? <Spinner /> : !words?.length ? <Empty>All words in this level are already in your reviews.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {words.map((w) => (
              <button key={w.id} onClick={() => toggle(w.id)} className={`rounded-xl border p-3 text-center transition ${known.has(w.id) ? 'border-nile-500 bg-nile-50 dark:bg-nile-950' : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'}`}>
                <div className="ar text-2xl">{w.arabic}</div>
                <div className={`text-xs ${known.has(w.id) ? 'text-nile-700 dark:text-nile-300' : 'text-transparent'}`}>{w.english}</div>
                {known.has(w.id) && <Check size={14} className="mx-auto text-nile-600" />}
              </button>
            ))}
          </div>
          <div className="sticky bottom-20 mt-4 flex gap-2 md:bottom-4">
            <button className="btn-outline" onClick={() => setKnown(new Set(words.map((w) => w.id)))}>Select all</button>
            <button className="btn-primary flex-1" disabled={!known.size} onClick={submit}>I know these {known.size} words</button>
          </div>
        </>
      )}
    </div>
  );
}
