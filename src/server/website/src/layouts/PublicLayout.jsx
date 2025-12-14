import { Outlet, useLocation, Navigate } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { useDiscordActivity } from '@/context/DiscordActivityContext';

export default function PublicLayout() {
    const { isEmbedded } = useDiscordActivity();
    const location = useLocation();

    if (isEmbedded && location.pathname === '/') {
        return <Navigate to="/statistics" replace />;
    }

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
            <Navbar />
            <main>
                <Outlet />
            </main>
        </div>
    );
}
