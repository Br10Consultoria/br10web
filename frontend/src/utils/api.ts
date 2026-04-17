import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// ─── Controle de logout em andamento ─────────────────────────────────────────
let isLoggingOut = false

function triggerSessionExpired(reason: 'expired' | 'invalid' | 'no_token' = 'expired') {
  if (isLoggingOut) return
  isLoggingOut = true

  const { logout } = useAuthStore.getState()
  logout()

  const messages = {
    expired:   'Sua sessão expirou. Faça login novamente.',
    invalid:   'Token de sessão inválido. Faça login novamente.',
    no_token:  'Sessão não encontrada. Faça login para continuar.',
  }

  toast.error(messages[reason], {
    id: 'session-expired',
    duration: 5000,
    icon: '🔒',
    style: {
      background: '#7f1d1d',
      color: '#fee2e2',
      border: '1px solid #ef4444',
      borderRadius: '0.75rem',
    },
  })

  setTimeout(() => {
    isLoggingOut = false
    window.location.href = '/login'
  }, 1500)
}

// ─── Request interceptor ──────────────────────────────────────────────────────
// Lê token do store (pós-hidratação) ou diretamente do localStorage (pré-hidratação).
// Isso garante que chamadas feitas no mount via useEffect antes da hidratação
// do Zustand ainda enviem o token correto.
api.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState()
    // localStorage como fallback para pré-hidratação
    const token = accessToken || localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ─── Response interceptor — refresh token automático ─────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Não tentar refresh para o próprio endpoint de refresh ou login
    const isAuthEndpoint =
      originalRequest?.url?.includes('/auth/refresh') ||
      originalRequest?.url?.includes('/auth/login')

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true

      const { refreshToken, setAuth, user } = useAuthStore.getState()
      // Fallback para localStorage (pré-hidratação)
      const storedRefreshToken = refreshToken || localStorage.getItem('refresh_token')

      if (storedRefreshToken) {
        try {
          const response = await axios.post('/api/v1/auth/refresh', {
            refresh_token: storedRefreshToken,
          })

          const { access_token, refresh_token } = response.data

          // Atualizar store e localStorage
          if (user) {
            setAuth(user, access_token, refresh_token)
          } else {
            // Usuário não hidratado ainda — salvar direto no localStorage
            localStorage.setItem('access_token', access_token)
            localStorage.setItem('refresh_token', refresh_token)
          }

          originalRequest.headers.Authorization = `Bearer ${access_token}`
          return api(originalRequest)
        } catch (refreshError: any) {
          // Refresh falhou — sessão definitivamente expirada
          const status = refreshError?.response?.status
          triggerSessionExpired(status === 401 ? 'expired' : 'invalid')
        }
      } else {
        // Sem refresh token em lugar nenhum
        triggerSessionExpired('no_token')
      }
    }

    return Promise.reject(error)
  }
)

export default api

// API helpers
export const authApi = {
  login: (data: { username: string; password: string; totp_code?: string }) =>
    api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  setup2fa: () => api.post('/auth/2fa/setup'),
  verify2fa: (totp_code: string) => api.post('/auth/2fa/verify', { totp_code }),
  disable2fa: (totp_code: string) => api.post('/auth/2fa/disable', { totp_code }),
  changePassword: (data: { current_password: string; new_password: string; confirm_password: string }) =>
    api.post('/auth/change-password', data),
  getUsers: () => api.get('/auth/users'),
  createUser: (data: any) => api.post('/auth/users', data),
  updateUser: (id: string, data: any) => api.put(`/auth/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/auth/users/${id}`),
}

export const devicesApi = {
  list: (params?: any) => api.get('/devices', { params }),
  get: (id: string) => api.get(`/devices/${id}`),
  create: (data: any) => api.post('/devices', data),
  update: (id: string, data: any) => api.put(`/devices/${id}`, data),
  delete: (id: string) => api.delete(`/devices/${id}`),
  stats: () => api.get('/devices/stats'),

  // VLANs
  getVlans: (id: string) => api.get(`/devices/${id}/vlans`),
  createVlan: (id: string, data: any) => api.post(`/devices/${id}/vlans`, data),
  updateVlan: (id: string, vlanId: string, data: any) => api.put(`/devices/${id}/vlans/${vlanId}`, data),
  deleteVlan: (id: string, vlanId: string) => api.delete(`/devices/${id}/vlans/${vlanId}`),

  // Ports
  getPorts: (id: string) => api.get(`/devices/${id}/ports`),
  createPort: (id: string, data: any) => api.post(`/devices/${id}/ports`, data),
  updatePort: (id: string, portId: string, data: any) => api.put(`/devices/${id}/ports/${portId}`, data),
  deletePort: (id: string, portId: string) => api.delete(`/devices/${id}/ports/${portId}`),

  // Photos
  getPhotos: (id: string) => api.get(`/devices/${id}/photos`),
  uploadPhoto: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/devices/${id}/photos`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  deletePhoto: (id: string, photoId: string) => api.delete(`/devices/${id}/photos/${photoId}`),

  // Credentials
  getCredentials: (id: string) => api.get(`/devices/${id}/credentials`),
  createCredential: (id: string, data: any) => api.post(`/devices/${id}/credentials`, data),
  deleteCredential: (id: string, credId: string) => api.delete(`/devices/${id}/credentials/${credId}`),

  // Status check
  checkStatus: (id: string) => api.post(`/devices/${id}/check-status`),
  checkAllStatus: (deviceIds?: string[]) => api.post('/devices/check-status', deviceIds ? { device_ids: deviceIds } : {}),
}

export const vpnApi = {
  list: (deviceId: string) => api.get(`/devices/${deviceId}/vpn`),
  get: (deviceId: string, vpnId: string) => api.get(`/devices/${deviceId}/vpn/${vpnId}`),
  create: (deviceId: string, data: any) => api.post(`/devices/${deviceId}/vpn`, data),
  update: (deviceId: string, vpnId: string, data: any) => api.put(`/devices/${deviceId}/vpn/${vpnId}`, data),
  delete: (deviceId: string, vpnId: string) => api.delete(`/devices/${deviceId}/vpn/${vpnId}`),
  connect: (deviceId: string, vpnId: string) =>
    api.post(`/devices/${deviceId}/vpn/${vpnId}/connect`, {}, { timeout: 45000 }),
  disconnect: (deviceId: string, vpnId: string) =>
    api.post(`/devices/${deviceId}/vpn/${vpnId}/disconnect`, {}, { timeout: 15000 }),
  getStatus: (deviceId: string, vpnId: string) =>
    api.get(`/devices/${deviceId}/vpn/${vpnId}/status`),
}

export const routesApi = {
  list: (deviceId: string) => api.get(`/devices/${deviceId}/routes`),
  create: (deviceId: string, data: any) => api.post(`/devices/${deviceId}/routes`, data),
  update: (deviceId: string, routeId: string, data: any) => api.put(`/devices/${deviceId}/routes/${routeId}`, data),
  delete: (deviceId: string, routeId: string) => api.delete(`/devices/${deviceId}/routes/${routeId}`),
}

export const backupApi = {
  list: () => api.get('/backup'),
  create: () => api.post('/backup/create'),
  download: (filename: string) => `/api/v1/backup/download/${filename}`,
  restore: (filename: string) => api.post(`/backup/restore/${filename}`),
  delete: (filename: string) => api.delete(`/backup/${filename}`),
  cleanup: (retentionDays?: number) => api.post('/backup/cleanup', null, { params: { retention_days: retentionDays } }),
}

export const auditApi = {
  list: (params?: { page?: number; per_page?: number; search?: string; action?: string; status?: string }) =>
    api.get('/audit', { params }),
}

export const clientsApi = {
  list: (activeOnly?: boolean) => api.get('/clients', { params: { active_only: activeOnly } }),
  get: (id: string) => api.get(`/clients/${id}`),
  create: (data: any) => api.post('/clients', data),
  update: (id: string, data: any) => api.put(`/clients/${id}`, data),
  delete: (id: string) => api.delete(`/clients/${id}`),
}

export const vendorsApi = {
  listGroups: () => api.get('/vendor-groups'),
  createGroup: (data: any) => api.post('/vendor-groups', data),
  updateGroup: (id: string, data: any) => api.put(`/vendor-groups/${id}`, data),
  deleteGroup: (id: string) => api.delete(`/vendor-groups/${id}`),
  listVendors: (groupId?: string) => api.get('/vendors', { params: { group_id: groupId } }),
  createVendor: (data: any) => api.post('/vendors', data),
  updateVendor: (id: string, data: any) => api.put(`/vendors/${id}`, data),
  deleteVendor: (id: string) => api.delete(`/vendors/${id}`),
  listModels: (vendorId?: string) => api.get('/vendor-models', { params: { vendor_id: vendorId } }),
  createModel: (data: any) => api.post('/vendor-models', data),
  updateModel: (id: string, data: any) => api.put(`/vendor-models/${id}`, data),
  deleteModel: (id: string) => api.delete(`/vendor-models/${id}`),
}

export const usersApi = {
  list: () => api.get('/auth/users'),
  get: (id: string) => api.get(`/auth/users/${id}`),
  create: (data: any) => api.post('/auth/users', data),
  update: (id: string, data: any) => api.put(`/auth/users/${id}`, data),
  delete: (id: string) => api.delete(`/auth/users/${id}`),
}

export const automationApi = {
  listCommands: (params?: { category?: string; vendor_id?: string; search?: string }) =>
    api.get('/automation/commands', { params }),
  getCommand: (id: string) => api.get(`/automation/commands/${id}`),
  createCommand: (data: any) => api.post('/automation/commands', data),
  updateCommand: (id: string, data: any) => api.put(`/automation/commands/${id}`, data),
  deleteCommand: (id: string) => api.delete(`/automation/commands/${id}`),
  execute: (data: any) => api.post('/automation/execute', data, { timeout: 120000 }),
  listHistory: (params?: { device_id?: string; template_id?: string; status?: string; limit?: number }) =>
    api.get('/automation/history', { params }),
  getExecution: (id: string) => api.get(`/automation/history/${id}`),
  deleteExecution: (id: string) => api.delete(`/automation/history/${id}`),
  listCategories: () => api.get('/automation/categories'),
}

// Alias para compatibilidade
export const getDeviceById = (id: string) => devicesApi.get(id)
export const getDeviceVpnConfigs = (id: string) => vpnApi.list(id)
export const getDevicePhotos = (id: string) => devicesApi.getPhotos(id)
export const getDeviceCredentials = (id: string) => devicesApi.getCredentials(id)
