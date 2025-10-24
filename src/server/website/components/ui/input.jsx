// website/components/ui/input.jsx
import React from 'react'

export function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={
        `px-3 py-2 rounded bg-gray-700 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 outline-none ` +
        className
      }
    />
  )
}