import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ChevronRight, Building2, X } from 'lucide-react'
import { api } from '../../services/api'
import type { Client } from '../../types'

interface NewClientForm {
  name: string
  document: string
  email: string
  phone: string
  plan: string
}

const EMPTY_FORM: NewClientForm = { name: '', document: '', email: '', phone: '', plan: 'standard' }

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewClientForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api.getClients()
      .then(setClients)
      .finally(() => setLoading(false))
  }, [])

  function openModal() {
    setForm(EMPTY_FORM)
    setError('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Nome é obrigatório'); return }
    setSaving(true)
    setError('')
    try {
      const { id } = await api.createClient({
        name: form.name.trim(),
        document: form.document.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        plan: form.plan,
      })
      const updated = await api.getClients()
      setClients(updated)
      setShowModal(false)
      navigate(`/clients/${id}`)
    } catch (err: any) {
      setError(err.message || 'Erro ao criar cliente')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clientes</h1>
          <p className="text-gray-400 text-sm mt-1">{clients.length} clientes cadastrados</p>
        </div>
        <button
          onClick={openModal}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Cliente
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500">Carregando...</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-16 text-gray-500">Nenhum cliente cadastrado</div>
      ) : (
        <div className="space-y-2">
          {clients.map(client => (
            <button
              key={client.id}
              onClick={() => navigate(`/clients/${client.id}`)}
              className="w-full flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-5 py-4 transition-colors text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-gray-800 rounded-lg">
                  <Building2 className="w-5 h-5 text-gray-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">{client.name}</p>
                  <p className="text-sm text-gray-400 mt-0.5">{client.email || client.document || 'Sem contato'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  client.active
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-gray-700 text-gray-400'
                }`}>
                  {client.active ? 'Ativo' : 'Inativo'}
                </span>
                <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-400 font-medium capitalize">
                  {client.plan}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>
            </button>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">Novo Cliente</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome da empresa"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">CNPJ / CPF</label>
                <input
                  type="text"
                  value={form.document}
                  onChange={e => setForm(f => ({ ...f, document: e.target.value }))}
                  placeholder="00.000.000/0001-00"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">E-mail</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="contato@empresa.com"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="(11) 99999-9999"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Plano</label>
                <select
                  value={form.plan}
                  onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {saving ? 'Salvando…' : 'Criar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
