import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Wifi, WifiOff, AlertTriangle, Activity, Radio, Clock } from 'lucide-react'
import { api } from '../../services/api'
import { useSSE } from '../../hooks/useSSE'
import type { TelemetryReading, DashboardStats } from '../../types'

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{label}</p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  )
}

function rssiStrength(rssi: number | null | undefined): { bars: number; color: string; label: string } {
  if (rssi == null) return { bars: 0, color: 'text-gray-600', label: '—' }
  if (rssi >= -50)  return { bars: 4, color: 'text-green-400',  label: 'Ótimo' }
  if (rssi >= -60)  return { bars: 3, color: 'text-green-400',  label: 'Bom' }
  if (rssi >= -70)  return { bars: 2, color: 'text-yellow-400', label: 'Regular' }
  return              { bars: 1, color: 'text-red-400',    label: 'Fraco' }
}

function WifiSignal({ rssi }: { rssi: number | null | undefined }) {
  const { bars, color, label } = rssiStrength(rssi)
  return (
    <div className={`flex items-end gap-0.5 ${color}`} title={rssi != null ? `${rssi} dBm — ${label}` : 'Sem dados de sinal'}>
      {[1, 2, 3, 4].map(b => (
        <div key={b} className={`w-1 rounded-sm transition-all ${b <= bars ? 'opacity-100' : 'opacity-20'}`}
          style={{ height: `${b * 3 + 3}px`, backgroundColor: 'currentColor' }} />
      ))}
    </div>
  )
}

function formatUptime(connectedSince: string | null | undefined): string {
  if (!connectedSince) return '—'
  const secs = Math.floor((Date.now() - new Date(connectedSince).getTime()) / 1000)
  if (secs < 60)  return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}min`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}min`
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`
}

function SensorCard({ device, onClick }: { device: TelemetryReading; onClick: () => void }) {
  const isOnline = device.status === 'online'
  const tempOk = device.temperature != null &&
    device.temperature >= device.temp_min &&
    device.temperature <= device.temp_max
  const humOk = device.humidity != null &&
    device.humidity >= device.humidity_min &&
    device.humidity <= device.humidity_max

  return (
    <div
      onClick={onClick}
      className={`bg-gray-900 border rounded-xl p-5 cursor-pointer hover:border-gray-600 transition-colors ${isOnline ? 'border-gray-800' : 'border-red-800/50'}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white truncate">{device.cpd_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{device.client_name}</p>
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {isOnline && <WifiSignal rssi={device.rssi} />}
          <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${
            isOnline ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={`rounded-lg p-3 ${tempOk ? 'bg-blue-500/10' : 'bg-orange-500/10'}`}>
          <p className="text-xs text-gray-400 mb-1">Temperatura</p>
          <p className={`text-2xl font-bold ${tempOk ? 'text-blue-400' : 'text-orange-400'}`}>
            {device.temperature != null ? `${device.temperature.toFixed(1)}°C` : '—'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {device.temp_min}° – {device.temp_max}°C
          </p>
        </div>
        <div className={`rounded-lg p-3 ${humOk ? 'bg-teal-500/10' : 'bg-orange-500/10'}`}>
          <p className="text-xs text-gray-400 mb-1">Umidade</p>
          <p className={`text-2xl font-bold ${humOk ? 'text-teal-400' : 'text-orange-400'}`}>
            {device.humidity != null ? `${device.humidity.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {device.humidity_min}% – {device.humidity_max}%
          </p>
        </div>
      </div>

      {isOnline && (
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          <span>Uptime: {formatUptime(device.connected_since)}</span>
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryReading[]>([])
  const [loading, setLoading] = useState(true)

  const { data: sseEvent, error: sseError } = useSSE<TelemetryReading>('/api/sse', 'telemetry')

  // Carga inicial via REST
  useEffect(() => {
    Promise.all([api.getStats(), api.getTelemetry()])
      .then(([s, t]) => { setStats(s); setTelemetry(t) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Atualiza o device específico quando chega evento SSE
  useEffect(() => {
    if (!sseEvent) return
    setTelemetry(prev => {
      const idx = prev.findIndex(d => d.id === sseEvent.id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], ...sseEvent }
      setStats(s => s ? {
        ...s,
        online_devices:  next.filter(d => d.status === 'online').length,
        offline_devices: next.filter(d => d.status === 'offline').length,
      } : s)
      return next
    })
  }, [sseEvent])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            {sseError
              ? <span className="text-orange-400">{sseError}</span>
              : <span className="flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-green-400" />Tempo real</span>
            }
          </p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Server} label="Total de Sensores" value={stats.total_devices} color="bg-blue-600" />
          <StatCard icon={Wifi} label="Online" value={stats.online_devices} color="bg-green-600" />
          <StatCard icon={WifiOff} label="Offline" value={stats.offline_devices} color="bg-red-600" />
          <StatCard icon={AlertTriangle} label="Alertas (7d)" value={stats.recent_alerts} color="bg-orange-600" />
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Sensores</h2>
        {telemetry.length === 0 ? (
          <div className="text-center py-16 text-gray-500">Nenhum sensor encontrado</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {telemetry.map(device => (
              <SensorCard
                key={device.id}
                device={device}
                onClick={() => navigate(`/clients/${device.client_id}/cpds/${device.cpd_id}/devices/${device.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
