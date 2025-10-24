// src/components/WeeklyEventsTable.jsx
import React, { useState, useEffect } from 'react';
import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import BaseTable from './BaseTable';
import { useFirebase } from '../context/FirebaseContext';
import '../index.css';

// Helper function to resolve Roblox IDs to usernames using your server API
async function fetchUsernames(userIds) {
  if (!userIds.length) return {};
  const resp = await fetch('/api/usernames?ids=' + userIds.join(','));
  if (!resp.ok) return {};
  return await resp.json();
}

export default function WeeklyEventsTable() {
  const { getWeekly } = useFirebase();
  const [data, setData] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [reverseUserMap, setReverseUserMap] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [formData, setFormData] = useState({});
  const [usernameWarning, setUsernameWarning] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteEventById, setdeleteEventById] = useState(null);

  const { user } = useContext(AuthContext);

  useEffect(() => {
    getWeekly()
      .then(async events => {
        // Gather all unique user IDs
        const userIds = new Set();
        events.forEach(ev => {
          if (ev.host) userIds.add(ev.host);
          if (ev.supervisor !== undefined && ev.supervisor !== -1) userIds.add(ev.supervisor);
          if (Array.isArray(ev.attendees)) ev.attendees.forEach(uid => userIds.add(uid));
        });
        const validUserIds = Array.from(userIds).filter(uid => typeof uid === "number" && uid > 0);
        const userMap = await fetchUsernames(validUserIds);

        setUserMap(userMap);
        // Build reverse map username -> ID
        const revMap = {};
        Object.entries(userMap).forEach(([id, username]) => {
          revMap[username] = Number(id);
        });
        setReverseUserMap(revMap);

        setData(events.map(ev => ({
          ...ev,
          timestamp: ev.timestamp?.toMillis
            ? new Date(ev.timestamp.toMillis()).toISOString()
            : ev.timestamp || ''
        })));
      })
      .catch(console.error);
  }, [getWeekly]);

  // Open modal and set form data when a row is clicked
  function onRowClick(row) {
    setEditEvent(row.original);
    // Prepare form data (copy to avoid mutation)
    // Convert IDs to usernames for host, supervisor, attendees
    const hostUsername = userMap[row.original.host] || '';
    const supervisorUsername = (row.original.supervisor === undefined || row.original.supervisor === -1) ? '' : (userMap[row.original.supervisor] || '');
    const attendeesUsernames = Array.isArray(row.original.attendees) ? row.original.attendees.map(uid => userMap[uid] || '').filter(u => u).join(', ') : '';
    // Convert timestamp ISO string to datetime-local format YYYY-MM-DDTHH:mm
    let datetimeLocal = '';
    if (row.original.timestamp) {
      let dateObj;
      if (typeof row.original.timestamp === 'string') {
        dateObj = new Date(row.original.timestamp);
      } else if (typeof row.original.timestamp === 'object' && row.original.timestamp !== null) {
        if ('_seconds' in row.original.timestamp) {
          dateObj = new Date(row.original.timestamp._seconds * 1000);
        } else if ('seconds' in row.original.timestamp) {
          dateObj = new Date(row.original.timestamp.seconds * 1000);
        } else if ('toDate' in row.original.timestamp && typeof row.original.timestamp.toDate === 'function') {
          dateObj = row.original.timestamp.toDate();
        }
      }
      if (dateObj && !isNaN(dateObj.getTime())) {
        // Format to YYYY-MM-DDTHH:mm
        const pad = (n) => n.toString().padStart(2, '0');
        const yyyy = dateObj.getFullYear();
        const mm = pad(dateObj.getMonth() + 1);
        const dd = pad(dateObj.getDate());
        const hh = pad(dateObj.getHours());
        const min = pad(dateObj.getMinutes());
        datetimeLocal = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
      }
    }
    setFormData({
      type: row.original.type || '',
      host: hostUsername,
      supervisor: supervisorUsername,
      attendees: attendeesUsernames,
      message: row.original.message || '',
      timestamp: datetimeLocal,
      eventid: row.original.eventid
    });
    setUsernameWarning('');
    setModalOpen(true);
  }

  // Handler to open delete modal
  function onDeleteClick(row) {
    setdeleteEventById(row.original);
    setDeleteModalOpen(true);
  }

  // Handle form input changes
  function handleChange(e) {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (['host', 'supervisor', 'attendees'].includes(name)) {
      // Validate usernames on change
      let invalidUsernames = [];
      if (name === 'host') {
        if (value.trim() !== '' && !(value.trim() in reverseUserMap)) {
          invalidUsernames.push(value.trim());
        }
      } else if (name === 'supervisor') {
        if (value.trim() !== '' && !(value.trim() in reverseUserMap)) {
          invalidUsernames.push(value.trim());
        }
      } else if (name === 'attendees') {
        const names = value.split(',').map(s => s.trim()).filter(s => s !== '');
        invalidUsernames = names.filter(n => !(n in reverseUserMap));
      }
      if (invalidUsernames.length > 0) {
        setUsernameWarning(`Warning: The following username(s) not found: ${invalidUsernames.join(', ')}`);
      } else {
        setUsernameWarning('');
      }
    }
  }

  // Handle Save button click
  async function handleSave() {
    if (!editEvent) return;

    // Validate usernames before converting
    const hostUsername = formData.host.trim();
    const supervisorUsername = formData.supervisor.trim();
    const attendeesUsernames = formData.attendees.split(',').map(s => s.trim()).filter(s => s !== '');

    const invalidUsernames = [];
    if (hostUsername !== '' && !(hostUsername in reverseUserMap)) invalidUsernames.push(hostUsername);
    if (supervisorUsername !== '' && !(supervisorUsername in reverseUserMap)) invalidUsernames.push(supervisorUsername);
    attendeesUsernames.forEach(u => {
      if (!(u in reverseUserMap)) invalidUsernames.push(u);
    });

    if (invalidUsernames.length > 0) {
      alert(`Cannot save. The following username(s) not found: ${[...new Set(invalidUsernames)].join(', ')}`);
      return;
    }

    // Convert usernames back to IDs
    const hostId = hostUsername === '' ? '' : reverseUserMap[hostUsername];
    const supervisorId = supervisorUsername === '' ? -1 : reverseUserMap[supervisorUsername];
    const attendeesIds = attendeesUsernames.map(u => reverseUserMap[u]);

    // Convert datetime-local to ISO string
    let isoTimestamp = '';
    if (formData.timestamp) {
      const dt = new Date(formData.timestamp);
      if (!isNaN(dt.getTime())) {
        isoTimestamp = dt.toISOString();
      }
    }

    // Prepare updated event data
    const updatedEvent = {
      ...editEvent,
      type: formData.type,
      host: hostId,
      supervisor: supervisorId,
      attendees: attendeesIds,
      message: formData.message,
      timestamp: isoTimestamp
    };

    // Compute what changed
    const diffs = {};
    const fields = ['type', 'host', 'supervisor', 'attendees', 'message', 'timestamp'];
    fields.forEach(field => {
      const original = editEvent[field];
      const updated = updatedEvent[field];
      // Compare arrays and primitives
      const origVal = Array.isArray(original) ? JSON.stringify(original) : String(original || '');
      const updVal = Array.isArray(updated) ? JSON.stringify(updated) : String(updated || '');
      if (origVal !== updVal) {
        diffs[field] = { from: original, to: updated };
      }
    });

    try {
      // PATCH /api/weekly/:id
      const weeklyResp = await fetch(`/api/weekly/${editEvent.eventid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedEvent)
      });
      if (!weeklyResp.ok) throw new Error('Failed to update weekly event');

      // PATCH /api/history/:id
      const historyResp = await fetch(`/api/history/${editEvent.eventid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedEvent)
      });
      if (!historyResp.ok) throw new Error('Failed to update history event');

      // POST /api/log-event-change
      await fetch('/api/log-event-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventid: editEvent.eventid,
          action: 'update',
          changes: diffs,
          changedBy: user?.id || null,
          timestamp: new Date().toISOString()
        })
      });

      // Refresh data
      const events = await getWeekly();
      const userIds = new Set();
      events.forEach(ev => {
        if (ev.host) userIds.add(ev.host);
        if (ev.supervisor !== undefined && ev.supervisor !== -1) userIds.add(ev.supervisor);
        if (Array.isArray(ev.attendees)) ev.attendees.forEach(uid => userIds.add(uid));
      });
      const validUserIds = Array.from(userIds).filter(uid => typeof uid === "number" && uid > 0);
      const userMap = await fetchUsernames(validUserIds);
      setUserMap(userMap);
      // Update reverse map too
      const revMap = {};
      Object.entries(userMap).forEach(([id, username]) => {
        revMap[username] = Number(id);
      });
      setReverseUserMap(revMap);
      setData(events.map(ev => ({
        ...ev,
        timestamp: ev.timestamp?.toMillis
          ? new Date(ev.timestamp.toMillis()).toISOString()
          : ev.timestamp || ''
      })));

      setModalOpen(false);
      setEditEvent(null);
      setFormData({});
      setUsernameWarning('');
    } catch (err) {
      console.error(err);
      alert('Error saving changes: ' + err.message);
    }
  }

  // Handle Cancel button click
  function handleCancel() {
    setModalOpen(false);
    setEditEvent(null);
    setFormData({});
    setUsernameWarning('');
  }

  // Handle Delete confirm
  async function handleDeleteConfirm() {
    if (!deleteEventById) return;
    try {
      // Call DELETE endpoints
      await fetch(`/api/weekly/${deleteEventById.eventid}`, { method: 'DELETE' });
      await fetch(`/api/history/${deleteEventById.eventid}`, { method: 'DELETE' });
      // Log deletion
      await fetch('/api/log-event-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventid: deleteEventById.eventid,
          action: 'delete',
          changedBy: user?.id || null,
          timestamp: new Date().toISOString()
        })
      });
      // Refresh data
      const events = await getWeekly();
      setData(events.map(ev => ({
        ...ev,
        timestamp: ev.timestamp?.toMillis
          ? new Date(ev.timestamp.toMillis()).toISOString()
          : ev.timestamp || ''
      })));
    } catch (err) {
      console.error(err);
      alert('Error deleting event: ' + err.message);
    }
    setDeleteModalOpen(false);
    setdeleteEventById(null);
  }

  const columns = React.useMemo(() => [
    { Header: 'Type', accessor: 'type' },
    {
      Header: 'Host',
      accessor: row => userMap[row.host] || row.host || '',
      id: 'host',
      Cell: ({ value }) => value
    },
    {
      Header: 'Supervisor',
      accessor: row =>
        row.supervisor === -1
          ? ''
          : (userMap[row.supervisor] || row.supervisor),
      id: 'supervisor',
      Cell: ({ value }) => value
    },
    {
      Header: 'Attendees',
      accessor: row =>
        Array.isArray(row.attendees)
          ? row.attendees.map(uid => userMap[uid] || uid).join(', ')
          : '',
      id: 'attendees',
      Cell: ({ value }) => value
    },
    {
      Header: 'Message',
      accessor: 'message',
      Cell: ({ value }) =>
        value ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#DCDDDE',
              textDecoration: 'underline'
            }}
          >
            Link
          </a>
        ) : ''
    },
    {
      Header: 'Timestamp',
      accessor: 'timestamp',
      Cell: ({ value }) => {
        if (!value) return '';
        let date;
        // Support Firestore Timestamp: {_seconds, _nanoseconds} and {seconds, nanoseconds}
        if (typeof value === 'object' && value !== null) {
          if ('_seconds' in value) {
            date = new Date(value._seconds * 1000);
          } else if ('seconds' in value) {
            date = new Date(value.seconds * 1000);
          } else if ('toDate' in value && typeof value.toDate === 'function') {
            date = value.toDate();
          } else {
            return '';
          }
        } else if (typeof value === 'string' && !isNaN(Date.parse(value))) {
          date = new Date(value);
        } else if (typeof value === 'number') {
          date = new Date(value);
        } else {
          return '';
        }
        return date.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    },
    {
      Header: 'Event ID',
      accessor: 'eventid'
    },
    {
      Header: 'Actions',
      id: 'actions',
      Cell: ({ row }) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onRowClick(row)}
            style={{
              padding: '4px 8px',
              backgroundColor: '#5865F2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Edit
          </button>
          <button
            onClick={() => onDeleteClick(row)}
            style={{
              padding: '4px 8px',
              backgroundColor: '#ED4245',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Delete
          </button>
        </div>
      )
    }
  ], [userMap]);

  // Helper to format timestamp for modal display
  function formatLocalTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  return (
    <div className="discord-table-container">
      <div className="discord-table">
        <BaseTable columns={columns} data={data} onRowClick={onRowClick} />
      </div>

      {modalOpen && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="modal-content" style={{
            backgroundColor: '#2f3136',
            padding: '20px',
            borderRadius: '8px',
            width: '400px',
            color: '#ddd'
          }}>
            <div style={{color: 'red', fontWeight: 'bold', marginBottom: '10px'}}>
              Note: Editing an event does NOT update EP.
            </div>
            <h2>Edit Event Details</h2>
            <div style={{ marginBottom: '10px' }}>
              <label>Type:</label><br />
              <input
                name="type"
                value={formData.type}
                onChange={handleChange}
                style={{ width: '100%', backgroundColor: '#202225', color: '#ddd', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>Host (Roblox username):</label><br />
              <input
                name="host"
                value={formData.host}
                onChange={handleChange}
                style={{ width: '100%', backgroundColor: '#202225', color: '#ddd', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>Supervisor (Roblox username, leave blank for none):</label><br />
              <input
                name="supervisor"
                value={formData.supervisor}
                onChange={handleChange}
                style={{ width: '100%', backgroundColor: '#202225', color: '#ddd', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>Attendees (comma-separated Roblox usernames):</label><br />
              <input
                name="attendees"
                value={formData.attendees}
                onChange={handleChange}
                style={{ width: '100%', backgroundColor: '#202225', color: '#ddd', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>Message (URL):</label><br />
              <input
                name="message"
                value={formData.message}
                onChange={handleChange}
                style={{ width: '100%', backgroundColor: '#202225', color: '#ddd', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>Timestamp (local datetime):</label><br />
              <input
                name="timestamp"
                type="datetime-local"
                value={formData.timestamp}
                onChange={handleChange}
                style={{ width: '100%', backgroundColor: '#202225', color: '#ddd', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}
              />
              {formData.timestamp && (
                <div style={{ marginTop: '4px', fontSize: '0.85em', color: '#aaa' }}>
                  Local time: {formatLocalTime(new Date(formData.timestamp).toISOString())}
                </div>
              )}
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label>Event ID:</label><br />
              <input
                value={formData.eventid}
                disabled
                style={{ width: '100%', backgroundColor: '#444', color: '#aaa', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}
              />
            </div>
            {usernameWarning && (
              <div style={{ color: 'yellow', marginBottom: '10px', fontWeight: 'bold' }}>
                {usernameWarning}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={handleCancel}
                style={{
                  backgroundColor: '#72767d',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={usernameWarning !== ''}
                style={{
                  backgroundColor: usernameWarning !== '' ? '#9999cc' : '#5865f2',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: usernameWarning !== '' ? 'not-allowed' : 'pointer'
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalOpen && deleteEventById && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="modal-content" style={{
            backgroundColor: '#2f3136',
            padding: '20px',
            borderRadius: '8px',
            width: '360px',
            color: '#ddd'
          }}>
            <div style={{color: 'red', fontWeight: 'bold', marginBottom: '10px'}}>
              Note: Deleting an event does NOT update EP. You must manually adjust EP if needed.
            </div>
            <h3>Confirm Delete</h3>
            <p>Are you sure you want to delete the event <strong>{deleteEventById.type}</strong>?</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button
                onClick={() => { setDeleteModalOpen(false); setdeleteEventById(null); }}
                style={{
                  backgroundColor: '#72767d',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                style={{
                  backgroundColor: '#ED4245',
                  border: 'none',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}