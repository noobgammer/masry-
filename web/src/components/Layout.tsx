import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, BookOpen, Ear, Headphones, Home, Layers, LogOut, MessageCircle, MessagesSquare, Menu, Mic2, Radio, Settings, X } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { AudioSourceBadge } from './ui';

export const NAV = [
  { to: '/', label: 'Dashboard', ar: 'الرئيسية', icon: Home },
  { to: '/vocabulary', label: 'Vocabulary', ar: 'الكلمات', icon: Layers },
  { to: '/context', label: 'Contextual Learning', ar: 'في سياق', icon: BookOpen },
  { to: '/input', label: 'Comprehensible Input', ar: 'استماع', icon: Headphones },
  { to: '/lab', label: 'Listening Lab', ar: 'معمل السمع', icon: Ear },
  { to: '/conversations', label: 'Conversations', ar: 'دردشة', icon: MessagesSquare },
  { to: '/reading', label: 'Reading', ar: 'قراية', icon: MessageCircle },
  { to: '/progress', label: 'Progress', ar: 'تقدمك', icon: BarChart3 },
];
const EXTRA = [
  { to: '/passive', label: 'Passive listening', icon: Radio },
  { to: '/studio', label: 'Native Speaker Studio', icon: Mic2 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function DisplayToggles() {
  const { me, updateSettings } = useApp();
  const s = me?.settings;
  if (!s) return null;
  const t = (k: 'showTranslit' | 'showEnglish', label: string, title: string) => (
    <button onClick={() => updateSettings({ [k]: !s[k] })} title={title}
      className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${s[k] ? 'bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900' : 'text-stone-500 line-through hover:bg-stone-100 dark:hover:bg-stone-800'}`}>
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 rounded-xl border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900">
      <span className="ar px-1.5 text-sm font-semibold text-nile-700 dark:text-nile-300" title="Arabic script is always shown">عربي</span>
      {t('showTranslit', 'Translit', 'Show Latin transliteration')}
      {t('showEnglish', 'English', 'Show English translations by default')}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { refresh } = useApp();
  const loc = useLocation();
  const logout = async () => { await api('/auth/logout', {}); refresh(); };
  const link = (n: { to: string; label: string; icon: any; ar?: string }, onClick?: () => void) => (
    <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onClick}
      className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-nile-600 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'}`}>
      <n.icon size={18} />
      <span className="flex-1">{n.label}</span>
      {n.ar && <span className="ar text-xs opacity-60">{n.ar}</span>}
    </NavLink>
  );
  const sidebar = (onClick?: () => void) => (
    <>
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="ar flex h-10 w-10 items-center justify-center rounded-xl bg-nile-600 text-2xl font-bold text-white">م</div>
        <div>
          <div className="font-bold leading-tight">Masry</div>
          <div className="text-xs text-stone-500">Egyptian Arabic, by ear</div>
        </div>
      </div>
      <nav className="space-y-1">{NAV.map((n) => link(n, onClick))}</nav>
      <div className="my-4 border-t border-stone-200 dark:border-stone-800" />
      <nav className="space-y-1">{EXTRA.map((n) => link(n, onClick))}</nav>
      <button onClick={logout} className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"><LogOut size={18} /> Log out</button>
    </>
  );
  const mobileMain = [NAV[0], NAV[1], NAV[3], NAV[4], NAV[5]];
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-e border-stone-200 bg-white/70 p-4 backdrop-blur md:block dark:border-stone-800 dark:bg-stone-950/60">
        {sidebar()}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 overflow-y-auto bg-white p-4 dark:bg-stone-950" onClick={(e) => e.stopPropagation()}>
            <button className="btn-ghost mb-2 !p-2" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>
            {sidebar(() => setOpen(false))}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-stone-200 bg-stone-50/85 px-4 py-2.5 backdrop-blur md:px-8 dark:border-stone-800 dark:bg-[#0f1413]/85">
          <button className="btn-ghost !p-2 md:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu size={20} /></button>
          <div className="flex-1"><AudioSourceBadge /></div>
          <DisplayToggles />
        </header>
        <main key={loc.pathname} className="fade-in mx-auto max-w-5xl px-4 pb-28 pt-6 md:px-8 md:pb-12">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-950/95">
        {mobileMain.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${isActive ? 'text-nile-600 dark:text-nile-400' : 'text-stone-500'}`}>
            <n.icon size={20} />
            {n.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
