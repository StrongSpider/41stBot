import React, { useState, useEffect, Fragment } from 'react';
import '../index.css';

export default function QuotasPage() {
    const [roles, setRoles] = useState([]);
    const [selectedRole, setSelectedRole] = useState('');
    const [quotaEP, setQuotaEP] = useState(0);
    // Dynamic event-cap rows
    const [eventCaps, setEventCaps] = useState([{ types: [], count: 1 }]);
    const [eventOptions, setEventOptions] = useState([]);
    const [message, setMessage] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    // For filtering roles in the modal
    const [modalRoleSearch, setModalRoleSearch] = useState('');
    // For overwrite role in modal
    const [overwriteSearch, setOverwriteSearch] = useState('');
    const [overwrites, setOverwrites] = useState('');


    const [quotas, setQuotas] = useState([]);
    const [searchRoleTable, setSearchRoleTable] = useState('');

    // Fetch roles and events list on mount
    useEffect(() => {
        fetch('/api/discord/roles', { credentials: 'include' })
            .then(res => res.json())
            .then(data => setRoles(data))
            .catch(console.error);

        fetch('/api/event-types', { credentials: 'include' })
            .then(res => res.json())
            .then(data => setEventOptions(data))
            .catch(console.error);

        loadQuotas();
    }, []);

    const loadQuotas = () => {
        fetch('/api/quotas', { credentials: 'include' })
            .then(res => res.json())
            .then(setQuotas)
            .catch(console.error);
    };

    const resetForm = () => {
        setModalRoleSearch('');
        setSelectedRole('');
        setQuotaEP(0);
        setEventCaps([{ types: [], count: 1 }]);  // reset event caps
        setOverwriteSearch('');
        setOverwrites('');
        setMessage('');
    };

    const handleSave = async e => {
        e.preventDefault();
        if (!selectedRole) {
            setMessage('Please select a role.');
            return;
        }

        const payload = {
            roleId: selectedRole,
            quotaEP,
            eventCaps,
            overwrites: overwrites || undefined
        };

        try {
            const res = await fetch('/api/quotas', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.success) {
                setMessage('Quota saved successfully.');
                setModalOpen(false);
                loadQuotas();
            } else {
                setMessage(json.error || 'Save failed.');
            }
        } catch (err) {
            console.error(err);
            setMessage('Network error.');
        }
    };

    // Open modal pre-filled for editing
    const handleEdit = quota => {
        resetForm();
        setSelectedRole(quota.roleId);
        setQuotaEP(quota.quotaEP);
        setEventCaps(quota.eventCaps.length ? quota.eventCaps : [{ types: [], count: 1 }]);
        if (quota.overwrites) {
            setOverwrites(quota.overwrites);
            const found = roles.find(r => r.id === quota.overwrites);
            setOverwriteSearch(found ? found.name : quota.overwrites);
        } else {
            setOverwrites('');
            setOverwriteSearch('');
        }
        setModalOpen(true);
    };

    // Delete quota
    const handleDelete = async roleId => {
        if (!window.confirm('Delete quota for this role?')) return;
        try {
            await fetch(`/api/quotas/${roleId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            loadQuotas();
        } catch (err) {
            console.error(err);
            setMessage('Delete failed.');
        }
    };

    return (
        <Fragment>
            <button
                onClick={() => { resetForm(); setModalOpen(true); }}
                className="mb-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm"
            >
                + New Quota
            </button>
            {modalOpen && (
              <div className="discord-table-container fixed inset-0 bg-[rgba(0,0,0,0.5)] flex items-center justify-center z-50">
                <div className="discord-table p-6 space-y-6 bg-gray-800 rounded-lg w-full max-w-md text-white">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold">
                                {selectedRole ? 'Edit Quota' : 'Create Quota'}
                            </h2>
                            <button
                                onClick={() => setModalOpen(false)}
                                className="text-red-400 hover:text-red-600 text-sm"
                            >
                                ✕
                            </button>
                        </div>
                        {message && <div className="mb-4 text-sm text-red-400">{message}</div>}
                        <form onSubmit={handleSave} className="space-y-6">
                            <div className="mb-4">
                                <label className="block text-sm font-semibold mb-1">Discord Role</label>
                                <input
                                    placeholder="Start typing role..."
                                    className="w-full mb-2 px-3 py-2 bg-gray-700 border border-gray-600 text-white text-sm rounded"
                                    value={modalRoleSearch}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setModalRoleSearch(val);
                                        const match = roles.find(r => r.name === val);
                                        setSelectedRole(match ? match.id : '');
                                    }}
                                    list="roles-list"
                                />
                                <datalist id="roles-list">
                                  {roles.map(r => (
                                    <option key={r.id} value={r.name} />
                                  ))}
                                </datalist>
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm mb-1">EP Quota</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="w-full px-3 py-2 rounded bg-gray-700 text-white text-sm"
                                    value={quotaEP}
                                    onChange={e => setQuotaEP(Number(e.target.value))}
                                />
                            </div>
                            {/* Overwrite Role input */}
                            <div className="mb-4">
                                <label className="block text-sm font-semibold mb-1">Overwrite Role</label>
                                <input
                                    list="roles-list-overwrites"
                                    placeholder="Start typing role or leave blank"
                                    className="w-full px-3 py-2 mb-2 bg-gray-700 border border-gray-600 text-white text-sm rounded"
                                    value={overwriteSearch}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setOverwriteSearch(val);
                                        const match = roles.find(r => r.name === val);
                                        setOverwrites(match ? match.id : '');
                                    }}
                                />
                                <datalist id="roles-list-overwrites">
                                    {roles.map(r => <option key={r.id} value={r.name} />)}
                                </datalist>
                            </div>
                            {/* Attendees / Event Caps */}
                            <div>
                              <label className="block mb-1">Event Caps:</label>
                              {eventCaps.map((cap, i) => (
                                <div key={i} className="flex items-center space-x-2 mb-3">
                                  <div className="relative flex-1">
                                    <input
                                      type="text"
                                      placeholder="e.g. Ranger*, Counter Raid"
                                      className="w-full bg-discord-header border border-gray-600 rounded px-2 py-1"
                                      value={cap.types.join(', ')}
                                      onChange={e => {
                                        const val = e.target.value;
                                        const parts = val.split(',').map(s => s.trim());
                                        const caps = [...eventCaps];
                                        caps[i].types = parts.filter(Boolean);
                                        setEventCaps(caps);
                                      }}
                                    />
                                  </div>
                                  <input
                                    type="number"
                                    min={1}
                                    className="w-20 bg-discord-header border border-gray-600 rounded px-2 py-1"
                                    value={cap.count}
                                    onChange={e => {
                                      const caps = [...eventCaps];
                                      caps[i].count = Number(e.target.value);
                                      setEventCaps(caps);
                                    }}
                                  />
                                  {eventCaps.length > 1 && (
                                    <button
                                      type="button"
                                      className="text-red-500 hover:text-red-700"
                                      onClick={() => {
                                        setEventCaps(eventCaps.filter((_, idx) => idx !== i));
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button
                                type="button"
                                className="text-green-400 hover:text-green-600 text-sm mb-4"
                                onClick={() => setEventCaps([...eventCaps, { types: [], count: 1 }])}
                              >
                                + Add Event Cap
                              </button>
                            </div>
                            <div className="flex items-center gap-4">
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-white text-sm"
                                >
                                    {selectedRole ? 'Update Quota' : 'Save Quota'}
                                </button>
                                {selectedRole && (
                                    <button
                                        type="button"
                                        className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-white text-sm"
                                        onClick={() => {
                                            resetForm();
                                            setModalOpen(false);
                                        }}
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <div className="discord-table-container">
                <div className="discord-table">
                    <h2 className="text-2xl font-bold mb-4">Active Quotas</h2>
                    <input
                        type="text"
                        placeholder="Filter roles..."
                        className="w-full px-3 py-2 mb-4 bg-gray-700 border border-gray-600 text-white text-sm rounded"
                        value={searchRoleTable}
                        onChange={e => setSearchRoleTable(e.target.value)}
                    />
                    <table className="w-full table-auto border-collapse">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase">Role</th>
                                <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase">EP</th>
                                <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase">Event Caps</th>
                                <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase">Overwrites</th>
                                <th className="px-4 py-2 text-left text-gray-400 text-xs uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                            {quotas
                                .filter(q => {
                                    const role = roles.find(r => r.id === q.roleId);
                                    return role && role.name.toLowerCase().includes(searchRoleTable.toLowerCase());
                                })
                                .map(q => {
                                    const role = roles.find(r => r.id === q.roleId);
                                    return (
                                        <tr key={q.roleId} className="hover:bg-gray-700">
                                            <td className="px-4 py-2 text-sm">{role?.name || q.roleId}</td>
                                            <td className="px-4 py-2 text-sm">{q.quotaEP}</td>
                                            <td className="px-4 py-2 text-sm">
                                                {q.eventCaps.map(c => `${c.types.join(', ')} (${c.count})`).join('; ')}
                                            </td>
                                            <td className="px-4 py-2 text-sm">
                                                {q.overwrites
                                                    ? (roles.find(r => r.id === q.overwrites)?.name || q.overwrites)
                                                    : '-'}
                                            </td>
                                            <td className="px-4 py-2 text-sm">
                                                <button
                                                    onClick={() => handleEdit(q)}
                                                    className="mr-2 text-blue-400 hover:text-blue-600"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(q.roleId)}
                                                    className="text-red-400 hover:text-red-600"
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>
        </Fragment>
    );
}
