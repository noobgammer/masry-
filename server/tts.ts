// Audio resolution: native recording > cached Azure Egyptian neural TTS > (client) browser speech fallback.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, db, now } from './db.ts';
import { normalize } from './arabic.ts';

export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const NATIVE_DIR = path.join(DATA_DIR, 'native');
fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(NATIVE_DIR, { recursive: true });

// Azure has two dedicated Egyptian voices. The "2" variants are pitch/style shifts of the same voices
// to vary the listening experience — they are NOT different real speakers (record natives for that).
export const VOICES: Record<string, { azure: string; pitch: string; label: string; gender: 'm' | 'f' }> = {
  f: { azure: 'ar-EG-SalmaNeural', pitch: '+0%', label: 'Salma (female, Egyptian)', gender: 'f' },
  m: { azure: 'ar-EG-ShakirNeural', pitch: '+0%', label: 'Shakir (male, Egyptian)', gender: 'm' },
  f2: { azure: 'ar-EG-SalmaNeural', pitch: '+7%', label: 'Salma — higher variation', gender: 'f' },
  m2: { azure: 'ar-EG-ShakirNeural', pitch: '-8%', label: 'Shakir — deeper variation', gender: 'm' },
};

export const azureEnabled = () => !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);

/** Azure renders are quantised to 3 rates; the client adjusts the rest with playbackRate (pitch-preserving). */
export function quantiseRate(rate: number): number {
  if (rate <= 0.85) return 0.75;
  if (rate >= 1.2) return 1.25;
  return 1;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function ssml(text: string, voice: string, rate: number) {
  const v = VOICES[voice] || VOICES.f;
  const pct = Math.round((rate - 1) * 100);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-EG"><voice name="${v.azure}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%" pitch="${v.pitch}">${esc(text)}</prosody></voice></speak>`;
}

export function nativeFor(text: string, speaker?: string): { file: string; mime: string; speaker: string } | null {
  const norm = normalize(text);
  const rows = db().prepare('SELECT file, mime, speaker FROM native_audio WHERE text_norm=?').all(norm) as any[];
  if (!rows.length) return null;
  const r = rows.find((x) => x.speaker === speaker) || rows[Math.floor(Math.random() * rows.length)];
  const f = path.join(NATIVE_DIR, r.file);
  return fs.existsSync(f) ? { file: f, mime: r.mime, speaker: r.speaker } : null;
}

const inflight = new Map<string, Promise<string>>();

export async function azureAudio(text: string, voice: string, rate: number): Promise<string> {
  const q = quantiseRate(rate);
  const key = crypto.createHash('sha1').update(`${text}|${voice}|${q}`).digest('hex');
  const hit = db().prepare('SELECT file FROM audio_cache WHERE key=?').get(key) as { file: string } | undefined;
  if (hit && fs.existsSync(path.join(AUDIO_DIR, hit.file))) return path.join(AUDIO_DIR, hit.file);
  if (inflight.has(key)) return inflight.get(key)!;
  const p = (async () => {
    const res = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'masry-app',
      },
      body: ssml(text, voice, q),
    });
    if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = `${key}.mp3`;
    fs.writeFileSync(path.join(AUDIO_DIR, file), buf);
    db().prepare('INSERT OR REPLACE INTO audio_cache (key, file, provider, created_at) VALUES (?,?,?,?)').run(key, file, 'azure', now());
    return path.join(AUDIO_DIR, file);
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

export function saveNative(text: string, speaker: string, mime: string, data: Buffer) {
  const norm = normalize(text);
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : 'webm';
  const file = `${crypto.createHash('sha1').update(`${norm}|${speaker}`).digest('hex')}.${ext}`;
  fs.writeFileSync(path.join(NATIVE_DIR, file), data);
  db().prepare('INSERT OR REPLACE INTO native_audio (text_norm, speaker, file, mime, created_at) VALUES (?,?,?,?,?)').run(norm, speaker, file, mime, now());
}
