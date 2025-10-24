import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  useTable,
  useSortBy,
  useFilters
} from 'react-table';

export default function UserEventsTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch data
  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(users => {
        setData(users);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  // CSV export (only names)
  const exportToCSV = () => {
    if (!data.length) return;
    const header = ['Username','Group Rank','Company','Event Points','Events'];
    const rows = data.map(u => [
      u.username,
      u.groupRank,
      u.company,
      u.eventPoints,
      u.events.map(e => e.name).join(', ')
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '41st_event_portal.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Table columns
  const columns = useMemo(() => [
    { Header: 'Username',    accessor: 'username' },
    { Header: 'Group Rank',  accessor: 'groupRank' },
    {
      Header: 'Company',
      accessor: 'company',
      Filter: ({ column: { filterValue, setFilter } }) => (
        <input
          className="mt-2 px-2 py-1 bg-gray-800 text-white rounded text-sm w-full"
          value={filterValue || ''}
          onChange={e => setFilter(e.target.value || undefined)}
          placeholder="Filter…"
        />
      )
    },
    { Header: 'Event Points', accessor: 'eventPoints' },
    {
      Header: 'Events',
      accessor: 'events',
      Cell: ({ value }) => {
        const events = value.filter(evt => evt.name);
        return (
          <div className="text-sm">
            {events.map((evt, idx) => (
              <React.Fragment key={idx}>
                <a
                  href={evt.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white hover:text-gray-200"
                >
                  {evt.name}
                </a>
                {idx < events.length - 1 ? ', ' : ''}
              </React.Fragment>
            ))}
          </div>
        );
      },
      Filter: ({ column: { filterValue, setFilter } }) => (
        <input
          className="mt-2 px-2 py-1 bg-gray-800 text-white rounded text-sm w-full"
          value={filterValue || ''}
          onChange={e => setFilter(e.target.value || undefined)}
          placeholder="Filter…"
        />
      )
    }
  ], []);

  const defaultColumn = useMemo(() => ({
    Filter: ({ column: { filterValue, setFilter } }) => (
      <input
        className="mt-2 px-2 py-1 bg-gray-800 text-white rounded text-sm w-full"
        value={filterValue || ''}
        onChange={e => setFilter(e.target.value || undefined)}
        placeholder="Filter…"
      />
    )
  }), []);

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    rows,
    prepareRow
  } = useTable(
    { columns, data, defaultColumn },
    useFilters, useSortBy
  );

  if (loading) return <div className="text-white">Loading…</div>;

  return (
    <div className="bg-gray-800 rounded-lg shadow p-4 text-white font-sans">
      {/* Export Only */}
      <div className="flex justify-end mb-4">
        <button
          onClick={exportToCSV}
          className="text-gray-400 hover:text-white text-sm"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table {...getTableProps()} className="w-full table-auto border-collapse">
          <thead className="bg-gray-700">
            {headerGroups.map(hg => (
              <tr {...hg.getHeaderGroupProps()}>
                {hg.headers.map(col => (
                  <th
                    {...col.getHeaderProps(col.getSortByToggleProps())}
                    className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide"
                  >
                    <div className="flex items-center">
                      {col.render('Header')}
                      {col.isSorted && (
                        <span className="ml-1">{col.isSortedDesc ? '↓' : '↑'}</span>
                      )}
                    </div>
                    {col.canFilter && <div className="mt-1">{col.render('Filter')}</div>}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody {...getTableBodyProps()} className="bg-gray-800 divide-y divide-gray-700">
            {rows.map(row => {
              prepareRow(row);
              return (
                <motion.tr
                  {...row.getRowProps()}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ backgroundColor: '#4a4a4a' }}
                >
                  {row.cells.map(cell => (
                    <td
                      {...cell.getCellProps()}
                      className="px-4 py-2 text-sm align-top whitespace-normal"
                    >
                      {cell.render('Cell')}
                    </td>
                  ))}
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}