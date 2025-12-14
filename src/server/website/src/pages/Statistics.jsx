import { useState, useMemo } from 'react';
import useEvents from '@/hooks/useEvents';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Loader2, Plus, Trash2, Settings2, Calendar } from 'lucide-react';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export default function Statistics() {
    const { events, loading, error } = useEvents('all-time');
    const [configs, setConfigs] = useState([]);
    const [newPattern, setNewPattern] = useState('');
    const [newAlias, setNewAlias] = useState('');

    const [timeRange, setTimeRange] = useState('30d'); // 7d, 30d, 90d, all, custom
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const handleAddConfig = (e) => {
        e.preventDefault();
        if (newPattern && newAlias) {
            setConfigs([...configs, { pattern: newPattern, alias: newAlias, id: Date.now() }]);
            setNewPattern('');
            setNewAlias('');
        }
    };

    const handleRemoveConfig = (id) => {
        setConfigs(configs.filter(c => c.id !== id));
    };

    const filteredEvents = useMemo(() => {
        if (!events || events.length === 0) return [];

        const now = new Date();
        let startDate = null;
        let endDate = null;

        if (timeRange === '7d') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (timeRange === '30d') {
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else if (timeRange === '90d') {
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        } else if (timeRange === 'custom') {
            if (customStart) startDate = new Date(customStart);
            if (customEnd) {
                endDate = new Date(customEnd);
                endDate.setHours(23, 59, 59, 999); // End of day
            }
        }

        return events.filter(ev => {
            if (!ev.timestamp) return false;
            const evDate = new Date(ev.timestamp);
            if (startDate && evDate < startDate) return false;
            if (endDate && evDate > endDate) return false;
            return true;
        });
    }, [events, timeRange, customStart, customEnd]);

    const data = useMemo(() => {
        if (filteredEvents.length === 0 || configs.length === 0) return [];

        const counts = {};
        configs.forEach(c => counts[c.alias] = 0);

        filteredEvents.forEach(ev => {
            const type = ev.type || '';
            for (const config of configs) {
                let match = false;
                if (config.pattern.endsWith('*')) {
                    const prefix = config.pattern.slice(0, -1);
                    if (type.startsWith(prefix)) match = true;
                } else {
                    if (type === config.pattern) match = true;
                }

                if (match) {
                    counts[config.alias]++;
                    break;
                }
            }
        });

        return Object.entries(counts)
            .filter(([_, value]) => value > 0)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [filteredEvents, configs]);

    return (
        <div className="container mx-auto px-4 py-8 max-w-7xl">
            <h1 className="text-3xl font-bold text-white mb-2">Statistics & Analysis</h1>
            <p className="text-neutral-400 mb-8">Customize and visualize event data.</p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Configuration Panel */}
                <div className="lg:col-span-1 space-y-6">
                    {/* Time Range Selector */}
                    <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
                        <div className="flex items-center gap-2 mb-4 text-emerald-400">
                            <Calendar className="w-5 h-5" />
                            <h2 className="font-semibold">Time Range</h2>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {['7d', '30d', '90d', 'all'].map(range => (
                                <button
                                    key={range}
                                    onClick={() => setTimeRange(range)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${timeRange === range
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
                                        }`}
                                >
                                    {range === 'all' ? 'All Time' : `Last ${range.replace('d', ' Days')}`}
                                </button>
                            ))}
                            <button
                                onClick={() => setTimeRange('custom')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${timeRange === 'custom'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
                                    }`}
                            >
                                Custom
                            </button>
                        </div>

                        {timeRange === 'custom' && (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-neutral-500 mb-1">Start Date</label>
                                    <input
                                        type="date"
                                        value={customStart}
                                        onChange={(e) => setCustomStart(e.target.value)}
                                        className="w-full bg-neutral-800 border-neutral-700 text-white rounded-lg px-2 py-1.5 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-neutral-500 mb-1">End Date</label>
                                    <input
                                        type="date"
                                        value={customEnd}
                                        onChange={(e) => setCustomEnd(e.target.value)}
                                        className="w-full bg-neutral-800 border-neutral-700 text-white rounded-lg px-2 py-1.5 text-sm"
                                    />
                                </div>
                            </div>
                        )}
                        <div className="text-xs text-neutral-500 mt-2">
                            Showing {filteredEvents.length} events
                        </div>
                    </div>

                    {/* Graph Configuration */}
                    <div className="bg-neutral-900/50 p-6 rounded-xl border border-neutral-800">
                        <div className="flex items-center gap-2 mb-4 text-emerald-400">
                            <Settings2 className="w-5 h-5" />
                            <h2 className="font-semibold">Graph Configuration</h2>
                        </div>
                        <p className="text-sm text-neutral-500 mb-4">
                            Define groupings for the chart. Use <code className="bg-neutral-800 px-1 rounded text-neutral-300">*</code> for wildcards.
                        </p>

                        <form onSubmit={handleAddConfig} className="space-y-3 mb-6">
                            <div>
                                <input
                                    type="text"
                                    placeholder="Pattern (e.g. Ranger*)"
                                    value={newPattern}
                                    onChange={(e) => setNewPattern(e.target.value)}
                                    className="w-full bg-neutral-800 border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </div>
                            <div>
                                <input
                                    type="text"
                                    placeholder="Alias (e.g. Rangers)"
                                    value={newAlias}
                                    onChange={(e) => setNewAlias(e.target.value)}
                                    className="w-full bg-neutral-800 border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={!newPattern || !newAlias}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                <Plus className="w-4 h-4" /> Add Grouping
                            </button>
                        </form>

                        <div className="space-y-2 max-h-[400px] overflow-y-auto">
                            {configs.map(config => (
                                <div key={config.id} className="flex items-center justify-between bg-neutral-800/50 p-3 rounded-lg border border-neutral-800 group">
                                    <div>
                                        <div className="text-sm font-medium text-white">{config.alias}</div>
                                        <div className="text-xs font-mono text-neutral-500">{config.pattern}</div>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveConfig(config.id)}
                                        className="text-neutral-500 hover:text-red-400 transition-colors p-1"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                            {configs.length === 0 && (
                                <div className="text-center text-sm text-neutral-600 py-4 italic">
                                    No groupings added. Graph will be empty.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Graph View */}
                <div className="lg:col-span-2">
                    {loading ? (
                        <div className="flex h-96 items-center justify-center bg-neutral-900/30 rounded-xl border border-neutral-800">
                            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                        </div>
                    ) : error ? (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-6 rounded-xl">
                            {error}
                        </div>
                    ) : (
                        <div className="bg-neutral-900/30 p-6 rounded-xl border border-neutral-800 h-[500px]">
                            {data.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={data}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={80}
                                            outerRadius={140}
                                            fill="#8884d8"
                                            paddingAngle={5}
                                            dataKey="value"
                                            label={({ name, value }) => `${name} (${value})`}
                                        >
                                            {data.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#fff' }}
                                            itemStyle={{ color: '#fff' }}
                                            labelStyle={{ color: '#fff' }}
                                        />
                                        <Legend verticalAlign="bottom" height={36} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-center px-6">
                                    <PieChart className="w-16 h-16 mb-4 opacity-20" />
                                    <p className="text-lg font-medium mb-1">No Data to Display</p>
                                    <p className="text-sm max-w-sm">
                                        Add groupings in the configuration panel and ensure the selected time range has events.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
