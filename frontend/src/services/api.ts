const BASE = '/api'

function getToken() {
  return localStorage.getItem('cpd_token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (res.status === 401) {
    localStorage.removeItem('cpd_token')
    window.location.href = '/login'
    throw new Error('Sessão expirada')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Erro ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; role: string; client_id?: number }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  // Clients
  getClients: () => request<any[]>('/clients'),
  createClient: (data: any) => request<{ id: number }>('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id: number, data: any) => request<{ ok: boolean }>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id: number) => request<{ ok: boolean }>(`/clients/${id}`, { method: 'DELETE' }),

  // CPDs
  getCPDs: () => request<any[]>('/cpds'),
  getCPD: (id: number) => request<any>(`/cpds/${id}`),
  createCPD: (data: any) => request<{ id: number }>('/cpds', { method: 'POST', body: JSON.stringify(data) }),
  updateCPD: (id: number, data: any) => request<{ ok: boolean }>(`/cpds/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCPD: (id: number) => request<{ ok: boolean }>(`/cpds/${id}`, { method: 'DELETE' }),

  // Devices
  getDevices: () => request<any[]>('/devices'),
  getCPDDevices: (cpdId: number) => request<any[]>(`/cpds/${cpdId}/devices`),
  createDevice: (cpdId: number, data: any) => request<any>(`/cpds/${cpdId}/devices`, { method: 'POST', body: JSON.stringify(data) }),
  updateDevice: (id: number, data: any) => request<{ ok: boolean }>(`/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDevice: (id: number) => request<{ ok: boolean }>(`/devices/${id}`, { method: 'DELETE' }),

  // Contacts
  getContacts: (clientId?: number) => request<any[]>(`/contacts${clientId ? `?client_id=${clientId}` : ''}`),
  createContact: (data: any) => request<{ id: number }>('/contacts', { method: 'POST', body: JSON.stringify(data) }),
  updateContact: (id: number, data: any) => request<{ ok: boolean }>(`/contacts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteContact: (id: number) => request<{ ok: boolean }>(`/contacts/${id}`, { method: 'DELETE' }),

  // Readings & Alerts
  getCPDReadings: (cpdId: number, limit = 60) => request<any[]>(`/cpds/${cpdId}/readings?limit=${limit}`),
  getCPDAlerts: (cpdId: number, limit = 50) => request<any[]>(`/cpds/${cpdId}/alerts?limit=${limit}`),
  getDeviceReadings: (deviceId: number, limit = 60) => request<any[]>(`/devices/${deviceId}/readings?limit=${limit}`),
  getDeviceAlerts: (deviceId: number, limit = 50) => request<any[]>(`/devices/${deviceId}/alerts?limit=${limit}`),

  // Dashboard
  getStats: () => request<any>('/stats'),
  getTelemetry: () => request<any[]>('/telemetry'),
  getDashboard: () => request<any[]>('/dashboard'),
}
