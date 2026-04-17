import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: string
  username: string
  email: string
  full_name: string
  role: string
  totp_enabled: boolean
  avatar_url?: string
  last_login?: string | null
  last_login_ip?: string | null
  phone?: string | null
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  _hydrated: boolean
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  clearAuth: () => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
  setHydrated: () => void
}

// ─── CORREÇÃO PRINCIPAL ───────────────────────────────────────────────────────
//
// PROBLEMA ANTERIOR:
//   O store usava sessionStorage como backend de persistência.
//   sessionStorage é EXCLUSIVO por aba/janela e é DESTRUÍDO quando o navegador
//   fecha ou a aba é fechada. Ao reabrir o navegador, o sessionStorage está
//   completamente vazio — o store não encontra tokens, isAuthenticated=false,
//   mas o backend ainda tem o token válido. O interceptador do Axios tenta
//   renovar com um refreshToken que está null, falha silenciosamente e não
//   exibe erro porque o usuário está na tela de login (isAuthEndpoint=false
//   não se aplica, mas refreshToken é null então vai para triggerSessionExpired
//   que também não exibe nada pois já está em /login).
//
//   Resultado: tela de login em branco, sem mensagem, sem log de auditoria.
//   Reiniciar o container "resolve" porque limpa o estado corrompido do
//   processo uvicorn (event loop, conexões DB pendentes), não porque corrige
//   o problema de sessão em si.
//
// SOLUÇÃO:
//   1. Usar localStorage para persistir tokens entre sessões do navegador.
//      O logout explícito (botão sair, inatividade) limpa o localStorage.
//   2. Adicionar flag _hydrated para que o App.tsx aguarde a hidratação
//      do Zustand antes de redirecionar para /login, evitando flash de
//      redirecionamento em usuários já autenticados.
//   3. Manter limpeza do sessionStorage legado na migração.
//
// ─────────────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      _hydrated: false,

      setAuth: (user, accessToken, refreshToken) => {
        // Persistir tokens no localStorage (sobrevive ao fechar o navegador)
        localStorage.setItem('access_token', accessToken)
        localStorage.setItem('refresh_token', refreshToken)
        // Limpar sessionStorage legado
        sessionStorage.removeItem('access_token')
        sessionStorage.removeItem('refresh_token')
        sessionStorage.removeItem('br10-auth')
        set({ user, accessToken, refreshToken, isAuthenticated: true })
      },

      clearAuth: () => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        sessionStorage.removeItem('access_token')
        sessionStorage.removeItem('refresh_token')
        sessionStorage.removeItem('br10-auth')
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
      },

      logout: () => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        sessionStorage.removeItem('access_token')
        sessionStorage.removeItem('refresh_token')
        sessionStorage.removeItem('br10-auth')
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
      },

      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),

      setHydrated: () => set({ _hydrated: true }),
    }),
    {
      name: 'br10-auth',
      // localStorage: persiste entre sessões do navegador (fechar e reabrir)
      storage: {
        getItem: (name) => {
          const item = localStorage.getItem(name)
          return item ? JSON.parse(item) : null
        },
        setItem: (name, value) => localStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => localStorage.removeItem(name),
      },
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Chamado quando o Zustand termina de ler o localStorage
        // Sinaliza para o App.tsx que a hidratação está completa
        if (state) {
          state.setHydrated()
        }
      },
    }
  )
)
