import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HouseMark } from './components/Brand';
import { Spinner } from './components/ui';
import { Shell } from './features/shell/Shell';
import { ApiError } from './lib/api';
import { useUnauthorizedRedirect, type LoginState } from './lib/auth';
import { useMe } from './lib/queries';
import { RealtimeProvider } from './lib/realtime';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CookingPage = lazy(() => import('./pages/CookingPage'));
const WashingPage = lazy(() => import('./pages/WashingPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

/** Full-screen wait. On Render's free tier the first visit may need ~1 min while the server wakes. */
function Splash() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <HouseMark className="size-12 text-lamp" />
        <Spinner label={slow ? 'Waking up the house… this can take up to a minute on first visit.' : 'Opening the door…'} />
      </div>
    </div>
  );
}

function RequireMember() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Splash />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace state={{ from: location.pathname + location.search } satisfies LoginState} />;
    }
    // Network/5xx (server waking up): keep retrying rather than bouncing to login.
    return <RetryingSplash retry={() => me.refetch()} />;
  }
  return (
    <RealtimeProvider>
      <Shell>
        <Suspense fallback={<div className="p-8"><Spinner /></div>}>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="cooking" element={<CookingPage />} />
            <Route path="washing" element={<WashingPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </Shell>
    </RealtimeProvider>
  );
}

function RetryingSplash({ retry }: { retry: () => void }) {
  useEffect(() => {
    const t = setInterval(retry, 5000);
    return () => clearInterval(t);
  }, [retry]);
  return <Splash />;
}

export default function App() {
  useUnauthorizedRedirect();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<RequireMember />} />
    </Routes>
  );
}
