import api from '@/api/axios';

const ApiService = {
    // Auth
    auth: {
        getMe: () => api.get('/auth/me').then(res => res.data),
        login: () => window.location.href = '/auth/discord',
        logout: () => api.post('/auth/logout'),
        getClientId: () => api.get('/auth/client-id').then(res => res.data),
        updateActivity: (code) => api.post('/auth/activity', { code }).then(res => res.data)
    },

    // Events
    events: {
        getAllTime: () => api.get('/all-time').then(res => res.data),
        getWeekly: () => api.get('/weekly').then(res => res.data),
        createChangeLog: (entry) => api.post('/log-event-change', entry).then(res => res.data),
        updateWeekly: (id, data) => api.patch(`/weekly/${id}`, data).then(res => res.data),
        updateAllTime: (id, data) => api.patch(`/all-time/${id}`, data).then(res => res.data),
        deleteWeekly: (id) => api.delete(`/weekly/${id}`).then(res => res.data),
        deleteAllTime: (id) => api.delete(`/all-time/${id}`).then(res => res.data)
    },
};

export default ApiService;
