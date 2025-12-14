import { useState } from 'react';
import useEvents from '@/hooks/useEvents';
import AdminEventTable from '@/components/AdminEventTable';
import { Loader2, RefreshCw } from 'lucide-react';

export default function AdminDashboard() {
    const [mode, setMode] = useState('weekly');
    const { events, loading, error, refetch } = useEvents(mode);

    const handleRefresh = () => {
        refetch();
    };

    return (
        <div className="container mx-auto px-4 py-8 max-w-7xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">HICOM Event Editor</h1>
                    <p className="text-neutral-400">Manage, edit, and delete event records.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex bg-neutral-900/50 p-1 rounded-lg border border-neutral-800">
                        <button
                            onClick={() => setMode('weekly')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'weekly'
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'text-neutral-400 hover:text-white'
                                }`}
                        >
                            Weekly
                        </button>
                        <button
                            onClick={() => setMode('all-time')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'all-time'
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'text-neutral-400 hover:text-white'
                                }`}
                        >
                            History
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-rose-500" />
                </div>
            ) : error ? (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-lg">
                    {error}
                </div>
            ) : (
                <AdminEventTable events={events} refreshEvents={handleRefresh} mode={mode} />
            )}
        </div>
    );
}
