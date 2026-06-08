import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ChevronRight, Building2 } from 'lucide-react'
import { api } from '../../services/api'
import type { Client } from '../../types'

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    api.getClients()
      .then(setClients)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clientes</h1>
          <p className="text-gray-400 text-sm mt-1">{clients.length} clientes cadastrados</p>
        </div>
        <button
          onClick={() => navigate('/clients/new')}
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
    </div>
  )
}
