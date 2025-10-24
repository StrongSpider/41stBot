import React, { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useContext(AuthContext);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-800">
      <button
        onClick={login}
        className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
      >
        Login with Discord
      </button>
    </div>
  );
}