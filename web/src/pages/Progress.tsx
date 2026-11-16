import { Link } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { fmtMs } from '../lib/api';
import { Bar, PageHeader, Spinner } from '../components/ui';

const TIER = ['', 'Words', 'Expressions', 'Simple', 'Connectors', 'Multi-clause', 'Natural replies', 'Unfamiliar'];

export default function Progress() {
  const { data: p } = useApi<any>('/progress');
  if (!p) return <Spinner />;
  const b = p.buckets;
  return (
    <div className="space-y-6">
      <PageHeader title="Progress" ar="تقدمك" sub="Eight skills measured independently. Knowing a word on paper and catching it at speed are different things — this page keeps them apart." />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Big label="Words learned" value={b.learned} sub={`${b.introduced} started`} />
        <Big label="Recognised instantly" value={b.instantCount} sub={`${b.instantListen} instantly by ear`} />
        <Big label="Arabic heard" value={`${p.exposure.totalHours.toFixed(1)} h`} sub={`${Math.round(p.exposure.todayMinutes)} min today`} />
        <Big label="Comfortable speed" value={p.speed ? `${p.speed}×` : '—'} sub={`avg. response ${fmtMs(p.response.overall)}`} />
        <Big label="Listening comprehension" value={p.input?.score != null ? `${p.input.score}%` : '—'} sub="full conversations & stories" />
        <Big label="Streak" value={`${p.streak.current} days`} sub={<StreakDots days={p.streak.last30} />} />
        <Big label="Often forgotten" value={b.counts.forgotten} sub="3+ lapses" />
        <Big label="Read ≫ heard" value={b.counts.readNotHeard} sub="know by sight, not by ear" />
      </section>

      <section className="card">
        <h2 className="mb-4 font-semibold">Skills</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {p.skills.map((s: any) => (
            <div key={s.key}>
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{s.label}</span>
                <span className="text-lg font-bold">{s.score != null ? `${s.score}%` : '—'}{s.trend != null && <span className={`ms-1 text-xs ${s.trend >= 0 ? 'text-nile-600' : 'text-red-500'}`}>{s.trend >= 0 ? '▲' : '▼'}{Math.abs(s.trend)}</span>}</span>
              </div>
              <Bar value={s.score} className={s.score == null ? '' : s.score >= 80 ? 'bg-nile-500' : s.score >= 60 ? 'bg-sand-400' : 'bg-red-400'} />
              <div className="mt-0.5 text-xs text-stone-500">{s.desc} · {s.n} answers</div>
              <Spark history={p.history.filter((h: any) => h.skill === s.key)} />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Diagnosis</h2>
        <ul className="space-y-3">
          {p.insights.map((i: any) => (
            <li key={i.id} className="flex gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${i.severity === 'high' ? 'bg-red-500' : i.severity === 'medium' ? 'bg-sand-500' : 'bg-stone-400'}`} />
              <div className="text-sm">{i.text} {i.action && <Link className="font-semibold text-nile-700 hover:underline dark:text-nile-400" to={i.action.path}>{i.action.label} →</Link>}</div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold">Sentence complexity</h2>
          {p.tiers.length ? p.tiers.map((t: any) => (
            <div key={t.tier} className="mb-2"><div className="flex justify-between text-sm"><span>Tier {t.tier} · {TIER[t.tier]}</span><span>{Math.round(t.acc * 100)}% <span className="text-xs text-stone-500">({t.n})</span></span></div><Bar value={t.acc * 100} h="h-1.5" /></div>
          )) : <p className="text-sm text-stone-500">Do some contextual listening to see this.</p>}
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold">Frequency levels — read vs. heard</h2>
          {p.levels.map((l: any) => (
            <div key={l.level} className="mb-3">
              <div className="flex justify-between text-sm"><span>Level {l.level}</span><span className="text-xs text-stone-500">{l.read} read · {l.listen} heard / {l.total}</span></div>
              <Bar value={(100 * l.read) / l.total} h="h-1.5" className="bg-stone-500" />
              <div className="mt-0.5"><Bar value={(100 * l.listen) / l.total} h="h-1.5" /></div>
            </div>
          ))}
          <p className="text-xs text-stone-500">Grey: reading skill · Green: listening skill</p>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <WordList title="Often forgotten" words={b.forgotten} extra={(w: any) => `${w.lapses}×`} />
        <WordList title="Known by sight, not by ear" words={b.readNotHeard} extra={(w: any) => `${w.read}/${w.listen}`} />
        <WordList title="Known alone, lost in sentences" words={b.isolatedOnly} extra={(w: any) => `${w.contextAccuracy}%`} />
      </div>
      <WordList title="Recognised instantly" words={b.instant} />
    </div>
  );
}

function Big({ label, value, sub }: { label: string; value: any; sub?: any }) {
  return <div className="card !p-4"><div className="label">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div>{sub && <div className="text-xs text-stone-500">{sub}</div>}</div>;
}
function StreakDots({ days }: { days: { day: string; active: boolean }[] }) {
  return <span className="mt-1 flex gap-[2px]">{days.map((d) => <span key={d.day} title={d.day} className={`h-2 w-1.5 rounded-sm ${d.active ? 'bg-nile-500' : 'bg-stone-200 dark:bg-stone-700'}`} />)}</span>;
}
function Spark({ history }: { history: { day: string; s: number }[] }) {
  if (history.length < 2) return null;
  const w = 200, h = 28;
  const pts = history.map((x, i) => `${(i / (history.length - 1)) * w},${h - x.s * h}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-7 w-full" preserveAspectRatio="none" aria-label="30-day trend"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-nile-500" /></svg>;
}
function WordList({ title, words, extra }: { title: string; words: any[]; extra?: (w: any) => string }) {
  return (
    <section className="card">
      <h2 className="mb-2 font-semibold">{title} <span className="text-sm font-normal text-stone-500">({words.length})</span></h2>
      {words.length ? (
        <div className="flex flex-wrap gap-1.5">
          {words.slice(0, 30).map((w) => <Link key={w.id} to={`/vocabulary/${w.id}`} className="chip border-stone-200 dark:border-stone-700" title={w.english}><span className="ar">{w.arabic}</span>{extra && <span className="text-[10px] text-stone-500">{extra(w)}</span>}</Link>)}
        </div>
      ) : <p className="text-sm text-stone-500">None yet.</p>}
    </section>
  );
}
