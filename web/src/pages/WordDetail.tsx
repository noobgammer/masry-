import { Link, useParams } from 'react-router-dom';
import { Ear, Eye } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { useSettings } from '../lib/store';
import { ArabicText, Notice, PlayButton, Spinner, Support } from '../components/ui';

const TIER = ['', 'Word', 'Expression', 'Simple sentence', 'With connectors', 'Multiple clauses', 'Natural response', 'Unfamiliar combination'];

export default function WordDetail() {
  const { id } = useParams();
  const { data: w } = useApi<any>(`/vocab/${id}`, [id]);
  const s = useSettings();
  if (!w) return <Spinner />;
  const card = (k: string) => w.cards.find((c: any) => c.skill === k);
  const ev = (m: string, c?: string) => {
    const rows = w.evidence.filter((e: any) => e.modality === m && (!c || e.context === c));
    const n = rows.reduce((a: number, r: any) => a + r.n, 0), ok = rows.reduce((a: number, r: any) => a + r.ok, 0);
    return n ? `${Math.round((100 * ok) / n)}% of ${n}` : '—';
  };
  const cs = (c: any) => (c ? `${c.state}${c.state === 'review' ? ` · next in ${Math.round(c.interval_days)}d` : ''}${c.lapses ? ` · forgotten ${c.lapses}×` : ''}` : 'not started');
  return (
    <div className="space-y-4">
      <Link to="/vocabulary?tab=browse" className="text-sm text-nile-700 hover:underline dark:text-nile-400">← All words</Link>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-stone-500">#{w.rank} · Level {w.level} · {w.pos} · {w.category}</div>
            <div className="ar mt-1 text-5xl font-semibold">{w.arabic}</div>
            <div className="mt-1 text-stone-500">{w.translit}</div>
            <div className="mt-2 text-xl font-semibold">{w.english}</div>
          </div>
          <div className="flex gap-2">
            <PlayButton text={w.arabic.split('/')[0]} voice="m" rate={s.defaultSpeed} />
            <PlayButton text={w.arabic.split('/')[0]} voice="f" rate={0.7} label="Slow" />
          </div>
        </div>
        {!w.verified && <div className="mt-3"><Notice>This entry was drafted by AI and hasn't been checked by a native speaker yet.</Notice></div>}
        {w.notes && <p className="mt-3 text-sm"><span className="label me-2">Variations & usage</span>{w.notes}</p>}
        {w.variants.length > 0 && <p className="mt-2 text-sm"><span className="label me-2">Forms you'll hear</span><span className="ar text-base">{w.variants.join(' · ')}</span></p>}
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800"><div className="flex items-center gap-1 font-semibold"><Eye size={14} /> Reading</div><div className="text-stone-500">{cs(card('read'))}</div><div className="text-stone-500">Correct when read: {ev('read')}</div></div>
          <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800"><div className="flex items-center gap-1 font-semibold"><Ear size={14} /> Listening</div><div className="text-stone-500">{cs(card('listen'))}</div><div className="text-stone-500">Heard alone: {ev('listen', 'isolated')} · in sentences: {ev('listen', 'sentence')}</div></div>
        </div>
        <Link to={`/context?word=${w.id}`} className="btn-primary mt-4">Practise this word in context</Link>
      </div>

      {w.ladder.length > 0 && (
        <section className="card">
          <h2 className="mb-1 font-semibold">From simple to natural</h2>
          <p className="mb-4 text-sm text-stone-500">The same word in sentences of growing length and complexity — tap any word for its meaning and structure.</p>
          <div className="space-y-5">
            {w.ladder.map((x: any) => <SentenceRow key={x.id} x={x} label={`Tier ${x.tier} · ${TIER[x.tier]}`} />)}
          </div>
        </section>
      )}
      {(w.sentences.length > 0 || w.lines.length > 0) && (
        <section className="card">
          <h2 className="mb-4 font-semibold">Elsewhere in your material</h2>
          <div className="space-y-5">
            {w.sentences.map((x: any) => <SentenceRow key={x.id} x={x} label={`Tier ${x.tier}`} />)}
            {w.lines.map((l: any, i: number) => (
              <div key={i} className="flex items-start gap-3">
                <PlayButton text={l.ar} size="sm" rate={s.defaultSpeed} />
                <div className="flex-1">
                  <p className="ar text-xl">{l.ar}</p>
                  <Support english={l.en} />
                  <Link to={`/${l.section === 'reading' ? 'reading' : 'input'}/${l.item_id}`} className="text-xs text-nile-700 hover:underline dark:text-nile-400">from “{l.title}”</Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SentenceRow({ x, label }: { x: any; label: string }) {
  const s = useSettings();
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col gap-1">
        <PlayButton text={x.arabic} size="sm" voice="m" rate={s.defaultSpeed} />
        <PlayButton text={x.arabic} size="sm" voice="f" rate={1.25} label="" className="!bg-sand-500" />
      </div>
      <div className="flex-1">
        <div className="label mb-0.5">{label}</div>
        <ArabicText tokens={x.tokens} className="text-xl" context="sentence" />
        <Support translit={x.translit} english={x.english} />
      </div>
    </div>
  );
}
