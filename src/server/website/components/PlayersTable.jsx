import React, { useState, useEffect } from 'react';
import BaseTable from './BaseTable';
import '../index.css';

export default function PlayersTable() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch('/api/users', { credentials: 'include' })
      .then(res => res.json())
      .then(setData)
      .catch(console.error);
  }, []);

  const columns = React.useMemo(() => [
    { Header: 'Username',    accessor: 'username' },
    { Header: 'Group Rank',  accessor: 'groupRank' },
    { Header: 'Company',     accessor: 'company' },
    { Header: 'Event Points',accessor: 'eventPoints' },
    {
      Header: 'Events',
      accessor: 'events',
      Cell: ({ value }) =>
        value && value.length
          ? value.map((e, i) =>
              e.link ? (
                <a
                  key={i}
                  href={e.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#DCDDDE',
                    background: '#393C43',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    textDecoration: 'none',
                    marginRight: 8,
                    marginBottom: 6,
                    fontSize: '0.9em',
                    display: 'inline-block'
                  }}
                >
                  {e.name}
                </a>
              ) : (
                <span
                  key={i}
                  style={{
                    color: '#DCDDDE',
                    background: '#393C43',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    marginRight: 8,
                    marginBottom: 6,
                    fontSize: '0.9em',
                    display: 'inline-block'
                  }}
                >
                  {e.name}
                </span>
              )
            )
          : null
    }
  ], []);

  return (
    <div className="discord-table-container">
      <div className="discord-table">
        <BaseTable columns={columns} data={data} />
      </div>
    </div>
  );
}