import { useState } from 'react'
import { Copy, Link2Off, Mail, MessageCircle, MessageSquareText } from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { TEMPLATES, buildMessage, isMobile, mailtoUrl, normalizePhone, smsUrl, subjectFor, suggestedTemplate, whatsappUrl } from '../lib/messages'
import { Button, ErrorBox, Modal, Select, Spinner, Textarea, useToast } from './ui'

export default function NotifyCustomerModal({ item, customer, onClose, onSent }) {
  const setup = useAsync(async () => {
    const [shop, link] = await Promise.all([
      api.get('/api/shop-profile'),
      api.post(`/api/interventions/${item.id}/public-link`),
    ])
    return { shop, link }
  }, [item.id])
  return (
    <Modal open size="md" onClose={onClose} title="Avvisa il cliente" subtitle={customer?.name}>
      <ErrorBox error={setup.error} onRetry={setup.reload} />
      {!setup.data ? (!setup.error && <Spinner />) : <NotifyForm item={item} customer={customer} shop={setup.data.shop} link={setup.data.link} onClose={onClose} onSent={onSent} />}
    </Modal>
  )
}

function NotifyForm({ item, customer, shop, link, onClose, onSent }) {
  const { toast, confirm } = useToast()
  const url = `${window.location.origin}${link.path}`
  const available = Object.entries(TEMPLATES).filter(([, t]) => t.types.includes(item.type))
  const [template, setTemplate] = useState(() => suggestedTemplate(item))
  const [text, setText] = useState(() => buildMessage(suggestedTemplate(item), { item, customer, shop, link: url }))
  const phone = normalizePhone(customer?.phone)

  const choose = (value) => { setTemplate(value); setText(buildMessage(value, { item, customer, shop, link: url })) }
  const record = (channel) => api.post(`/api/interventions/${item.id}/customer-message`, { channel, template: TEMPLATES[template]?.label }).then(() => onSent?.()).catch(() => {})

  const open = (channel, href) => {
    window.open(href, channel === 'email' || channel === 'sms' ? '_self' : '_blank', 'noopener')
    record(channel)
    toast('Messaggio pronto: completa l\'invio nell\'app che si è aperta.')
  }
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {})
    record('copia')
    toast('Testo copiato.')
  }
  const revoke = async () => {
    if (!(await confirm({ title: 'Disattivare il link?', message: 'Chi ha il link vecchio non vedrà più lo stato. Alla prossima condivisione ne verrà creato uno nuovo.', danger: true, confirmLabel: 'Disattiva' }))) return
    await api.del(`/api/interventions/${item.id}/public-link`)
    toast('Link disattivato.')
    onClose()
  }

  return (
    <div className="space-y-4">
      <Select label="Messaggio" value={template} onChange={(e) => choose(e.target.value)}>
        {available.map(([value, t]) => <option key={value} value={value}>{t.label}</option>)}
      </Select>
      <Textarea label="Testo (modificabile)" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="whatsapp" icon={MessageCircle} disabled={!phone} onClick={() => open('whatsapp', whatsappUrl(phone, text))}>WhatsApp</Button>
        <Button variant="secondary" icon={Mail} disabled={!customer?.email} onClick={() => open('email', mailtoUrl(customer.email, subjectFor(template, { item, shop }), text))}>Email</Button>
        <Button variant="secondary" icon={MessageSquareText} disabled={!phone} onClick={() => open('sms', smsUrl(phone, text))}>SMS</Button>
        <Button variant="ghost" icon={Copy} onClick={copy}>Copia testo</Button>
      </div>
      <div className="space-y-1 text-xs text-slate-500">
        {!phone && <p>Il cliente non ha un numero di telefono valido: aggiungilo nella scheda cliente per usare WhatsApp/SMS.</p>}
        {phone && !isMobile(customer.phone) && <p>Il numero sembra un fisso: WhatsApp potrebbe non funzionare.</p>}
        {!customer?.email && <p>Nessuna email in scheda cliente.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>Pagina di stato per il cliente:</span>
        <a href={url} target="_blank" rel="noreferrer" className="font-mono text-amber-700 hover:underline">{link.path}</a>
        <span>· aperta {link.views || 0} volte</span>
        <button type="button" onClick={revoke} className="ml-auto flex items-center gap-1 text-red-600 hover:underline"><Link2Off className="h-3.5 w-3.5" /> Disattiva link</button>
      </div>
    </div>
  )
}
