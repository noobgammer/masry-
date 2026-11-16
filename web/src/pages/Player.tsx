import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EyeOff, Headphones, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { play, playSequence, stop, voiceMap, type VoiceKey } from '../lib/audio';
import { useApi, usePlanBlock } from '../lib/hooks';
import { useSettings } from '../lib/store';
import { ArabicText, BookmarkButton, Mcq, Notice, SpeedControl, Spinner } from '../components/ui';
import { BANDS } from './InputLibrary';

type Subs = 'none' | 'ar' | 'ar-en' | 'en';

export default function Player() {
  usePlanBlock('input');
  const { id } = useParams();
  const { data: item } = useApi<any>(`/input/${id}`, [id]);
  const settings = useSettings();
  const [phase, setPhase] = useState<'blind' | 'questions' | 'review'>('blind');
  const [subs, setSubs] = useState<Subs>('none');
  const [cur, setCur] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(settings.defaultSpeed);
  const [listenedAll, setListenedAll] = useState(false);
  const [peeked, setPeeked] = useState({ transcript: false, english: false });
  const stopFlag = useRef(false);
  const t0 = useRef(Date.now());
  const yt = useYouTube(item?.youtube_id, item?.lines, setCur, speed);
  const voices = useMemo<Record<string, VoiceKey>>(() => (item ? voiceMap(item.lines) : {}), [item]);
  useEffect(() => () => { stopFlag.current = true; stop(); }, []);
  useEffect(() => { if (phase === 'review' && subs === 'none') setSubs('ar'); }, [phase]);
  if (!item) return <Spinner />;
  const lines = item.lines;
  const seq = (from: number, to = lines.length) => lines.slice(from, to).map((l: any) => ({ text: l.ar, voice: voices[l.speaker] }));

  const runFrom = async (from: number, to?: number) => {
    if (yt.enabled) { yt.seekLine(from); return; }
    stopFlag.current = false;
    setPlaying(true);
    try {
      await playSequence(seq(from, to), { rate: speed, gapMs: item.kind === 'dialogue' ? 350 : 550, onLine: (k) => k >= 0 && setCur(from + k), shouldStop: () => stopFlag.current });
      if (to == null && from === 0 && !stopFlag.current) setListenedAll(true);
      if (to == null && !stopFlag.current) setListenedAll(true);
    } catch { /* stopped */ }
    setPlaying(false);
  };
  const pause = () => { stopFlag.current = true; stop(); yt.pause(); setPlaying(false); };
  const repeatLine = async () => { pause(); const k = Math.max(0, cur); if (yt.enabled) return yt.seekLine(k); setCur(k); try { await play(lines[k].ar, { voice: voices[lines[k].speaker], rate: speed }); } catch {} };
  const repeatPara = () => { pause(); const k = Math.max(0, cur); const p = lines[k].para; const start = lines.findIndex((l: any) => l.para === p); const end = lines.findIndex((l: any, j: number) => j > start && l.para !== p); setTimeout(() => runFrom(start, end === -1 ? undefined : end), 50); };
  const go = (d: number) => { pause(); const k = Math.min(lines.length - 1, Math.max(0, cur + d)); setCur(k); setTimeout(() => runFrom(k, k + 1), 50); };
  const showAr = phase === 'review' ? subs === 'ar' || subs === 'ar-en' : subs !== 'none' && subs !== 'en';
  const showEn = subs === 'ar-en' || subs === 'en';
  const setSubsTracked = (s: Subs) => {
    if (phase !== 'review' && s !== 'none') setPeeked((p) => ({ transcript: p.transcript || s !== 'en', english: p.english || s === 'ar-en' || s === 'en' }));
    setSubs(s);
  };
  const del = async () => { if (confirm('Delete this imported item?')) { await api(`/input/${item.id}`, undefined, 'DELETE'); history.back(); } };

  return (
    <div>
      <Link to="/input" className="text-sm text-nile-700 hover:underline dark:text-nile-400">← Library</Link>
      <div className="mb-4 mt-1 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{item.title} <span className="ar ms-1 text-xl text-nile-700 dark:text-nile-300">{item.title_ar}</span></h1>
          <div className="text-sm text-stone-500">{BANDS[item.difficulty]} · {item.topic} · {lines.length} lines</div>
        </div>
        {item.slug.startsWith('import-') && <button className="btn-ghost text-red-600" onClick={del}><Trash2 size={16} /></button>}
      </div>
      {!item.verified && <div className="mb-3"><Notice>Imported content: translations/questions were drafted by AI and are not verified by a native speaker.</Notice></div>}

      {yt.enabled && <div className="mb-4 aspect-video overflow-hidden rounded-2xl bg-black"><div ref={yt.ref} className="h-full w-full" /></div>}

      {/* phase banner */}
      <div className="mb-4 rounded-2xl border border-nile-200 bg-nile-50 p-4 dark:border-nile-900 dark:bg-nile-950">
        {phase === 'blind' && (
          <div className="flex flex-wrap items-center gap-3">
            <Headphones className="text-nile-600" />
            <div className="flex-1 text-sm"><b>Step 1 — listen without the transcript.</b> Let the meaning come from the sound. Replay lines as much as you like.</div>
            <button className="btn-primary" disabled={!listenedAll && !yt.enabled} onClick={() => { pause(); setPhase('questions'); }}>{listenedAll || yt.enabled ? 'Answer the questions →' : 'Listen to it all first'}</button>
          </div>
        )}
        {phase === 'questions' && <div className="text-sm"><b>Step 2 — answer from what you heard.</b> The questions are in Egyptian Arabic on purpose.</div>}
        {phase === 'review' && <div className="text-sm"><b>Step 3 — now look.</b> Read along, tap any word, bookmark the lines that beat you, then listen once more without text.</div>}
      </div>

      {/* controls */}
      <div className="card sticky top-14 z-20 mb-4 !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !p-2" onClick={() => go(-1)} aria-label="Previous line"><SkipBack size={18} /></button>
          {playing || yt.playing ? (
            <button className="flex h-12 w-12 items-center justify-center rounded-full bg-nile-600 text-white" onClick={pause} aria-label="Pause"><Pause /></button>
          ) : (
            <button className="flex h-12 w-12 items-center justify-center rounded-full bg-nile-600 text-white" onClick={() => (yt.enabled ? yt.play() : runFrom(Math.max(0, cur === lines.length - 1 ? 0 : cur)))} aria-label="Play"><Play className="translate-x-[1px]" /></button>
          )}
          <button className="btn-ghost !p-2" onClick={() => go(1)} aria-label="Next line"><SkipForward size={18} /></button>
          <button className="btn-ghost !px-2 text-xs" onClick={repeatLine} title="Repeat sentence"><Repeat1 size={16} /> Sentence</button>
          <button className="btn-ghost !px-2 text-xs" onClick={repeatPara} title="Repeat paragraph"><Repeat size={16} /> Paragraph</button>
          <div className="flex-1" />
          <SpeedControl value={speed} onChange={(v) => { setSpeed(v); yt.setRate(v); }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span className="label me-1">Subtitles</span>
          {([['none', 'Hidden'], ['ar', 'Arabic'], ['ar-en', 'Arabic + English'], ['en', 'English']] as [Subs, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setSubsTracked(k)} className={`rounded-lg px-2 py-1 font-semibold ${subs === k ? 'bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900' : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800'}`}>{l}</button>
          ))}
          {phase !== 'review' && subs !== 'none' && <span className="ms-2 text-sand-600">Peeking — try to rely on your ears first</span>}
          <span className="ms-auto text-stone-500">Line {cur + 1}/{lines.length}</span>
        </div>
      </div>

      {phase === 'questions' && <Questions item={item} onDone={() => setPhase('review')} meta={{ listenedBlind: !peeked.transcript, revealedTranscript: peeked.transcript, revealedEnglish: peeked.english, ms: Date.now() - t0.current }} />}

      {/* transcript */}
      <div className="space-y-2">
        {lines.map((l: any, k: number) => {
          const newPara = k > 0 && l.para !== lines[k - 1].para;
          return (
            <div key={k} className={`${newPara ? 'mt-5' : ''}`}>
              <div className={`flex gap-3 rounded-xl p-3 transition ${cur === k ? 'bg-sand-50 ring-1 ring-sand-200 dark:bg-stone-800 dark:ring-stone-700' : ''}`}>
                <button onClick={() => { pause(); setCur(k); setTimeout(() => runFrom(k, k + 1), 50); }} className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-bold text-stone-600 hover:bg-nile-100 dark:bg-stone-800 dark:text-stone-300" title={`Play line (${l.speaker})`}>{item.kind === 'dialogue' || item.kind === 'video' ? l.speaker : k + 1}</button>
                <div className="min-w-0 flex-1">
                  {showAr ? <ArabicText tokens={l.tokens} className="text-xl md:text-2xl" context="input" /> : subs === 'en' ? null : <p className="ar blur-text text-xl" aria-hidden>{l.ar}</p>}
                  {showEn && <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{l.en}</p>}
                </div>
                {phase === 'review' && <BookmarkButton itemType="line" itemId={item.id} lineIdx={k} arabic={l.ar} english={l.en} initial={l.bookmarked} />}
              </div>
            </div>
          );
        })}
      </div>
      {phase === 'review' && (
        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => { setSubs('none'); runFrom(0); }}><EyeOff size={16} /> Final listen, no text</button>
          <button className="btn-outline" onClick={() => setPhase('questions')}>Retake questions</button>
          <Link to="/input" className="btn-primary">Back to library</Link>
        </div>
      )}
    </div>
  );
}

function Questions({ item, onDone, meta }: { item: any; onDone: () => void; meta: any }) {
  const [answers, setAnswers] = useState<(number | null)[]>(item.questions.map(() => null));
  const [res, setRes] = useState<any>(null);
  const [showEn, setShowEn] = useState(false);
  if (!item.questions.length) return <div className="card mb-4"><p className="text-sm">No questions for this item.</p><button className="btn-primary mt-2" onClick={onDone}>Show transcript</button></div>;
  const submit = async () => setRes(await api(`/input/${item.id}/answers`, { answers, ...meta, revealedEnglish: meta.revealedEnglish || showEn }));
  return (
    <div className="card mb-6 space-y-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Comprehension</h2>
        <button className="text-xs text-nile-700 hover:underline dark:text-nile-400" onClick={() => setShowEn(!showEn)}>{showEn ? 'Hide' : 'Show'} English questions</button></div>
      {item.questions.map((q: any, i: number) => {
        const r = res?.results[i];
        return (
          <div key={i}>
            <p className="ar text-xl font-semibold">{q.q}</p>
            {showEn && <p className="mb-1 text-sm text-stone-500">{q.q_en}</p>}
            <Mcq dirAr options={q.options.map((o: any) => o.text)} picked={r ? q.options.findIndex((o: any) => o.k === answers[i]) : null}
              correct={r ? q.options.findIndex((o: any) => o.k === r.answer) : null}
              onAnswer={(j) => { const a = [...answers]; a[i] = q.options[j].k; setAnswers(a); }} />
            {!res && answers[i] != null && <p className="mt-1 text-xs text-nile-700">Selected: <span className="ar">{q.options.find((o: any) => o.k === answers[i]).text}</span></p>}
          </div>
        );
      })}
      {!res ? (
        <button className="btn-primary w-full" disabled={answers.some((a) => a == null)} onClick={submit}>Check answers</button>
      ) : (
        <div className="fade-in rounded-xl bg-stone-50 p-4 dark:bg-stone-800">
          <div className="text-2xl font-bold">{Math.round(res.score * 100)}%</div>
          <p className="text-sm">{res.advice === 'up' ? 'Excellent — you are ready for harder material. The library will now recommend a higher level.' : res.advice === 'down' ? 'This one was tough. Look through the transcript, then try something with more familiar words — comprehension builds on what you already know.' : 'Good. Read through the transcript, then re-listen without text.'}</p>
          <button className="btn-primary mt-3" onClick={onDone}>Reveal transcript & translations</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- YouTube sync
function useYouTube(videoId: string | null | undefined, lines: any[] | undefined, setCur: (n: number) => void, rate: number) {
  const ref = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const enabled = !!videoId;
  useEffect(() => {
    if (!videoId || !ref.current) return;
    const init = () => {
      player.current = new (window as any).YT.Player(ref.current, {
        videoId, playerVars: { rel: 0, modestbranding: 1, cc_load_policy: 0 },
        events: { onStateChange: (e: any) => setPlaying(e.data === 1), onReady: () => player.current.setPlaybackRate(rate) },
      });
    };
    if ((window as any).YT?.Player) init();
    else {
      (window as any).onYouTubeIframeAPIReady = init;
      if (!document.getElementById('yt-api')) { const s = document.createElement('script'); s.id = 'yt-api'; s.src = 'https://www.youtube.com/iframe_api'; document.body.appendChild(s); }
    }
    const t = setInterval(() => {
      const p = player.current;
      if (!p?.getCurrentTime || !lines) return;
      const time = p.getCurrentTime();
      if (lines.some((l) => l.start != null)) { let k = -1; lines.forEach((l, i) => { if (l.start != null && l.start <= time + 0.2) k = i; }); setCur(k); }
    }, 300);
    // exposure: count video watch time
    const ex = setInterval(() => { if (player.current?.getPlayerState?.() === 1) api('/exposure', { kind: 'audio', seconds: 15 }).catch(() => {}); }, 15000);
    return () => { clearInterval(t); clearInterval(ex); try { player.current?.destroy(); } catch {} };
  }, [videoId]);
  return {
    ref, enabled, playing,
    play: () => player.current?.playVideo?.(),
    pause: () => player.current?.pauseVideo?.(),
    setRate: (r: number) => player.current?.setPlaybackRate?.(r),
    seekLine: (k: number) => { const l = lines?.[k]; if (l?.start != null) { player.current?.seekTo(l.start, true); player.current?.playVideo(); } else player.current?.playVideo?.(); setCur(k); },
  };
}
