import React, { useState, useEffect } from 'react';
import '../index.css';              // for your Discord-theme

export default function QuotaReportPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [rolesMap, setRolesMap] = useState({});

  const [filters, setFilters] = useState({
    username: '',
    quotas: '',
    purge: '',
  });

  useEffect(() => {
    let abort = false;
  
    async function loadReports() {
      try {
        // POST to quota-check; server derives all members internally
        const resp = await fetch('/api/quota/check', {
          method: 'POST',
          credentials: 'include'
        });
        if (!resp.ok) throw new Error('Batch quota check failed');
        const data = await resp.json();

        // then fetch all roles for name lookup
        const rolesResp = await fetch('/api/discord/roles', { credentials: 'include' });
        if (rolesResp.ok) {
          const rolesList = await rolesResp.json();
          const map = {};
          rolesList.forEach(r => { map[r.id] = r.name; });
          if (!abort) setRolesMap(map);
        }

        if (!abort) {
          setReports(data);
          setLoading(false);
        }
      } catch (err) {
        if (!abort) {
          console.error(err);
          setError(err.message);
          setLoading(false);
        }
      }
    }
  
    loadReports();
    return () => { abort = true; };
  }, []);

  const handleFilterChange = (field) => (e) => {
    setFilters(prev => ({ ...prev, [field]: e.target.value }));
  };

  const filteredReports = reports.filter(r => {
    // Username filter
    if (filters.username && !r.username.toLowerCase().includes(filters.username.toLowerCase())) {
      return false;
    }
    // Quotas filter
    if (filters.quotas) {
      if (r.status === 'EXEMPT' || r.status === 'NOT VERIFIED') {
        const statusText = r.status === 'EXEMPT'
          ? 'exempt from quotas'
          : 'not verified';
        if (!statusText.includes(filters.quotas.toLowerCase())) {
          return false;
        }
      } else {
        const quotaNames = (Array.isArray(r.quotas) ? r.quotas : [])
          .map(q => rolesMap[q.roleId] || q.roleId);
        const match = quotaNames.some(qname =>
          qname.toLowerCase().includes(filters.quotas.toLowerCase())
        );
        if (!match) return false;
      }
    }
    // Purge filter
    if (filters.purge) {
      const purgeText = r.purge ? 'Purge DEFCON' : '';
      if (!purgeText.toLowerCase().includes(filters.purge.toLowerCase())) {
        return false;
      }
    }
    return true;
  });

  if (loading) return <div className="text-gray-300 p-4">Loading quota report…</div>;
  if (error)   return <div className="text-red-500 p-4">Error: {error}</div>;

  return (
    <div className="discord-table-container">
      <div className="discord-table">
        <h2 className="text-2xl font-bold mb-4">Quota Report</h2>
        <table className="w-full table-auto">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide">
                <input
                  type="text"
                  placeholder="Filter Username"
                  value={filters.username}
                  onChange={handleFilterChange('username')}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-300 text-xs"
                />
              </th>
              <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide">
                <input
                  type="text"
                  placeholder="Filter Quotas"
                  value={filters.quotas}
                  onChange={handleFilterChange('quotas')}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-300 text-xs"
                />
              </th>
              <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide">
                <input
                  type="text"
                  placeholder="Filter Purge"
                  value={filters.purge}
                  onChange={handleFilterChange('purge')}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-300 text-xs"
                />
              </th>
            </tr>
            <tr>
              <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide">User</th>
              <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide">Quotas</th>
              <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide">Purge</th>
            </tr>
          </thead>
          <tbody>
            {filteredReports.map((r, idx) => (
              <tr key={r.userId ?? idx} className="hover:bg-gray-700">
                <td className="px-4 py-2">{r.username}</td>
                <td className="px-4 py-2">
                  {(r.status === 'EXEMPT' || r.status === 'NOT VERIFIED') ? (
                    <span className="text-blue-300 italic">
                      {r.status === 'EXEMPT' ? 'Exempt from quotas' : 'Not verified'}
                    </span>
                  ) : (
                    (Array.isArray(r.quotas) ? r.quotas : []).map((q, j) => (
                      <div key={`${q.roleId ?? 'quota'}-${j}`} className="mb-2">
                        <span
                          style={{ color: q.passed ? '#43B581' : '#F04747' }}
                          title={
                            (q.deltaEP < 0 ? `EP: need ${Math.abs(q.deltaEP)} more\n` : '') +
                            (Array.isArray(q.eventCaps)
                              ? q.eventCaps
                                  .filter(ec => !ec.passed)
                                  .map(ec => {
                                    const need = Math.abs(ec.delta);
                                    return `${ec.alias}: need ${need}`;
                                  })
                                  .join('\n')
                              : '')
                          }
                        >
                          {rolesMap[q.roleId] || q.roleId}
                        </span>
                      </div>
                    ))
                  )}
                </td>
                <td className="px-4 py-2">{r.purge ? 'Purge DEFCON' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}