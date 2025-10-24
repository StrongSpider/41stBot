import React, { createContext, useContext } from 'react';

const FirebaseContext = createContext();

export function FirebaseProvider({ children }) {
  // Fetch all weekly events
  const getWeekly = async () => {
    const res = await fetch('/api/weekly', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch weekly events');
    return res.json();
  };

  // Update a single weekly event
  const updateWeekly = async (id, changes) => {
    const res = await fetch(`/api/weekly/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes)
    });
    if (!res.ok) throw new Error('Failed to update weekly event');
    return res.json();
  };

  // Fetch all history events
  const getHistory = async () => {
    const res = await fetch('/api/history', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch history events');
    return res.json();
  };

  // Update a single history event
  const updateHistory = async (id, changes) => {
    const res = await fetch(`/api/history/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes)
    });
    if (!res.ok) throw new Error('Failed to update history event');
    return res.json();
  };

  return (
    <FirebaseContext.Provider value={{ getWeekly, updateWeekly, getHistory, updateHistory }}>
      {children}
    </FirebaseContext.Provider>
  );
}

// Custom hook for ease of use
export function useFirebase() {
  return useContext(FirebaseContext);
}
