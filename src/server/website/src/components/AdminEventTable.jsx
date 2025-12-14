import { useState, useMemo } from 'react';
import { Search, Filter, Trash2, Edit2, Check, X } from 'lucide-react';
import api from '@/api/axios';

export default function AdminEventTable({ events, refreshEvents, mode }) {
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('All');
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});

    const filteredEvents = useMemo(() => {
        return events.filter(ev => {
            const matchesSearch =
                (ev.host || '').toLowerCase().includes(search.toLowerCase()) ||
                (ev.type || '').toLowerCase().includes(search.toLowerCase()) ||
                (ev.message || '').toLowerCase().includes(search.toLowerCase());

            const matchesType = typeFilter === 'All' || ev.type === typeFilter;

            return matchesSearch && matchesType;
        });
    }, [events, search, typeFilter]);

    const eventTypes = useMemo(() => {
        const types = new Set(events.map(e => e.type));
        return ['All', ...Array.from(types)];
    }, [events]);

    const handleEditClick = (ev) => {
        setEditingId(ev.eventId);
        setEditForm({ ...ev });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditForm({});
    };

    const handleSaveEdit = async () => {
        try {
            const endpoint = mode === 'weekly' ? `/weekly/${editingId}` : `/all-time/${editingId}`;
            await api.patch(endpoint, {
                type: editForm.type,
                message: editForm.message
            });
            setEditingId(null);
            refreshEvents();
        } catch (error) {
            console.error('Update failed', error);
            alert('Failed to update event');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this event?')) return;
        try {
            const endpoint = mode === 'weekly' ? `/weekly/${id}` : `/all-time/${id}`;
            await api.delete(endpoint);
            refreshEvents();
        } catch (error) {
            console.error('Delete failed', error);
            alert('Failed to delete event');
        }
    };

    return (
        <div className="bg-neutral-900/30 border border-neutral-800 rounded-lg overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-neutral-800 flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" size={16} />
                    <input
                        type="text"
                        placeholder="Search events..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-rose-500 transition-colors"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <Filter className="text-neutral-500" size={16} />
                    <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        className="bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-rose-500"
                    >
                        {eventTypes.map(type => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-neutral-400">
                    <thead className="bg-neutral-900/50 text-neutral-200 uppercase text-xs">
                        <tr>
                            <th className="px-6 py-3 font-medium">Type</th>
                            <th className="px-6 py-3 font-medium">Host</th>
                            <th className="px-6 py-3 font-medium">Message/Details</th>
                            <th className="px-6 py-3 font-medium">Date</th>
                            <th className="px-6 py-3 font-medium text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                        {filteredEvents.map((ev) => (
                            <tr key={ev.eventId} className="hover:bg-neutral-800/30 transition-colors group">
                                <td className="px-6 py-4 font-medium text-white">
                                    {editingId === ev.eventId ? (
                                        <input
                                            type="text"
                                            value={editForm.type}
                                            onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                                            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white w-full"
                                        />
                                    ) : (
                                        ev.type
                                    )}
                                </td>
                                <td className="px-6 py-4">{ev.host}</td>
                                <td className="px-6 py-4 max-w-xs truncate">
                                    {editingId === ev.eventId ? (
                                        <input
                                            type="text"
                                            value={editForm.message || ''}
                                            onChange={(e) => setEditForm({ ...editForm, message: e.target.value })}
                                            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white w-full"
                                        />
                                    ) : (
                                        ev.message || '-'
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {ev.timestamp ? new Date(ev.timestamp).toLocaleDateString() : 'N/A'}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {editingId === ev.eventid ? (
                                        <div className="flex justify-end gap-2">
                                            <button onClick={handleSaveEdit} className="text-green-500 hover:text-green-400 p-1"><Check size={18} /></button>
                                            <button onClick={handleCancelEdit} className="text-red-500 hover:text-red-400 p-1"><X size={18} /></button>
                                        </div>
                                    ) : (
                                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEditClick(ev)} className="text-indigo-400 hover:text-indigo-300 p-1"><Edit2 size={18} /></button>
                                            <button onClick={() => handleDelete(ev.eventId)} className="text-red-400 hover:text-red-300 p-1"><Trash2 size={18} /></button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="p-4 border-t border-neutral-800 text-xs text-neutral-500 text-center">
                Showing {filteredEvents.length} of {events.length} events
            </div>
        </div>
    );
}
