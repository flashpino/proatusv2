export interface Client {
  id: number
  name: string
  document?: string
  email?: string
  phone?: string
  plan: string
  active: boolean
  created_at: string
  default_temp_max: number
  default_temp_min: number
  default_humidity_max: number
  default_humidity_min: number
}

export interface CPD {
  id: number
  client_id: number
  client_name?: string
  name: string
  location?: string
  timezone: string
  active: boolean
  temp_max?: number | null
  temp_min?: number | null
  humidity_max?: number | null
  humidity_min?: number | null
  heartbeat_interval_sec: number
  heartbeat_timeout_sec: number
  severity_warning_delta?: number | null
  severity_critical_delta?: number | null
}

export interface Device {
  id: number
  cpd_id: number
  cpd_name?: string
  client_id?: number
  client_name?: string
  name: string
  mqtt_client_id: string
  firmware_version?: string
  active: boolean
  last_seen_at?: string
  status?: 'online' | 'offline'
  temperature?: number | null
  humidity?: number | null
  temp_max?: number | null
  temp_min?: number | null
  humidity_max?: number | null
  humidity_min?: number | null
  severity_warning_delta?: number | null
  severity_critical_delta?: number | null
}

export interface Contact {
  id: number
  client_id: number
  name: string
  whatsapp?: string
  email?: string
  active: boolean
  subscriptions: AlertSubscription[]
}

export interface AlertSubscription {
  id: number
  contact_id: number
  cpd_id?: number
  alert_type: string
  channel: 'whatsapp' | 'email' | 'call'
  time_from: string
  time_to: string
  weekdays_mask: number
  cooldown_minutes: number
  severity_min: 'warning' | 'critical'
  active: boolean
}

export interface AlertEvent {
  id: number
  alert_type: string
  severity: 'warning' | 'critical'
  value?: number
  threshold?: number
  message: string
  triggered_at: string
  resolved_at?: string
}

export interface TelemetryReading {
  id: number
  mqtt_client_id: string
  cpd_id: number
  cpd_name: string
  client_id: number
  client_name: string
  status: 'online' | 'offline'
  temperature: number | null
  humidity: number | null
  last_seen_at?: string
  rssi?: number | null
  connected_since?: string | null
  temp_max: number
  temp_min: number
  humidity_max: number
  humidity_min: number
}

export interface DashboardStats {
  total_clients: number
  total_devices: number
  online_devices: number
  offline_devices: number
  recent_alerts: number
}

export interface AuthUser {
  token: string
  role: 'superadmin' | 'admin' | 'viewer'
  client_id?: number
}
