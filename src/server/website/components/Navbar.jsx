import React, { useContext } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

export default function Navbar() {
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }) =>
    isActive
      ? 'underline px-5 py-3 text-xl font-semibold'
      : 'hover:underline px-5 py-3 text-xl font-semibold';

  return (
    <nav
      className="flex items-center justify-between py-3 pr-8"
      style={{
        backgroundColor: 'var(--discord-header, #202225)',
        color: 'var(--discord-text, #DCDDDE)',
        borderBottom: '2px solid var(--discord-hover, #393C43)',
        fontFamily: 'inherit',
        height: '64px',
        paddingLeft: '2.5rem', // About 40px
      }}
    >
      <div
        className="flex items-center"
        style={{ gap: '2rem', paddingLeft: '1.5rem' }} // Adds 24px left padding and gap
      >
        <h1 className="text-2xl font-bold" style={{ color: 'var(--discord-text, #DCDDDE)' }}>
          41st Event Portal
        </h1>
        <div className="flex items-center" style={{ gap: '2rem' }}>
          <NavLink to="/players" className={linkClass}>
            Players
          </NavLink>
          <NavLink to="/weekly" className={linkClass}>
            Weekly
          </NavLink>
          <NavLink to="/history" className={linkClass}>
            History
          </NavLink>
          {/* <NavLink to="/quotas" className={linkClass}>
            Quotas
          </NavLink> */}
          <NavLink to="/quotas/report" className={linkClass}>
            Quota Report
          </NavLink>
        </div>
      </div>
      <button
        onClick={onLogout}
        className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded text-lg font-semibold"
        style={{ minWidth: '100px' }}
      >
        Logout
      </button>
    </nav>
  );
}