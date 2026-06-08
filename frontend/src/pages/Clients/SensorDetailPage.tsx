import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Wifi, WifiOff, AlertTriangle, Activity, Settings
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api } from '../../services/api'
import type { Device, AlertEvent } from '../../types'

type Tab = 'leituras' | 'alertas' | 'configuracoes'

function severityBadge(severity: string) {
  return severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'
}

export default function SensorDetailPage() {
  const { clientId, cpdId, deviceId } = useParams<{ clientId: string; cpdId: string; deviceId: string }>()
  const navigate = useNavigate()
  const [device, setDevice] = useState<Device | null>(null)
  const [readings, setReadings] = useState<any[]>([])
  const [alerts, setAlerts] = useState<AlertEvent[]>([])
  const [tab, setTab] = useState<Tab>('leituras')
  const [loading, setLoading] = useState(true)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgName, setCfgName] = useState('')
  const [cfg, setCfg] = useState({
    temp_max: '' as string | number, temp_min: '' as string | number,
    humidity_max: '' as string | number, humidity_min: '' as string | number,
  })

  const id = Number(deviceId)

  useEffect(() => {
    Promise.all([
      api.getCPDDevices(Number(cpdId)).then(devs => {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000)
        const d = devs.find((d: Device) => d.id === id)
        if (d) {
          const enriched = { ...d, status: d.last_seen_at && new Date(d.last_seen_at) > cutoff ? 'online' : 'offline' }
          setDevice(enriched)
          setCfgName(d.name)
          setCfg({
            temp_max: d.temp_max ?? '',
            temp_min: d.temp_min ?? '',
            humidity_max: d.humidity_max ?? '',
            humidity_min: d.humidity_min ?? '',
          })
        }
      }),
      api.getDeviceReadings(id, 60).then(setReadings),
    ]).finally(() => setLoading(false))
  }, [id, cpdId])

  useEffect(() => {
    if (tab === 'alertas' && alerts.length === 0) {
      api.getDeviceAlerts(id, 50).then(setAlerts)
    }
  }, [tab])

  async function saveCfg(e: React.FormEvent) {
    e.preventDefault()
    setCfgSaving(true)
    try {
      const payload: any = {}
      if (cfgName.trim()) payload.name = cfgName.trim()
      if (cfg.temp_max !== '')     payload.temp_max     = Number(cfg.temp_max)
      if (cfg.temp_min !== '')     payload.temp_min     = Number(cfg.temp_min)
      if (cfg.humidity_max !== '') payload.humidity_max = Number(cfg.humidity_max)
      if (cfg.humidity_min !== '') payload.humidity_min = Number(cfg.humidity_min)
      await api.updateDevice(id, payload)
      setDevice(d => d ? { ...d, ...payload } : d)
    } finally { setCfgSaving(false) }
  }

  const chartData = readings.map(r => ({
    time: format(new Date(r._time || r.time), 'HH:mm', { locale: ptBR }),
    Temperatura: r.temperature != null ? +parseFloat(r.temperature).toFixed(1) : null,
    Umidade: r.humidity != null ? +parseFloat(r.humidity).toFixed(1) : null,
  }))

  if (loading) return <div className="text-center py-16 text-gray-500">Carregando...</div>
  if (!device) return <div className="text-center py-16 text-gray-400">Sensor não encontrado</div>

  const isOnline = device.status === 'online'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/clients/${clientId}/cpds/${cpdId}`)}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{device.name}</h1>
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${
              isOnline ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{device.mqtt_client_id}</p>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 w-fit">
        {([
          { key: 'leituras',      label: 'Leituras' },
          { key: 'alertas',       label: 'Alertas' },
          { key: 'configuracoes', label: 'Configurações', icon: Settings },
        ] as { key: Tab; label: string; icon?: any }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}>
            {t.icon && <t.icon className="w-3.5 h-3.5" />}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'leituras' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Leituras (últimas 60 min)</h2>
          {readings.length === 0 ? (
            <div className="text-center py-16 text-gray-500 flex flex-col items-center gap-2">
              <Activity className="w-8 h-8 text-gray-700" />
              Sem leituras registradas
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#9ca3af' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="Temperatura" stroke="#60a5fa" dot={false} strokeWidth={2} unit="°C" />
                  <Line type="monotone" dataKey="Umidade" stroke="#2dd4bf" dot={false} strokeWidth={2} unit="%" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {tab === 'alertas' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Alertas</h2>
          {alerts.length === 0 ? (
            <div className="text-center py-12 text-gray-500 flex flex-col items-center gap-2">
              <AlertTriangle className="w-8 h-8 text-gray-700" />
              Nenhum alerta
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map(a => (
                <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${severityBadge(a.severity)}`}>
                          {a.severity}
                        </span>
                        <span className="text-xs text-gray-500">{a.alert_type}</span>
                      </div>
                      <p className="text-sm text-white">{a.message}</p>
                      {a.value != null && (
                        <p className="text-xs text-gray-500 mt-1">Valor: {a.value} · Limite: {a.threshold}</p>
                      )}
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-xs text-gray-500">
                        {format(new Date(a.triggered_at), 'dd/MM HH:mm', { locale: ptBR })}
                      </p>
                      {!a.resolved_at
                        ? <span className="text-xs text-red-400">Aberto</span>
                        : <span className="text-xs text-green-500">Resolvido</span>
                      }
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'configuracoes' && (
        <form onSubmit={saveCfg} className="space-y-5 max-w-lg">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Identificação</h3>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Nome</label>
              <input
                type="text"
                value={cfgName}
                onChange={e => setCfgName(e.target.value)}
                placeholder="ex: Sensor Rack A"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Limites de temperatura</h3>
              <p className="text-xs text-gray-500 mt-0.5">Define quando alertas são disparados para este sensor</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['temp_max', 'temp_min'] as const).map(k => (
                <div key={k}>
                  <label className="text-xs text-gray-400 block mb-1">{k === 'temp_max' ? 'Máximo' : 'Mínimo'}</label>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.1" value={cfg[k]} placeholder="—"
                      onChange={e => setCfg(c => ({ ...c, [k]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
                    <span className="text-xs text-gray-500">°C</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Limites de umidade</h3>
              <p className="text-xs text-gray-500 mt-0.5">Define quando alertas são disparados para este sensor</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['humidity_max', 'humidity_min'] as const).map(k => (
                <div key={k}>
                  <label className="text-xs text-gray-400 block mb-1">{k === 'humidity_max' ? 'Máximo' : 'Mínimo'}</label>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.1" value={cfg[k]} placeholder="—"
                      onChange={e => setCfg(c => ({ ...c, [k]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
                    <span className="text-xs text-gray-500">%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={cfgSaving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {cfgSaving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
