import { useState } from 'react';
import { useApp } from '../lib/store';
import { browserVoiceStatus } from '../lib/audio';
import { useApi } from '../lib/hooks';
import { PageHeader, PlayButton, SpeedControl } from '../components/ui';

export default function SettingsPage() {
  const { me, updateSettings, status } = useApp();
  const s = me!.settings;
  const [name, setName] = useState(s.name);
  const bv = browserVoiceStatus();
  const { data: flags } = useApi<any[]>('/flags');
  const row = (label: string, desc: string, control: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 py-4 last:border-0 dark:border-stone-800">
      <div className="max-w-md"><div className="font-medium">{label}</div><div className="text-sm text-stone-500">{desc}</div></div>{control}
    </div>
  );
  const toggle = (k: 'showTranslit' | 'showEnglish') => (
    <button onClick={() => updateSettings({ [k]: !s[k] })} className={`relative h-7 w-12 rounded-full transition ${s[k] ? 'bg-nile-600' : 'bg-stone-300 dark:bg-stone-700'}`} role="switch" aria-checked={s[k]}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${s[k] ? 'start-6' : 'start-1'}`} />
    </button>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <section className="card !py-1">
        {row('Your name', 'Used by the conversation partner.', <div className="flex gap-2"><input className="input !w-48" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-outline" onClick={() => updateSettings({ name })}>Save</button></div>)}
        {row('New words per day', 'Frequency words introduced per day. 10–20 is sustainable alongside listening.', <select className="input !w-28" value={s.newPerDay} onChange={(e) => updateSettings({ newPerDay: Number(e.target.value) })}>{[5, 10, 15, 20, 25, 30, 40].map((n) => <option key={n}>{n}</option>)}</select>)}
        {row('Listening cards per day (first tests)', 'Caps how many fast-tracked words are first tested by ear each day.', <select className="input !w-28" value={s.listenNewPerDay} onChange={(e) => updateSettings({ listenNewPerDay: Number(e.target.value) })}>{[10, 25, 40, 60].map((n) => <option key={n}>{n}</option>)}</select>)}
        {row('Default audio speed', 'Start slower if needed — but push towards 1× and beyond.', <SpeedControl value={s.defaultSpeed} onChange={(v) => updateSettings({ defaultSpeed: v })} />)}
        {row('Show transliteration', 'Latin letters under Arabic. Turn off as soon as you can — your ears and eyes should work with Arabic directly.', toggle('showTranslit'))}
        {row('Show English by default', 'When off, English is one tap away instead of on screen. Recommended: off.', toggle('showEnglish'))}
      </section>

      <section className="card space-y-3 text-sm">
        <h2 className="text-base font-semibold">Audio & AI services</h2>
        <p><b>Egyptian neural TTS (Azure):</b> {status?.azure ? <span className="text-nile-700">configured ✓ — voices ar-EG Salma (f) and Shakir (m)</span> : <span className="text-sand-600">not configured</span>}</p>
        <p><b>Browser voice fallback:</b> {bv.available ? `${bv.name}${bv.egyptian ? ' — Egyptian ✓' : ' — NOT Egyptian (expect MSA/Gulf pronunciation)'}` : 'none available'} <PlayButton text="إزيك؟ عامل إيه النهارده؟" size="sm" className="ms-2 align-middle" /></p>
        <p><b>Native recordings:</b> {status?.native ?? 0} sentences recorded by real Egyptians (always preferred).</p>
        <p><b>AI partner (Claude):</b> {status?.ai ? <span className="text-nile-700">configured ✓</span> : <span className="text-sand-600">not configured — set ANTHROPIC_API_KEY</span>}</p>
        <p className="text-stone-500">Speech recognition uses your browser's built-in recogniser with the Egyptian Arabic (ar-EG) locale — works in Chrome, Edge and Safari. In other browsers type your answers.</p>
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 text-base font-semibold">Content corrections from native speakers</h2>
        {!flags?.length ? <p className="text-stone-500">No open flags.</p> : flags.map((f) => (
          <div key={f.id} className="border-b border-stone-100 py-2 last:border-0 dark:border-stone-800"><p className="ar text-lg line-through opacity-60">{f.arabic}</p><p className="ar text-lg text-nile-700">{f.suggestion}</p>{f.comment && <p className="text-xs text-stone-500">{f.comment}</p>}</div>
        ))}
        <p className="mt-2 text-xs text-stone-500">Apply accepted corrections in <code>content/</code> and run <code>npm run seed</code>.</p>
      </section>
    </div>
  );
}
