import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - adiciona token
api.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState()
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor - refresh token automático
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const { refreshToken, setAuth, logout, user } = useAuthStore.getState()

      if (refreshToken) {
        try {
          const response = await axios.post('/api/v1/auth/refresh', {
            refresh_token: refreshToken,
          })

          const { access_token, refresh_token } = response.data
          if (user) {
            setAuth(user, access_token, refresh_token)
          }

          originalRequest.headers.Authorization = `Bearer ${access_token}`
          return api(originalRequest)
        } catch {
          logout()
          window.location.href = '/login'
        }
      } else {
        logout()
        window.location.href = '/login'
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
  listGroups: () => api.get('/vendors/groups'),
  createGroup: (data: any) => api.post('/vendors/groups', data),
  updateGroup: (id: string, data: any) => api.put(`/vendors/groups/${id}`, data),
  deleteGroup: (id: string) => api.delete(`/vendors/groups/${id}`),
  listVendors: (groupId?: string) => api.get('/vendors', { params: { group_id: groupId } }),
  createVendor: (data: any) => api.post('/vendors', data),
  updateVendor: (id: string, data: any) => api.put(`/vendors/${id}`, data),
  deleteVendor: (id: string) => api.delete(`/vendors/${id}`),
  listModels: (vendorId?: string) => api.get('/vendors/models', { params: { vendor_id: vendorId } }),
  createModel: (data: any) => api.post('/vendors/models', data),
  updateModel: (id: string, data: any) => api.put(`/vendors/models/${id}`, data),
  deleteModel: (id: string) => api.delete(`/vendors/models/${id}`),
}

export const usersApi = {
  list: () => api.get('/auth/users'),
  get: (id: string) => api.get(`/auth/users/${id}`),
  create: (data: any) => api.post('/auth/users', data),
  update: (id: string, data: any) => api.put(`/auth/users/${id}`, data),
  delete: (id: string) => api.delete(`/auth/users/${id}`),
}

// Alias para compatibilidade
export const getDeviceById = (id: string) => devicesApi.get(id)
export const getDeviceVpnConfigs = (id: string) => vpnApi.list(id)
export const getDevicePhotos = (id: string) => devicesApi.getPhotos(id)
export const getDeviceCredentials = (id: string) => devicesApi.getCredentials(id)
