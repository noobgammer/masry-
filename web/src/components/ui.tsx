import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck, Loader2, Pause, Play, Plus, Check, Volume2, X, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { play, stop, type VoiceKey } from '../lib/audio';
import { useAudioState } from '../lib/hooks';
import { useSettings } from '../lib/store';

export interface Tok {
  surface: string;
  kind: 'exact' | 'derived' | 'unknown';
  lemma: { id: number; arabic: string; translit: string; english: string; pos: string } | null;
  parts: { text: string; gloss: string; role: string }[];
  alts?: { id: number; arabic: string; english: string }[];
  mwe?: { start: number; end: number; id: number; arabic: string; english: string; translit: string };
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} />;
}

export function PageHeader({ title, ar, children, sub }: { title: string; ar?: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {title} {ar && <span className="ar ms-2 text-xl font-semibold text-nile-600 dark:text-nile-400">{ar}</span>}
        </h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-stone-500 dark:text-stone-400">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card text-center text-stone-500">{children}</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>;
}

export function Bar({ value, className = 'bg-nile-500', h = 'h-2' }: { value: number | null | undefined; className?: string; h?: string }) {
  return (
    <div className={`${h} w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800`}>
      <div className={`${h} rounded-full ${className} transition-all`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  );
}

export const SPEEDS = [0.7, 0.85, 1, 1.15, 1.3, 1.5];
export function SpeedControl({ value, onChange, speeds = SPEEDS }: { value: number; onChange: (v: number) => void; speeds?: number[] }) {
  return (
    <div className="inline-flex rounded-xl border border-stone-200 bg-white p-0.5 text-xs dark:border-stone-700 dark:bg-stone-900" role="radiogroup" aria-label="Playback speed">
      {speeds.map((s) => (
        <button key={s} onClick={() => onChange(s)} role="radio" aria-checked={value === s}
          className={`rounded-lg px-2 py-1 font-semibold ${value === s ? 'bg-nile-600 text-white' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'}`}>
          {s}×
        </button>
      ))}
    </div>
  );
}

/** Play button for a single text. */
export function PlayButton({ text, voice, rate = 1, label, size = 'md', onPlayed, className = '' }: { text: string; voice?: VoiceKey; rate?: number; label?: string; size?: 'sm' | 'md' | 'lg'; onPlayed?: () => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const go = async () => {
    if (playing) { stop(); return; }
    setBusy(true);
    try {
      const p = play(text, { voice, rate });
      setBusy(false);
      setPlaying(true);
      onPlayed?.();
      await p;
    } catch { /* stopped */ } finally { setBusy(false); setPlaying(false); }
  };
  const dims = size === 'lg' ? 'h-16 w-16' : size === 'sm' ? 'h-8 w-8' : 'h-11 w-11';
  const icon = size === 'lg' ? 28 : size === 'sm' ? 15 : 20;
  return (
    <button onClick={go} aria-label={label || 'Play audio'} title={label || 'Play'}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-nile-600 text-white shadow transition hover:bg-nile-700 active:scale-95 ${label ? 'h-11 px-5' : dims} ${className}`}>
      {busy ? <Spinner /> : playing ? <Pause size={icon} /> : <Play size={icon} className="translate-x-[1px]" />}
      {label && <span className="text-sm font-semibold">{label}</span>}
    </button>
  );
}

export function AudioSourceBadge() {
  const a = useAudioState();
  if (a.source === 'none') return null;
  const map = {
    native: ['Native recording', 'bg-nile-100 text-nile-800 dark:bg-nile-900 dark:text-nile-100'],
    azure: ['Egyptian neural voice', 'bg-nile-50 text-nile-700 dark:bg-nile-950 dark:text-nile-200'],
    browser: [/ar[-_]EG/i.test(a.browserVoice) ? `Browser · ${a.browserVoice}` : `Browser voice (not Egyptian!) · ${a.browserVoice}`, /ar[-_]EG/i.test(a.browserVoice) ? 'bg-sand-100 text-sand-600' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'],
  } as const;
  const [label, cls] = map[a.source as keyof typeof map];
  return <span className={`inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}><Volume2 size={12} />{label}</span>;
}

// ---------------------------------------------------------------- interactive Arabic text

export function ArabicText({ tokens, text, highlight, onLookup, className = 'text-2xl', showTranslit, hidden = false, knownIds, context = 'input' }: {
  tokens?: Tok[]; text?: string; highlight?: number; onLookup?: (t: Tok) => void; className?: string; showTranslit?: boolean; hidden?: boolean; knownIds?: Set<number>; context?: string;
}) {
  const [open, setOpen] = useState<{ tok: Tok; rect: DOMRect } | null>(null);
  if (!tokens) return <p className={`ar ${className}`}>{text}</p>;
  return (
    <>
      <p className={`ar ${className} ${hidden ? 'blur-text' : ''}`} dir="rtl">
        {tokens.map((t, i) => {
          const id = t.mwe?.id ?? t.lemma?.id;
          const cls = id == null ? '' : knownIds ? (knownIds.has(id) ? 'tok-known' : 'tok-new') : '';
          return (
            <span key={i}>
              <span role="button" tabIndex={hidden ? -1 : 0}
                className={`tok ${cls} ${highlight === i ? 'bg-sand-200 dark:bg-sand-600/40' : ''} ${t.mwe && t.mwe.start !== t.mwe.end ? 'border-b-2 border-nile-200 dark:border-nile-800' : ''}`}
                onClick={(e) => { if (hidden) return; setOpen({ tok: t, rect: (e.target as HTMLElement).getBoundingClientRect() }); onLookup?.(t); if (id) api('/lookup', { vocab_id: id, context }).catch(() => {}); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).click(); }}>
                {t.surface}
              </span>{' '}
            </span>
          );
        })}
      </p>
      {open && <WordPopover tok={open.tok} rect={open.rect} onClose={() => setOpen(null)} />}
    </>
  );
}

export function WordPopover({ tok, rect, onClose }: { tok: Tok; rect: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);
  const w = 300;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
  const below = rect.bottom + 8 + 260 < window.innerHeight;
  const style = { left, width: w, ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }) };
  const main = tok.mwe && tok.mwe.start !== tok.mwe.end ? { id: tok.mwe.id, arabic: tok.mwe.arabic, english: tok.mwe.english, translit: tok.mwe.translit } : tok.lemma;
  const save = async () => { await api('/saved', { text: main?.arabic || tok.surface, vocab_id: main?.id, context: tok.surface, source: 'popover' }); setSaved(true); };
  return createPortal(
    <div ref={ref} style={style} className="fade-in fixed z-50 rounded-2xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-700 dark:bg-stone-900" role="dialog">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="ar text-2xl font-semibold">{tok.surface.replace(/[،؟.!,?]/g, '')}</div>
          {main && <div className="text-xs text-stone-500">{main.translit}</div>}
        </div>
        <div className="flex gap-1">
          <PlayButton text={tok.surface.replace(/[،؟.!,?]/g, '')} size="sm" />
          <button onClick={onClose} className="btn-ghost !p-1.5" aria-label="Close"><X size={16} /></button>
        </div>
      </div>
      {main ? (
        <>
          <div className="mt-2 text-base font-semibold">{main.english}</div>
          {tok.mwe && tok.mwe.start !== tok.mwe.end && <div className="mt-1 text-xs text-nile-700 dark:text-nile-300">Part of the expression <span className="ar">{tok.mwe.arabic}</span></div>}
          {tok.alts?.length ? <div className="mt-1 text-xs text-sand-600">Also: {tok.alts.map((a) => a.english).join(' · ')}</div> : null}
          {tok.parts.length > 1 && (
            <div className="mt-3 rounded-xl bg-stone-50 p-2 dark:bg-stone-800">
              <div className="label mb-1">How it's built</div>
              <div className="flex flex-row-reverse flex-wrap justify-end gap-1.5" dir="rtl">
                {tok.parts.map((p, i) => (
                  <div key={i} className={`rounded-lg px-2 py-1 text-center ${p.role === 'stem' ? 'bg-nile-100 dark:bg-nile-900' : 'bg-sand-100 dark:bg-stone-700'}`}>
                    <div className="ar text-lg leading-tight">{p.text}</div>
                    <div className="max-w-[7rem] text-[10px] leading-tight text-stone-600 dark:text-stone-300" dir="ltr">{p.gloss}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={saved} className="btn-outline !py-1.5 text-xs">{saved ? <><Check size={14} /> Saved</> : <><Plus size={14} /> Save word</>}</button>
            {main.id && <Link to={`/vocabulary/${main.id}`} className="btn-ghost !py-1.5 text-xs" onClick={onClose}>See in context →</Link>}
          </div>
        </>
      ) : (
        <div className="mt-2 text-sm text-stone-500">
          {tok.parts[0]?.gloss || 'Not in the dictionary yet — guess from context.'}
          {!tok.parts.length && <button onClick={save} disabled={saved} className="btn-outline mt-2 !py-1.5 text-xs">{saved ? 'Saved' : 'Save to look up later'}</button>}
        </div>
      )}
    </div>,
    document.body,
  );
}

export function BookmarkButton({ itemType, itemId, lineIdx = -1, arabic, english, initial = false }: { itemType: string; itemId: number; lineIdx?: number; arabic: string; english?: string; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  const toggle = async () => { await api('/bookmarks', { item_type: itemType, item_id: itemId, line_idx: lineIdx, arabic, english, remove: on }); setOn(!on); };
  return (
    <button onClick={toggle} className={`btn-ghost !p-1.5 ${on ? 'text-sand-500' : 'text-stone-400'}`} title={on ? 'Remove bookmark' : 'Bookmark difficult sentence'} aria-label="Bookmark">
      {on ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
    </button>
  );
}

export function Mcq({ options, onAnswer, correct, picked, dirAr = false }: { options: string[]; onAnswer: (i: number) => void; correct?: number | null; picked?: number | null; dirAr?: boolean }) {
  return (
    <div className="grid gap-2">
      {options.map((o, i) => {
        const done = picked != null;
        const state = !done ? '' : i === correct ? 'border-nile-500 bg-nile-50 dark:bg-nile-950' : i === picked ? 'border-red-400 bg-red-50 dark:bg-red-950' : 'opacity-50';
        return (
          <button key={i} disabled={done} onClick={() => onAnswer(i)}
            className={`rounded-xl border border-stone-200 bg-white px-4 py-3 text-start transition hover:border-nile-400 dark:border-stone-700 dark:bg-stone-900 ${state} ${dirAr ? 'ar text-lg' : ''}`}
            dir={dirAr ? 'rtl' : 'ltr'}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Notice({ children, tone = 'sand' }: { children: ReactNode; tone?: 'sand' | 'red' | 'nile' }) {
  const cls = { sand: 'border-sand-200 bg-sand-50 text-sand-600 dark:border-stone-700 dark:bg-stone-900 dark:text-sand-400', red: 'border-red-200 bg-red-50 text-red-800', nile: 'border-nile-200 bg-nile-50 text-nile-800 dark:border-nile-900 dark:bg-nile-950 dark:text-nile-200' }[tone];
  return <div className={`flex gap-2 rounded-xl border p-3 text-sm ${cls}`}><AlertTriangle size={16} className="mt-0.5 shrink-0" /><div>{children}</div></div>;
}

/** Shows transliteration / English according to global settings (with local reveal). */
export function Support({ translit, english, forceEnglish = false }: { translit?: string | null; english?: string | null; forceEnglish?: boolean }) {
  const s = useSettings();
  const [showEn, setShowEn] = useState(false);
  return (
    <div className="mt-1 space-y-0.5">
      {translit && s?.showTranslit && <p className="text-sm italic text-stone-500 dark:text-stone-400">{translit}</p>}
      {english && (s?.showEnglish || forceEnglish || showEn
        ? <p className="text-sm text-stone-700 dark:text-stone-300">{english}</p>
        : <button className="text-xs font-medium text-nile-700 hover:underline dark:text-nile-400" onClick={() => setShowEn(true)}>Show English</button>)}
    </div>
  );
}
