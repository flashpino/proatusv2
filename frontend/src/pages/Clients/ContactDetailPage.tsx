import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, Trash2, Phone, Mail, Bell, Pencil, Check, X } from 'lucide-react'
import { api } from '../../services/api'
import type { Contact, CPD, AlertSubscription } from '../../types'

const ALERT_TYPES = [
  { value: 'all',           label: 'Todos os alertas' },
  { value: 'temp_high',     label: 'Temperatura alta' },
  { value: 'temp_low',      label: 'Temperatura baixa' },
  { value: 'humidity_high', label: 'Umidade alta' },
  { value: 'humidity_low',  label: 'Umidade baixa' },
  { value: 'comm_failure',  label: 'Sensor offline' },
]

const ALERT_TYPE_LABEL: Record<string, string> = Object.fromEntries(ALERT_TYPES.map(t => [t.value, t.label]))
const CHANNELS: AlertSubscription['channel'][] = ['whatsapp', 'email', 'call']
const SEVERITIES: AlertSubscription['severity_min'][] = ['warning', 'critical']
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function maskToDays(mask: number): number[] {
  return DAYS.map((_, i) => i).filter(i => mask & (1 << i))
}
function daysToMask(days: number[]): number {
  return days.reduce((acc, d) => acc | (1 << d), 0)
}

const DEFAULT_SUB: Partial<AlertSubscription> = {
  alert_type: 'all',
  channel: 'whatsapp',
  time_from: '00:00',
  time_to: '23:59',
  weekdays_mask: 127,
  cooldown_minutes: 30,
  severity_min: 'warning',
}

function SubForm({
  cpds,
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  cpds: CPD[]
  initial: Partial<AlertSubscription>
  saveLabel: string
  onSave: (sub: Partial<AlertSubscription>) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<Partial<AlertSubscription>>(initial)
  const [saving, setSaving] = useState(false)

  const selectedDays = maskToDays(form.weekdays_mask ?? 127)

  function toggleDay(d: number) {
    const curr = maskToDays(form.weekdays_mask ?? 127)
    const next = curr.includes(d) ? curr.filter(x => x !== d) : [...curr, d]
    setForm(f => ({ ...f, weekdays_mask: daysToMask(next) }))
  }

  async function submit() {
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  const sel = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500'
  const inp = sel

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Local</label>
          <select value={form.cpd_id ?? ''} onChange={e => setForm(f => ({ ...f, cpd_id: e.target.value ? Number(e.target.value) : undefined }))} className={sel}>
            <option value="">Todos os locais</option>
            {cpds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Tipo de alerta</label>
          <select value={form.alert_type} onChange={e => setForm(f => ({ ...f, alert_type: e.target.value }))} className={sel}>
            {ALERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Canal</label>
          <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value as AlertSubscription['channel'] }))} className={sel}>
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Severidade mínima</label>
          <select value={form.severity_min} onChange={e => setForm(f => ({ ...f, severity_min: e.target.value as AlertSubscription['severity_min'] }))} className={sel}>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">De</label>
          <input type="time" value={form.time_from} onChange={e => setForm(f => ({ ...f, time_from: e.target.value }))} className={inp} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Até</label>
          <input type="time" value={form.time_to} onChange={e => setForm(f => ({ ...f, time_to: e.target.value }))} className={inp} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Cooldown (min)</label>
          <input type="number" min={1} value={form.cooldown_minutes} onChange={e => setForm(f => ({ ...f, cooldown_minutes: Number(e.target.value) }))} className={inp} />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-2">Dias da semana</label>
        <div className="flex gap-1.5">
          {DAYS.map((label, i) => (
            <button key={i} type="button" onClick={() => toggleDay(i)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedDays.includes(i) ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-1.5 text-sm text-gray-400 hover:text-white flex items-center gap-1">
          <X className="w-3.5 h-3.5" /> Cancelar
        </button>
        <button type="button" onClick={submit} disabled={saving}
          className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 flex items-center gap-1">
          <Check className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : saveLabel}
        </button>
      </div>
    </div>
  )
}

export default function ContactDetailPage() {
  const { clientId, contactId } = useParams<{ clientId: string; contactId: string }>()
  const navigate = useNavigate()
  const [contact, setContact] = useState<Contact | null>(null)
  const [cpds, setCpds] = useState<CPD[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const [form, setForm] = useState({ name: '', whatsapp: '', email: '' })

  useEffect(() => {
    Promise.all([
      api.getContacts(Number(clientId)).then(cs => {
        const c = cs.find(x => x.id === Number(contactId))
        if (c) { setContact(c); setForm({ name: c.name, whatsapp: c.whatsapp || '', email: c.email || '' }) }
      }),
      api.getCPDs().then(cs => setCpds(cs.filter((c: CPD) => c.client_id === Number(clientId)))),
    ]).finally(() => setLoading(false))
  }, [contactId, clientId])

  async function saveContact(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.updateContact(Number(contactId), form)
      setContact(c => c ? { ...c, ...form } : c)
    } finally { setSaving(false) }
  }

  async function addSub(sub: Partial<AlertSubscription>) {
    const created = await api.createSubscription(Number(contactId), sub)
    setContact(c => c ? { ...c, subscriptions: [...c.subscriptions, created] } : c)
    setShowAddForm(false)
  }

  async function updateSub(subId: number, sub: Partial<AlertSubscription>) {
    await api.updateSubscription(Number(contactId), subId, sub)
    setContact(c => c ? { ...c, subscriptions: c.subscriptions.map(s => s.id === subId ? { ...s, ...sub } : s) } : c)
    setEditingId(null)
  }

  async function deleteSub(subId: number) {
    await api.deleteSubscription(Number(contactId), subId)
    setContact(c => c ? { ...c, subscriptions: c.subscriptions.filter(s => s.id !== subId) } : c)
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Carregando...</div>
  if (!contact) return <div className="text-center py-16 text-gray-400">Contato não encontrado</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/clients/${clientId}`)} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-white">{contact.name}</h1>
      </div>

      <form onSubmit={saveContact} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-white">Dados do contato</h2>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Nome</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-gray-400 block mb-1 flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> WhatsApp</label>
            <input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="+55 11 9..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1 flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> E-mail</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Bell className="w-4 h-4 text-gray-400" /> Inscrições de alerta
            <span className="text-xs bg-gray-800 rounded-full px-1.5 text-gray-400">{contact.subscriptions.length}</span>
          </h2>
          <button onClick={() => { setShowAddForm(true); setEditingId(null) }}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg">
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>

        {showAddForm && (
          <SubForm cpds={cpds} initial={DEFAULT_SUB} saveLabel="Adicionar"
            onSave={addSub} onCancel={() => setShowAddForm(false)} />
        )}

        {contact.subscriptions.length === 0 && !showAddForm ? (
          <div className="text-center py-8 text-gray-500">Nenhuma inscrição configurada</div>
        ) : (
          <div className="space-y-2">
            {contact.subscriptions.map(s => {
              const cpdName = cpds.find(c => c.id === s.cpd_id)?.name
              const days = maskToDays(s.weekdays_mask)

              if (editingId === s.id) {
                return (
                  <SubForm key={s.id} cpds={cpds} initial={s} saveLabel="Salvar"
                    onSave={data => updateSub(s.id, data)}
                    onCancel={() => setEditingId(null)} />
                )
              }

              return (
                <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-3 flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">{s.channel}</span>
                      <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{ALERT_TYPE_LABEL[s.alert_type] ?? s.alert_type}</span>
                      <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{s.severity_min}+</span>
                      {cpdName && <span className="text-xs text-gray-400">{cpdName}</span>}
                    </div>
                    <p className="text-xs text-gray-500">
                      {s.time_from} – {s.time_to} · {days.map(d => DAYS[d]).join(', ')} · cooldown {s.cooldown_minutes}min
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <button onClick={() => { setEditingId(s.id); setShowAddForm(false) }}
                      className="p-1.5 rounded-lg hover:bg-blue-500/10 text-gray-500 hover:text-blue-400 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteSub(s.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
