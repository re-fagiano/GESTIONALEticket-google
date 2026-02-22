import React from 'react';

export default function ToastList({ toasts }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-2 rounded shadow text-sm ${
            toast.tone === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
