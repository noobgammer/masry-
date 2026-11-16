import { useEffect, useRef, useState } from 'react';
import { Check, Flag, Mic, Square, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Bar, ErrorBox, PageHeader, PlayButton, Spinner } from '../components/ui';

/**
 * Native Speaker Studio: an Egyptian friend records sentences in their own voice (overrides TTS everywhere),
 * and can flag anything that sounds unnatural. This is how the content becomes genuinely authentic.
 */
export default function Studio() {
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  const { data, reload } = useApi<any>(`/studio/queue?filter=${filter}`, [filter]);
  const [speaker, setSpeaker] = useState(() => localStorage.getItem('masry-speaker') || '');
  useEffect(() => { try { localStorage.setItem('masry-speaker', speaker); } catch {} }, [speaker]);
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title="Native Speaker Studio" ar="سجّل بصوتك" sub="Hand this page to an Egyptian friend. Each recording replaces the synthetic voice for that sentence everywhere in the app — real connected speech, real reductions, real accents. They can also flag anything that doesn't sound like how Egyptians talk." />
      <div className="card mb-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label><span className="label">Speaker name (so we can mix several real voices)</span><input className="input mt-1" value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="e.g. Ahmed (Cairo)" /></label>
        <div className="text-sm"><b>{data.recorded}</b> / {data.total} recorded<Bar value={(100 * data.recorded) / data.total} h="h-1.5" /></div>
      </div>
      <div className="mb-3 flex gap-2 text-sm">
        <button onClick={() => setFilter('todo')} className={`chip ${filter === 'todo' ? 'border-nile-500' : 'border-stone-200 dark:border-stone-700'}`}>Not recorded</button>
        <button onClick={() => setFilter('all')} className={`chip ${filter === 'all' ? 'border-nile-500' : 'border-stone-200 dark:border-stone-700'}`}>All</button>
      </div>
      {!speaker && <p className="mb-3 text-sm text-sand-600">Enter a speaker name to start recording.</p>}
      <div className="space-y-2">{data.items.map((it: any, k: number) => <Row key={`${it.type}-${it.id}-${it.line ?? ''}-${k}`} it={it} speaker={speaker} onSaved={reload} />)}</div>
    </div>
  );
}

function Row({ it, speaker, onSaved }: { it: any; speaker: string; onSaved: () => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [state, setState] = useState<'idle' | 'saved' | 'flag'>(it.recorded ? 'saved' : 'idle');
  const [err, setErr] = useState<string | null>(null);
  const [flag, setFlag] = useState({ suggestion: it.arabic, comment: '' });
  const chunks = useRef<Blob[]>([]);
  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.onstop = () => { setBlob(new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })); stream.getTracks().forEach((t) => t.stop()); };
      mr.start(); setRec(mr);
    } catch (e: any) { setErr(`Microphone unavailable: ${e.message}`); }
  };
  const stopRec = () => { rec?.stop(); setRec(null); };
  const upload = async () => {
    if (!blob) return;
    const r = await fetch(`/api/audio/native?text=${encodeURIComponent(it.arabic)}&speaker=${encodeURIComponent(speaker)}`, { method: 'POST', headers: { 'content-type': blob.type.split(';')[0] }, body: blob });
    if (!r.ok) return setErr('Upload failed');
    setBlob(null); setState('saved'); onSaved();
  };
  const sendFlag = async () => { await api('/flags', { item_type: it.type, item_id: it.id, arabic: it.arabic, suggestion: flag.suggestion, comment: flag.comment }); setState(it.recorded ? 'saved' : 'idle'); };
  return (
    <div className="card !p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1"><p className="ar text-xl">{it.arabic}</p><p className="text-xs text-stone-500">{it.english}{it.title ? ` · ${it.title}` : ''}</p></div>
        {state === 'saved' && <span className="chip border-nile-300 text-xs text-nile-700"><Check size={12} /> recorded</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!rec ? <button className="btn-outline !py-1.5 text-xs" disabled={!speaker} onClick={start}><Mic size={14} /> {state === 'saved' ? 'Re-record' : 'Record'}</button>
          : <button className="btn !py-1.5 bg-red-500 text-xs text-white" onClick={stopRec}><Square size={14} /> Stop</button>}
        {blob && <><audio src={URL.createObjectURL(blob)} controls className="h-8" /><button className="btn-primary !py-1.5 text-xs" onClick={upload}><Upload size={14} /> Save</button></>}
        <PlayButton text={it.arabic} size="sm" />
        <button className="btn-ghost !py-1.5 text-xs" onClick={() => setState('flag')}><Flag size={14} /> Doesn't sound Egyptian</button>
      </div>
      {state === 'flag' && (
        <div className="mt-3 space-y-2">
          <textarea className="input ar text-lg" dir="rtl" value={flag.suggestion} onChange={(e) => setFlag({ ...flag, suggestion: e.target.value })} />
          <input className="input" placeholder="What's wrong? (optional)" value={flag.comment} onChange={(e) => setFlag({ ...flag, comment: e.target.value })} />
          <button className="btn-primary !py-1.5 text-xs" onClick={sendFlag}>Submit correction</button>
        </div>
      )}
      <ErrorBox error={err} />
    </div>
  );
}
