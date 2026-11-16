// Audio engine: server audio (native recordings / Azure Egyptian TTS, cached) with a
// browser speechSynthesis fallback. Tracks listening exposure time.
import { api } from './api';

export type VoiceKey = 'f' | 'm' | 'f2' | 'm2';
export interface PlayOpts { voice?: VoiceKey; rate?: number }
export type Source = 'native' | 'azure' | 'browser' | 'none';

type Listener = () => void;
const blobCache = new Map<string, { url: string; rendered: number; source: Source }>();
const failed = new Set<string>();

let currentAudio: HTMLAudioElement | null = null;
let currentReject: ((e: Error) => void) | null = null;
let lastSource: Source = 'none';
let browserVoiceName = '';
const listeners = new Set<Listener>();
export const onAudioChange = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
const emit = () => listeners.forEach((l) => l());
export const audioInfo = () => ({ source: lastSource, browserVoice: browserVoiceName, speaking: !!currentAudio || speechSynthesis.speaking });

// ---------------------------------------------------------------- exposure tracking
let pendingSeconds = 0;
let pendingKind = 'audio';
export function setExposureKind(k: 'audio' | 'passive' | 'conversation') { pendingKind = k; }
function addExposure(sec: number) { if (sec > 0 && sec < 120) pendingSeconds += sec; }
setInterval(() => {
  if (pendingSeconds >= 5) {
    const s = Math.round(pendingSeconds);
    pendingSeconds = 0;
    api('/exposure', { kind: pendingKind, seconds: s }).catch(() => {});
  }
}, 20000);
window.addEventListener('beforeunload', () => {
  if (pendingSeconds >= 1) navigator.sendBeacon?.('/api/exposure', new Blob([JSON.stringify({ kind: pendingKind, seconds: Math.round(pendingSeconds) })], { type: 'application/json' }));
});

// ---------------------------------------------------------------- browser voices
function pickBrowserVoice(gender: 'm' | 'f'): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  const eg = voices.filter((v) => /ar[-_]EG/i.test(v.lang));
  const pool = eg.length ? eg : voices.filter((v) => /^ar/i.test(v.lang));
  if (!pool.length) return null;
  const byGender = pool.find((v) => (gender === 'm' ? /shakir|male|maged|tarik|hamed/i : /salma|female|zariyah|laila|hoda/i).test(v.name));
  return byGender || pool[0];
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => emit();
export function browserVoiceStatus() {
  if (typeof speechSynthesis === 'undefined') return { available: false, egyptian: false, name: '' };
  const v = pickBrowserVoice('f');
  return { available: !!v, egyptian: !!v && /ar[-_]EG/i.test(v.lang), name: v ? `${v.name} (${v.lang})` : '' };
}

// ---------------------------------------------------------------- core
export function stop() {
  if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  if (currentReject) { const r = currentReject; currentReject = null; r(new Error('stopped')); }
  emit();
}

async function fetchServer(text: string, voice: VoiceKey, rate: number) {
  const q = rate <= 0.85 ? 0.75 : rate >= 1.2 ? 1.25 : 1;
  const key = `${voice}|${q}|${text}`;
  if (blobCache.has(key)) return blobCache.get(key)!;
  if (failed.has(key)) return null;
  try {
    const res = await fetch(`/api/audio?text=${encodeURIComponent(text)}&voice=${voice}&rate=${rate}`);
    if (!res.ok || res.status === 204) { failed.add(key); return null; }
    const src = (res.headers.get('X-Audio-Source') || 'azure').split(':')[0] as Source;
    const rendered = Number(res.headers.get('X-Rendered-Rate') || 1);
    const url = URL.createObjectURL(await res.blob());
    const entry = { url, rendered, source: src };
    // native recordings aren't rate-specific: cache under every rate key
    blobCache.set(key, entry);
    if (blobCache.size > 150) { const first = blobCache.keys().next().value!; URL.revokeObjectURL(blobCache.get(first)!.url); blobCache.delete(first); }
    return entry;
  } catch {
    return null;
  }
}

/** Preload audio for upcoming lines (best-effort). */
export function preload(text: string, opts: PlayOpts = {}) { void fetchServer(text, opts.voice || 'f', opts.rate ?? 1); }

/** Speak text. Resolves when playback ends; rejects with 'stopped' if interrupted. */
export async function play(text: string, opts: PlayOpts = {}): Promise<void> {
  stop();
  const voice = opts.voice || 'f';
  const rate = opts.rate ?? 1;
  const entry = await fetchServer(text, voice, rate);
  const started = performance.now();
  if (entry) {
    lastSource = entry.source;
    const a = new Audio(entry.url);
    (a as any).preservesPitch = true;
    a.playbackRate = Math.max(0.5, Math.min(2.5, rate / (entry.source === 'native' ? 1 : entry.rendered)));
    currentAudio = a;
    emit();
    return new Promise<void>((resolve, reject) => {
      currentReject = reject;
      a.onended = () => { addExposure((performance.now() - started) / 1000); currentAudio = null; currentReject = null; emit(); resolve(); };
      a.onerror = () => { currentAudio = null; currentReject = null; emit(); reject(new Error('audio error')); };
      a.play().catch((e) => { currentAudio = null; currentReject = null; emit(); reject(e); });
    });
  }
  // browser fallback
  if (typeof speechSynthesis === 'undefined') throw new Error('No audio available');
  const v = pickBrowserVoice(voice.startsWith('m') ? 'm' : 'f');
  lastSource = 'browser';
  browserVoiceName = v ? `${v.name} (${v.lang})` : 'default';
  const u = new SpeechSynthesisUtterance(text);
  u.lang = v?.lang || 'ar-EG';
  if (v) u.voice = v;
  u.rate = rate;
  u.pitch = voice === 'm2' ? 0.85 : voice === 'f2' ? 1.15 : 1;
  emit();
  return new Promise<void>((resolve, reject) => {
    currentReject = reject;
    u.onend = () => { addExposure((performance.now() - started) / 1000); currentReject = null; emit(); resolve(); };
    u.onerror = (e) => { currentReject = null; emit(); e.error === 'interrupted' || e.error === 'canceled' ? reject(new Error('stopped')) : reject(new Error(e.error)); };
    speechSynthesis.speak(u);
  });
}

/** Play a sequence of lines with a pause between them. */
export async function playSequence(lines: { text: string; voice?: VoiceKey }[], opts: { rate?: number; gapMs?: number; onLine?: (i: number) => void; startAt?: number; shouldStop?: () => boolean } = {}) {
  for (let i = opts.startAt || 0; i < lines.length; i++) {
    if (opts.shouldStop?.()) return;
    opts.onLine?.(i);
    if (lines[i + 1]) preload(lines[i + 1].text, { voice: lines[i + 1].voice, rate: opts.rate });
    await play(lines[i].text, { voice: lines[i].voice, rate: opts.rate });
    await new Promise((r) => setTimeout(r, opts.gapMs ?? 450));
  }
  opts.onLine?.(-1);
}

/** Map dialogue speakers to distinct voices (2 Azure voices + 2 variations). */
export function voiceMap(lines: { speaker: string; gender: 'm' | 'f' }[]): Record<string, VoiceKey> {
  const map: Record<string, VoiceKey> = {};
  const used = { m: 0, f: 0 };
  for (const l of lines) {
    if (map[l.speaker]) continue;
    const g = l.gender;
    map[l.speaker] = (used[g]++ % 2 === 0 ? g : `${g}2`) as VoiceKey;
  }
  return map;
}

export const randomVoice = (): VoiceKey => (['f', 'm', 'f2', 'm2'] as VoiceKey[])[Math.floor(Math.random() * 4)];
