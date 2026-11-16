import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { onAudioChange, audioInfo } from './audio';

/** Fetch helper with reload. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, error, loading, reload: load, setData };
}

/** Counts time spent on a daily-plan block while the tab is visible and the user was active in the last minute. */
export function usePlanBlock(block: 'vocab' | 'context' | 'input' | 'lab' | 'speaking') {
  const last = useRef(Date.now());
  useEffect(() => {
    const act = () => (last.current = Date.now());
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, act, { passive: true }));
    const off = onAudioChange(act);
    let acc = 0;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && (Date.now() - last.current < 60000 || audioInfo().speaking)) acc += 5;
      if (acc >= 30) { api('/plan/tick', { block, seconds: acc }).catch(() => {}); acc = 0; }
    }, 5000);
    return () => { clearInterval(t); evs.forEach((e) => window.removeEventListener(e, act)); off(); if (acc) api('/plan/tick', { block, seconds: acc }).catch(() => {}); };
  }, [block]);
}

export function useAudioState() {
  const [s, setS] = useState(audioInfo());
  useEffect(() => onAudioChange(() => setS(audioInfo())), []);
  return s;
}

/** Web Speech API recognition (Egyptian Arabic). */
export function useSpeechRecognition(lang = 'ar-EG') {
  const Rec: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<any>(null);
  const start = useCallback((onFinal: (text: string) => void) => {
    if (!Rec) return;
    const r = new Rec();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (e: any) => {
      let it = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else it += e.results[i][0].transcript;
      }
      setInterim(finalText + it);
    };
    r.onend = () => { setListening(false); setInterim(''); if (finalText.trim()) onFinal(finalText.trim()); };
    r.onerror = () => setListening(false);
    recRef.current = r;
    setListening(true);
    r.start();
  }, [Rec, lang]);
  const stop = useCallback(() => recRef.current?.stop(), []);
  return { supported: !!Rec, listening, interim, start, stop };
}
