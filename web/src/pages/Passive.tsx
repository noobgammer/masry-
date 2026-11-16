import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import { play, setExposureKind, stop, type VoiceKey } from '../lib/audio';
import { useApi } from '../lib/hooks';
import { Empty, PageHeader, SpeedControl, Spinner } from '../components/ui';

function speakEnglish(text: string) {
  return new Promise<void>((res) => {
    if (typeof speechSynthesis === 'undefined' || !text) return res();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    const v = speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.onend = () => res(); u.onerror = () => res();
    speechSynthesis.speak(u);
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Passive() {
  const { data: tracks } = useApi<any[]>('/passive');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState({ speed: 1, repeat: 1, english: false, gap: 1.2, showText: false, loop: true });
  const [now, setNow] = useState<{ t: string; i: number; ar: string; en: string } | null>(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  useEffect(() => () => { stopRef.current = true; stop(); setExposureKind('audio'); }, []);
  if (!tracks) return <Spinner />;
  const chosen = tracks.filter((t) => sel.size === 0 || sel.has(t.id));
  const start = async () => {
    stopRef.current = false; setRunning(true); setExposureKind('passive');
    do {
      for (const t of chosen) {
        if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: 'Masry · passive listening' });
        for (let i = 0; i < t.lines.length; i++) {
          const l = t.lines[i];
          for (let r = 0; r < opts.repeat; r++) {
            if (stopRef.current) return finish();
            setNow({ t: t.title, i, ar: l.ar, en: l.en });
            try { await play(l.ar, { voice: (l.gender === 'f' ? 'f' : 'm') as VoiceKey, rate: opts.speed }); } catch { return finish(); }
            await wait(opts.gap * 1000);
          }
          if (opts.english && l.en && !stopRef.current) { await speakEnglish(l.en); await wait(600); }
        }
        await wait(1500);
      }
    } while (opts.loop && !stopRef.current);
    finish();
  };
  const finish = () => { setRunning(false); setExposureKind('audio'); };
  const halt = () => { stopRef.current = true; stop(); speechSynthesis?.cancel(); finish(); };
  if ('mediaSession' in navigator) { navigator.mediaSession.setActionHandler('pause', halt); navigator.mediaSession.setActionHandler('play', () => !running && start()); }
  return (
    <div>
      <PageHeader title="Passive listening" ar="ودنك تتعود" sub="Hands-free replay of material you've already worked through — for walking, commuting or the gym. Familiar content at natural speed is exactly what tunes your ear." />
      {!tracks.length ? <Empty>Finish a few Comprehensible Input items, bookmark sentences or do Context sessions — they'll appear here.</Empty> : (
        <>
          <div className="card mb-4 space-y-2">
            <div className="label">Playlist (none selected = all)</div>
            {tracks.map((t) => (
              <label key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-800">
                <input type="checkbox" checked={sel.has(t.id)} onChange={() => { const n = new Set(sel); n.has(t.id) ? n.delete(t.id) : n.add(t.id); setSel(n); }} className="h-4 w-4 accent-nile-600" />
                <span className="flex-1">{t.title}</span><span className="text-xs text-stone-500">{t.lines.length} lines</span>
              </label>
            ))}
          </div>
          <div className="card mb-4 grid gap-4 sm:grid-cols-2">
            <div><div className="label mb-1">Speed</div><SpeedControl value={opts.speed} onChange={(v) => setOpts({ ...opts, speed: v })} /></div>
            <label className="text-sm"><div className="label mb-1">Repeat each line</div><select className="input" value={opts.repeat} onChange={(e) => setOpts({ ...opts, repeat: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}×</option>)}</select></label>
            <label className="text-sm"><div className="label mb-1">Pause between lines</div><input type="range" min={0.3} max={4} step={0.1} value={opts.gap} onChange={(e) => setOpts({ ...opts, gap: Number(e.target.value) })} className="w-full accent-nile-600" /> {opts.gap.toFixed(1)} s</label>
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={opts.english} onChange={(e) => setOpts({ ...opts, english: e.target.checked })} className="accent-nile-600" /> English after each line (beginner crutch)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={opts.showText} onChange={(e) => setOpts({ ...opts, showText: e.target.checked })} className="accent-nile-600" /> Show text on screen</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={opts.loop} onChange={(e) => setOpts({ ...opts, loop: e.target.checked })} className="accent-nile-600" /> Loop</label>
            </div>
          </div>
          <div className="card flex flex-col items-center gap-4 py-8 text-center">
            <button onClick={running ? halt : start} className="flex h-20 w-20 items-center justify-center rounded-full bg-nile-600 text-white shadow-lg">{running ? <Pause size={32} /> : <Play size={32} className="translate-x-0.5" />}</button>
            {now && running ? (
              <div>
                <div className="flex items-center justify-center gap-1 text-xs text-stone-500"><Radio size={12} className="animate-pulse text-red-500" /> {now.t} · line {now.i + 1}</div>
                {opts.showText && <><p className="ar mt-2 text-2xl">{now.ar}</p><p className="text-sm text-stone-500">{now.en}</p></>}
              </div>
            ) : <p className="text-sm text-stone-500">Keep this tab open; lock-screen controls work on most phones.</p>}
          </div>
        </>
      )}
    </div>
  );
}
