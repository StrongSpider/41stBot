import React, { useState, useEffect } from 'react';
import BaseTable, { EditableCell } from './BaseTable';
import { useFirebase } from '../context/FirebaseContext';
import '../index.css';

export default function HistoryEventsTable() {
  const { getHistory, updateHistory } = useFirebase();
  const [data, setData] = useState([]);
  const [userMap, setUserMap] = useState([]);

  useEffect(() => {
    getHistory()
      .then(async events => {
        const userIds = new Set();
        events.forEach(ev => {
          if (ev.host) userIds.add(ev.host);
          if (ev.supervisor !== undefined && ev.supervisor !== -1) userIds.add(ev.supervisor);
          if (Array.isArray(ev.attendees)) ev.attendees.forEach(uid => userIds.add(uid));
        });
        const validUserIds = Array.from(userIds).filter(uid => typeof uid === "number" && uid > 0);
  
        // Fetch usernames from your backend API
        let userMap = {};
        if (validUserIds.length) {
          const resp = await fetch('/api/usernames?ids=' + validUserIds.join(','));
          userMap = await resp.json();
        }
  
        setUserMap(userMap);
        setData(events);
      })
      .catch(console.error);
  }, []);

  const updateData = (rowIndex, columnId, value) => {
    const updated = [...data];
    const { eventid } = updated[rowIndex];
    updateHistory(eventid, { [columnId]: value })
      .then(() => {
        updated[rowIndex] = { ...updated[rowIndex], [columnId]: value };
        setData(updated);
      })
      .catch(console.error);
  };

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
        // Support Firestore Timestamp: {_seconds, _nanoseconds}
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
    }
  ], [userMap]);

  return (
    <div className="discord-table-container">
      <div className="discord-table">
        <BaseTable columns={columns} data={data} updateData={updateData} />
      </div>
    </div>
  );
}