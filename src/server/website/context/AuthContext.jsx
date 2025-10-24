import React, { createContext, useState, useEffect } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(undefined);

    useEffect(() => {
        fetch('/api/auth/me', { credentials: 'include' })
            .then(res => res.ok ? res.json() : Promise.reject())
            .then(data => setUser(data))
            .catch(() => setUser(null));
    }, []);

    const login = () => {
        window.location.href = '/auth/discord';
    };

    const logout = async () => {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}