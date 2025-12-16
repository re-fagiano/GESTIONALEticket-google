import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Ticket, 
  Wrench, 
  Plus, 
  Bot, 
  Menu, 
  X, 
  Trash2, 
  RefreshCw,
  Zap,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Package, // Icona Magazzino
  AlertTriangle, // Icona Avvisi
  Phone,
  MapPin
} from 'lucide-react';

const DEEPSEEK_API_URL = (import.meta.env.VITE_DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY;

export default function App() {
  const [activeTab, setActiveTab] = useState('inventory'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // --- STATO CALENDARIO ---
  const [currentDate, setCurrentDate] = useState(new Date());

  // --- FUNZIONI DI MEMORIA ---
  const loadData = (key, defaultData) => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Errore lettura memoria", e);
    }
    return defaultData;
  };

  // --- DATI DI PROVA ---
  const initialCustomers = [
    { id: '1', name: 'Maria Bianchi', email: 'maria@test.com', phone: '3339988776', address: 'Via dei Fiori 12' },
    { id: '2', name: 'Ristorante Da Luigi', email: 'info@luigi.com', phone: '06123456', address: 'Piazza Navona 5' }
  ];

  const initialTickets = [
    { id: '101', subject: 'Lavatrice non scarica', description: 'La lavatrice Bosch si blocca piena di acqua', customerId: '1', status: 'aperto', date: new Date().toISOString().split('T')[0], time: '09:00' },
    { id: '102', subject: 'Frigorifero caldo', description: 'Il reparto freezer funziona ma il frigo è caldo', customerId: '2', status: 'in lavorazione', date: new Date().toISOString().split('T')[0], time: '14:30' }
  ];

  const initialInventory = [
    { id: 'p1', name: 'Pompa Scarico Universale', location: 'AF-01-A', qty: 3, price: 25.00, minQty: 5 },
    { id: 'p2', name: 'Cuscinetti Cestello', location: 'BF-02-C', qty: 10, price: 15.50, minQty: 2 },
    { id: 'p3', name: 'Scheda Elettronica Samsung', location: 'SEC-09', qty: 1, price: 120.00, minQty: 1 }
  ];

  // --- STATO APP ---
  const [customers, setCustomers] = useState(() => loadData('customers', initialCustomers));
  const [tickets, setTickets] = useState(() => loadData('tickets', initialTickets));
  const [inventory, setInventory] = useState(() => loadData('inventory', initialInventory));

  // --- EFFETTO SALVATAGGIO ---
  useEffect(() => { localStorage.setItem('customers', JSON.stringify(customers)); }, [customers]);
  useEffect(() => { localStorage.setItem('tickets', JSON.stringify(tickets)); }, [tickets]);
  useEffect(() => { localStorage.setItem('inventory', JSON.stringify(inventory)); }, [inventory]);

  // Modal & AI State
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewPart, setShowNewPart] = useState(false); 
  
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [currentTicketForAi, setCurrentTicketForAi] = useState(null);
  const [aiError, setAiError] = useState(null);

  // Forms
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', phone: '', address: '' });
  const [newTicket, setNewTicket] = useState({ 
    subject: '', description: '', customerId: '', status: 'aperto', 
    date: new Date().toISOString().split('T')[0], time: '09:00' 
  });
  const [newPart, setNewPart] = useState({ name: '', location: '', qty: 1, price: 0, minQty: 5 });

  // --- AZIONI ---
  const handleAddCustomer = () => {
    if (!newCustomer.name) return;
    const customer = { ...newCustomer, id: Date.now().toString() };
    setCustomers([...customers, customer]);
    setNewCustomer({ name: '', email: '', phone: '', address: '' });
    setShowNewCustomer(false);
  };

  const handleAddTicket = () => {
    if (!newTicket.subject || !newTicket.customerId) return;
    const ticket = { ...newTicket, id: Date.now().toString() };
    setTickets([...tickets, ticket]); 
    setNewTicket({ subject: '', description: '', customerId: '', status: 'aperto', date: new Date().toISOString().split('T')[0], time: '09:00' });
    setShowNewTicket(false);
  };

  const handleAddPart = () => {
    if (!newPart.name) return;
    const part = { ...newPart, id: Date.now().toString() };
    setInventory([...inventory, part]);
    setNewPart({ name: '', location: '', qty: 1, price: 0, minQty: 5 }); 
    setShowNewPart(false);
  };

  const updateStock = (id, delta) => {
    setInventory(inventory.map(item => 
      item.id === id ? { ...item, qty: Math.max(0, parseInt(item.qty) + delta) } : item
    ));
  };

  const handleDelete = (type, id) => {
    if (!confirm("Sei sicuro?")) return;
    if (type === 'customers') setCustomers(customers.filter(c => c.id !== id));
    if (type === 'tickets') setTickets(tickets.filter(t => t.id !== id));
    if (type === 'inventory') setInventory(inventory.filter(i => i.id !== id));
  };

  const handleResetData = () => {
    if(confirm("Reset completo dati?")) {
      setCustomers(initialCustomers);
      setTickets(initialTickets);
      setInventory(initialInventory);
    }
  };

  // --- GOOGLE CALENDAR LINK ---
  const addToGoogleCalendar = (ticket) => {
    const customer = customers.find(c => c.id === ticket.customerId);
    const title = encodeURIComponent(`Intervento FIXLAB: ${ticket.subject}`);
    const details = encodeURIComponent(`Problema: ${ticket.description}\nCliente: ${customer?.name}\nTel: ${customer?.phone}`);
    const location = encodeURIComponent(customer?.address || "");
    const dateStr = ticket.date || new Date().toISOString().split('T')[0];
    const timeStr = ticket.time || '09:00';
    const startDate = new Date(`${dateStr}T${timeStr}`);
    const endDate = new Date(startDate.getTime() + 60*60*1000); 
    const formatGCalDate = (date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${formatGCalDate(startDate)}/${formatGCalDate(endDate)}`;
    window.open(url, '_blank');
  };

  // --- AI DEEPSEEK ---
  const getDeepSeekAnalysis = async (ticketDescription, ticketSubject) => {
    if (!DEEPSEEK_API_KEY) {
      setAiError("Configura la chiave API di DeepSeek (VITE_DEEPSEEK_API_KEY) nell'ambiente di deploy.");
      return;
    }

    setLoadingAi(true); 
    setAiSuggestion(null); 
    setAiError(null);
    const systemPrompt = "Sei un tecnico esperto di elettrodomestici. Analizza il problema e fornisci: 1) Possibile Causa 2) Diagnosi 3) Ricambi.";
    const endpoint = `${DEEPSEEK_API_URL}/chat/completions`;
    
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Oggetto: ${ticketSubject}. Descrizione: ${ticketDescription}` }], stream: false })
      });
      if (!response.ok) throw new Error(`Errore API: ${response.status}`);
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Risposta AI non valida.");
      setAiSuggestion({ text: content, confidence: "DeepSeek AI" });
    } catch (error) {
      setAiError(error.message || "Errore connessione AI.");
    } finally { setLoadingAi(false); }
  };

  // --- CALENDAR HELPERS ---
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay(); 
    const startingDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    const days = [];
    for (let i = 0; i < startingDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  };

  const changeMonth = (offset) => {
    const newDate = new Date(currentDate.setMonth(currentDate.getMonth() + offset));
    setCurrentDate(new Date(newDate));
  };

  // --- VISTE AGGIUNTIVE ---
  
  const DashboardView = () => {
    const lowStock = inventory.filter(i => i.qty <= i.minQty);
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-800">Dashboard Laboratorio</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded shadow border-l-4 border-blue-500">
            <p className="text-slate-500">Ticket Aperti</p>
            <p className="text-3xl font-bold">{tickets.filter(t => t.status === 'aperto').length}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-yellow-500">
            <p className="text-slate-500">In Lavorazione</p>
            <p className="text-3xl font-bold">{tickets.filter(t => t.status === 'in lavorazione').length}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-purple-500">
            <p className="text-slate-500">Ricambi Totali</p>
            <p className="text-3xl font-bold">{inventory.reduce((acc, item) => acc + parseInt(item.qty), 0)}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-red-500">
            <p className="text-slate-500">Scorte Basse</p>
            <p className="text-3xl font-bold text-red-600">{lowStock.length}</p>
          </div>
        </div>

        {lowStock.length > 0 && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
            <h3 className="text-red-800 font-bold flex items-center gap-2 mb-2"><AlertTriangle size={20}/> Attenzione: Scorte in esaurimento</h3>
            <ul className="list-disc list-inside text-red-700">
              {lowStock.map(item => (
                <li key={item.id}>{item.name} [{item.location || 'N/D'}] (Rimasti: <strong>{item.qty}</strong>)</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  };

  const CustomerListView = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Rubrica Clienti</h2>
        <button onClick={() => setShowNewCustomer(true)} className="bg-green-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Nuovo Cliente</button>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-100 uppercase text-sm font-semibold text-slate-600">
            <tr><th className="p-4">Nome</th><th className="p-4">Contatti</th><th className="p-4">Indirizzo</th><th className="p-4 text-right">Azioni</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map(c => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="p-4 font-bold text-slate-800">{c.name}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2 text-sm text-slate-600"><Phone size={14}/> {c.phone}</div>
                  <div className="text-xs text-slate-400">{c.email}</div>
                </td>
                <td className="p-4 text-sm text-slate-600"><MapPin size={14} className="inline mr-1"/>{c.address}</td>
                <td className="p-4 text-right"><button onClick={() => handleDelete('customers', c.id)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={18}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const InventoryView = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Magazzino Ricambi</h2>
        <button onClick={() => setShowNewPart(true)} className="bg-purple-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Aggiungi Articolo</button>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-100 uppercase text-sm font-semibold text-slate-600">
            <tr>
                <th className="p-4">Prodotto</th>
                <th className="p-4">Posizione</th>
                <th className="p-4">Prezzo</th>
                <th className="p-4 text-center">Quantità</th>
                <th className="p-4 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.map(item => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="p-4 font-medium text-slate-800">
                  {item.name}
                  {item.qty <= item.minQty && <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Scorta Bassa</span>}
                </td>
                <td className="p-4">
                    <span className="bg-slate-200 text-slate-700 text-xs font-mono font-bold px-2 py-1 rounded border border-slate-300">
                        {item.location || 'N/D'}
                    </span>
                </td>
                <td className="p-4 text-slate-600">€ {parseFloat(item.price).toFixed(2)}</td>
                <td className="p-4 text-center">
                  <div className="flex items-center justify-center gap-3">
                    <button onClick={() => updateStock(item.id, -1)} className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-bold">-</button>
                    <span className={`font-bold w-8 ${item.qty === 0 ? 'text-red-600' : 'text-slate-800'}`}>{item.qty}</span>
                    <button onClick={() => updateStock(item.id, 1)} className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-bold">+</button>
                  </div>
                </td>
                <td className="p-4 text-right"><button onClick={() => handleDelete('inventory', item.id)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={18}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const Sidebar = () => (
    <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 flex flex-col`}>
      <div className="flex items-center justify-between p-4 border-b border-slate-700 h-16">
        <h1 className="text-xl font-bold flex items-center gap-2"><Zap className="w-6 h-6 text-yellow-400" /> FIXLAB AI</h1>
        <button onClick={() => setIsSidebarOpen(false)} className="md:hidden"><X className="w-6 h-6" /></button>
      </div>
      <nav className="p-4 space-y-2 flex-1">
        <button onClick={() => setActiveTab('dashboard')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'dashboard' ? 'bg-slate-800 text-yellow-400' : ''}`}><LayoutDashboard size={20}/> Dashboard</button>
        <button onClick={() => setActiveTab('calendar')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'calendar' ? 'bg-slate-800 text-yellow-400' : ''}`}><CalendarIcon size={20}/> Calendario</button>
        <button onClick={() => setActiveTab('tickets')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'tickets' ? 'bg-slate-800 text-yellow-400' : ''}`}><Ticket size={20}/> Lista Ticket</button>
        <button onClick={() => setActiveTab('customers')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'customers' ? 'bg-slate-800 text-yellow-400' : ''}`}><Users size={20}/> Clienti</button>
        <button onClick={() => setActiveTab('inventory')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'inventory' ? 'bg-slate-800 text-yellow-400' : ''}`}><Package size={20}/> Magazzino</button>
      </nav>
      <div className="p-4 border-t border-slate-700"><button onClick={handleResetData} className="w-full text-xs bg-red-900/50 text-red-200 p-2 rounded">Reset Dati</button></div>
    </div>
  );

  const CalendarView = () => {
    const days = getDaysInMonth(currentDate);
    const monthName = currentDate.toLocaleString('it-IT', { month: 'long', year: 'numeric' });

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center bg-white p-4 rounded shadow">
          <h2 className="text-2xl font-bold capitalize text-slate-800">{monthName}</h2>
          <div className="flex gap-2">
            <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-slate-100 rounded"><ChevronLeft/></button>
            <button onClick={() => changeMonth(1)} className="p-2 hover:bg-slate-100 rounded"><ChevronRight/></button>
            <button onClick={() => setShowNewTicket(true)} className="bg-blue-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Nuovo Intervento</button>
          </div>
        </div>

        <div className="bg-white rounded shadow p-4">
          <div className="grid grid-cols-7 gap-2 mb-2 text-center font-bold text-slate-500 uppercase text-sm">
            <div>Lun</div><div>Mar</div><div>Mer</div><div>Gio</div><div>Ven</div><div>Sab</div><div>Dom</div>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, idx) => {
              if (!day) return <div key={idx} className="bg-slate-50 h-32 rounded"></div>;
              const dayString = day.toISOString().split('T')[0];
              const dayTickets = tickets.filter(t => t.date === dayString);
              const isToday = dayString === new Date().toISOString().split('T')[0];
              return (
                <div key={idx} className={`h-32 border rounded p-2 flex flex-col gap-1 overflow-y-auto ${isToday ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <div className="text-right text-sm font-semibold text-slate-400">{day.getDate()}</div>
                  {dayTickets.map(t => (
                    <div key={t.id} onClick={() => setCurrentTicketForAi(t)} className="text-xs bg-white border-l-4 border-yellow-500 p-1 rounded shadow-sm cursor-pointer hover:bg-yellow-50 truncate">
                      <span className="font-bold">{t.time}</span> {t.subject}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm z-30 p-4 flex justify-between items-center md:hidden">
           <span className="font-bold text-slate-700 flex items-center gap-2"><Zap className="text-yellow-500 w-5 h-5"/> FIXLAB</span>
           <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}><Menu className="w-6 h-6 text-slate-600" /></button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto pb-20">
            {activeTab === 'dashboard' && <DashboardView />}
            {activeTab === 'calendar' && <CalendarView />}
            {activeTab === 'customers' && <CustomerListView />}
            {activeTab === 'inventory' && <InventoryView />}
            
            {activeTab === 'tickets' && (
                <div className="space-y-6">
                    <div className="flex justify-between"><h2 className="text-2xl font-bold">Tutti i Ticket</h2><button onClick={() => setShowNewTicket(true)} className="bg-blue-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Nuovo</button></div>
                    <div className="bg-white rounded shadow overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-100"><tr><th className="p-4">Data</th><th className="p-4">Problema</th><th className="p-4">Stato</th><th className="p-4 text-right">Azioni</th></tr></thead>
                            <tbody>
                                {tickets.map(t => (
                                    <tr key={t.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setCurrentTicketForAi(t)}>
                                        <td className="p-4 text-sm"><div className="font-bold">{t.date}</div><div className="text-slate-500">{t.time}</div></td>
                                        <td className="p-4"><div className="font-bold">{t.subject}</div><div className="text-xs text-slate-500">{t.description}</div></td>
                                        <td className="p-4"><span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">{t.status}</span></td>
                                        <td className="p-4 text-right flex justify-end gap-2">
                                            <button onClick={(e) => {e.stopPropagation(); addToGoogleCalendar(t)}} className="text-green-600 hover:bg-green-50 p-1 rounded"><CalendarIcon size={18}/></button>
                                            <button onClick={(e) => {e.stopPropagation(); handleDelete('tickets', t.id)}} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={18}/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {currentTicketForAi && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-2xl font-bold flex items-center gap-2"><Wrench className="text-blue-600"/> {currentTicketForAi.subject}</h3>
                                <p className="text-slate-500 text-sm">Intervento del {currentTicketForAi.date} alle {currentTicketForAi.time}</p>
                            </div>
                            <button onClick={() => setCurrentTicketForAi(null)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="bg-slate-50 p-4 rounded border"><h4 className="font-bold text-sm text-slate-700 uppercase mb-2">Dettagli Problema</h4><p className="text-slate-700">{currentTicketForAi.description}</p></div>
                                <button onClick={() => addToGoogleCalendar(currentTicketForAi)} className="w-full py-3 bg-white border-2 border-green-500 text-green-600 font-bold rounded hover:bg-green-50 flex items-center justify-center gap-2"><CalendarIcon/> Salva su Google Calendar</button>
                            </div>
                            <div className="space-y-4">
                                <div className="bg-indigo-50 p-4 rounded border border-indigo-100">
                                    <h4 className="font-bold text-sm text-indigo-800 uppercase mb-2 flex items-center gap-2"><Bot size={16}/> Diagnosi AI</h4>
                                    {aiError && <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded">{aiError}</div>}
                                    {aiSuggestion ? (
                                      <div className="text-sm whitespace-pre-line text-slate-700">{aiSuggestion.text}</div>
                                    ) : loadingAi ? (
                                      <div className="flex items-center gap-2 text-indigo-600"><RefreshCw className="animate-spin"/> Analisi in corso...</div>
                                    ) : (
                                      <button onClick={() => getDeepSeekAnalysis(currentTicketForAi.description, currentTicketForAi.subject)} className="bg-indigo-600 text-white px-4 py-2 rounded text-sm w-full">Avvia Analisi DeepSeek</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
          </div>
        </main>
      </div>
      
      {showNewTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Nuovo Intervento</h3>
                <div className="space-y-3">
                    <select className="w-full border p-2 rounded" value={newTicket.customerId} onChange={e => setNewTicket({...newTicket, customerId: e.target.value})}>
                        <option value="">Seleziona Cliente...</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input className="w-full border p-2 rounded" placeholder="Elettrodomestico / Problema" value={newTicket.subject} onChange={e => setNewTicket({...newTicket, subject: e.target.value})} />
                    <div className="flex gap-2">
                        <input type="date" className="w-full border p-2 rounded" value={newTicket.date} onChange={e => setNewTicket({...newTicket, date: e.target.value})} />
                        <input type="time" className="w-full border p-2 rounded" value={newTicket.time} onChange={e => setNewTicket({...newTicket, time: e.target.value})} />
                    </div>
                    <textarea className="w-full border p-2 rounded" placeholder="Descrizione dettagliata (per AI)" value={newTicket.description} onChange={e => setNewTicket({...newTicket, description: e.target.value})} />
                </div>
                <div className="flex justify-end gap-2 mt-4"><button onClick={() => setShowNewTicket(false)} className="px-4 py-2 text-slate-500">Annulla</button><button onClick={handleAddTicket} className="px-4 py-2 bg-blue-600 text-white rounded">Salva</button></div>
            </div>
        </div>
      )}

      {showNewCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Nuovo Cliente</h3>
                <div className="space-y-3">
                    <input className="w-full border p-2 rounded" placeholder="Nome Completo" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Telefono" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Email" value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Indirizzo" value={newCustomer.address} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} />
                </div>
                <div className="flex justify-end gap-2 mt-4"><button onClick={() => setShowNewCustomer(false)} className="px-4 py-2 text-slate-500">Annulla</button><button onClick={handleAddCustomer} className="px-4 py-2 bg-green-600 text-white rounded">Salva</button></div>
            </div>
        </div>
      )}

      {showNewPart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Nuovo Articolo Magazzino</h3>
                <div className="space-y-3">
                    <input className="w-full border p-2 rounded" placeholder="Nome Prodotto (es. Cuscinetti)" value={newPart.name} onChange={e => setNewPart({...newPart, name: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Codice Posizione (es. af00021)" value={newPart.location} onChange={e => setNewPart({...newPart, location: e.target.value})} />
                    <div className="flex gap-2">
                        <input type="number" className="w-full border p-2 rounded" placeholder="Quantità" value={newPart.qty} onChange={e => setNewPart({...newPart, qty: parseInt(e.target.value)})} />
                        <input type="number" className="w-full border p-2 rounded" placeholder="Prezzo (€)" value={newPart.price} onChange={e => setNewPart({...newPart, price: parseFloat(e.target.value)})} />
                    </div>
                    <input type="number" className="w-full border p-2 rounded" placeholder="Quantità Minima (Allarme)" value={newPart.minQty} onChange={e => setNewPart({...newPart, minQty: parseInt(e.target.value)})} />
                </div>
                <div className="flex justify-end gap-2 mt-4"><button onClick={() => setShowNewPart(false)} className="px-4 py-2 text-slate-500">Annulla</button><button onClick={handleAddPart} className="px-4 py-2 bg-purple-600 text-white rounded">Salva</button></div>
            </div>
        </div>
      )}
    </div>
  );
}
