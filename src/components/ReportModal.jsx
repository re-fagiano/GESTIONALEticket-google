import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { PAYMENT_METHODS, descriptionEntries, isOpen } from '../lib/domain'
import { uploadFile } from '../lib/files'
import { fmtEuro } from '../lib/format'
import { useAsync } from '../lib/hooks'
import SignaturePad from './SignaturePad'
import { Button, Input, Modal, Select, Spinner, Textarea, useToast } from './ui'

const round2 = (value) => Math.round(value * 100) / 100

// Righe iniziali: dal rapportino precedente, oppure diritto di chiamata + manodopera + ricambi scaricati.
const initialLines = (intervention, shop, movements) => {
  if (intervention.additionalData?.report?.lines?.length) return intervention.additionalData.report.lines.map((line, i) => ({ ...line, key: `p${i}` }))
  const lines = []
  if (intervention.type === 'chiamata') lines.push({ key: 'call', kind: 'call', description: 'Diritto di chiamata', qty: 1, unitPrice: shop.callFee || 0 })
  lines.push({ key: 'labor', kind: 'labor', description: 'Manodopera (ore)', qty: 1, unitPrice: shop.hourlyRate || 0 })
  const used = new Map()
  for (const m of movements) {
    const entry = used.get(m.itemId) || { qty: 0, m }
    entry.qty -= m.delta
    used.set(m.itemId, entry)
  }
  for (const [itemId, { qty, m }] of used) {
    if (qty > 0) lines.push({ key: itemId, kind: 'part', itemId, description: `${m.itemName} (${m.itemCode})`, qty, unitPrice: m.itemPrice || 0 })
  }
  return lines
}

export default function ReportModal({ intervention, customer, onClose, onSaved }) {
  const setup = useAsync(async () => {
    const [shop, movements] = await Promise.all([
      api.get('/api/shop-profile'),
      api.get(`/api/inventory/movements?interventionId=${intervention.id}&take=200`).catch(() => []),
    ])
    return { shop, movements }
  }, [intervention.id])
  return (
    <Modal open size="lg" onClose={onClose} title={intervention.additionalData?.report ? `Rapportino ${intervention.additionalData.report.number}` : 'Nuovo rapportino'} subtitle={customer?.name}>
      {!setup.data ? <Spinner /> : <ReportForm intervention={intervention} customer={customer} shop={setup.data.shop} movements={setup.data.movements} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function ReportForm({ intervention, customer, shop, movements, onClose, onSaved }) {
  const { toast } = useToast()
  const previous = intervention.additionalData?.report
  const pad = useRef(null)
  const [lines, setLines] = useState(() => initialLines(intervention, shop, movements))
  const [workDone, setWorkDone] = useState(() => previous?.workDone || descriptionEntries(intervention).filter((e) => e.source === 'note').map((e) => e.text).join('\n'))
  const [notes, setNotes] = useState(previous?.notes || '')
  const [discount, setDiscount] = useState(previous?.discount || 0)
  const [paymentMethod, setPaymentMethod] = useState(previous?.paymentMethod || '')
  const [signerName, setSignerName] = useState(previous?.signerName || customer?.name || '')
  const [hasSignature, setHasSignature] = useState(false)
  const [closeIntervention, setCloseIntervention] = useState(isOpen(intervention))
  const [busy, setBusy] = useState(false)

  const subtotal = useMemo(() => round2(lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0)), [lines])
  const total = round2(subtotal - Math.min(subtotal, Number(discount) || 0))
  const update = (key, field) => (e) => setLines(lines.map((l) => (l.key === key ? { ...l, [field]: e.target.value } : l)))

  const save = async () => {
    if (!workDone.trim()) return toast('Descrivi il lavoro svolto.', 'error')
    if (hasSignature && !signerName.trim()) return toast('Scrivi il nome di chi firma.', 'error')
    setBusy(true)
    try {
      let signatureFileId = null
      if (hasSignature) {
        const blob = await pad.current.toBlob()
        if (blob) signatureFileId = (await uploadFile(new File([blob], `firma-${intervention.code}.png`, { type: 'image/png' }), { kind: 'signature', interventionId: intervention.id })).id
      }
      const result = await api.post(`/api/interventions/${intervention.id}/report`, {
        workDone, notes, discount: Number(discount) || 0, paymentMethod, closeIntervention,
        signerName: hasSignature ? signerName.trim() : (previous?.signatureFileId ? previous.signerName : ''),
        signatureFileId: signatureFileId || previous?.signatureFileId || null,
        lines: lines.map(({ kind, description, qty, unitPrice, itemId }) => ({ kind, description, qty: Number(qty) || 0, unitPrice: Number(unitPrice) || 0, itemId })),
      })
      toast(`Rapportino ${result.report.number} salvato.`)
      onSaved?.(result.intervention, result.report)
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <Textarea label="Lavoro svolto" rows={4} value={workDone} onChange={(e) => setWorkDone(e.target.value)} placeholder="Es. Sostituita pompa di scarico, pulito filtro, provato ciclo completo." />

      <div className="space-y-2">
        <div className="text-sm font-medium text-slate-700">Voci</div>
        <div className="space-y-2">
          {lines.length > 0 && (
            <div className="grid grid-cols-[1fr_4.5rem_6rem_2rem] gap-2 text-xs text-slate-500">
              <span>Descrizione</span><span className="text-right">Q.tà / ore</span><span className="text-right">Prezzo €</span><span />
            </div>
          )}
          {lines.map((line) => (
            <div key={line.key} className="grid grid-cols-[1fr_4.5rem_6rem_2rem] items-center gap-2">
              <input aria-label="Descrizione" value={line.description} onChange={update(line.key, 'description')} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <input aria-label="Quantità" type="number" min="0" step="0.5" value={line.qty} onChange={update(line.key, 'qty')} className="rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm" />
              <input aria-label="Prezzo" type="number" min="0" step="0.01" value={line.unitPrice} onChange={update(line.key, 'unitPrice')} className="rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm" />
              <button type="button" aria-label="Rimuovi voce" onClick={() => setLines(lines.filter((l) => l.key !== line.key))} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setLines([...lines, { key: `n${Date.now()}`, kind: 'other', description: '', qty: 1, unitPrice: 0 }])}>Aggiungi voce</Button>
        <div className="flex flex-wrap items-end justify-end gap-4 border-t border-slate-100 pt-3">
          <Input label="Sconto €" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-28" />
          <Select label="Pagamento" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-44">
            {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <div className="text-right">
            <div className="text-xs text-slate-500">Totale {shop.pricesIncludeVat === false ? 'IVA esclusa' : 'IVA inclusa'}</div>
            <div className="text-2xl font-bold text-slate-900">{fmtEuro(total)}</div>
          </div>
        </div>
      </div>

      <Input label="Note per il cliente (facoltative)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. consigliata pulizia filtro ogni 3 mesi" />

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div className="text-sm font-medium text-slate-700">Firma del cliente</div>
          {previous?.signatureFileId && !hasSignature && <span className="text-xs text-slate-500">Già firmato da {previous.signerName}: firma di nuovo solo per sostituirla.</span>}
        </div>
        <SignaturePad ref={pad} onChange={(isEmpty) => setHasSignature(!isEmpty)} />
        <Input label="Nome di chi firma" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={closeIntervention} onChange={(e) => setCloseIntervention(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        Segna l'intervento come completato
      </label>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onClose}>Annulla</Button>
        <Button onClick={save} loading={busy}>{previous ? 'Aggiorna e rigenera PDF' : 'Salva e crea PDF'}</Button>
      </div>
    </div>
  )
}
