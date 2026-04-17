/**
 * useInactivityTimeout
 *
 * Encerra a sessão do usuário após um período de inatividade.
 * Exibe um aviso antes do logout automático.
 *
 * Eventos monitorados: mousemove, mousedown, keydown, touchstart, scroll, click
 *
 * Fluxo:
 *   0s ──── atividade ──── 9min ──── aviso ──── 10min ──── logout automático
 */
import { useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000   // 10 minutos
const WARNING_BEFORE_MS     = 1 * 60 * 1000    // aviso 1 minuto antes (aos 9 min)

// ID do toast de aviso — para poder dispensá-lo ao detectar atividade
const WARNING_TOAST_ID = 'inactivity-warning'

export function useInactivityTimeout() {
  const { isAuthenticated, logout } = useAuthStore()
  const logoutTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnedRef       = useRef(false)
  // Controle para evitar múltiplos logouts simultâneos
  const isLoggingOutRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    logoutTimerRef.current  = null
    warningTimerRef.current = null
  }, [])

  const doLogout = useCallback(() => {
    if (isLoggingOutRef.current) return
    isLoggingOutRef.current = true

    toast.dismiss(WARNING_TOAST_ID)

    // Limpar estado de autenticação
    logout()

    // Limpar sessionStorage explicitamente para garantir estado limpo
    sessionStorage.removeItem('access_token')
    sessionStorage.removeItem('refresh_token')
    sessionStorage.removeItem('br10-auth')

    // Exibir mensagem antes de redirecionar
    toast('Sessão encerrada por inatividade.', {
      id: 'inactivity-logout',
      duration: 3000,
      icon: '⏱️',
      style: {
        background: '#1e3a5f',
        color: '#bfdbfe',
        border: '1px solid #3b82f6',
        borderRadius: '0.75rem',
        fontSize: '0.875rem',
      },
    })

    setTimeout(() => {
      isLoggingOutRef.current = false
      window.location.href = '/login'
    }, 1200)
  }, [logout])

  const resetTimers = useCallback(() => {
    if (!isAuthenticated) return

    clearTimers()

    // Dispensar aviso se o usuário voltou a interagir
    if (warnedRef.current) {
      toast.dismiss(WARNING_TOAST_ID)
      warnedRef.current = false
    }

    // Agendar aviso (aos 9 minutos)
    warningTimerRef.current = setTimeout(() => {
      warnedRef.current = true
      toast(
        `Sua sessão expirará em 1 minuto por inatividade. ` +
        `Mova o mouse ou pressione qualquer tecla para continuar.`,
        {
          id: WARNING_TOAST_ID,
          duration: WARNING_BEFORE_MS,
          icon: '⚠️',
          style: {
            background: '#92400e',
            color: '#fef3c7',
            border: '1px solid #d97706',
            borderRadius: '0.75rem',
            fontSize: '0.875rem',
            maxWidth: '420px',
          },
        }
      )
    }, INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_MS)

    // Agendar logout (aos 10 minutos)
    logoutTimerRef.current = setTimeout(() => {
      doLogout()
    }, INACTIVITY_TIMEOUT_MS)
  }, [isAuthenticated, clearTimers, doLogout])

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimers()
      warnedRef.current = false
      return
    }

    const EVENTS = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
      'click',
    ] as const

    // Throttle: resetar no máximo 1x por segundo para não sobrecarregar
    let throttleHandle: ReturnType<typeof setTimeout> | null = null
    const handleActivity = () => {
      if (throttleHandle) return
      throttleHandle = setTimeout(() => {
        throttleHandle = null
        resetTimers()
      }, 1000)
    }

    EVENTS.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }))

    // Iniciar timers imediatamente
    resetTimers()

    return () => {
      EVENTS.forEach((ev) => window.removeEventListener(ev, handleActivity))
      if (throttleHandle) clearTimeout(throttleHandle)
      clearTimers()
      toast.dismiss(WARNING_TOAST_ID)
    }
  }, [isAuthenticated, resetTimers, clearTimers])
}
