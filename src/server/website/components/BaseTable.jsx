import React, { useState, useEffect } from 'react';
import { useTable, useSortBy, useFilters } from 'react-table';
import { motion } from 'framer-motion';

// Editable cell renderer
export function EditableCell({ value: initialValue, row: { index }, column: { id }, updateData }) {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const onBlur = () => {
        if (value !== initialValue) {
            updateData(index, id, value);
        }
    };

    return (
        <input
            value={value || ''}
            onChange={e => setValue(e.target.value)}
            onBlur={onBlur}
            className="bg-gray-700 text-white rounded p-1 text-sm w-full"
        />
    );
}

function DefaultColumnFilter({ column: { filterValue, setFilter } }) {
  return (
    <input
      className="discord-tag"
      style={{
        background: '#393C43',
        color: '#DCDDDE',
        borderRadius: '6px',
        padding: '4px 8px',
        width: '100%',
        marginTop: '4px'
      }}
      value={filterValue || ''}
      onChange={e => setFilter(e.target.value || undefined)}
      placeholder="Filter…"
    />
  );
}

// Utility to export table data as CSV, excluding link fields
function exportTableToCSV(columns, rows) {
    // Only include columns whose id does NOT include "link" (case insensitive)
    const visibleColumns = columns.filter(col => 
        !String(col.id || col.accessor || '').toLowerCase().includes('link')
    );
    const header = visibleColumns.map(col => col.Header);
    const csvRows = rows.map(row =>
        visibleColumns.map(col => {
            const cellVal = row.values[col.id || col.accessor];
            // Format arrays as joined string, otherwise as string
            return Array.isArray(cellVal) ? cellVal.join(', ') : String(cellVal ?? '');
        })
    );
    const csvString = [header, ...csvRows]
      .map(r => r.map(val => `"${val.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Generic table component
export default function BaseTable({ columns, data, updateData }) {
    const defaultColumn = React.useMemo(
      () => ({
        Filter: DefaultColumnFilter,
      }),
      []
    );

    const tableInstance = useTable(
        { columns, data, updateData, defaultColumn },
        useFilters,
        useSortBy
    );

    const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } = tableInstance;

    return (
        <div className="overflow-x-auto">
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => exportTableToCSV(tableInstance.allColumns, rows)}
                style={{
                  background: '#393C43',
                  color: '#DCDDDE',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 16px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                Download CSV
              </button>
            </div>
            <table {...getTableProps()} className="min-w-full table-auto border-collapse">
                <thead className="bg-gray-700">
                    {headerGroups.map(headerGroup => (
                        <tr {...headerGroup.getHeaderGroupProps()}>
                            {headerGroup.headers.map(column => (
                                <th
                                    {...column.getHeaderProps(column.getSortByToggleProps())}
                                    className="px-4 py-2 text-left text-gray-400 text-xs uppercase tracking-wide"
                                >
                                    <div className="flex items-center">
                                        {column.render('Header')}
                                        {column.isSorted ? (column.isSortedDesc ? ' ↓' : ' ↑') : ''}
                                    </div>
                                    {column.canFilter ? <div>{column.render('Filter')}</div> : null}
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
    );
}
