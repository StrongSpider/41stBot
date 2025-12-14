import { createContext, useContext, useEffect, useState } from 'react';
import api from '@/api/axios';

const AuthContext = createContext({
    user: null,
    loading: true,
    login: () => { },
    logout: () => { },
    checkAuth: () => { }
});

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = async () => {
        try {
            const { data } = await api.get('/auth/me');
            setUser(data);
        } catch (error) {
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkAuth();
    }, []);

    const login = () => {
        window.location.href = '/auth/discord';
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout');
            setUser(null);
            window.location.reload();
        } catch (error) {
            console.error('Logout failed', error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
