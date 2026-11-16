import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Film, Plus, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, usePlanBlock } from '../lib/hooks';
import { useApp } from '../lib/store';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';

export const BANDS = ['', 'Beginner', 'Elementary', 'Intermediate', 'Upper intermediate', 'Advanced'];

export default function InputLibrary() {
  usePlanBlock('input');
  const { data, loading, reload } = useApi<any>('/input');
  const [showImport, setShowImport] = useState(false);
  if (loading || !data) return <Spinner />;
  const rec = data.items.find((i: any) => i.id === data.recommended);
  return (
    <div>
      <PageHeader title="Comprehensible input" ar="استماع" sub="Lots of understandable Egyptian Arabic. Listen to the whole thing first — no transcript — answer the questions, and only then look at the text.">
        <button className="btn-outline" onClick={() => setShowImport(!showImport)}><Plus size={16} /> Import YouTube / podcast</button>
      </PageHeader>
      {showImport && <ImportForm onDone={() => { setShowImport(false); reload(); }} />}
      {rec && (
        <Link to={`/input/${rec.id}`} className="card mb-6 flex items-center gap-4 border-nile-300 bg-gradient-to-r from-nile-50 to-white transition hover:border-nile-500 dark:border-nile-800 dark:from-nile-950 dark:to-stone-900">
          <Star className="shrink-0 text-sand-500" />
          <div className="flex-1">
            <div className="label">Recommended next · {BANDS[rec.difficulty]}</div>
            <div className="text-lg font-semibold">{rec.title} <span className="ar ms-1 text-nile-700 dark:text-nile-300">{rec.title_ar}</span></div>
            <div className="text-sm text-stone-500">You already know ~{rec.coverage}% of its words — ideal input is 90–98%. Target level: {BANDS[data.targetDifficulty]}.</div>
          </div>
        </Link>
      )}
      {[1, 2, 3, 4, 5].map((d) => {
        const items = data.items.filter((i: any) => i.difficulty === d);
        if (!items.length) return null;
        return (
          <section key={d} className="mb-6">
            <h2 className="mb-2 font-semibold">{BANDS[d]}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((i: any) => (
                <Link key={i.id} to={`/input/${i.id}`} className="card !p-4 transition hover:border-nile-400">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{i.title}</div>
                    {i.progress?.completed && <CheckCircle2 size={18} className="shrink-0 text-nile-600" />}
                  </div>
                  <div className="ar text-nile-700 dark:text-nile-300">{i.title_ar}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500">
                    <span>{i.kind === 'video' ? <><Film size={12} className="inline" /> video</> : i.kind}</span><span>· {i.topic}</span><span>· {i.lines} lines</span>
                    {i.own && <span className="rounded bg-sand-100 px-1 text-sand-600">imported{!i.verified && ', AI-translated'}</span>}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"><div className={`h-full ${i.coverage >= 90 ? 'bg-nile-500' : i.coverage >= 75 ? 'bg-sand-400' : 'bg-red-400'}`} style={{ width: `${i.coverage}%` }} /></div>
                    <span className="text-stone-500">{i.coverage}% known</span>
                  </div>
                  {i.progress && <div className="mt-1 text-xs text-stone-500">Best score {Math.round(i.progress.best * 100)}% · {i.progress.attempts} attempt{i.progress.attempts > 1 ? 's' : ''}</div>}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const { status } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ title: '', youtube: '', text: '', difficulty: 5 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/input/import', f); onDone(); nav(`/input/${r.id}`); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card mb-6 space-y-3">
      <h3 className="font-semibold">Import authentic content</h3>
      <p className="text-sm text-stone-500">Paste an Egyptian YouTube video / interview / podcast link and its Arabic transcript (one sentence per line; optional timestamps like <code>1:23 جملة</code> sync the video; optional <code>| English</code> after a line). Missing translations and questions are drafted by AI {status?.ai ? '' : '(needs ANTHROPIC_API_KEY)'} and marked unverified.</p>
      <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input className="input" placeholder="YouTube URL (optional)" value={f.youtube} onChange={(e) => setF({ ...f, youtube: e.target.value })} />
      <textarea className="input ar min-h-40 text-lg" dir="rtl" placeholder={'0:05 أهلاً بيكم في حلقة جديدة\n0:09 النهارده هنتكلم عن...'} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
      <label className="flex items-center gap-2 text-sm">Difficulty <select className="input !w-auto" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{BANDS[d]}</option>)}</select></label>
      <ErrorBox error={err} />
      <button className="btn-primary" disabled={busy || !f.title || !f.text} onClick={submit}>{busy ? <Spinner /> : 'Import'}</button>
    </div>
  );
}
