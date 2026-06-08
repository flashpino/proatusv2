import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, MapPin, Plus, Wifi, WifiOff,
  Trash2, Server, Copy, Check, Settings,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api } from '../../services/api'
import type { CPD, Device } from '../../types'

type Tab = 'sensores' | 'configuracoes'

function ProvisionModal({
  localId,
  onClose,
  onCreated,
}: {
  localId: number
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [result, setResult] = useState<{ mqtt_client_id: string; token: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const res = await api.createDevice(localId, { name: name.trim() })
      setResult(res)
      onCreated()
    } finally {
      setLoading(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Provisionar sensor</h2>

        {!result ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Nome do sensor</label>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="ex: Sensor Rack A"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
              >
                {loading ? 'Criando...' : 'Criar'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
              <p className="text-orange-400 text-sm font-medium">
                Copie o token agora — ele não será exibido novamente.
              </p>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">MQTT Client ID</label>
              <code className="block bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono break-all">
                {result.mqtt_client_id}
              </code>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Token de autenticação</label>
              <div className="flex gap-2">
                <code className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm text-green-400 font-mono break-all">
                  {result.token}
                </code>
                <button
                  onClick={() => copy(result.token)}
                  className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button onClick={onClose} className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LocalDetailPage() {
  const { clientId, cpdId } = useParams<{ clientId: string; cpdId: string }>()
  const navigate = useNavigate()
  const [local, setLocal] = useState<CPD | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [tab, setTab] = useState<Tab>('sensores')
  const [loading, setLoading] = useState(true)
  const [showProvision, setShowProvision] = useState(false)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [wDelta, setWDelta] = useState('')
  const [cDelta, setCDelta] = useState('')

  const id = Number(cpdId)

  async function loadDevices() {
    const devs = await api.getCPDDevices(id)
    const cutoff = new Date(Date.now() - 5 * 60 * 1000)
    setDevices(devs.map((d: Device) => ({
      ...d,
      status: d.last_seen_at && new Date(d.last_seen_at) > cutoff ? 'online' : 'offline',
    })))
  }

  useEffect(() => {
    Promise.all([
      api.getCPD(id),
      loadDevices(),
    ]).then(([l]) => {
      setLocal(l)
      setWDelta(l.severity_warning_delta?.toString() ?? '')
      setCDelta(l.severity_critical_delta?.toString() ?? '')
    }).finally(() => setLoading(false))
  }, [id])

  async function deleteDevice(deviceId: number) {
    if (!confirm('Remover este sensor?')) return
    await api.deleteDevice(deviceId)
    setDevices(prev => prev.filter(d => d.id !== deviceId))
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Carregando...</div>
  if (!local) return <div className="text-center py-16 text-gray-400">Local não encontrado</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/clients/${clientId}`)}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">{local.name}</h1>
          {local.location && (
            <div className="flex items-center gap-1.5 text-gray-400 text-sm mt-0.5">
              <MapPin className="w-3.5 h-3.5" />{local.location}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 w-fit">
        {([
          { key: 'sensores',      label: 'Sensores' },
          { key: 'configuracoes', label: 'Configurações', icon: Settings },
        ] as { key: Tab; label: string; icon?: any }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.icon && <t.icon className="w-3.5 h-3.5" />}
            {t.label}
            {t.key === 'sensores' && (
              <span className="text-xs bg-white/10 rounded-full px-1.5">{devices.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'sensores' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Sensores</h2>
            <button
              onClick={() => setShowProvision(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Provisionar sensor
            </button>
          </div>
          {devices.length === 0 ? (
            <div className="text-center py-12 text-gray-500">Nenhum sensor cadastrado</div>
          ) : (
            <div className="space-y-2">
              {devices.map(d => {
                const isOnline = d.status === 'online'
                const lastSeen = d.last_seen_at
                  ? format(new Date(d.last_seen_at), 'dd/MM HH:mm', { locale: ptBR })
                  : '—'
                return (
                  <div key={d.id} className="flex items-center bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl overflow-hidden transition-colors">
                    <button
                      onClick={() => navigate(`/clients/${clientId}/cpds/${cpdId}/devices/${d.id}`)}
                      className="flex-1 flex items-center gap-4 px-5 py-4 text-left"
                    >
                      <div className={`p-2.5 rounded-lg ${isOnline ? 'bg-green-500/10' : 'bg-gray-800'}`}>
                        <Server className={`w-5 h-5 ${isOnline ? 'text-green-400' : 'text-gray-500'}`} />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-white">{d.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5 font-mono">{d.mqtt_client_id}</p>
                      </div>
                      <div className="text-right mr-2">
                        <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${
                          isOnline ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                        }`}>
                          {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                          {isOnline ? 'Online' : 'Offline'}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">{lastSeen}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => deleteDevice(d.id)}
                      className="p-4 hover:bg-red-500/10 text-gray-600 hover:text-red-400 transition-colors border-l border-gray-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'configuracoes' && (
        <form onSubmit={async e => {
          e.preventDefault()
          setCfgSaving(true)
          try {
            await api.updateCPD(id, {
              severity_warning_delta:  wDelta !== '' ? Number(wDelta) : null,
              severity_critical_delta: cDelta !== '' ? Number(cDelta) : null,
            })
          } finally { setCfgSaving(false) }
        }} className="space-y-5 max-w-lg">

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Sensibilidade de alertas</h3>
              <p className="text-xs text-gray-500 mt-1">
                Desvio mínimo acima do limite para classificar o alerta.<br />
                Vazio = padrão do sistema (warning: 2°/%, critical: 5°/%).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">⚠️ Warning a partir de</label>
                <div className="flex items-center gap-2">
                  <input type="number" step="0.1" value={wDelta} onChange={e => setWDelta(e.target.value)}
                    placeholder="2.0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
                  <span className="text-xs text-gray-500 whitespace-nowrap">° / %</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">🔴 Critical a partir de</label>
                <div className="flex items-center gap-2">
                  <input type="number" step="0.1" value={cDelta} onChange={e => setCDelta(e.target.value)}
                    placeholder="5.0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
                  <span className="text-xs text-gray-500 whitespace-nowrap">° / %</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={cfgSaving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {cfgSaving ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </form>
      )}

      {showProvision && (
        <ProvisionModal
          localId={id}
          onClose={() => setShowProvision(false)}
          onCreated={loadDevices}
        />
      )}
    </div>
  )
}
