import { Link } from 'react-router-dom';
import { ArrowRight, Flame, Gauge, Headphones, Lightbulb, Radio, Sparkles, Timer } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { browserVoiceStatus } from '../lib/audio';
import { Bar, Notice, Spinner } from '../components/ui';

export default function Dashboard() {
  const { data: d } = useApi<any>('/dashboard');
  if (!d) return <div className="flex justify-center py-20"><Spinner /></div>;
  const totalPlan = d.plan.reduce((s: number, b: any) => s + b.minutes, 0);
  const donePlan = d.plan.reduce((s: number, b: any) => s + b.done, 0);
  const bv = browserVoiceStatus();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  const listening = d.scores.input?.score ?? d.scores.sentence?.score;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ar text-lg text-nile-700 dark:text-nile-400">{greet} يا {d.name}</p>
          <h1 className="text-2xl font-bold md:text-3xl">Today's listening</h1>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-sand-100 px-4 py-2 text-sand-600 dark:bg-stone-900">
          <Flame size={20} /> <span className="text-xl font-bold">{d.streak.current}</span> <span className="text-sm">day streak{d.streak.doneToday ? '' : ' — keep it alive today'}</span>
        </div>
      </div>

      {(!d.audio.azure || !d.audio.ai) && (
        <div className="space-y-2">
          {!d.audio.azure && (
            <Notice tone={bv.egyptian ? 'nile' : 'sand'}>
              <b>Audio:</b> no Egyptian neural voice is configured on the server, so audio uses your browser's voice
              {bv.available ? <> (<i>{bv.name}</i>{bv.egyptian ? ' — Egyptian ✓' : ' — not Egyptian, pronunciation will be off'})</> : ' (none found)'}.
              For authentic audio set <code>AZURE_SPEECH_KEY</code>/<code>AZURE_SPEECH_REGION</code>, or record a native friend in the <Link className="underline" to="/studio">Native Speaker Studio</Link>.
            </Notice>
          )}
          {!d.audio.ai && <Notice><b>AI partner:</b> set <code>ANTHROPIC_API_KEY</code> on the server to enable conversations and AI-generated unexpected questions. Everything else works offline.</Notice>}
        </div>
      )}

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Daily plan · {Math.round(donePlan)} / {totalPlan} min</h2>
          <Link to="/passive" className="btn-ghost !py-1.5 text-xs"><Radio size={14} /> Passive listening</Link>
        </div>
        <Bar value={(100 * donePlan) / totalPlan} h="h-2.5" />
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          {d.plan.map((b: any) => {
            const pct = (100 * b.done) / b.minutes;
            return (
              <Link key={b.key} to={b.path} className={`group rounded-xl border p-3 transition hover:border-nile-400 ${pct >= 100 ? 'border-nile-300 bg-nile-50 dark:border-nile-800 dark:bg-nile-950' : 'border-stone-200 dark:border-stone-800'}`}>
                <div className="text-xs text-stone-500">{b.minutes} min</div>
                <div className="text-sm font-semibold">{b.label}</div>
                <div className="mt-2"><Bar value={pct} h="h-1.5" /></div>
                <div className="mt-1 text-[11px] text-stone-500">{pct >= 100 ? 'Done ✓' : `${Math.ceil(b.minutes - b.done)} min left`}</div>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="card md:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-sand-500" /> Do this next</h2>
          <div className="space-y-2">
            {d.recommendations.map((r: any, i: number) => (
              <Link key={i} to={r.path} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 transition hover:border-nile-400 dark:border-stone-800">
                <div className="flex-1">
                  <div className="font-semibold">{r.label}</div>
                  <div className="text-sm text-stone-500">{r.reason}</div>
                </div>
                <ArrowRight size={18} className="text-stone-400" />
              </Link>
            ))}
            {!d.recommendations.length && <p className="text-sm text-stone-500">You're done for today. Passive listening still counts!</p>}
          </div>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">At a glance</h2>
          <Stat icon={<Headphones size={16} />} label="Listening comprehension" value={listening != null ? `${listening}%` : '—'} />
          <Stat icon={<Gauge size={16} />} label="Comfortable speed" value={d.comfortableSpeed ? `${d.comfortableSpeed}×` : 'not measured'} />
          <Stat icon={<Timer size={16} />} label="Arabic heard" value={`${d.exposure.totalHours.toFixed(1)} h total · ${Math.round(d.exposure.todayMinutes)} min today`} />
          <Stat label="Words learned" value={`${d.words.learned} / ${d.words.total}`} />
          <Stat label="Recognised instantly" value={d.words.instant} />
          <Stat label="Often forgotten" value={d.words.forgotten} />
          <Stat label="Reviews due" value={d.due} />
        </section>
      </div>

      <section className="card">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><Lightbulb size={18} className="text-sand-500" /> What the data says about you</h2>
        <ul className="space-y-2">
          {d.insights.map((i: any) => (
            <li key={i.id} className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.severity === 'high' ? 'bg-red-500' : i.severity === 'medium' ? 'bg-sand-500' : 'bg-stone-400'}`} />
              <div className="flex-1 text-sm">{i.text} {i.action && <Link to={i.action.path} className="font-semibold text-nile-700 hover:underline dark:text-nile-400">{i.action.label} →</Link>}</div>
            </li>
          ))}
        </ul>
        <Link to="/progress" className="mt-3 inline-block text-sm font-semibold text-nile-700 hover:underline dark:text-nile-400">Full progress report →</Link>
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: any; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-stone-500">{icon}{label}</span>
      <span className="text-end font-semibold">{value}</span>
    </div>
  );
}
