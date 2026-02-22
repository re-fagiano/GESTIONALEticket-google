import React from 'react';
import {
  LayoutDashboard,
  Users,
  Phone,
  Wrench,
  Package,
  Ticket,
  Calendar as CalendarIcon,
  Bot,
  Zap,
  X
} from 'lucide-react';

export default function Sidebar({ isSidebarOpen, activeTab, onClose, onSwitchTab, onResetData }) {
  return (
    <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 flex flex-col`}>
      <div className="flex items-center justify-between p-4 border-b border-slate-700 h-16">
        <h1 className="text-xl font-bold flex items-center gap-2"><Zap className="w-6 h-6 text-yellow-400" /> FIXLAB AI</h1>
        <button onClick={onClose} className="md:hidden"><X className="w-6 h-6" /></button>
      </div>
      <nav className="p-4 space-y-2 flex-1">
        <button onClick={() => onSwitchTab('dashboard')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'dashboard' ? 'bg-slate-800 text-yellow-400' : ''}`}><LayoutDashboard size={20}/> Dashboard</button>
        <button onClick={() => onSwitchTab('customers')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'customers' ? 'bg-slate-800 text-yellow-400' : ''}`}><Users size={20}/> Clienti</button>
        <button onClick={() => onSwitchTab('chiamate')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'chiamate' ? 'bg-slate-800 text-yellow-400' : ''}`}><Phone size={20}/> Chiamate</button>
        <button onClick={() => onSwitchTab('riparazioni')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'riparazioni' ? 'bg-slate-800 text-yellow-400' : ''}`}><Wrench size={20}/> Riparazioni</button>
        <button onClick={() => onSwitchTab('ordine-ricambi')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'ordine-ricambi' ? 'bg-slate-800 text-yellow-400' : ''}`}><Package size={20}/> Ordine Ricambi</button>
        <button onClick={() => onSwitchTab('preventivi-nuovi')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'preventivi-nuovi' ? 'bg-slate-800 text-yellow-400' : ''}`}><Ticket size={20}/> Preventivi Nuovi</button>
        <button onClick={() => onSwitchTab('calendar')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'calendar' ? 'bg-slate-800 text-yellow-400' : ''}`}><CalendarIcon size={20}/> Calendario</button>
        <button onClick={() => onSwitchTab('inventory')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'inventory' ? 'bg-slate-800 text-yellow-400' : ''}`}><Package size={20}/> Magazzino</button>
        <button onClick={() => onSwitchTab('settings')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'settings' ? 'bg-slate-800 text-yellow-400' : ''}`}><Bot size={20}/> Impostazioni</button>
      </nav>
      <div className="p-4 border-t border-slate-700"><button onClick={onResetData} className="w-full text-xs bg-red-900/50 text-red-200 p-2 rounded">Reset Dati</button></div>
    </div>
  );
}
