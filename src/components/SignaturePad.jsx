import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

// Riquadro firma per dito o penna (pointer events). Esporta un PNG con sfondo trasparente,
// ritagliato e in scala ×2 così resta nitido nel PDF.
const SignaturePad = forwardRef(function SignaturePad({ onChange, height = 180 }, ref) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const bounds = useRef(null)
  const [empty, setEmpty] = useState(true)

  const setup = useCallback(() => {
    const el = canvas.current
    if (!el) return
    const ratio = window.devicePixelRatio || 1
    const rect = el.getBoundingClientRect()
    el.width = Math.round(rect.width * ratio)
    el.height = Math.round(rect.height * ratio)
    const ctx = el.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
    bounds.current = null
  }, [])

  useEffect(() => { setup() }, [setup])

  const point = (event) => {
    const rect = canvas.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, p: event.pressure || 0.5 }
  }
  const grow = ({ x, y }) => {
    const b = bounds.current || { minX: x, minY: y, maxX: x, maxY: y }
    bounds.current = { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }
  }
  const down = (event) => {
    event.preventDefault()
    canvas.current.setPointerCapture?.(event.pointerId)
    drawing.current = true
    last.current = point(event)
    grow(last.current)
  }
  const move = (event) => {
    if (!drawing.current) return
    event.preventDefault()
    const ctx = canvas.current.getContext('2d')
    const next = point(event)
    ctx.lineWidth = event.pointerType === 'pen' ? 1.2 + next.p * 2.2 : 2.4
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(next.x, next.y)
    ctx.stroke()
    last.current = next
    grow(next)
    if (empty) { setEmpty(false); onChange?.(false) }
  }
  const up = () => { drawing.current = false }

  const clear = () => {
    const el = canvas.current
    el.getContext('2d').clearRect(0, 0, el.width, el.height)
    bounds.current = null
    setEmpty(true)
    onChange?.(true)
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear,
    toBlob: () => new Promise((resolve) => {
      const el = canvas.current
      const b = bounds.current
      if (!b || empty) return resolve(null)
      const ratio = el.width / el.getBoundingClientRect().width
      const pad = 8
      const sx = Math.max(0, (b.minX - pad) * ratio)
      const sy = Math.max(0, (b.minY - pad) * ratio)
      const sw = Math.min(el.width - sx, (b.maxX - b.minX + pad * 2) * ratio)
      const sh = Math.min(el.height - sy, (b.maxY - b.minY + pad * 2) * ratio)
      const out = document.createElement('canvas')
      const scale = Math.min(1, 900 / sw)
      out.width = Math.max(1, Math.round(sw * scale))
      out.height = Math.max(1, Math.round(sh * scale))
      out.getContext('2d').drawImage(el, sx, sy, sw, sh, 0, 0, out.width, out.height)
      out.toBlob(resolve, 'image/png')
    }),
  }))

  return (
    <div className="space-y-1">
      <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvas}
          style={{ height, touchAction: 'none' }}
          className="block w-full cursor-crosshair"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          onPointerCancel={up}
          aria-label="Riquadro firma del cliente"
          role="img"
        />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Firma qui con il dito</span>}
        <div className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-slate-200" />
      </div>
      <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><Eraser className="h-3.5 w-3.5" /> Cancella firma</button>
    </div>
  )
})

export default SignaturePad
