import { Outlet } from 'react-router-dom';
import Navbar from '@/components/Navbar';

export default function PublicLayout() {
    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
            <Navbar />
            <main>
                <Outlet />
            </main>
        </div>
    );
}
