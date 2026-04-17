/**
 * ClientNetworkPage — Visão consolidada de rede por cliente
 *
 * Exibe todos os dispositivos, VLANs, portas, rotas e VPNs de cada cliente
 * em uma única página, com filtros, busca e expansão por dispositivo.
 */
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2, Server, ChevronDown, ChevronRight,
  Wifi, WifiOff, HelpCircle, Network, GitBranch,
  Shield, Search, RefreshCw, AlertCircle, Loader2,
  MapPin, Phone, Mail, Tag, Globe, Cpu, Info,
  Activity, Layers, ArrowRight, Clock, Edit2, Terminal,
} from 'lucide-react'
import { clientsApi, devicesApi } from '../utils/api'
import api from '../utils/api'
import DeviceFormModal from '../components/devices/DeviceFormModal'
import { useNavigate } from 'react-router-dom'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ClientSummary {
  id: string
  name: string
  short_name: string | null
  city: string | null
  state: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  notes: string | null
}

interface DeviceVlan {
  id: string
  vlan_id: number
  name: string | null
  description: string | null
  ip_address: string | null
  subnet_mask: string | null
  gateway: string | null
  is_management: boolean
  is_active: boolean
}

interface DevicePort {
  id: string
  port_name: string
  port_number: string | null
  port_type: string
  status: string
  speed_mbps: number | null
  vlan_id: number | null
  ip_address: string | null
  description: string | null
  is_trunk: boolean
  connected_device: string | null
}

interface DeviceRoute {
  id: string
  destination_network: string
  next_hop: string
  interface: string | null
  metric: number
  description: string | null
  is_active: boolean
}

interface DeviceVpn {
  id: string
  name: string
  vpn_type: string
  status: string
  server_ip: string
  local_ip: string | null
  remote_ip: string | null
  tunnel_ip: string | null
}

interface DeviceData {
  id: string
  name: string
  hostname: string | null
  description: string | null
  device_type: string
  status: string
  manufacturer: string | null
  model: string | null
  firmware_version: string | null
  serial_number: string | null
  location: string | null
  site: string | null
  management_ip: string | null
  subnet_mask: string | null
  gateway: string | null
  dns_primary: string | null
  dns_secondary: string | null
  loopback_ip: string | null
  primary_protocol: string
  ssh_port: number | null
  tags: string[]
  notes: string | null
  last_seen: string | null
  last_backup: string | null
  vlans: DeviceVlan[]
  ports: DevicePort[]
  routes: DeviceRoute[]
  vpns: DeviceVpn[]
}

interface NetworkStats {
  total_devices: number
  online: number
  offline: number
  unknown: number
  total_vlans: number
  total_ports: number
  total_routes: number
  total_vpns: number
}

interface ClientNetworkData {
  client: ClientSummary
  stats: NetworkStats
  devices: DeviceData[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<any> }> = {
  online:  { label: 'Online',     color: 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20', icon: Wifi },
  offline: { label: 'Offline',    color: 'text-red-400 bg-red-400/10 border-red-500/20',             icon: WifiOff },
  unknown: { label: 'Desconhecido', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-500/20',  icon: HelpCircle },
}

const PORT_STATUS_COLOR: Record<string, string> = {
  up:         'text-emerald-400',
  down:       'text-red-400',
  admin_down: 'text-orange-400',
  unknown:    'text-gray-400',
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function VlansTable({ vlans }: { vlans: DeviceVlan[] }) {
  if (!vlans.length) return <p className="text-dark-500 text-sm py-2">Nenhuma VLAN cadastrada</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-dark-500 border-b border-dark-700">
            <th className="text-left py-2 pr-4 font-medium">VLAN ID</th>
            <th className="text-left py-2 pr-4 font-medium">Nome</th>
            <th className="text-left py-2 pr-4 font-medium">IP</th>
            <th className="text-left py-2 pr-4 font-medium">Máscara</th>
            <th className="text-left py-2 pr-4 font-medium">Gateway</th>
            <th className="text-left py-2 font-medium">Flags</th>
          </tr>
        </thead>
        <tbody>
          {vlans.map(v => (
            <tr key={v.id} className="border-b border-dark-800 hover:bg-dark-800/30">
              <td className="py-2 pr-4 font-mono text-brand-400 font-semibold">{v.vlan_id}</td>
              <td className="py-2 pr-4 text-white">{v.name || '—'}</td>
              <td className="py-2 pr-4 font-mono text-dark-300">{v.ip_address || '—'}</td>
              <td className="py-2 pr-4 font-mono text-dark-300">{v.subnet_mask || '—'}</td>
              <td className="py-2 pr-4 font-mono text-dark-300">{v.gateway || '—'}</td>
              <td className="py-2 flex gap-1 flex-wrap">
                {v.is_management && (
                  <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-xs">Mgmt</span>
                )}
                {!v.is_active && (
                  <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded text-xs">Inativa</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PortsTable({ ports }: { ports: DevicePort[] }) {
  if (!ports.length) return <p className="text-dark-500 text-sm py-2">Nenhuma porta cadastrada</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-dark-500 border-b border-dark-700">
            <th className="text-left py-2 pr-4 font-medium">Porta</th>
            <th className="text-left py-2 pr-4 font-medium">Tipo</th>
            <th className="text-left py-2 pr-4 font-medium">Status</th>
            <th className="text-left py-2 pr-4 font-medium">VLAN</th>
            <th className="text-left py-2 pr-4 font-medium">IP</th>
            <th className="text-left py-2 pr-4 font-medium">Velocidade</th>
            <th className="text-left py-2 font-medium">Conectado a</th>
          </tr>
        </thead>
        <tbody>
          {ports.map(p => (
            <tr key={p.id} className="border-b border-dark-800 hover:bg-dark-800/30">
              <td className="py-2 pr-4 font-mono text-white font-medium">{p.port_name}</td>
              <td className="py-2 pr-4 text-dark-400 capitalize">{p.port_type}</td>
              <td className={`py-2 pr-4 font-medium capitalize ${PORT_STATUS_COLOR[p.status] ?? 'text-gray-400'}`}>
                {p.status.replace('_', ' ')}
              </td>
              <td className="py-2 pr-4 font-mono text-dark-300">{p.vlan_id ?? '—'}</td>
              <td className="py-2 pr-4 font-mono text-dark-300">{p.ip_address || '—'}</td>
              <td className="py-2 pr-4 text-dark-300">{p.speed_mbps ? `${p.speed_mbps} Mbps` : '—'}</td>
              <td className="py-2 text-dark-400 text-xs">{p.connected_device || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RoutesTable({ routes }: { routes: DeviceRoute[] }) {
  if (!routes.length) return <p className="text-dark-500 text-sm py-2">Nenhuma rota cadastrada</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-dark-500 border-b border-dark-700">
            <th className="text-left py-2 pr-4 font-medium">Destino</th>
            <th className="text-left py-2 pr-4 font-medium">Próximo Salto</th>
            <th className="text-left py-2 pr-4 font-medium">Interface</th>
            <th className="text-left py-2 pr-4 font-medium">Métrica</th>
            <th className="text-left py-2 font-medium">Descrição</th>
          </tr>
        </thead>
        <tbody>
          {routes.map(r => (
            <tr key={r.id} className="border-b border-dark-800 hover:bg-dark-800/30">
              <td className="py-2 pr-4 font-mono text-brand-400 font-semibold">{r.destination_network}</td>
              <td className="py-2 pr-4 font-mono text-dark-300">{r.next_hop}</td>
              <td className="py-2 pr-4 text-dark-400">{r.interface || '—'}</td>
              <td className="py-2 pr-4 text-dark-400">{r.metric}</td>
              <td className="py-2 text-dark-400 text-xs">{r.description || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VpnsTable({ vpns }: { vpns: DeviceVpn[] }) {
  if (!vpns.length) return <p className="text-dark-500 text-sm py-2">Nenhuma VPN cadastrada</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-dark-500 border-b border-dark-700">
            <th className="text-left py-2 pr-4 font-medium">Nome</th>
            <th className="text-left py-2 pr-4 font-medium">Tipo</th>
            <th className="text-left py-2 pr-4 font-medium">Status</th>
            <th className="text-left py-2 pr-4 font-medium">Servidor</th>
            <th className="text-left py-2 font-medium">Tunnel IP</th>
          </tr>
        </thead>
        <tbody>
          {vpns.map(v => (
            <tr key={v.id} className="border-b border-dark-800 hover:bg-dark-800/30">
              <td className="py-2 pr-4 text-white font-medium">{v.name}</td>
              <td className="py-2 pr-4 text-dark-400 uppercase text-xs">{v.vpn_type}</td>
              <td className="py-2 pr-4">
                <span className={`text-xs font-medium ${v.status === 'active' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {v.status}
                </span>
              </td>
              <td className="py-2 pr-4 font-mono text-dark-300">{v.server_ip}</td>
              <td className="py-2 font-mono text-dark-300">{v.tunnel_ip || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── DeviceCard ───────────────────────────────────────────────────────────────

type DeviceTab = 'info' | 'vlans' | 'ports' | 'routes' | 'vpns'

function DeviceCard({ device, onEdit }: { device: DeviceData; onEdit: (d: any) => void }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<DeviceTab>('info')

  const tabs: { id: DeviceTab; label: string; count?: number; icon: React.FC<any> }[] = [
    { id: 'info',   label: 'Informações', icon: Info },
    { id: 'vlans',  label: 'VLANs',       count: device.vlans.length,  icon: Layers },
    { id: 'ports',  label: 'Portas',      count: device.ports.length,  icon: Activity },
    { id: 'routes', label: 'Rotas',       count: device.routes.length, icon: GitBranch },
    { id: 'vpns',   label: 'VPNs',        count: device.vpns.length,   icon: Shield },
  ]

  return (
    <div className="card border border-dark-700 overflow-hidden">
      {/* Header do dispositivo */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-4 hover:bg-dark-800/40 transition-colors text-left"
      >
        <div className="flex-shrink-0 w-9 h-9 bg-dark-700 rounded-lg flex items-center justify-center">
          <Server className="w-4 h-4 text-brand-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{device.name}</span>
            <StatusBadge status={device.status} />
            {device.device_type && (
              <span className="text-xs text-dark-500 capitalize">{device.device_type.replace('_', ' ')}</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-0.5 text-xs text-dark-500 flex-wrap">
            {device.management_ip && (
              <span className="font-mono">{device.management_ip}</span>
            )}
            {device.manufacturer && <span>{device.manufacturer}</span>}
            {device.model && <span>{device.model}</span>}
            {device.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />{device.location}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-xs text-dark-500">
            {device.vlans.length > 0 && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" />{device.vlans.length} VLANs
              </span>
            )}
            {device.ports.length > 0 && (
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />{device.ports.length} portas
              </span>
            )}
            {device.routes.length > 0 && (
              <span className="flex items-center gap-1">
                <GitBranch className="w-3 h-3" />{device.routes.length} rotas
              </span>
            )}
          </div>

          {/* Ações Rápidas */}
          <div className="flex items-center gap-1 mr-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => onEdit(device)}
              className="p-1.5 text-dark-400 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-colors"
              title="Editar Dispositivo"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate(`/devices/${device.id}/terminal`)}
              className="p-1.5 text-dark-400 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-colors"
              title="Acessar Terminal"
            >
              <Terminal className="w-4 h-4" />
            </button>
          </div>

          {expanded ? (
            <ChevronDown className="w-4 h-4 text-dark-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-dark-500" />
          )}
        </div>
      </button>

      {/* Conteúdo expandido */}
      {expanded && (
        <div className="border-t border-dark-700">
          {/* Tabs */}
          <div className="flex border-b border-dark-700 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-dark-500 hover:text-dark-300'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                    activeTab === tab.id ? 'bg-brand-500/20 text-brand-300' : 'bg-dark-700 text-dark-400'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-4">
            {activeTab === 'info' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-dark-500 text-xs uppercase tracking-wider mb-2">Identificação</p>
                  <div className="space-y-1.5">
                    <InfoRow label="Hostname" value={device.hostname} mono />
                    <InfoRow label="Tipo" value={device.device_type?.replace('_', ' ')} capitalize />
                    <InfoRow label="Fabricante" value={device.manufacturer} />
                    <InfoRow label="Modelo" value={device.model} />
                    <InfoRow label="Firmware" value={device.firmware_version} mono />
                    <InfoRow label="Nº de Série" value={device.serial_number} mono />
                  </div>
                </div>
                <div>
                  <p className="text-dark-500 text-xs uppercase tracking-wider mb-2">Rede</p>
                  <div className="space-y-1.5">
                    <InfoRow label="IP de Gerência" value={device.management_ip} mono />
                    <InfoRow label="Máscara" value={device.subnet_mask} mono />
                    <InfoRow label="Gateway" value={device.gateway} mono />
                    <InfoRow label="DNS Primário" value={device.dns_primary} mono />
                    <InfoRow label="DNS Secundário" value={device.dns_secondary} mono />
                    <InfoRow label="Loopback" value={device.loopback_ip} mono />
                  </div>
                </div>
                <div>
                  <p className="text-dark-500 text-xs uppercase tracking-wider mb-2">Localização & Acesso</p>
                  <div className="space-y-1.5">
                    <InfoRow label="Local" value={device.location} />
                    <InfoRow label="Site" value={device.site} />
                    <InfoRow label="Protocolo" value={device.primary_protocol?.toUpperCase()} />
                    <InfoRow label="Porta SSH" value={device.ssh_port?.toString()} />
                    {device.last_seen && (
                      <div className="flex items-start gap-2">
                        <span className="text-dark-500 text-xs w-24 flex-shrink-0">Visto em</span>
                        <span className="text-dark-300 text-xs flex items-center gap-1">
                          <Clock className="w-3 h-3" />{formatDate(device.last_seen)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {device.tags.length > 0 && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <p className="text-dark-500 text-xs uppercase tracking-wider mb-2">Tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {device.tags.map(tag => (
                        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-dark-700 rounded text-xs text-dark-300">
                          <Tag className="w-3 h-3" />{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {device.notes && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <p className="text-dark-500 text-xs uppercase tracking-wider mb-2">Observações</p>
                    <p className="text-dark-300 text-sm bg-dark-800 rounded p-3">{device.notes}</p>
                  </div>
                )}
              </div>
            )}
            {activeTab === 'vlans'  && <VlansTable  vlans={device.vlans}   />}
            {activeTab === 'ports'  && <PortsTable  ports={device.ports}   />}
            {activeTab === 'routes' && <RoutesTable routes={device.routes} />}
            {activeTab === 'vpns'   && <VpnsTable   vpns={device.vpns}     />}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value, mono, capitalize }: {
  label: string; value?: string | null; mono?: boolean; capitalize?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-dark-500 text-xs w-24 flex-shrink-0">{label}</span>
      <span className={`text-xs ${mono ? 'font-mono text-dark-300' : capitalize ? 'text-dark-300 capitalize' : 'text-dark-300'}`}>
        {value || '—'}
      </span>
    </div>
  )
}

// ─── ClientCard ───────────────────────────────────────────────────────────────

function ClientCard({
  client,
  isSelected,
  onSelect,
  deviceCount,
}: {
  client: any
  isSelected: boolean
  onSelect: () => void
  deviceCount: number
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isSelected
          ? 'border-brand-500 bg-brand-500/10'
          : 'border-dark-700 bg-dark-800/40 hover:border-dark-600 hover:bg-dark-800'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isSelected ? 'bg-brand-500/20' : 'bg-dark-700'
        }`}>
          <Building2 className={`w-4 h-4 ${isSelected ? 'text-brand-400' : 'text-dark-400'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`font-medium text-sm truncate ${isSelected ? 'text-brand-300' : 'text-white'}`}>
            {client.name}
          </p>
          <p className="text-dark-500 text-xs truncate">
            {client.city ? `${client.city}${client.state ? `, ${client.state}` : ''}` : 'Sem localização'}
          </p>
          <p className="text-dark-600 text-xs mt-0.5">
            {deviceCount} dispositivo{deviceCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </button>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function ClientNetworkPage() {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [searchDevice, setSearchDevice] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [expandAll, setExpandAll] = useState(false)
  const [editingDevice, setEditingDevice] = useState<any>(null)

  // Lista de clientes
  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list().then(r => r.data),
  })

  // Dados de rede do cliente selecionado
  const {
    data: networkData,
    isLoading: loadingNetwork,
    error: networkError,
    refetch,
    isFetching,
  } = useQuery<ClientNetworkData>({
    queryKey: ['client-network', selectedClientId],
    queryFn: () => api.get(`/clients/${selectedClientId}/network`).then(r => r.data),
    enabled: !!selectedClientId,
    staleTime: 30_000,
  })

  // Filtrar clientes na sidebar
  const filteredClients = useMemo(() =>
    clients.filter((c: any) =>
      c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
      (c.city || '').toLowerCase().includes(clientSearch.toLowerCase())
    ),
    [clients, clientSearch]
  )

  // Filtrar dispositivos pela busca
  const filteredDevices = useMemo(() => {
    if (!networkData?.devices) return []
    const q = searchDevice.toLowerCase()
    if (!q) return networkData.devices
    return networkData.devices.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.management_ip || '').includes(q) ||
      (d.hostname || '').toLowerCase().includes(q) ||
      (d.model || '').toLowerCase().includes(q) ||
      (d.location || '').toLowerCase().includes(q) ||
      d.vlans.some(v => v.ip_address?.includes(q) || String(v.vlan_id).includes(q))
    )
  }, [networkData, searchDevice])

  const stats = networkData?.stats
  const clientInfo = networkData?.client

  return (
    <div className="flex h-full gap-0">
      {/* ── Sidebar de Clientes ── */}
      <aside className="w-64 flex-shrink-0 border-r border-dark-700 flex flex-col bg-dark-900">
        <div className="p-3 border-b border-dark-700">
          <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-brand-400" />
            Clientes
          </h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              className="input w-full pl-8 py-1.5 text-xs"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingClients ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            </div>
          ) : filteredClients.length === 0 ? (
            <p className="text-dark-500 text-xs text-center py-8">Nenhum cliente encontrado</p>
          ) : (
            filteredClients.map((c: any) => (
              <ClientCard
                key={c.id}
                client={c}
                isSelected={selectedClientId === c.id}
                onSelect={() => {
                  setSelectedClientId(c.id)
                  setSearchDevice('')
                }}
                deviceCount={c.device_count ?? 0}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Área Principal ── */}
      <main className="flex-1 overflow-y-auto">
        {!selectedClientId ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mb-4">
              <Network className="w-8 h-8 text-dark-500" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Selecione um Cliente</h3>
            <p className="text-dark-500 text-sm max-w-sm">
              Escolha um cliente na lista à esquerda para visualizar toda a infraestrutura de rede consolidada.
            </p>
          </div>
        ) : loadingNetwork ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="w-8 h-8 text-brand-400 animate-spin mb-3" />
            <p className="text-dark-400 text-sm">Carregando infraestrutura...</p>
          </div>
        ) : networkError ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-white font-medium mb-1">Erro ao carregar dados</p>
            <p className="text-dark-500 text-sm mb-4">Verifique sua conexão e tente novamente.</p>
            <button onClick={() => refetch()} className="btn-primary text-sm">
              Tentar novamente
            </button>
          </div>
        ) : networkData ? (
          <div className="p-6 space-y-6">
            {/* Header do cliente */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 bg-brand-500/20 rounded-xl flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-brand-400" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-white">{clientInfo?.name}</h1>
                    <div className="flex items-center gap-3 text-dark-500 text-xs flex-wrap">
                      {clientInfo?.city && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {clientInfo.city}{clientInfo.state ? `, ${clientInfo.state}` : ''}
                        </span>
                      )}
                      {clientInfo?.contact_name && (
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3" />{clientInfo.contact_name}
                        </span>
                      )}
                      {clientInfo?.contact_phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />{clientInfo.contact_phone}
                        </span>
                      )}
                      {clientInfo?.contact_email && (
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />{clientInfo.contact_email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="btn-ghost text-sm flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>

            {/* Cards de estatísticas */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <StatCard label="Total" value={stats.total_devices} icon={Server} color="text-white" />
                <StatCard label="Online" value={stats.online} icon={Wifi} color="text-emerald-400" />
                <StatCard label="Offline" value={stats.offline} icon={WifiOff} color="text-red-400" />
                <StatCard label="Desconhecido" value={stats.unknown} icon={HelpCircle} color="text-yellow-400" />
                <StatCard label="VLANs" value={stats.total_vlans} icon={Layers} color="text-blue-400" />
                <StatCard label="Portas" value={stats.total_ports} icon={Activity} color="text-purple-400" />
                <StatCard label="Rotas" value={stats.total_routes} icon={GitBranch} color="text-orange-400" />
                <StatCard label="VPNs" value={stats.total_vpns} icon={Shield} color="text-cyan-400" />
              </div>
            )}

            {/* Barra de busca e controles */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                <input
                  type="text"
                  placeholder="Buscar por nome, IP, VLAN, modelo..."
                  value={searchDevice}
                  onChange={e => setSearchDevice(e.target.value)}
                  className="input w-full pl-10"
                />
              </div>
              <span className="text-dark-500 text-sm">
                {filteredDevices.length} de {networkData.devices.length} dispositivos
              </span>
            </div>

            {/* Lista de dispositivos */}
            {filteredDevices.length === 0 ? (
              <div className="text-center py-12">
                <Server className="w-10 h-10 text-dark-600 mx-auto mb-3" />
                <p className="text-dark-400 font-medium">Nenhum dispositivo encontrado</p>
                <p className="text-dark-600 text-sm mt-1">
                  {searchDevice ? 'Tente outros termos de busca.' : 'Este cliente não possui dispositivos cadastrados.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredDevices.map(device => (
                  <DeviceCard 
                    key={device.id} 
                    device={device} 
                    onEdit={(d) => setEditingDevice(d)}
                  />
                ))}
              </div>

              {editingDevice && (
                <DeviceFormModal
                  device={editingDevice}
                  onClose={() => setEditingDevice(null)}
                  onSuccess={() => {
                    setEditingDevice(null)
                    refetchNetwork()
                  }}
                />
              )}
            )}
          </div>
        ) : null}
      </main>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.FC<any>; color: string
}) {
  return (
    <div className="card p-3 text-center">
      <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-dark-500 text-xs leading-tight">{label}</p>
    </div>
  )
}
