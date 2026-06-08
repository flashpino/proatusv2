import { useEffect, useRef, useState } from 'react'

// Vite proxy drops long-lived SSE connections — connect directly to the backend in dev
const SSE_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api'

export function useSSE<T>(path: string, eventName = 'message', enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled) return

    const token = localStorage.getItem('cpd_token')
    const url = `${SSE_BASE}${path.replace(/^\/api/, '')}?token=${token}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setError(null)

    const handler = (e: MessageEvent) => {
      try {
        setData(JSON.parse(e.data))
        setError(null)
      } catch {
        setError('Erro ao parsear evento SSE')
      }
    }

    es.addEventListener(eventName, handler)

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setError('Conexão SSE encerrada')
      } else {
        setError('Conexão SSE perdida, reconectando...')
      }
    }

    return () => {
      es.removeEventListener(eventName, handler)
      es.close()
      esRef.current = null
    }
  }, [path, eventName, enabled])

  return { data, error }
}
