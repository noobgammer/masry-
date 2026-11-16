import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { ErrorBox } from '../components/ui';

export default function Login() {
  const { refresh } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [f, setF] = useState({ username: '', password: '', name: '' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try { await api(`/auth/${mode}`, f); await refresh(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-nile-50 via-stone-50 to-sand-50 p-4 dark:from-stone-950 dark:via-stone-950 dark:to-stone-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="ar mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-nile-600 text-4xl font-bold text-white shadow-lg">م</div>
          <h1 className="text-3xl font-bold">Masry <span className="ar text-nile-600">مصري</span></h1>
          <p className="mt-2 text-stone-500">Understand Egyptians the way they actually talk.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
          <div className="grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm font-semibold dark:bg-stone-800">
            {(['register', 'login'] as const).map((m) => (
              <button type="button" key={m} onClick={() => setMode(m)} className={`rounded-lg py-2 ${mode === m ? 'bg-white shadow dark:bg-stone-900' : 'text-stone-500'}`}>
                {m === 'register' ? 'Create account' : 'Log in'}
              </button>
            ))}
          </div>
          {mode === 'register' && (
            <label className="block"><span className="label">Your name (the AI partner will use it)</span>
              <input className="input mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Bilal" /></label>
          )}
          <label className="block"><span className="label">Username</span>
            <input className="input mt-1" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></label>
          <label className="block"><span className="label">Password</span>
            <input className="input mt-1" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
          <ErrorBox error={err} />
          <button className="btn-primary w-full">{mode === 'register' ? 'Start learning' : 'Log in'}</button>
        </form>
      </div>
    </div>
  );
}
