import { useEffect, useRef, useState } from 'react'
import { Upload, Cpu, RefreshCw, CheckCircle, AlertTriangle, Wifi, WifiOff, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api } from '../../services/api'

interface DeviceStatus {
  id: number
  device_name: string
  firmware_version?: string
  cpd_name: string
  client_name: string
  published: boolean
  version?: string
  md5?: string
  notes?: string
  uploaded_at?: string
  size?: number
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function Msg({ msg }: { msg: { type: 'ok' | 'err'; text: string } }) {
  return (
    <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
      msg.type === 'ok'
        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
        : 'bg-red-500/10 border border-red-500/20 text-red-400'
    }`}>
      {msg.type === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
      {msg.text}
    </div>
  )
}

export default function FirmwarePage() {
  const [devices, setDevices] = useState<DeviceStatus[]>([])
  const [loading, setLoading] = useState(true)

  // upload
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | ''>('')
  const [file, setFile] = useState<File | null>(null)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // trigger
  const [triggerDeviceId, setTriggerDeviceId] = useState<number | null>(null)
  const [triggerMsg, setTriggerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function loadData() {
    const devs = await api.getFirmwareStatus()
    setDevices(devs)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !version.trim() || selectedDeviceId === '') return
    setUploading(true)
    setUploadMsg(null)
    try {
      const fd = new FormData()
      fd.append('bin', file)
      fd.append('version', version.trim())
      fd.append('device_id', String(selectedDeviceId))
      if (notes.trim()) fd.append('notes', notes.trim())
      const res = await api.uploadFirmware(fd)
      setUploadMsg({ type: 'ok', text: `Firmware v${res.version} publicado para o device (${formatBytes(res.size)})` })
      setFile(null)
      setVersion('')
      setNotes('')
      setSelectedDeviceId('')
      if (fileRef.current) fileRef.current.value = ''
      await loadData()
    } catch (err: any) {
      setUploadMsg({ type: 'err', text: err.message })
    } finally {
      setUploading(false)
    }
  }

  async function handleTrigger(device: DeviceStatus) {
    if (!confirm(`Enviar comando de atualização para "${device.device_name}"?`)) return
    setTriggerDeviceId(device.id)
    setTriggerMsg(null)
    try {
      const res = await api.triggerFirmwareUpdate([device.id])
      setTriggerMsg({
        type: res.sent > 0 ? 'ok' : 'err',
        text: res.sent > 0
          ? `Comando enviado para ${device.device_name}.`
          : `${device.device_name} está offline — o comando será entregue quando voltar.`,
      })
    } catch (err: any) {
      setTriggerMsg({ type: 'err', text: err.message })
    } finally {
      setTriggerDeviceId(null)
    }
  }

  const publishedDevices = devices.filter(d => d.published)
  const unpublishedDevices = devices.filter(d => !d.published)

  if (loading) return <div className="text-center py-16 text-gray-500">Carregando...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Firmware OTA</h1>
        <p className="text-sm text-gray-400 mt-1">Publique um firmware por dispositivo e dispare a atualização remota.</p>
      </div>

      {/* Upload */}
      <form onSubmit={handleUpload} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Upload className="w-4 h-4 text-blue-400" /> Publicar firmware
        </h2>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Dispositivo</label>
          <select
            value={selectedDeviceId}
            onChange={e => setSelectedDeviceId(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Selecione o dispositivo...</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.device_name} — {d.client_name} / {d.cpd_name}
                {d.published ? ` (publicado: v${d.version})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Arquivo .bin</label>
          <input
            ref={fileRef}
            type="file"
            accept=".bin"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-400
              file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
              file:bg-gray-700 file:text-white file:text-sm file:font-medium
              hover:file:bg-gray-600 cursor-pointer"
          />
          {file && <p className="text-xs text-gray-500 mt-1">{file.name} — {formatBytes(file.size)}</p>}
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Versão (ex: 1.2.0)</label>
          <input
            value={version}
            onChange={e => setVersion(e.target.value)}
            placeholder="1.2.0"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Notas (opcional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Resumo das mudanças..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>

        {uploadMsg && <Msg msg={uploadMsg} />}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={uploading || !file || !version.trim() || selectedDeviceId === ''}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Publicando...' : 'Publicar firmware'}
          </button>
        </div>
      </form>

      {/* Lista de devices com firmware publicado */}
      {publishedDevices.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-400" /> Firmware publicado por dispositivo
          </h2>

          {triggerMsg && <Msg msg={triggerMsg} />}

          <div className="space-y-2">
            {publishedDevices.map(d => (
              <div key={d.id} className="flex items-start gap-4 bg-gray-800 rounded-xl px-4 py-3">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm text-white font-medium">{d.device_name}</p>
                  <p className="text-xs text-gray-500">{d.client_name} · {d.cpd_name}</p>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-xs font-mono text-blue-400">v{d.version}</span>
                    {d.firmware_version && d.firmware_version !== d.version && (
                      <span className="text-xs text-yellow-400">rodando: v{d.firmware_version}</span>
                    )}
                    {d.firmware_version && d.firmware_version === d.version && (
                      <span className="text-xs text-green-400">atualizado</span>
                    )}
                    {d.size && <span className="text-xs text-gray-500">{formatBytes(d.size)}</span>}
                    {d.uploaded_at && (
                      <span className="text-xs text-gray-500">
                        {format(new Date(d.uploaded_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                      </span>
                    )}
                  </div>
                  {d.notes && <p className="text-xs text-gray-400 mt-1">{d.notes}</p>}
                </div>
                <button
                  onClick={() => handleTrigger(d)}
                  disabled={triggerDeviceId === d.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${triggerDeviceId === d.id ? 'animate-spin' : ''}`} />
                  Atualizar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Devices sem firmware publicado */}
      {unpublishedDevices.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Sem firmware publicado
          </h2>
          <div className="space-y-1">
            {unpublishedDevices.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-gray-700 shrink-0" />
                <span className="text-sm text-gray-500">{d.device_name}</span>
                <span className="text-xs text-gray-600">{d.client_name} · {d.cpd_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
