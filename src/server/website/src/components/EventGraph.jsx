import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function EventGraph({ events }) {
    const data = useMemo(() => {
        if (!events || events.length === 0) return [];

        const counts = {};
        events.forEach(ev => {
            const type = ev.type || 'Unknown';
            counts[type] = (counts[type] || 0) + 1;
        });

        return Object.entries(counts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [events]);

    if (events.length === 0) {
        return (
            <div className="h-64 flex items-center justify-center text-neutral-500 bg-neutral-900/30 rounded-lg border border-neutral-800">
                No event data available
            </div>
        );
    }

    return (
        <div className="bg-neutral-900/30 p-6 rounded-lg border border-neutral-800">
            <h3 className="text-lg font-semibold mb-4 text-neutral-200">Event Distribution</h3>
            <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            fill="#8884d8"
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#fff' }}
                        />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
