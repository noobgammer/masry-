import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, Flag, Languages, MessageSquarePlus, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { play, setExposureKind, stop } from '../lib/audio';
import { useApi, usePlanBlock } from '../lib/hooks';
import { useApp } from '../lib/store';
import { ErrorBox, Notice, PageHeader, Spinner } from '../components/ui';
import { AnswerBox } from './Lab';

const TOPICS = ['Football', 'University', 'Gym', 'Food', 'Daily life', 'Friends', 'Relationships', 'Travel', 'Religion', 'General chat', 'Work', 'Weekend plans', 'Films & series'];
const MODES = [
  { k: 'learning', label: 'Learning', desc: 'Slow, clear, short sentences', rate: 0.85 },
  { k: 'natural', label: 'Natural', desc: 'Normal conversational Egyptian', rate: 1 },
  { k: 'challenge', label: 'Challenge', desc: 'Fast, slang, fillers — no simplifying', rate: 1.2 },
];

export default function Conversations() {
  usePlanBlock('speaking');
  const { id } = useParams();
  const { status } = useApp();
  useEffect(() => { setExposureKind('conversation'); return () => setExposureKind('audio'); }, []);
  if (id) return <Chat id={Number(id)} />;
  return (
    <div>
      <PageHeader title="Conversations" ar="دردشة" sub="Talk with Youssef, a 27-year-old Cairene. He only speaks Egyptian Arabic, won't stop to correct you, and keeps notes on your mistakes for after the conversation." />
      {!status?.ai && <div className="mb-4"><Notice>The conversation partner needs <code>ANTHROPIC_API_KEY</code> set on the server. Until then, use <Link className="underline" to="/lab/unexpected">Unexpected responses (scripted)</Link> for speaking practice.</Notice></div>}
      <NewConversation disabled={!status?.ai} />
      <History />
    </div>
  );
}

function NewConversation({ disabled }: { disabled: boolean }) {
  const nav = useNavigate();
  const [topic, setTopic] = useState('Daily life');
  const [custom, setCustom] = useState('');
  const [mode, setMode] = useState('natural');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/conversations', { topic: custom || topic, mode }); nav(`/conversations/${r.id}`); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="card mb-6 space-y-4">
      <div>
        <div className="label mb-2">Topic</div>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => <button key={t} onClick={() => { setTopic(t); setCustom(''); }} className={`chip ${topic === t && !custom ? 'border-nile-500 bg-nile-50 text-nile-800 dark:bg-nile-950 dark:text-nile-200' : 'border-stone-200 dark:border-stone-700'}`}>{t}</button>)}
        </div>
        <input className="input mt-2" placeholder="…or anything else (e.g. 'my landlord raised the rent')" value={custom} onChange={(e) => setCustom(e.target.value)} />
      </div>
      <div>
        <div className="label mb-2">Listening difficulty</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button key={m.k} onClick={() => setMode(m.k)} className={`rounded-xl border p-3 text-start ${mode === m.k ? 'border-nile-500 bg-nile-50 dark:bg-nile-950' : 'border-stone-200 dark:border-stone-700'}`}>
              <div className="font-semibold">{m.label}</div><div className="text-xs text-stone-500">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={err} />
      <button className="btn-primary" disabled={disabled || busy} onClick={start}>{busy ? <Spinner /> : <><MessageSquarePlus size={16} /> Start talking</>}</button>
    </div>
  );
}

function History() {
  const { data } = useApi<any[]>('/conversations');
  if (!data?.length) return null;
  return (
    <section>
      <h2 className="mb-2 font-semibold">Past conversations</h2>
      <div className="card divide-y divide-stone-100 !p-0 dark:divide-stone-800">
        {data.map((c) => (
          <Link key={c.id} to={`/conversations/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800/50">
            <span><b>{c.topic}</b> <span className="text-sm capitalize text-stone-500">· {c.mode} · {c.n} messages</span></span>
            <span className="text-xs text-stone-500">{new Date(c.updated_at).toLocaleDateString()}{c.ended ? ' · feedback ✓' : ''}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Chat({ id }: { id: number }) {
  const { data: conv, setData } = useApi<any>(`/conversations/${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hideText, setHideText] = useState(true);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [english, setEnglish] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(0);
  const [panel, setPanel] = useState<'none' | 'corrections' | 'summary'>('none');
  const [feedback, setFeedback] = useState<any[] | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const rate = MODES.find((m) => m.k === conv?.mode)?.rate || 1;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conv?.messages.length, busy]);
  useEffect(() => {
    if (!conv) return;
    setPending(conv.evaluations.filter((e: any) => e.corrections?.length).length);
    if (conv.summary) setSummary(conv.summary);
    const last = conv.messages[conv.messages.length - 1];
    if (last?.role === 'assistant' && conv.messages.length === 1) play(last.content, { voice: 'm', rate }).catch(() => {});
    return () => stop();
  }, [conv?.id]);
  if (!conv) return <Spinner />;
  const send = async (text: string, ms: number, via: string) => {
    setBusy(true); setErr(null);
    const msgs = [...conv.messages, { role: 'user', content: text, via }];
    setData({ ...conv, messages: msgs });
    try {
      const r = await api(`/conversations/${id}/message`, { text, ms, via });
      setData({ ...conv, messages: [...msgs, r.reply] });
      setPending(r.pendingCorrections);
      play(r.reply.content, { voice: 'm', rate }).catch(() => {});
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const showCorrections = async () => { setPanel('corrections'); setFeedback(await api(`/conversations/${id}/feedback`)); };
  const end = async () => { setPanel('summary'); if (!summary) { setBusy(true); try { setSummary((await api(`/conversations/${id}/end`, {})).summary); } catch (e: any) { setErr(e.message); } setBusy(false); } };
  const tog = (set: Set<number>, fn: (s: Set<number>) => void, i: number) => { const n = new Set(set); n.has(i) ? n.delete(i) : n.add(i); fn(n); };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col md:h-[calc(100vh-7rem)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link to="/conversations" className="text-sm text-nile-700 hover:underline dark:text-nile-400">←</Link>
        <h1 className="font-bold">{conv.topic}</h1><span className="chip border-stone-200 text-xs capitalize dark:border-stone-700">{conv.mode}</span>
        <div className="flex-1" />
        <button className="btn-ghost !py-1.5 text-xs" onClick={() => setHideText(!hideText)}>{hideText ? <><Eye size={14} /> Show his text</> : <><EyeOff size={14} /> Listen-first mode</>}</button>
        <button className="btn-outline !py-1.5 text-xs" onClick={showCorrections}><Flag size={14} /> Corrections{pending ? ` (${pending})` : ''}</button>
        <button className="btn-primary !py-1.5 text-xs" onClick={end}>End & feedback</button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-stone-100/60 p-3 dark:bg-stone-900/60">
        {conv.messages.map((m: any, i: number) => m.role === 'assistant' ? (
          <div key={i} className="flex max-w-[85%] flex-col items-start">
            <div className="rounded-2xl rounded-ss-sm bg-white px-4 py-2.5 shadow-sm dark:bg-stone-800">
              <div className="mb-1 flex items-center gap-2 text-xs text-stone-500">
                <span className="font-semibold text-nile-700 dark:text-nile-300">يوسف</span>
                <button onClick={() => play(m.content, { voice: 'm', rate }).catch(() => {})} aria-label="Play"><Volume2 size={14} /></button>
                <button onClick={() => play(m.content, { voice: 'm', rate: 0.75 }).catch(() => {})} className="text-[10px]">slow</button>
                {hideText && <button onClick={() => tog(revealed, setRevealed, i)} className="text-[10px] underline">{revealed.has(i) ? 'hide' : 'show text'}</button>}
                <button onClick={() => tog(english, setEnglish, i)} title="English"><Languages size={14} /></button>
              </div>
              <p className={`ar text-lg ${hideText && !revealed.has(i) ? 'blur-text' : ''}`} onClick={() => hideText && tog(revealed, setRevealed, i)}>{m.content}</p>
              {english.has(i) && <p className="mt-1 text-sm text-stone-500">{m.en}<br /><i className="text-xs">{m.translit}</i></p>}
            </div>
          </div>
        ) : (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-se-sm bg-nile-600 px-4 py-2.5 text-white shadow-sm"><p className="ar text-lg">{m.content}</p>{m.via === 'voice' && <p className="text-[10px] opacity-70">🎤 voice</p>}</div>
          </div>
        ))}
        {busy && <div className="flex gap-1 p-2"><span className="h-2 w-2 animate-bounce rounded-full bg-stone-400" /><span className="h-2 w-2 animate-bounce rounded-full bg-stone-400 [animation-delay:.1s]" /><span className="h-2 w-2 animate-bounce rounded-full bg-stone-400 [animation-delay:.2s]" /></div>}
        <div ref={endRef} />
      </div>
      <ErrorBox error={err} />
      {!summary && <div className="mt-3"><AnswerBox disabled={busy} onSubmit={send} /></div>}
      <p className="mt-1 text-center text-[11px] text-stone-500">Tip: use the mic and answer without composing in English first. Mistakes are fine — they're saved for later.</p>

      {panel !== 'none' && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4" onClick={() => setPanel('none')}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 md:rounded-3xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
            {panel === 'corrections' && (
              <>
                <h2 className="mb-3 text-lg font-bold">Notes on your messages</h2>
                {!feedback ? <Spinner /> : !feedback.length ? <p className="text-sm text-stone-500">Nothing yet.</p> : feedback.map((e, i) => <EvalCard key={i} e={e} />)}
              </>
            )}
            {panel === 'summary' && (
              <>
                <h2 className="mb-3 text-lg font-bold">Conversation feedback</h2>
                {!summary ? (busy ? <Spinner /> : <p className="text-sm text-stone-500">Say something first!</p>) : (
                  <div className="space-y-4 text-sm">
                    <p>{summary.overall_en}</p>
                    {summary.strengths.length > 0 && <div><div className="label mb-1">Strengths</div><ul className="list-disc space-y-1 ps-5">{summary.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>}
                    {summary.focus_points.length > 0 && <div><div className="label mb-1">Work on</div><ul className="list-disc space-y-1 ps-5">{summary.focus_points.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>}
                    {summary.corrections.length > 0 && <div><div className="label mb-1">Key corrections</div>{summary.corrections.map((c: any, i: number) => <Correction key={i} c={c} />)}</div>}
                    {summary.useful_phrases.length > 0 && <div><div className="label mb-1">Phrases to steal</div>{summary.useful_phrases.map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 py-1"><button onClick={() => play(p.ar, { voice: 'm' }).catch(() => {})}><Volume2 size={14} /></button><span className="ar text-lg">{p.ar}</span><span className="text-stone-500">— {p.en}</span></div>))}</div>}
                    <Link to="/conversations" className="btn-primary">New conversation</Link>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EvalCard({ e }: { e: any }) {
  return (
    <div className="mb-3 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
      <p className="ar text-lg">{e.said}</p>
      <div className="mt-1 flex gap-3 text-xs text-stone-500"><span>Understandable {Math.round(e.understandable)}%</span><span>Sounds Egyptian {Math.round(e.naturalness)}%</span>{!e.answered_question && <span className="text-sand-600">didn't answer his question</span>}</div>
      {e.corrections.map((c: any, i: number) => <Correction key={i} c={c} />)}
      {e.more_natural && <p className="mt-2 text-sm">More natural: <span className="ar text-lg text-nile-700 dark:text-nile-300">{e.more_natural}</span></p>}
      {e.notes && <p className="mt-1 text-xs text-stone-500">{e.notes}</p>}
    </div>
  );
}
function Correction({ c }: { c: any }) {
  return (
    <div className="mt-2 rounded-lg bg-stone-50 p-2 text-sm dark:bg-stone-800">
      <span className="ar text-red-600 line-through">{c.original}</span> → <span className="ar font-semibold text-nile-700 dark:text-nile-300">{c.corrected}</span>
      <p className="text-xs text-stone-500">{c.explanation}</p>
    </div>
  );
}
