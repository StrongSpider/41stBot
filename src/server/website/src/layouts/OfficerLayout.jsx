import { Navigate, Outlet } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import Navbar from '@/components/Navbar';
import { Loader2 } from 'lucide-react';

export default function OfficerLayout() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-neutral-950 text-white">
                <Loader2 className="w-8 h-8 animate-spin text-rose-500" />
            </div>
        );
    }

    if (!user || !user.isOfficer) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-rose-500/30 selection:text-rose-200">
            <Navbar />
            <main>
                <Outlet />
            </main>
        </div>
    );
}
