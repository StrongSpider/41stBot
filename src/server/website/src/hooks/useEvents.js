import { useState, useEffect, useCallback } from 'react';
import ApiService from '@/services/api';
import useAuth from '@/hooks/useAuth';

export default function useEvents(mode = 'weekly') {
    const { user } = useAuth();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchEvents = useCallback(async () => {
        // Allow public access for 'all-time'
        if (!user && mode !== 'all-time') {
            setEvents([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const data = mode === 'weekly'
                ? await ApiService.events.getWeekly()
                : await ApiService.events.getAllTime();
            setEvents(data);
        } catch (err) {
            console.error('Failed to fetch events', err);
            setError(err.message || 'Failed to fetch events');
        } finally {
            setLoading(false);
        }
    }, [user, mode]);

    useEffect(() => {
        // Trigger fetch if user exists OR if mode is public 'all-time'
        if (user || mode === 'all-time') {
            fetchEvents();
        } else {
            setEvents([]);
            setLoading(false);
        }
    }, [fetchEvents, user, mode]);

    return { events, loading, error, refetch: fetchEvents };
}
