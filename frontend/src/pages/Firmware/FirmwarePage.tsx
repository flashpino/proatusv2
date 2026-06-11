import { useEffect, useRef, useState } from 'react'
import { Upload, Cpu, RefreshCw, CheckCircle, AlertTriangle, Wifi, WifiOff } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { api } from '../../services/api'

interface FirmwareStatus {
  published: boolean
  version?: string
  file?: string
  md5?: string
  notes?: string
  uploaded_at?: string
  size?: number
}

interface DeviceRow {
  id: number
  name: string
  mqtt_client_id: string
  firmware_version?: string
  last_seen_at?: string
  cpd_name: string
  client_name: string
  status?: 'online' | 'offline'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function FirmwarePage() {
  const [status, setStatus] = useState<FirmwareStatus | null>(null)
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState(true)

  const [file, setFile] = useState<File | null>(null)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function loadData() {
    const [s, devs] = await Promise.all([
      api.getFirmwareStatus(),
      api.getDevices(),
    ])
    setStatus(s)
    const cutoff = Date.now() - 5 * 60 * 1000
    setDevices(devs.map((d: any) => ({
      ...d,
      status: d.last_seen_at && new Date(d.last_seen_at).getTime() > cutoff ? 'online' : 'offline',
    })))
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  function toggleDevice(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev => prev.size === devices.length ? new Set() : new Set(devices.map(d => d.id)))
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !version.trim()) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const fd = new FormData()
      fd.append('bin', file)
      fd.append('version', version.trim())
      if (notes.trim()) fd.append('notes', notes.trim())
      const res = await api.uploadFirmware(fd)
      setUploadMsg({ type: 'ok', text: `Firmware v${res.version} publicado (${formatBytes(res.size)})` })
      setFile(null)
      setVersion('')
      setNotes('')
      if (fileRef.current) fileRef.current.value = ''
      await loadData()
    } catch (err: any) {
      setUploadMsg({ type: 'err', text: err.message })
    } finally {
      setUploading(false)
    }
  }

  async function handleTrigger() {
    if (selected.size === 0) return
    const names = devices.filter(d => selected.has(d.id)).map(d => d.name).join(', ')
    if (!confirm(`Enviar comando de atualização para:\n${names}`)) return
    setTriggering(true)
    setTriggerMsg(null)
    try {
      const res = await api.triggerFirmwareUpdate(Array.from(selected))
      setTriggerMsg({
        type: 'ok',
        text: `Comando enviado para ${res.sent} de ${res.total} dispositivo(s).`,
      })
    } catch (err: any) {
      setTriggerMsg({ type: 'err', text: err.message })
    } finally {
      setTriggering(false)
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Carregando...</div>

  const allSelected = selected.size === devices.length && devices.length > 0

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Firmware OTA</h1>
        <p className="text-sm text-gray-400 mt-1">Publicar firmware e disparar atualização por dispositivo.</p>
      </div>

      {/* Versão atual */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Cpu className="w-4 h-4 text-blue-400" /> Versão publicada
        </h2>
        {status?.published ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500 text-xs block">Versão</span>
              <span className="text-white font-mono font-medium">{status.version}</span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">Tamanho</span>
              <span className="text-white">{status.size ? formatBytes(status.size) : '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">MD5</span>
              <span className="text-gray-400 font-mono text-xs break-all">{status.md5 ?? '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">Publicado em</span>
              <span className="text-white text-xs">
                {status.uploaded_at
                  ? format(new Date(status.uploaded_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                  : '—'}
              </span>
            </div>
            {status.notes && (
              <div className="col-span-2">
                <span className="text-gray-500 text-xs block">Notas</span>
                <span className="text-gray-300 text-sm">{status.notes}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Nenhum firmware publicado ainda.</p>
        )}
      </div>

      {/* Upload */}
      <form onSubmit={handleUpload} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Upload className="w-4 h-4 text-blue-400" /> Publicar novo firmware
        </h2>
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
        {uploadMsg && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
            uploadMsg.type === 'ok'
              ? 'bg-green-500/10 border border-green-500/20 text-green-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            {uploadMsg.type === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {uploadMsg.text}
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={uploading || !file || !version.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Enviando...' : 'Publicar firmware'}
          </button>
        </div>
      </form>

      {/* Selecionar devices e disparar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-blue-400" /> Disparar atualização
        </h2>
        <p className="text-xs text-gray-500">
          Selecione os dispositivos e clique em disparar. Cada device verifica o manifest e
          atualiza se a versão for diferente da que está rodando.
        </p>

        {devices.length === 0 ? (
          <p className="text-gray-500 text-sm">Nenhum dispositivo ativo.</p>
        ) : (
          <>
            {/* cabeçalho com select all */}
            <div className="flex items-center gap-3 pb-2 border-b border-gray-800">
              <input
                type="checkbox"
                id="select-all"
                checked={allSelected}
                onChange={toggleAll}
                className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
              />
              <label htmlFor="select-all" className="text-xs text-gray-400 cursor-pointer select-none">
                Selecionar todos ({devices.length})
              </label>
              {selected.size > 0 && (
                <span className="ml-auto text-xs text-blue-400">{selected.size} selecionado(s)</span>
              )}
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {devices.map(d => {
                const isOnline = d.status === 'online'
                return (
                  <label
                    key={d.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      selected.has(d.id) ? 'bg-blue-600/10 border border-blue-500/30' : 'hover:bg-gray-800 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggleDevice(d.id)}
                      className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
                    />
                    <div className={`p-1.5 rounded-md ${isOnline ? 'bg-green-500/10' : 'bg-gray-800'}`}>
                      {isOnline
                        ? <Wifi className="w-3.5 h-3.5 text-green-400" />
                        : <WifiOff className="w-3.5 h-3.5 text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{d.name}</p>
                      <p className="text-xs text-gray-500 truncate">{d.client_name} · {d.cpd_name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {d.firmware_version && (
                        <span className="text-xs font-mono text-gray-400">v{d.firmware_version}</span>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </>
        )}

        {triggerMsg && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
            triggerMsg.type === 'ok'
              ? 'bg-green-500/10 border border-green-500/20 text-green-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            {triggerMsg.type === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {triggerMsg.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleTrigger}
            disabled={triggering || selected.size === 0 || !status?.published}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${triggering ? 'animate-spin' : ''}`} />
            {triggering ? 'Enviando...' : `Atualizar ${selected.size > 0 ? `${selected.size} ` : ''}dispositivo(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
