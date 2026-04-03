import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Shield, Plus, Trash2, Edit2, RefreshCw, Network, Route, Server,
  Play, Square, Wifi, WifiOff, AlertCircle, CheckCircle2, Clock, Info
} from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi, vpnApi, routesApi } from '../utils/api'
import VpnFormModal from '../components/vpn/VpnFormModal'
import RouteFormModal from '../components/vpn/RouteFormModal'

// Badge de status da VPN
function VpnStatusBadge({ status, connected }: { status: string; connected?: boolean }) {
  const s = connected !== undefined ? (connected ? 'active' : status) : status
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    active:     { label: 'Conectado',    cls: 'bg-green-500/20 text-green-400 border-green-500/30',   icon: <CheckCircle2 className="w-3 h-3" /> },
    connecting: { label: 'Conectando…',  cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: <Clock className="w-3 h-3 animate-spin" /> },
    error:      { label: 'Erro',         cls: 'bg-red-500/20 text-red-400 border-red-500/30',          icon: <AlertCircle className="w-3 h-3" /> },
    inactive:   { label: 'Desconectado', cls: 'bg-dark-600 text-dark-400 border-dark-500',             icon: <WifiOff className="w-3 h-3" /> },
    disabled:   { label: 'Desabilitado', cls: 'bg-dark-600 text-dark-500 border-dark-600',             icon: <Square className="w-3 h-3" /> },
  }
  const cfg = map[s] || map.inactive
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.cls}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

export default function VpnPage() {
  const queryClient = useQueryClient()
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [showVpnModal, setShowVpnModal] = useState(false)
  const [showRouteModal, setShowRouteModal] = useState(false)
  const [editVpn, setEditVpn] = useState<any>(null)
  const [editRoute, setEditRoute] = useState<any>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list({ limit: 200 }).then(r => r.data),
  })

  const { data: vpnConfigs = [], isLoading: loadingVpn } = useQuery({
    queryKey: ['vpn', selectedDevice],
    queryFn: () => vpnApi.list(selectedDevice).then(r => r.data),
    enabled: !!selectedDevice,
    // Polling a cada 15s para atualizar status quando há VPN conectando
    refetchInterval: (data: any) => {
      const configs = Array.isArray(data) ? data : []
      const hasConnecting = configs.some((v: any) => v.status === 'connecting')
      return hasConnecting ? 3000 : 15000
    },
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

  const connectVpn = useMutation({
    mutationFn: (vpnId: string) => vpnApi.connect(selectedDevice, vpnId),
    onMutate: (vpnId) => {
      setConnectingId(vpnId)
      toast.loading('Conectando VPN…', { id: 'vpn-connect' })
    },
    onSuccess: (res) => {
      setConnectingId(null)
      toast.success(`VPN conectada! Interface: ${res.data.tunnel_ip || 'PPP ativa'}`, { id: 'vpn-connect' })
      queryClient.invalidateQueries({ queryKey: ['vpn', selectedDevice] })
    },
    onError: (err: any) => {
      setConnectingId(null)
      const msg = err.response?.data?.detail || 'Falha ao conectar VPN'
      toast.error(msg, { id: 'vpn-connect' })
      queryClient.invalidateQueries({ queryKey: ['vpn', selectedDevice] })
    },
  })

  const disconnectVpn = useMutation({
    mutationFn: (vpnId: string) => vpnApi.disconnect(selectedDevice, vpnId),
    onMutate: () => toast.loading('Desconectando…', { id: 'vpn-disconnect' }),
    onSuccess: () => {
      toast.success('VPN desconectada', { id: 'vpn-disconnect' })
      queryClient.invalidateQueries({ queryKey: ['vpn', selectedDevice] })
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Erro ao desconectar', { id: 'vpn-disconnect' })
      queryClient.invalidateQueries({ queryKey: ['vpn', selectedDevice] })
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

            {/* Aviso sobre como funciona */}
            <div className="mb-4 flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2.5 text-xs text-blue-300">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Ao clicar em <strong>Conectar</strong>, o servidor BR10 disca para o servidor L2TP configurado.
                Após a conexão ser estabelecida, adicione as rotas estáticas abaixo para acessar os dispositivos remotos via SSH/Telnet.
              </span>
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
                {vpnConfigs.map((vpn: any) => {
                  const isConnecting = connectingId === vpn.id || vpn.status === 'connecting'
                  const isActive = vpn.status === 'active'
                  const isError = vpn.status === 'error'

                  return (
                    <motion.div
                      key={vpn.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`bg-dark-900 border rounded-xl p-4 transition-colors ${
                        isActive ? 'border-green-500/30' :
                        isError ? 'border-red-500/30' :
                        'border-dark-700'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <h4 className="font-medium text-white">{vpn.name}</h4>
                            <VpnStatusBadge status={vpn.status} />
                            <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">
                              {vpn.vpn_type?.toUpperCase()}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
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
                            {vpn.tunnel_ip && (
                              <div>
                                <span className="text-dark-500">IP Túnel:</span>
                                <span className="text-green-400 ml-1 font-mono">{vpn.tunnel_ip}</span>
                              </div>
                            )}
                            {vpn.local_ip && !vpn.tunnel_ip && (
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

                          {/* Mensagem de erro */}
                          {isError && vpn.last_error && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              {vpn.last_error}
                            </div>
                          )}

                          {/* Info quando conectado */}
                          {isActive && vpn.connected_at && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-green-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Conectado em {new Date(vpn.connected_at).toLocaleString('pt-BR')}
                            </div>
                          )}

                          {vpn.description && (
                            <p className="text-xs text-dark-500 mt-2">{vpn.description}</p>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                          {/* Botão Conectar / Desconectar */}
                          {isActive ? (
                            <button
                              onClick={() => disconnectVpn.mutate(vpn.id)}
                              disabled={disconnectVpn.isPending}
                              title="Desconectar VPN"
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                            >
                              {disconnectVpn.isPending ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Square className="w-3.5 h-3.5" />
                              )}
                              Desconectar
                            </button>
                          ) : (
                            <button
                              onClick={() => connectVpn.mutate(vpn.id)}
                              disabled={isConnecting || connectVpn.isPending}
                              title="Conectar VPN"
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                            >
                              {isConnecting ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Play className="w-3.5 h-3.5" />
                              )}
                              {isConnecting ? 'Conectando…' : 'Conectar'}
                            </button>
                          )}

                          <button
                            onClick={() => { setEditVpn(vpn); setShowVpnModal(true) }}
                            className="btn-secondary btn-sm"
                            title="Editar"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteVpn.mutate(vpn.id)}
                            disabled={isActive}
                            title={isActive ? 'Desconecte antes de remover' : 'Remover'}
                            className="btn-ghost btn-sm text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
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

            {/* Aviso sobre rotas e VPN */}
            {vpnConfigs.some((v: any) => v.status === 'active') && (
              <div className="mb-3 flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-xs text-green-300">
                <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
                VPN ativa. Ao adicionar uma rota, selecione a interface da VPN conectada para rotear o tráfego corretamente.
              </div>
            )}

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
                        <td className="text-dark-400 font-mono text-xs">{route.interface || '—'}</td>
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
