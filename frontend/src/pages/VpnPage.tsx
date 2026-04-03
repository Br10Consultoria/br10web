import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Shield, Plus, Trash2, Edit2, RefreshCw, Network, Route, Server } from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi, vpnApi, routesApi } from '../utils/api'
import VpnFormModal from '../components/vpn/VpnFormModal'
import RouteFormModal from '../components/vpn/RouteFormModal'

export default function VpnPage() {
  const queryClient = useQueryClient()
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [showVpnModal, setShowVpnModal] = useState(false)
  const [showRouteModal, setShowRouteModal] = useState(false)
  const [editVpn, setEditVpn] = useState<any>(null)
  const [editRoute, setEditRoute] = useState<any>(null)

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list({ limit: 200 }).then(r => r.data),
  })

  const { data: vpnConfigs = [], isLoading: loadingVpn } = useQuery({
    queryKey: ['vpn', selectedDevice],
    queryFn: () => vpnApi.list(selectedDevice).then(r => r.data),
    enabled: !!selectedDevice,
  })

  const { data: routes = [] } = useQuery({
    queryKey: ['routes', selectedDevice],
    queryFn: () => routesApi.list(selectedDevice).then(r => r.data),
    enabled: !!selectedDevice,
  })

  const deleteVpn = useMutation({
    mutationFn: (vpnId: string) => vpnApi.delete(selectedDevice, vpnId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn', selectedDevice] })
      toast.success('VPN removida')
    },
  })

  const deleteRoute = useMutation({
    mutationFn: (routeId: string) => routesApi.delete(selectedDevice, routeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes', selectedDevice] })
      toast.success('Rota removida')
    },
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">VPN & Rotas Estáticas</h1>
          <p className="text-dark-400 text-sm">Gerenciamento de VPN L2TP e rotas estáticas por dispositivo</p>
        </div>
      </div>

      {/* Device Selector */}
      <div className="card">
        <label className="label">Selecionar Dispositivo</label>
        <select
          value={selectedDevice}
          onChange={e => setSelectedDevice(e.target.value)}
          className="input max-w-md"
        >
          <option value="">Selecione um dispositivo...</option>
          {devices.map((d: any) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.management_ip})
            </option>
          ))}
        </select>
      </div>

      {selectedDevice && (
        <>
          {/* VPN Configs */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-400" />
                Configurações VPN L2TP
              </h3>
              <button
                onClick={() => { setEditVpn(null); setShowVpnModal(true) }}
                className="btn-primary btn-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova VPN
              </button>
            </div>

            {loadingVpn ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="w-6 h-6 text-brand-400 animate-spin" />
              </div>
            ) : vpnConfigs.length === 0 ? (
              <div className="text-center py-10 text-dark-500">
                <Shield className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Nenhuma VPN configurada para este dispositivo</p>
              </div>
            ) : (
              <div className="space-y-3">
                {vpnConfigs.map((vpn: any) => (
                  <motion.div
                    key={vpn.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-dark-900 border border-dark-700 rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-white">{vpn.name}</h4>
                          <span className={`badge ${vpn.status === 'active' ? 'badge-online' : 'badge-offline'}`}>
                            {vpn.status}
                          </span>
                          <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">
                            {vpn.vpn_type.toUpperCase()}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2 text-xs">
                          <div>
                            <span className="text-dark-500">Servidor:</span>
                            <span className="text-dark-300 ml-1 font-mono">{vpn.server_ip}:{vpn.server_port}</span>
                          </div>
                          {vpn.username && (
                            <div>
                              <span className="text-dark-500">Usuário:</span>
                              <span className="text-dark-300 ml-1">{vpn.username}</span>
                            </div>
                          )}
                          {vpn.local_ip && (
                            <div>
                              <span className="text-dark-500">IP Local:</span>
                              <span className="text-dark-300 ml-1 font-mono">{vpn.local_ip}</span>
                            </div>
                          )}
                          {vpn.remote_ip && (
                            <div>
                              <span className="text-dark-500">IP Remoto:</span>
                              <span className="text-dark-300 ml-1 font-mono">{vpn.remote_ip}</span>
                            </div>
                          )}
                          <div>
                            <span className="text-dark-500">Auth:</span>
                            <span className="text-dark-300 ml-1 uppercase">{vpn.authentication_type}</span>
                          </div>
                          <div>
                            <span className="text-dark-500">MTU:</span>
                            <span className="text-dark-300 ml-1">{vpn.mtu}</span>
                          </div>
                          {vpn.ipsec_enabled && (
                            <div className="col-span-2">
                              <span className="text-purple-400">IPSec: {vpn.ipsec_encryption} / {vpn.ipsec_hash}</span>
                            </div>
                          )}
                        </div>
                        {vpn.description && (
                          <p className="text-xs text-dark-500 mt-2">{vpn.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => { setEditVpn(vpn); setShowVpnModal(true) }}
                          className="btn-secondary btn-sm"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteVpn.mutate(vpn.id)}
                          className="btn-ghost btn-sm text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Static Routes */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Route className="w-4 h-4 text-green-400" />
                Rotas Estáticas
              </h3>
              <button
                onClick={() => { setEditRoute(null); setShowRouteModal(true) }}
                className="btn-success btn-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova Rota
              </button>
            </div>

            {routes.length === 0 ? (
              <div className="text-center py-10 text-dark-500">
                <Network className="w-10 h-10 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Nenhuma rota estática configurada</p>
              </div>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Destino</th>
                      <th>Próximo Salto</th>
                      <th>Interface</th>
                      <th>Métrica</th>
                      <th>Status</th>
                      <th>Descrição</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((route: any) => (
                      <tr key={route.id}>
                        <td className="font-mono text-green-400">{route.destination_network}</td>
                        <td className="font-mono text-dark-300">{route.next_hop}</td>
                        <td className="text-dark-400">{route.interface || '—'}</td>
                        <td className="text-dark-400">{route.metric}</td>
                        <td>
                          <span className={route.is_active ? 'badge-online' : 'badge-offline'}>
                            {route.is_active ? 'Ativa' : 'Inativa'}
                          </span>
                        </td>
                        <td className="text-dark-500 text-xs">{route.description || '—'}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setEditRoute(route); setShowRouteModal(true) }}
                              className="btn-ghost btn-sm p-1"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteRoute.mutate(route.id)}
                              className="btn-ghost btn-sm p-1 text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showVpnModal && (
        <VpnFormModal
          deviceId={selectedDevice}
          vpn={editVpn}
          onClose={() => setShowVpnModal(false)}
          onSuccess={() => {
            setShowVpnModal(false)
            queryClient.invalidateQueries({ queryKey: ['vpn', selectedDevice] })
          }}
        />
      )}

      {showRouteModal && (
        <RouteFormModal
          deviceId={selectedDevice}
          route={editRoute}
          vpnConfigs={vpnConfigs}
          onClose={() => setShowRouteModal(false)}
          onSuccess={() => {
            setShowRouteModal(false)
            queryClient.invalidateQueries({ queryKey: ['routes', selectedDevice] })
          }}
        />
      )}
    </div>
  )
}
