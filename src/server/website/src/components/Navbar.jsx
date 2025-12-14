import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { LogIn, LogOut, User } from 'lucide-react';
import icon from '@/assets/icon.png';

export default function Navbar() {
    const { user, login, logout, loading } = useAuth();

    return (
        <nav className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-50">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                <Link to="/" className="text-xl font-bold text-emerald-500 flex items-center gap-2">
                    <img src={icon} alt="Logo" className="w-8 h-8 rounded-full" />
                    <span>41st Elite Corps</span>
                </Link>

                <div className="flex items-center gap-4">
                    <Link to="/statistics" className="text-sm font-medium text-neutral-400 hover:text-white transition-colors">
                        Statistics
                    </Link>
                    {!loading && user && (
                        <div className="flex gap-4 mr-4 border-r border-neutral-700 pr-4">
                            {user.isOfficer && (
                                <Link to="/officer" className="text-sm font-medium text-neutral-400 hover:text-white transition-colors">
                                    Officer
                                </Link>
                            )}
                            {user.isHICOM && (
                                <Link to="/admin" className="text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors">
                                    HICOM
                                </Link>
                            )}
                        </div>
                    )}

                    {!loading && (
                        user ? (
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 text-sm text-neutral-300">
                                    {user.avatar ? (
                                        <img
                                            src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`}
                                            alt={user.username}
                                            className="w-8 h-8 rounded-full bg-neutral-800"
                                        />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                                            <User size={16} />
                                        </div>
                                    )}
                                    <span className="hidden sm:inline">{user.username}</span>
                                </div>
                                <button
                                    onClick={logout}
                                    className="p-2 text-neutral-400 hover:text-white transition-colors"
                                    title="Logout"
                                >
                                    <LogOut size={20} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={login}
                                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                                <LogIn size={16} />
                                <span>Login via Discord</span>
                            </button>
                        )
                    )}
                </div>
            </div>
        </nav>
    );
}
