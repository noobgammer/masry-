import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Languages } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { ArabicText, Mcq, PageHeader, Spinner } from '../components/ui';
import { BANDS } from './InputLibrary';

export default function Reading() {
  const { id } = useParams();
  return id ? <ChatReader id={Number(id)} /> : <ReadingList />;
}

function ReadingList() {
  const { data } = useApi<any>('/reading');
  const { data: struggles } = useApi<any[]>('/reading-struggles');
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title="Reading messages" ar="قراية" sub="Real-style WhatsApp chats: casual spelling, slang, Franco (3arabizi). English is hidden — work out the meaning from the Arabic, tap words only when stuck." />
      <div className="grid gap-3 sm:grid-cols-2">
        {data.items.map((i: any) => (
          <Link key={i.id} to={`/reading/${i.id}`} className="card !p-4 transition hover:border-nile-400">
            <div className="flex justify-between gap-2"><span className="font-semibold">{i.title}</span>{i.progress?.completed && <CheckCircle2 size={18} className="text-nile-600" />}</div>
            <div className="ar text-nile-700 dark:text-nile-300">{i.title_ar}</div>
            <div className="mt-1 text-xs text-stone-500">{BANDS[i.difficulty]} · {i.topic} · {i.lines} messages · {i.coverage}% known{/franco/i.test(i.title) ? ' · Franco' : ''}</div>
          </Link>
        ))}
      </div>
      {struggles && struggles.length > 0 && (
        <section className="card mt-6">
          <h2 className="mb-2 font-semibold">Words you keep looking up while reading</h2>
          <div className="flex flex-wrap gap-2">
            {struggles.map((w) => <Link key={w.id} to={`/vocabulary/${w.id}`} className="chip border-stone-200 dark:border-stone-700"><span className="ar text-lg">{w.arabic}</span><span className="text-xs text-stone-500">{w.english} · {w.n}×</span></Link>)}
          </div>
        </section>
      )}
    </div>
  );
}

function ChatReader({ id }: { id: number }) {
  const { data: item } = useApi<any>(`/reading/${id}`, [id]);
  const [showArabic, setShowArabic] = useState<Set<number>>(new Set());
  const [showEn, setShowEn] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [res, setRes] = useState<any>(null);
  if (!item) return <Spinner />;
  const t = (s: Set<number>, f: (x: Set<number>) => void, i: number) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); f(n); };
  const submit = async () => setRes(await api(`/reading/${id}/answers`, { answers, revealedEnglish: showEn.size > 0 }));
  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/reading" className="text-sm text-nile-700 hover:underline dark:text-nile-400">← Chats</Link>
      <h1 className="mb-3 mt-1 text-xl font-bold">{item.title} <span className="ar ms-1 text-nile-700 dark:text-nile-300">{item.title_ar}</span></h1>
      <div className="space-y-2 rounded-3xl bg-[#e9e3d8] p-3 sm:p-5 dark:bg-[#0b141a]">
        {item.lines.map((l: any, i: number) => {
          const me = l.speaker === item.me;
          return (
            <div key={i} className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${me ? 'rounded-se-sm bg-[#d9fdd3] dark:bg-[#005c4b]' : 'rounded-ss-sm bg-white dark:bg-[#202c33]'}`}>
                {!me && <div className="text-xs font-semibold text-sand-600">{l.speaker}</div>}
                {l.franco ? (
                  <>
                    <p className="text-base" dir="ltr">{l.franco}</p>
                    {showArabic.has(i) && <ArabicText tokens={l.tokens} className="mt-1 text-lg" context="reading" />}
                  </>
                ) : <ArabicText tokens={l.tokens} className="text-lg" context="reading" />}
                {showEn.has(i) && <p className="mt-1 border-t border-black/5 pt-1 text-sm text-stone-600 dark:text-stone-300">{l.en}</p>}
                <div className="mt-0.5 flex justify-end gap-3 text-[11px] text-stone-500">
                  {l.franco && <button onClick={() => t(showArabic, setShowArabic, i)}>{showArabic.has(i) ? 'hide' : 'عربي'}</button>}
                  <button onClick={() => t(showEn, setShowEn, i)} title="English"><Languages size={12} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-stone-500">Tap any Arabic word for its meaning (it's logged as a word you struggled with). Franco: 3 = ع, 7 = ح, 2 = ء/ق, 5 = خ.</p>
      {item.questions.length > 0 && (
        <div className="card mt-4 space-y-4">
          <h2 className="font-semibold">Did you get it?</h2>
          {item.questions.map((q: any, i: number) => {
            const r = res?.results[i];
            return (
              <div key={i}>
                <p className="ar text-lg font-semibold">{q.q}</p>
                <Mcq dirAr options={q.options.map((o: any) => o.text)} picked={r ? q.options.findIndex((o: any) => o.k === answers[i]) : null} correct={r ? q.options.findIndex((o: any) => o.k === r.answer) : null}
                  onAnswer={(j) => { const a = [...answers]; a[i] = q.options[j].k; setAnswers(a); }} />
              </div>
            );
          })}
          {!res ? <button className="btn-primary w-full" disabled={item.questions.some((_: any, i: number) => answers[i] == null)} onClick={submit}>Check</button>
            : <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800"><b className="text-xl">{Math.round(res.score * 100)}%</b> {showEn.size > 0 && <span className="text-sm text-stone-500"> · you opened {showEn.size} translation{showEn.size > 1 ? 's' : ''} — next time try without.</span>}</div>}
        </div>
      )}
    </div>
  );
}
