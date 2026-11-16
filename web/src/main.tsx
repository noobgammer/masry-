import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AppProvider, useApp } from './lib/store';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

const Vocabulary = lazy(() => import('./pages/Vocabulary'));
const WordDetail = lazy(() => import('./pages/WordDetail'));
const Context = lazy(() => import('./pages/Context'));
const InputLibrary = lazy(() => import('./pages/InputLibrary'));
const Player = lazy(() => import('./pages/Player'));
const Lab = lazy(() => import('./pages/Lab'));
const Conversations = lazy(() => import('./pages/Conversations'));
const Reading = lazy(() => import('./pages/Reading'));
const Progress = lazy(() => import('./pages/Progress'));
const Passive = lazy(() => import('./pages/Passive'));
const Studio = lazy(() => import('./pages/Studio'));
const SettingsPage = lazy(() => import('./pages/Settings'));

function Root() {
  const { me, loading } = useApp();
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!me) return <Login />;
  return (
    <Layout>
      <Suspense fallback={<div className="flex justify-center py-20"><Spinner /></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/vocabulary" element={<Vocabulary />} />
          <Route path="/vocabulary/:id" element={<WordDetail />} />
          <Route path="/context" element={<Context />} />
          <Route path="/input" element={<InputLibrary />} />
          <Route path="/input/:id" element={<Player />} />
          <Route path="/lab/*" element={<Lab />} />
          <Route path="/conversations" element={<Conversations />} />
          <Route path="/conversations/:id" element={<Conversations />} />
          <Route path="/reading" element={<Reading />} />
          <Route path="/reading/:id" element={<Reading />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/passive" element={<Passive />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Root />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
