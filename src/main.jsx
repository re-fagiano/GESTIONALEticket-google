import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Errore applicazione', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-lg space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow">
          <h1 className="text-lg font-bold text-red-600">Qualcosa è andato storto</h1>
          <p className="text-sm text-slate-600">I dati sono al sicuro sul server. Ricarica la pagina per continuare.</p>
          <p className="break-all text-xs text-slate-400">{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">Ricarica</button>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
