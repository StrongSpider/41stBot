// website/components/ui/card.jsx
import React from 'react'

export function Card({ className = '', children, ...props }) {
  return (
    <div
      {...props}
      className={
        `bg-gray-800 rounded-lg shadow ${className}`
      }
    >
      {children}
    </div>
  )
}

export function CardContent({ className = '', children, ...props }) {
  return (
    <div
      {...props}
      className={`p-4 ${className}`}
    >
      {children}
    </div>
  )
}