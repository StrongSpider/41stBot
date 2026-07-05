import { useState, useMemo } from 'react';
import useEvents from '@/hooks/useEvents';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Pie,
    PieChart as RechartsPieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import {
    Activity,
    BarChart3,
    Calendar,
    Check,
    Clock,
    Eye,
    Loader2,
    PieChart,
    Plus,
    Settings2,
    Trash2,
    Users
} from 'lucide-react';
import {
    buildStatistics,
    buildTypeBreakdownRows,
    filterEventsByRange,
    getRangeBounds
} from '@/lib/statistics';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const SECTION_LINKS = [
    { key: 'overview', label: 'Overview' },
    { key: 'trends', label: 'Trends' },
    { key: 'event-types', label: 'Event Types' },
    { key: 'people', label: 'People' },
    { key: 'timing', label: 'Timing' }
];

const tooltipStyle = {
    backgroundColor: '#171717',
    borderColor: '#262626',
    borderRadius: 8,
    color: '#fff'
};

function formatNumber(value) {
    return new Intl.NumberFormat().format(value || 0);
}

function metricLabel(metric) {
    if (metric === 'attendees') return 'Attendees';
    if (metric === 'both') return 'Events + attendees';
    return 'Events';
}

function SectionHeader({ eyebrow, title, description }) {
    return (
        <div className="mb-4 flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">{eyebrow}</span>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="max-w-3xl text-sm text-neutral-400">{description}</p>}
        </div>
    );
}

function FieldLabel({ children }) {
    return <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-neutral-500">{children}</span>;
}

function SelectControl({ label, value, onChange, options }) {
    return (
        <label className="block">
            <FieldLabel>{label}</FieldLabel>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        </label>
    );
}

function MetricCard({ icon, label, value, detail }) {
    const Icon = icon;

    return (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-neutral-400">{label}</span>
                <Icon className="h-4 w-4 shrink-0 text-emerald-400" />
            </div>
            <div className="truncate text-2xl font-semibold text-white">{value}</div>
            {detail && <div className="mt-1 truncate text-xs text-neutral-500">{detail}</div>}
        </div>
    );
}

function ChartPanel({ title, icon, children, className = '', action }) {
    const Icon = icon;

    return (
        <section className={`rounded-lg border border-neutral-800 bg-neutral-900/30 p-5 ${className}`}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-emerald-400" />
                    <h3 className="text-base font-semibold text-neutral-100">{title}</h3>
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

function EmptyChart({ message }) {
    return (
        <div className="flex h-full min-h-64 items-center justify-center rounded-lg border border-dashed border-neutral-800 px-4 text-center text-sm text-neutral-500">
            {message}
        </div>
    );
}

function TimeRangeControls({ timeRange, setTimeRange, customStart, setCustomStart, customEnd, setCustomEnd, count }) {
    return (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
            <div className="mb-4 flex items-center gap-2 text-emerald-400">
                <Calendar className="h-5 w-5" />
                <h3 className="font-semibold text-neutral-100">Date Range</h3>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {['7d', '30d', '90d', 'all', 'custom'].map((range) => (
                    <button
                        key={range}
                        type="button"
                        onClick={() => setTimeRange(range)}
                        className={`flex min-h-12 items-center justify-center rounded-md px-2 py-2 text-center text-sm font-medium leading-tight transition-colors ${timeRange === range
                            ? 'bg-emerald-600 text-white'
                            : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                            }`}
                    >
                        {range === 'all' ? 'All Time' : range === 'custom' ? 'Custom' : range.replace('d', 'd')}
                    </button>
                ))}
            </div>

            {timeRange === 'custom' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                        <FieldLabel>Start</FieldLabel>
                        <input
                            type="date"
                            value={customStart}
                            onChange={(event) => setCustomStart(event.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                    </label>
                    <label className="block">
                        <FieldLabel>End</FieldLabel>
                        <input
                            type="date"
                            value={customEnd}
                            onChange={(event) => setCustomEnd(event.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-2 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                    </label>
                </div>
            )}

            <div className="mt-3 rounded-md bg-neutral-950/40 px-3 py-2 text-xs text-neutral-400">
                {formatNumber(count)} events match current setup.
            </div>
        </section>
    );
}

const TOP_LIMIT_OPTIONS = [
    { value: '5', label: 'Top 5' },
    { value: '8', label: 'Top 8' },
    { value: '12', label: 'Top 12' },
    { value: '20', label: 'Top 20' }
];

function SectionNavControls() {
    return (
        <nav className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                <Eye className="h-4 w-4" />
                <span>Sections</span>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
                {SECTION_LINKS.map((section) => (
                    <a
                        key={section.key}
                        href={`#${section.key}`}
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-100 transition-colors hover:border-emerald-400 hover:bg-emerald-500/20 hover:text-white"
                    >
                        {section.label}
                    </a>
                ))}
            </div>
        </nav>
    );
}

function EventGroupSetupPanel({
    configs,
    selectedGroupIds,
    newPattern,
    setNewPattern,
    newAlias,
    setNewAlias,
    addConfig,
    removeConfig,
    toggleGroup,
    addTypeGroup,
    topTypes
}) {
    return (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
            <div className="mb-4 flex items-center gap-2 text-emerald-400">
                <Settings2 className="h-5 w-5" />
                <h3 className="font-semibold text-neutral-100">Event Type Groups</h3>
            </div>

            <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-400">
                Select groups to filter every section. No selection means all event types are included.
            </div>

            {topTypes.length > 0 && (
                <div className="mb-4">
                    <FieldLabel>Quick add</FieldLabel>
                    <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
                        {topTypes.map((type) => (
                            <button
                                key={type.name}
                                type="button"
                                onClick={() => addTypeGroup(type.name)}
                                className="rounded-md border border-neutral-800 bg-neutral-800/70 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-emerald-500/40 hover:text-white"
                            >
                                {type.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <form onSubmit={addConfig} className="mb-4 grid grid-cols-1 gap-3">
                <label>
                    <FieldLabel>Pattern</FieldLabel>
                    <input
                        type="text"
                        placeholder="Ranger*"
                        value={newPattern}
                        onChange={(event) => setNewPattern(event.target.value)}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                </label>
                <label>
                    <FieldLabel>Label</FieldLabel>
                    <input
                        type="text"
                        placeholder="Ranger Events"
                        value={newAlias}
                        onChange={(event) => setNewAlias(event.target.value)}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                </label>
                <button
                    type="submit"
                    disabled={!newPattern.trim() || !newAlias.trim()}
                    className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                    Add
                </button>
            </form>

            <div className="max-h-96 space-y-2 overflow-y-auto pr-1 xl:max-h-[42vh]">
                {configs.map((config) => {
                    const selected = selectedGroupIds.includes(config.id);
                    return (
                        <div key={config.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
                            <button
                                type="button"
                                onClick={() => toggleGroup(config.id)}
                                className={`flex min-w-0 flex-1 items-center gap-2 text-left ${selected ? 'text-emerald-100' : 'text-neutral-300'}`}
                            >
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-emerald-500 bg-emerald-500/20' : 'border-neutral-600'}`}>
                                    {selected && <Check className="h-3.5 w-3.5" />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{config.alias}</span>
                                    <span className="block truncate font-mono text-xs text-neutral-500">{config.pattern}</span>
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => removeConfig(config.id)}
                                className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-red-400"
                                aria-label={`Remove ${config.alias}`}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    );
                })}
                {configs.length === 0 && (
                    <div className="rounded-lg border border-dashed border-neutral-800 py-4 text-center text-sm text-neutral-600">
                        No event type groups yet.
                    </div>
                )}
            </div>
        </section>
    );
}

function SectionControls({ children }) {
    return (
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {children}
        </div>
    );
}

function DayHourGrid({ data }) {
    const max = Math.max(...data.map((item) => item.events), 1);
    const byDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => ({
        day,
        slots: data.filter((item) => item.day === day)
    }));

    return (
        <div className="overflow-x-auto">
            <div className="min-w-[760px]">
                <div className="mb-2 grid grid-cols-[44px_repeat(24,minmax(24px,1fr))] gap-1 text-xs text-neutral-500">
                    <div />
                    {Array.from({ length: 24 }, (_, hour) => (
                        <div key={hour} className="text-center">{hour}</div>
                    ))}
                </div>
                <div className="space-y-1">
                    {byDay.map(({ day, slots }) => (
                        <div key={day} className="grid grid-cols-[44px_repeat(24,minmax(24px,1fr))] gap-1">
                            <div className="flex items-center text-xs font-medium text-neutral-400">{day}</div>
                            {slots.map((slot) => {
                                const intensity = slot.events / max;
                                return (
                                    <div
                                        key={slot.label}
                                        title={`${slot.label}: ${slot.events} events`}
                                        className="h-7 rounded border border-neutral-800"
                                        style={{
                                            backgroundColor: slot.events
                                                ? `rgba(16, 185, 129, ${0.2 + intensity * 0.75})`
                                                : 'rgba(38, 38, 38, 0.55)'
                                        }}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function TrendTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;

    const row = payload[0]?.payload || {};
    return (
        <div className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm shadow-xl">
            <div className="mb-2 font-semibold text-white">{row.tooltipLabel || row.label}</div>
            <div className="space-y-1">
                {payload.map((item) => (
                    <div key={item.dataKey} className="flex items-center justify-between gap-6">
                        <span className="text-neutral-300">{item.name}</span>
                        <span className="font-medium text-white">{formatNumber(item.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TrendChart({ data, trendMetric, trendStyle }) {
    const showEvents = trendMetric === 'events' || trendMetric === 'both';
    const showAttendees = trendMetric === 'attendees' || trendMetric === 'both';
    const Chart = trendStyle === 'bar' ? BarChart : AreaChart;

    return (
        <ResponsiveContainer width="100%" height="100%">
            <Chart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#a3a3a3" fontSize={12} />
                <YAxis stroke="#a3a3a3" fontSize={12} allowDecimals={false} />
                <Tooltip content={<TrendTooltip />} />
                <Legend />
                {trendStyle === 'bar' ? (
                    <>
                        {showEvents && <Bar dataKey="events" name="Events" fill="#10b981" radius={[6, 6, 0, 0]} />}
                        {showAttendees && <Bar dataKey="attendees" name="Attendees" fill="#3b82f6" radius={[6, 6, 0, 0]} />}
                    </>
                ) : (
                    <>
                        {showEvents && <Area type="monotone" dataKey="events" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name="Events" />}
                        {showAttendees && <Area type="monotone" dataKey="attendees" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} name="Attendees" />}
                    </>
                )}
            </Chart>
        </ResponsiveContainer>
    );
}

function TypeChart({ data, typeChart }) {
    if (typeChart === 'bar') {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 42, bottom: 4 }}>
                    <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="#a3a3a3" fontSize={12} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" stroke="#a3a3a3" fontSize={12} width={120} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                    <Bar dataKey="events" name="Events" fill="#3b82f6" radius={[0, 6, 6, 0]} />
                </BarChart>
            </ResponsiveContainer>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={105}
                    paddingAngle={3}
                    dataKey="events"
                    nameKey="name"
                >
                    {data.map((entry, index) => (
                        <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                <Legend />
            </RechartsPieChart>
        </ResponsiveContainer>
    );
}

function AttendanceTypeChart({ data }) {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 40 }}>
                <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#a3a3a3" fontSize={12} angle={-20} textAnchor="end" interval={0} height={54} />
                <YAxis stroke="#a3a3a3" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                <Legend />
                <Bar dataKey="attendees" name="Attendees" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                <Bar dataKey="average" name="Avg/Event" fill="#06b6d4" radius={[6, 6, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
}

function normalizeEventType(type) {
    const value = String(type || '').trim();
    return value || 'Unknown';
}

function matchesGroupPattern(type, pattern) {
    const value = String(pattern || '').trim();
    if (!value) return false;
    return value.endsWith('*') ? type.startsWith(value.slice(0, -1)) : type === value;
}

function eventMatchesAnyGroup(event, groups) {
    const type = normalizeEventType(event?.type);
    return groups.some((group) => matchesGroupPattern(type, group.pattern));
}

export default function Statistics() {
    const { events, loading, error } = useEvents('all-time');
    const [configs, setConfigs] = useState([]);
    const [selectedGroupIds, setSelectedGroupIds] = useState([]);
    const [newPattern, setNewPattern] = useState('');
    const [newAlias, setNewAlias] = useState('');
    const [timeRange, setTimeRange] = useState('30d');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [typeLimit, setTypeLimit] = useState('8');
    const [peopleLimit, setPeopleLimit] = useState('8');
    const [trendMetric, setTrendMetric] = useState('both');
    const [trendStyle, setTrendStyle] = useState('area');
    const [typeChart, setTypeChart] = useState('donut');
    const bounds = useMemo(() => getRangeBounds(timeRange, customStart, customEnd), [timeRange, customStart, customEnd]);
    const filteredEvents = useMemo(() => filterEventsByRange(events, bounds), [events, bounds]);
    const selectedConfigs = useMemo(() => configs.filter((config) => selectedGroupIds.includes(config.id)), [configs, selectedGroupIds]);
    const activeCustomConfigs = selectedConfigs.length ? selectedConfigs : configs;
    const scopedEvents = useMemo(() => {
        if (!selectedConfigs.length) return filteredEvents;
        return filteredEvents.filter((event) => eventMatchesAnyGroup(event, selectedConfigs));
    }, [filteredEvents, selectedConfigs]);
    const statsLimit = Math.max(Number(typeLimit), Number(peopleLimit));
    const stats = useMemo(() => buildStatistics(scopedEvents, bounds, { topLimit: statsLimit }), [scopedEvents, bounds, statsLimit]);
    const topTypeOptions = useMemo(() => buildTypeBreakdownRows(filteredEvents, { topLimit: 20, sortBy: 'events' }), [filteredEvents]);
    const customTypeRows = useMemo(() => activeCustomConfigs.length ? buildTypeBreakdownRows(scopedEvents, {
        configs: activeCustomConfigs,
        limitCustom: false,
        sortBy: 'events'
    }) : [], [scopedEvents, activeCustomConfigs]);
    const customAttendanceRows = useMemo(() => activeCustomConfigs.length ? buildTypeBreakdownRows(scopedEvents, {
        configs: activeCustomConfigs,
        limitCustom: false,
        sortBy: 'attendees'
    }) : [], [scopedEvents, activeCustomConfigs]);
    const typeRows = stats.typeRows.slice(0, Number(typeLimit));
    const attendanceRows = stats.attendanceByType.slice(0, Number(typeLimit));
    const hostRows = stats.hostRows.slice(0, Number(peopleLimit));
    const supervisorRows = stats.supervisorRows.slice(0, Number(peopleLimit));

    const handleAddConfig = (event) => {
        event.preventDefault();
        const pattern = newPattern.trim();
        const alias = newAlias.trim();
        if (!pattern || !alias) return;
        const id = Date.now();
        setConfigs((current) => [...current, { pattern, alias, id }]);
        setSelectedGroupIds((current) => [...current, id]);
        setNewPattern('');
        setNewAlias('');
    };

    const handleRemoveConfig = (id) => {
        setConfigs((current) => current.filter((config) => config.id !== id));
        setSelectedGroupIds((current) => current.filter((groupId) => groupId !== id));
    };

    const toggleGroup = (id) => {
        setSelectedGroupIds((current) => current.includes(id)
            ? current.filter((groupId) => groupId !== id)
            : [...current, id]);
    };

    const addTypeGroup = (type) => {
        const existing = configs.find((config) => config.pattern === type && config.alias === type);
        if (existing) {
            setSelectedGroupIds((selected) => selected.includes(existing.id) ? selected : [...selected, existing.id]);
            return;
        }

        const id = Date.now() + configs.length;
        setConfigs((current) => [...current, { pattern: type, alias: type, id }]);
        setSelectedGroupIds((selected) => [...selected, id]);
    };

    return (
        <div className="min-h-screen bg-neutral-950">
            <header className="sticky top-0 z-40 border-b border-neutral-900 bg-neutral-950/95 backdrop-blur">
                <div className="container mx-auto flex max-w-[90rem] flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                        <h1 className="truncate text-2xl font-bold text-white">Statistics & Analysis</h1>
                        <p className="truncate text-sm text-neutral-400">Filter event history, tune charts, and compare activity patterns.</p>
                    </div>
                    <SectionNavControls />
                </div>
            </header>

            <div className="container mx-auto max-w-[90rem] px-4 py-6">
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                    <aside className="space-y-4 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
                        <SectionHeader
                            eyebrow="Setup"
                            title="Choose What To Analyze"
                            description="Date range and event type groups apply to every section."
                        />
                        <TimeRangeControls
                            timeRange={timeRange}
                            setTimeRange={setTimeRange}
                            customStart={customStart}
                            setCustomStart={setCustomStart}
                            customEnd={customEnd}
                            setCustomEnd={setCustomEnd}
                            count={scopedEvents.length}
                        />
                        <EventGroupSetupPanel
                            configs={configs}
                            selectedGroupIds={selectedGroupIds}
                            newPattern={newPattern}
                            setNewPattern={setNewPattern}
                            newAlias={newAlias}
                            setNewAlias={setNewAlias}
                            addConfig={handleAddConfig}
                            removeConfig={handleRemoveConfig}
                            toggleGroup={toggleGroup}
                            addTypeGroup={addTypeGroup}
                        topTypes={topTypeOptions.slice(0, 5)}
                        />
                    </aside>

                    <main className="min-w-0">
            {loading ? (
                <div className="flex h-96 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/30">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                </div>
            ) : error ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-6 text-red-400">
                    {error}
                </div>
            ) : filteredEvents.length === 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-10 text-center text-neutral-500">
                    No events found for this range.
                </div>
            ) : (
                <div className="space-y-10">
                    <section id="overview" className="scroll-mt-24">
                        <SectionHeader
                            eyebrow="Overview"
                            title="Snapshot"
                            description="High-level totals for the current date range."
                        />
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <MetricCard icon={Activity} label="Total Events" value={formatNumber(stats.totalEvents)} detail={`${stats.bucketMode} buckets`} />
                            <MetricCard icon={BarChart3} label="Events Per Day" value={stats.eventsPerDay} detail={`${stats.rangeDays} days in range`} />
                            <MetricCard icon={Users} label="Average Attendance" value={stats.averageAttendees} detail={`${formatNumber(stats.uniqueAttendees)} unique attendees`} />
                            <MetricCard icon={Clock} label="Busiest Slot" value={stats.busiestDayHour.events ? stats.busiestDayHour.label : 'N/A'} detail={`${formatNumber(stats.busiestDayHour.events)} events`} />
                            <MetricCard icon={PieChart} label="Busiest Type" value={stats.busiestType} detail="Top event category" />
                            <MetricCard icon={Users} label="Unique Hosts" value={formatNumber(stats.uniqueHosts)} detail="Host names in range" />
                            <MetricCard icon={Users} label="Unique Supervisors" value={formatNumber(stats.uniqueSupervisors)} detail="Supervisor names in range" />
                            <MetricCard icon={Calendar} label="Date Span" value={`${formatNumber(stats.rangeDays)} days`} detail="Filtered event window" />
                        </div>
                    </section>

                    <section id="trends" className="scroll-mt-24">
                        <SectionHeader
                            eyebrow="Trends"
                            title="Activity Over Time"
                            description={`${metricLabel(trendMetric)} shown across ${stats.bucketMode} buckets.`}
                        />
                        <SectionControls>
                            <SelectControl
                                label="Metric"
                                value={trendMetric}
                                onChange={setTrendMetric}
                                options={[
                                    { value: 'both', label: 'Events + attendees' },
                                    { value: 'events', label: 'Events only' },
                                    { value: 'attendees', label: 'Attendees only' }
                                ]}
                            />
                            <SelectControl
                                label="Chart"
                                value={trendStyle}
                                onChange={setTrendStyle}
                                options={[
                                    { value: 'area', label: 'Area' },
                                    { value: 'bar', label: 'Bar' }
                                ]}
                            />
                        </SectionControls>
                        <ChartPanel title="Event Volume" icon={Activity}>
                            <div className="h-80">
                                <TrendChart data={stats.trendData} trendMetric={trendMetric} trendStyle={trendStyle} />
                            </div>
                        </ChartPanel>
                    </section>

                    <section id="event-types" className="scroll-mt-24">
                        <SectionHeader
                            eyebrow="Breakdowns"
                            title="Event Type Analysis"
                            description={`Compare top ${typeLimit} event types and configured groups by frequency and attendance.`}
                        />
                        <SectionControls>
                            <SelectControl
                                label="Event types"
                                value={typeLimit}
                                onChange={setTypeLimit}
                                options={TOP_LIMIT_OPTIONS}
                            />
                            <SelectControl
                                label="Chart"
                                value={typeChart}
                                onChange={setTypeChart}
                                options={[
                                    { value: 'donut', label: 'Donut' },
                                    { value: 'bar', label: 'Bar' }
                                ]}
                            />
                        </SectionControls>
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                <ChartPanel title="Event Types" icon={PieChart}>
                                    <div className="h-80">
                                        {typeRows.length ? (
                                            <TypeChart data={typeRows} typeChart={typeChart} />
                                        ) : (
                                            <EmptyChart message="No event type data in this range." />
                                        )}
                                    </div>
                                </ChartPanel>

                                <ChartPanel title="Attendance By Type" icon={Users}>
                                    <div className="h-80">
                                        {attendanceRows.length ? (
                                            <AttendanceTypeChart data={attendanceRows} />
                                        ) : (
                                            <EmptyChart message="No event type attendance in this range." />
                                        )}
                                    </div>
                                </ChartPanel>
                            </div>

                            {configs.length > 0 && (
                                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                    <ChartPanel title="Grouped Event Types" icon={PieChart}>
                                        <div className="h-80">
                                            {customTypeRows.length ? (
                                                <TypeChart data={customTypeRows} typeChart={typeChart} />
                                            ) : (
                                                <EmptyChart message="No matching grouped events in this setup." />
                                            )}
                                        </div>
                                    </ChartPanel>

                                    <ChartPanel title="Grouped Attendance" icon={Users}>
                                        <div className="h-80">
                                            {customAttendanceRows.length ? (
                                                <AttendanceTypeChart data={customAttendanceRows} />
                                            ) : (
                                                <EmptyChart message="No matching grouped attendance in this setup." />
                                            )}
                                        </div>
                                    </ChartPanel>
                                </div>
                            )}
                        </div>
                    </section>

                    <section id="people" className="scroll-mt-24">
                        <SectionHeader
                            eyebrow="People"
                            title="Hosts And Supervisors"
                            description={`Showing top ${peopleLimit} names by event count.`}
                        />
                        <SectionControls>
                            <SelectControl
                                label="People shown"
                                value={peopleLimit}
                                onChange={setPeopleLimit}
                                options={TOP_LIMIT_OPTIONS}
                            />
                        </SectionControls>
                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <ChartPanel title="Top Hosts" icon={Users}>
                                <div className="h-80">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={hostRows} layout="vertical" margin={{ top: 4, right: 24, left: 42, bottom: 4 }}>
                                            <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                                            <XAxis type="number" stroke="#a3a3a3" fontSize={12} allowDecimals={false} />
                                            <YAxis type="category" dataKey="name" stroke="#a3a3a3" fontSize={12} width={120} />
                                            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                                            <Bar dataKey="events" name="Hosted" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </ChartPanel>

                            <ChartPanel title="Top Supervisors" icon={Users}>
                                <div className="h-80">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={supervisorRows} layout="vertical" margin={{ top: 4, right: 24, left: 42, bottom: 4 }}>
                                            <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                                            <XAxis type="number" stroke="#a3a3a3" fontSize={12} allowDecimals={false} />
                                            <YAxis type="category" dataKey="name" stroke="#a3a3a3" fontSize={12} width={120} />
                                            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                                            <Bar dataKey="events" name="Supervised" fill="#ec4899" radius={[0, 6, 6, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </ChartPanel>
                        </div>
                    </section>

                    <section id="timing" className="scroll-mt-24">
                        <SectionHeader
                            eyebrow="Timing"
                            title="Busiest Days And Hours"
                            description="Darker cells mean more events happened in that day/hour slot."
                        />
                        <ChartPanel title="Activity Heatmap" icon={Clock}>
                            <DayHourGrid data={stats.dayHour} />
                        </ChartPanel>
                    </section>

                </div>
            )}
                    </main>
                </div>
            </div>
        </div>
    );
}
