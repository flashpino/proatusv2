import { useState } from 'react'
import type { AuthUser } from '../types'

function readUserFromStorage(): AuthUser | null {
  const token = localStorage.getItem('cpd_token')
  const role = localStorage.getItem('cpd_role') as AuthUser['role'] | null
  const client_id = localStorage.getItem('cpd_client_id')
  if (token && role) return { token, role, client_id: client_id ? Number(client_id) : undefined }
  return null
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(readUserFromStorage)

  function login(data: { token: string; role: string; client_id?: number }) {
    localStorage.setItem('cpd_token', data.token)
    localStorage.setItem('cpd_role', data.role)
    if (data.client_id) localStorage.setItem('cpd_client_id', String(data.client_id))
    setUser({ token: data.token, role: data.role as AuthUser['role'], client_id: data.client_id })
  }

  function logout() {
    localStorage.removeItem('cpd_token')
    localStorage.removeItem('cpd_role')
    localStorage.removeItem('cpd_client_id')
    setUser(null)
  }

  return { user, login, logout, isAuthenticated: !!user }
}
