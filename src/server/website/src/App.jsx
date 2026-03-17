import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import PublicLayout from '@/layouts/PublicLayout';
import AdminLayout from '@/layouts/AdminLayout';
import OfficerLayout from '@/layouts/OfficerLayout';
import Home from '@/pages/Home';
import Statistics from '@/pages/Statistics';
import AdminDashboard from '@/pages/Admin/Dashboard';
import OfficerDashboard from '@/pages/Officer/Dashboard';
import DinoGame from '@/components/DinoGame';

import { DiscordActivityProvider } from '@/context/DiscordActivityContext';

function App() {
  return (
    <Router>
      <DiscordActivityProvider>
        <AuthProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/activity" element={<DinoGame />} />
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/statistics" element={<Statistics />} />
            </Route>

            {/* Admin Routes */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
            </Route>

            {/* Officer Routes */}
            <Route path="/officer" element={<OfficerLayout />}>
              <Route index element={<OfficerDashboard />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </DiscordActivityProvider>
    </Router>
  )
}

export default App
