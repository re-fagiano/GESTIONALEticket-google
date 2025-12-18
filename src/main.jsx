import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Errore applicativo inatteso.' }
  }

  componentDidCatch(error, info) {
    console.error('Errore inatteso render:', error, info)
  }

  handleReload = () => {
    try { localStorage.clear() } catch (e) { console.warn('Impossibile svuotare lo storage', e) }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
          <div className="bg-white shadow-md rounded-lg p-6 max-w-lg w-full space-y-3 border border-slate-200">
            <h1 className="text-xl font-bold text-red-600">Qualcosa è andato storto</h1>
            <p className="text-sm text-slate-700">L&apos;app non è riuscita ad avviarsi correttamente.</p>
            <p className="text-xs text-slate-500 break-all">{this.state.message}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={this.handleReload} className="px-4 py-2 bg-red-600 text-white rounded text-sm">Svuota dati locali e ricarica</button>
              <button onClick={() => window.location.reload()} className="px-4 py-2 bg-slate-200 text-slate-800 rounded text-sm">Riprova</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Promise non gestita:', event.reason)
})

const rootElement = document.getElementById('root')

const renderApp = async () => {
  try {
    const { default: App } = await import('./App.jsx')
    createRoot(rootElement).render(
      <StrictMode>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    console.error('Errore critico durante il bootstrap:', error)
    rootElement.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 16px;">
        <h1>Impossibile avviare l'app</h1>
        <p style="color:#991b1b;">${error?.message || 'Errore sconosciuto'}</p>
        <button id="reload-btn" style="background:#991b1b;color:#fff;padding:8px 12px;border:none;border-radius:6px;cursor:pointer;">Svuota dati locali e ricarica</button>
      </div>
    `
    const reloadBtn = document.getElementById('reload-btn')
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        try { localStorage.clear() } catch (e) { console.warn('Impossibile svuotare lo storage', e) }
        window.location.reload()
      })
    }
  }
}

renderApp()
