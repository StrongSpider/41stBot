import React, { useContext } from 'react';
import { FirebaseProvider } from './context/FirebaseContext';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, AuthContext } from './context/AuthContext';
import LoginPage from './components/LoginPage';
import PlayersTable from './components/PlayersTable';
import WeeklyEventsTable from './components/WeeklyEventsTable';
import HistoryEventsTable from './components/HistoryEventsTable';
import Navbar from './components/Navbar';
import QuotasPage from './components/QuotasPage';
import QuotaReportPage from './components/QuotaReportPage';

function AppRoutes() {
  const { user } = useContext(AuthContext);

  // still checking session
  if (user === undefined) return <div className="p-4">Loading…</div>;

  // not logged in → force login
  if (user === null) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // logged in → show app
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/"       element={<Navigate to="/players" replace />} />
        <Route path="/players" element={<PlayersTable />} />
        <Route path="/weekly"  element={<WeeklyEventsTable />} />
        <Route path="/history" element={<HistoryEventsTable />} />
        {/* <Route path="/quotas"  element={<QuotasPage />} /> */}
        <Route path="/quotas/report"  element={<QuotaReportPage />} />
        <Route path="*"       element={<Navigate to="/players" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FirebaseProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </FirebaseProvider>
    </AuthProvider>
  );
}