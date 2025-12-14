import { format } from 'date-fns';

export default function EventList({ events }) {
    if (!events || events.length === 0) {
        return (
            <div className="text-center py-12 text-neutral-500">
                No events found.
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/30">
            <table className="w-full text-left text-sm text-neutral-400">
                <thead className="bg-neutral-900/50 text-neutral-200 uppercase">
                    <tr>
                        <th className="px-6 py-3 font-medium">Type</th>
                        <th className="px-6 py-3 font-medium">Host</th>
                        <th className="px-6 py-3 font-medium">Supervisor</th>
                        <th className="px-6 py-3 font-medium">Date</th>
                        <th className="px-6 py-3 font-medium">Attendees</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                    {events.map((ev) => (
                        <tr key={ev.eventId} className="hover:bg-neutral-800/30 transition-colors">
                            <td className="px-6 py-4 font-medium text-white">{ev.type}</td>
                            <td className="px-6 py-4">{ev.host}</td>
                            <td className="px-6 py-4">{ev.supervisor}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                                {ev.timestamp ? new Date(ev.timestamp).toLocaleDateString() : 'N/A'}
                            </td>
                            <td className="px-6 py-4">{ev.attendees ? ev.attendees.length : 0}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
