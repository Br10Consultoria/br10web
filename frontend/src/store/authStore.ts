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
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  clearAuth: () => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

// Usa sessionStorage para que a sessão seja encerrada ao fechar o navegador.
// Combinado com o hook useInactivityTimeout (5 min sem atividade = logout automático).
const sessionStorageAdapter = {
  getItem: (name: string) => sessionStorage.getItem(name),
  setItem: (name: string, value: string) => sessionStorage.setItem(name, value),
  removeItem: (name: string) => sessionStorage.removeItem(name),
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) => {
        sessionStorage.setItem('access_token', accessToken)
        sessionStorage.setItem('refresh_token', refreshToken)
        // Limpar localStorage legado (migração silenciosa para usuários existentes)
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('br10-auth')
        set({ user, accessToken, refreshToken, isAuthenticated: true })
      },

      clearAuth: () => {
        sessionStorage.removeItem('access_token')
        sessionStorage.removeItem('refresh_token')
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
      },

      logout: () => {
        sessionStorage.removeItem('access_token')
        sessionStorage.removeItem('refresh_token')
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
      },

      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
    }),
    {
      name: 'br10-auth',
      storage: sessionStorageAdapter,
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
