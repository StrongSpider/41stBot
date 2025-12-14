import { useState, useEffect, useCallback } from 'react';
import api from '@/api/axios';
import useAuth from '@/hooks/useAuth';

export default function useEvents(mode = 'weekly') {
    const { user } = useAuth();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchEvents = useCallback(async () => {
        if (!user) {
            setEvents([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const endpoint = mode === 'weekly' ? '/weekly' : '/all-time';
            const { data } = await api.get(endpoint);
            setEvents(data);
        } catch (err) {
            console.error('Failed to fetch events', err);
            setError(err.message || 'Failed to fetch events');
        } finally {
            setLoading(false);
        }
    }, [user, mode]);

    useEffect(() => {
        if (user) {
            fetchEvents();
        } else {
            setEvents([]);
            setLoading(false);
        }
    }, [fetchEvents, user]);

    return { events, loading, error, refetch: fetchEvents };
}
