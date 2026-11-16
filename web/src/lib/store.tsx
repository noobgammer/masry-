import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Settings { showTranslit: boolean; showEnglish: boolean; newPerDay: number; listenNewPerDay: number; defaultSpeed: number; voice: string; name: string }
interface Me { id: number; username: string; settings: Settings }
interface Ctx { me: Me | null; loading: boolean; refresh: () => Promise<void>; updateSettings: (s: Partial<Settings>) => Promise<void>; status: { azure: boolean; ai: boolean; native: number } | null }

const AppCtx = createContext<Ctx>(null as any);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Ctx['status']>(null);
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/me')); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    refresh();
    fetch('/api/audio/status').then((r) => r.json()).then(setStatus).catch(() => {});
    const off = () => setMe(null);
    window.addEventListener('masry:logout', off);
    return () => window.removeEventListener('masry:logout', off);
  }, [refresh]);
  const updateSettings = async (s: Partial<Settings>) => {
    const next = await api<Settings>('/settings', s, 'PUT');
    setMe((m) => (m ? { ...m, settings: next } : m));
  };
  return <AppCtx.Provider value={{ me, loading, refresh, updateSettings, status }}>{children}</AppCtx.Provider>;
}
export const useApp = () => useContext(AppCtx);
export const useSettings = () => useContext(AppCtx).me?.settings as Settings;
