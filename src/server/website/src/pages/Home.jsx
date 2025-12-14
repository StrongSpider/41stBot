import { useState } from 'react';
import useAuth from '@/hooks/useAuth';
import useEvents from '@/hooks/useEvents';
import EventList from '@/components/EventList';
import { Loader2 } from 'lucide-react';

export default function Home() {
    const { user, login, loading: authLoading } = useAuth();
    const [mode, setMode] = useState('weekly');
    const { events, loading: eventsLoading, error } = useEvents(mode);

    if (authLoading) {
        return (
            <div className="flex h-[80vh] items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
                <h1 className="text-5xl font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent mb-6">
                    41st Elite Corps Portal
                </h1>
                <p className="text-xl text-neutral-400 mb-8 max-w-lg">
                    Access event data, manage records, and view statistics. Please login with Discord to continue.
                </p>
                <button
                    onClick={login}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-xl text-lg font-medium transition-all shadow-lg hover:shadow-emerald-500/20"
                >
                    Login with Discord
                </button>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-7xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Event Explorer</h1>
                    <p className="text-neutral-400">View and analyze unit activity.</p>
                </div>

                <div className="flex bg-neutral-900/50 p-1 rounded-lg border border-neutral-800 self-start">
                    <button
                        onClick={() => setMode('weekly')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'weekly'
                            ? 'bg-neutral-800 text-white shadow-sm'
                            : 'text-neutral-400 hover:text-white'
                            }`}
                    >
                        Weekly Events
                    </button>
                    <button
                        onClick={() => setMode('all-time')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'all-time'
                            ? 'bg-neutral-800 text-white shadow-sm'
                            : 'text-neutral-400 hover:text-white'
                            }`}
                    >
                        All Time History
                    </button>
                </div>
            </div>

            {eventsLoading ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
            ) : error ? (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-lg">
                    {error}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-8">
                    <div className="w-full">
                        <EventList events={events} />
                    </div>
                </div>
            )}
        </div>
    );
}
