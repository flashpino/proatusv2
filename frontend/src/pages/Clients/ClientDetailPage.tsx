import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, MapPin, Users, Plus, ChevronRight, Server, Phone, Mail } from 'lucide-react'
import { api } from '../../services/api'
import type { Client, CPD, Contact } from '../../types'

type Tab = 'locais' | 'contatos'

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client | null>(null)
  const [cpds, setCpds] = useState<CPD[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [tab, setTab] = useState<Tab>('locais')
  const [loading, setLoading] = useState(true)

  const id = Number(clientId)

  useEffect(() => {
    Promise.all([
      api.getClients().then(cs => cs.find((c: Client) => c.id === id) || null),
      api.getCPDs().then(cs => cs.filter((c: CPD) => c.client_id === id)),
      api.getContacts(id),
    ]).then(([c, cs, cts]) => {
      setClient(c)
      setCpds(cs)
      setContacts(cts)
    }).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-center py-16 text-gray-500">Carregando...</div>
  if (!client) return <div className="text-center py-16 text-gray-400">Cliente não encontrado</div>

  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'locais',   label: 'Locais',   icon: MapPin, count: cpds.length },
    { key: 'contatos', label: 'Contatos', icon: Users,  count: contacts.length },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/clients')} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">{client.name}</h1>
          <p className="text-gray-400 text-sm mt-0.5 capitalize">{client.plan} · {client.active ? 'Ativo' : 'Inativo'}</p>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}>
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.count !== undefined && (
              <span className="text-xs bg-white/10 rounded-full px-1.5">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'locais' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Locais</h2>
            <button onClick={() => navigate(`/clients/${id}/cpds/new`)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> Novo Local
            </button>
          </div>
          {cpds.length === 0 ? (
            <div className="text-center py-12 text-gray-500">Nenhum local cadastrado</div>
          ) : (
            <div className="space-y-2">
              {cpds.map(cpd => (
                <button key={cpd.id} onClick={() => navigate(`/clients/${id}/cpds/${cpd.id}`)}
                  className="w-full flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-5 py-4 transition-colors text-left">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-gray-800 rounded-lg">
                      <Server className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{cpd.name}</p>
                      <p className="text-sm text-gray-400 mt-0.5">{cpd.location || 'Sem localização'}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'contatos' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Contatos</h2>
            <button onClick={() => navigate(`/clients/${id}/contacts/new`)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> Novo Contato
            </button>
          </div>
          {contacts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">Nenhum contato cadastrado</div>
          ) : (
            <div className="space-y-2">
              {contacts.map(contact => (
                <button key={contact.id} onClick={() => navigate(`/clients/${id}/contacts/${contact.id}`)}
                  className="w-full flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-5 py-4 transition-colors text-left">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-gray-800 rounded-lg">
                      <Users className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{contact.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {contact.whatsapp && <span className="text-xs text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />{contact.whatsapp}</span>}
                        {contact.email && <span className="text-xs text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{contact.subscriptions?.length || 0} inscrições</span>
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
