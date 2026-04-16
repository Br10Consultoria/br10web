import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Terminal, Shield, Network, Server, Edit2, Trash2,
  Wifi, WifiOff, AlertTriangle, Settings, Upload, Plus, RefreshCw,
  Key, Globe, Layers, GitBranch, Camera, Activity, CheckCircle, Eye, EyeOff,
  Zap, Clock, Radio, Cpu, MemoryStick, ArrowDown, ArrowUp
} from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi, vpnApi, routesApi } from '../utils/api'
import api from '../utils/api'
import { useAuthStore } from '../store/authStore'
import VlanFormModal from '../components/devices/VlanFormModal'
import PortFormModal from '../components/devices/PortFormModal'
import RouteFormModal from '../components/devices/RouteFormModal'
import CredentialFormModal from '../components/devices/CredentialFormModal'
import VpnFormModal from '../components/vpn/VpnFormModal'
import DeviceFormModal from '../components/devices/DeviceFormModal'

const DEVICE_TYPE_LABELS: Record<string, string> = {
  huawei_ne8000: 'Huawei NE8000',
  huawei_6730: 'Huawei 6730',
  datacom: 'Datacom',
  vsol_olt: 'VSOL OLT',
  mikrotik: 'Mikrotik',
  cisco: 'Cisco',
  juniper: 'Juniper',
  generic_router: 'Roteador Genérico',
  generic_switch: 'Switch Genérico',
  generic_olt: 'OLT Genérica',
  other: 'Outro',
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: any; label: string }> = {
  online: { color: 'text-green-400', bg: 'bg-green-400/10', icon: CheckCircle, label: 'Online' },
  offline: { color: 'text-red-400', bg: 'bg-red-400/10', icon: WifiOff, label: 'Offline' },
  maintenance: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', icon: Settings, label: 'Manutenção' },
  unknown: { color: 'text-slate-400', bg: 'bg-slate-400/10', icon: AlertTriangle, label: 'Desconhecido' },
  alert: { color: 'text-orange-400', bg: 'bg-orange-400/10', icon: AlertTriangle, label: 'Alerta' },
}

type TabType = 'info' | 'vlans' | 'ports' | 'vpn' | 'routes' | 'photos' | 'credentials'

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabType>('info')
  const [showEditModal, setShowEditModal] = useState(false)

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', id],
    queryFn: () => devicesApi.get(id!).then(r => r.data),
    enabled: !!id,
  })

  const deleteMutation = useMutation({
    mutationFn: () => devicesApi.delete(id!),
    onSuccess: () => {
      toast.success('Dispositivo removido com sucesso')
      navigate('/devices')
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: () => toast.error('Erro ao remover dispositivo'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    )
  }

  if (!device) {
    return (
      <div className="text-center py-12">
        <Server className="w-16 h-16 text-dark-600 mx-auto mb-4" />
        <p className="text-dark-400">Dispositivo não encontrado</p>
        <Link to="/devices" className="btn btn-primary mt-4 inline-flex">Voltar</Link>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[device.status] || STATUS_CONFIG.unknown
  const StatusIcon = statusConfig.icon
  const canEdit = user?.role !== 'viewer'
  const canDelete = user?.role === 'admin'

  const handleConnect = (protocol: string) => {
    navigate(`/devices/${id}/terminal?protocol=${protocol}`)
  }

  const handleDelete = () => {
    if (confirm(`Tem certeza que deseja remover "${device.name}"? Esta ação não pode ser desfeita.`)) {
      deleteMutation.mutate()
    }
  }

  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: 'info', label: 'Informações', icon: Server },
    { id: 'vlans', label: 'VLANs', icon: Layers },
    { id: 'ports', label: 'Portas', icon: Network },
    { id: 'vpn', label: 'VPN L2TP', icon: Shield },
    { id: 'routes', label: 'Rotas', icon: GitBranch },
    { id: 'photos', label: 'Fotos', icon: Camera },
    { id: 'credentials', label: 'Credenciais', icon: Key },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={() => navigate('/devices')}
          className="p-2 rounded-lg hover:bg-dark-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{device.name}</h1>
            <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${statusConfig.bg} ${statusConfig.color}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              {statusConfig.label}
            </span>
          </div>
          <p className="text-dark-400 text-sm mt-1">
            {DEVICE_TYPE_LABELS[device.device_type] || device.device_type}
            {device.management_ip && ` • ${device.management_ip}`}
            {device.location && ` • ${device.location}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => handleConnect('ssh')} className="btn btn-primary flex items-center gap-2 text-sm">
            <Terminal className="w-4 h-4" /> SSH
          </button>
          <button onClick={() => handleConnect('telnet')} className="btn btn-secondary flex items-center gap-2 text-sm">
            <Terminal className="w-4 h-4" /> Telnet
          </button>
          {device.http_port && (
            <a
              href={`http://${device.management_ip}:${device.http_port}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <Globe className="w-4 h-4" /> Web
            </a>
          )}
          {canEdit && (
            <button
              onClick={() => setShowEditModal(true)}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <Edit2 className="w-4 h-4" /> Editar
            </button>
          )}
          {canDelete && (
            <button
              onClick={handleDelete}
              className="btn btn-danger flex items-center gap-2 text-sm"
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-4 h-4" />
              Remover
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-dark-400 hover:text-dark-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'info' && <DeviceInfoTab device={device} deviceId={device.id} />}
      {activeTab === 'vlans' && <VlansTab deviceId={device.id} canEdit={canEdit} />}
      {activeTab === 'ports' && <PortsTab deviceId={device.id} canEdit={canEdit} />}
      {activeTab === 'vpn' && <VpnTab deviceId={device.id} canEdit={canEdit} />}
      {activeTab === 'routes' && <RoutesTab deviceId={device.id} canEdit={canEdit} />}
      {activeTab === 'photos' && <PhotosTab deviceId={device.id} canEdit={canEdit} />}
      {activeTab === 'credentials' && <CredentialsTab deviceId={device.id} canEdit={canEdit} />}

      {/* Modal de edição do dispositivo */}
      {showEditModal && (
        <DeviceFormModal
          device={device}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false)
            queryClient.invalidateQueries({ queryKey: ['device', id] })
            queryClient.invalidateQueries({ queryKey: ['devices'] })
          }}
        />
      )}
    </div>
  )
}

// ─── InfoRow helper ────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex justify-between py-2.5 border-b border-dark-700/50 last:border-0">
      <span className="text-dark-400 text-sm">{label}</span>
      <span className={`text-sm font-medium ${mono ? 'font-mono text-green-400' : 'text-dark-200'}`}>{value}</span>
    </div>
  )
}

// ─── DeviceInfoTab ─────────────────────────────────────────────────────────────
function DeviceInfoTab({ device, deviceId }: { device: any; deviceId: string }) {
  // Protocolos habilitados para exibição
  const protocols = []
  if (device.ssh_port) protocols.push({ label: 'SSH', port: device.ssh_port })
  if (device.telnet_port) protocols.push({ label: 'Telnet', port: device.telnet_port })
  if (device.winbox_port) protocols.push({ label: 'Winbox', port: device.winbox_port })
  if (device.http_port) protocols.push({ label: 'HTTP', port: device.http_port })
  if (device.https_port) protocols.push({ label: 'HTTPS', port: device.https_port })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Identificação */}
      <div className="card">
        <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Identificação</h3>
        <InfoRow label="Nome" value={device.name} />
        <InfoRow label="Hostname" value={device.hostname} />
        <InfoRow label="Tipo" value={DEVICE_TYPE_LABELS[device.device_type] || device.device_type} />
        <InfoRow label="Fabricante" value={device.manufacturer} />
        <InfoRow label="Modelo" value={device.model} />
        <InfoRow label="Firmware" value={device.firmware_version} />
        <InfoRow label="Número de Série" value={device.serial_number} />
        <InfoRow label="Localização" value={device.location} />
        <InfoRow label="Site" value={device.site} />
      </div>

      {/* Configuração de Rede — só mostra campos preenchidos */}
      <div className="card">
        <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Configuração de Rede</h3>
        <InfoRow label="IP de Gerência" value={device.management_ip} mono />
        <InfoRow label="Máscara" value={device.subnet_mask} mono />
        <InfoRow label="Gateway" value={device.gateway} mono />
        <InfoRow label="DNS Primário" value={device.dns_primary} mono />
        <InfoRow label="DNS Secundário" value={device.dns_secondary} mono />
        <InfoRow label="IP Loopback" value={device.loopback_ip} mono />
        <InfoRow label="Protocolo Principal" value={device.primary_protocol?.toUpperCase()} />

        {/* Portas de Acesso — só mostra as que estão configuradas */}
        {protocols.length > 0 && (
          <div className="mt-3 pt-3 border-t border-dark-700/50">
            <p className="text-xs text-dark-500 uppercase tracking-wider mb-3">Portas de Acesso</p>
            <div className="flex flex-wrap gap-3">
              {protocols.map(p => (
                <div key={p.label} className="flex items-center gap-1.5 bg-dark-700/60 rounded-lg px-3 py-1.5">
                  <span className="text-xs font-medium text-brand-400">{p.label}</span>
                  <span className="text-xs font-mono text-dark-300">{p.port}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Monitoramento — sempre visível */}
      <MonitoringCard device={device} />

      {/* Dados SNMP coletados */}
      <SnmpDataCard deviceId={deviceId} />

      {/* Observações */}
      {device.notes && (
        <div className="card">
          <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Observações</h3>
          <p className="text-dark-300 text-sm whitespace-pre-wrap">{device.notes}</p>
        </div>
      )}

      {/* Tags */}
      {device.tags && device.tags.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-4">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {device.tags.map((tag: string) => (
              <span key={tag} className="badge badge-info">{tag}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MonitoringCard ───────────────────────────────────────────────────────────
function MonitoringCard({ device }: { device: any }) {
  const queryClient = useQueryClient()
  const [isChecking, setIsChecking] = useState(false)

  const STATUS_COLORS: Record<string, string> = {
    online: 'text-green-400 bg-green-400/10',
    offline: 'text-red-400 bg-red-400/10',
    maintenance: 'text-yellow-400 bg-yellow-400/10',
    unknown: 'text-slate-400 bg-slate-400/10',
    alert: 'text-orange-400 bg-orange-400/10',
  }

  const STATUS_LABELS: Record<string, string> = {
    online: 'Online',
    offline: 'Offline',
    maintenance: 'Manutenção',
    unknown: 'Desconhecido',
    alert: 'Alerta',
  }

  const handleCheckNow = async () => {
    setIsChecking(true)
    try {
      const res = await devicesApi.checkStatus(device.id)
      const { old_status, new_status, changed } = res.data
      if (changed) {
        toast.success(`Status atualizado: ${STATUS_LABELS[old_status] || old_status} → ${STATUS_LABELS[new_status] || new_status}`)
      } else {
        toast.success(`Status confirmado: ${STATUS_LABELS[new_status] || new_status}`)
      }
      queryClient.invalidateQueries({ queryKey: ['device', device.id] })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    } catch {
      toast.error('Erro ao verificar status')
    } finally {
      setIsChecking(false)
    }
  }

  const statusKey = device.status || 'unknown'
  const colorClass = STATUS_COLORS[statusKey] || STATUS_COLORS.unknown
  const statusLabel = STATUS_LABELS[statusKey] || statusKey

  const formatDate = (iso: string | null) => {
    if (!iso) return null
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  const formatUptime = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return null
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (d > 0) return `${d}d ${h}h ${m}m`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider">Monitoramento</h3>
        </div>
        <button
          onClick={handleCheckNow}
          disabled={isChecking}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 transition-colors disabled:opacity-50"
        >
          {isChecking ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Zap className="w-3.5 h-3.5" />
          )}
          Verificar Agora
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {/* Status atual */}
        <div className="bg-dark-900/50 rounded-xl p-4 flex flex-col items-center gap-2">
          <span className="text-xs text-dark-400 uppercase tracking-wider">Status</span>
          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${colorClass}`}>
            {statusLabel}
          </span>
        </div>

        {/* Último check */}
        <div className="bg-dark-900/50 rounded-xl p-4 flex flex-col items-center gap-2">
          <Clock className="w-4 h-4 text-dark-500" />
          <span className="text-xs text-dark-400 uppercase tracking-wider">Último Acesso</span>
          <span className="text-xs text-dark-300 text-center">
            {formatDate(device.last_seen) || <span className="text-dark-600 italic">Nunca verificado</span>}
          </span>
        </div>

        {/* Uptime */}
        <div className="bg-dark-900/50 rounded-xl p-4 flex flex-col items-center gap-2">
          <Activity className="w-4 h-4 text-dark-500" />
          <span className="text-xs text-dark-400 uppercase tracking-wider">Uptime</span>
          <span className="text-sm font-mono text-dark-300">
            {formatUptime(device.uptime_seconds) || <span className="text-dark-600 italic">—</span>}
          </span>
        </div>

        {/* Último backup */}
        <div className="bg-dark-900/50 rounded-xl p-4 flex flex-col items-center gap-2">
          <CheckCircle className="w-4 h-4 text-dark-500" />
          <span className="text-xs text-dark-400 uppercase tracking-wider">Último Backup</span>
          <span className="text-xs text-dark-300 text-center">
            {formatDate(device.last_backup) || <span className="text-dark-600 italic">Nenhum</span>}
          </span>
        </div>
      </div>

      {/* CPU e Memória se disponíveis */}
      {(device.cpu_usage !== null && device.cpu_usage !== undefined) && (
        <div className="mt-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-dark-400">CPU</span>
            <span className="text-dark-300 font-mono">{device.cpu_usage.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-dark-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                device.cpu_usage > 80 ? 'bg-red-500' : device.cpu_usage > 60 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(device.cpu_usage, 100)}%` }}
            />
          </div>
        </div>
      )}
      {(device.memory_usage !== null && device.memory_usage !== undefined) && (
        <div className="mt-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-dark-400">Memória</span>
            <span className="text-dark-300 font-mono">{device.memory_usage.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-dark-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                device.memory_usage > 80 ? 'bg-red-500' : device.memory_usage > 60 ? 'bg-yellow-500' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(device.memory_usage, 100)}%` }}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-dark-600 mt-4">
        Verificação automática a cada 5 minutos via TCP nas portas configuradas.
      </p>
    </div>
  )
}

// ─── SnmpDataCard ─────────────────────────────────────────────────────────────
function SnmpDataCard({ deviceId }: { deviceId: string }) {
  const [snmpTarget, setSnmpTarget] = useState<any>(null)
  const [ifaceData, setIfaceData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const targetsRes = await api.get(`/snmp/targets?device_id=${deviceId}`)
        const targets = targetsRes.data
        if (targets.length > 0) {
          const target = targets[0]
          setSnmpTarget(target)
          const ifaceRes = await api.get(`/snmp/targets/${target.id}/interfaces`)
          setIfaceData(ifaceRes.data)
        }
      } catch { /* sem SNMP configurado */ }
      finally { setLoading(false) }
    }
    load()
  }, [deviceId])

  const formatBps = (bps: number | null): string => {
    if (bps === null || bps === undefined) return '—'
    if (bps === 0) return '0 bps'
    if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
    if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
    return `${bps} bps`
  }

  const formatUptime = (seconds: number): string => {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (d > 0) return `${d}d ${h}h ${m}m`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider">Dados SNMP</h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <RefreshCw className="w-5 h-5 animate-spin text-brand-400" />
        </div>
      </div>
    )
  }

  if (!snmpTarget) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-dark-500" />
          <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider">Dados SNMP</h3>
        </div>
        <p className="text-sm text-dark-500 italic">
          Nenhum target SNMP vinculado a este dispositivo. Cadastre um target no SNMP Monitor e vincule ao dispositivo.
        </p>
      </div>
    )
  }

  const upInterfaces = ifaceData?.interfaces?.filter((i: any) => i.is_up) || []
  const downInterfaces = ifaceData?.interfaces?.filter((i: any) => !i.is_up) || []

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider">Dados SNMP</h3>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          snmpTarget.last_status === 'ok' ? 'bg-green-400/10 text-green-400' :
          snmpTarget.last_status === 'error' ? 'bg-red-400/10 text-red-400' :
          'bg-dark-700 text-dark-400'
        }`}>
          {snmpTarget.last_status === 'ok' ? 'OK' : snmpTarget.last_status === 'error' ? 'Erro' : 'Nunca polled'}
        </span>
      </div>

      {/* Info do sistema via SNMP */}
      <div className="space-y-1 mb-4">
        {ifaceData?.sys_name && <InfoRow label="sysName" value={ifaceData.sys_name} />}
        {ifaceData?.sys_descr && <InfoRow label="sysDescr" value={ifaceData.sys_descr.split(' ').slice(0, 8).join(' ')} />}
        {ifaceData?.sys_location && <InfoRow label="Localização (SNMP)" value={ifaceData.sys_location} />}
        {ifaceData?.sys_contact && <InfoRow label="Contato (SNMP)" value={ifaceData.sys_contact} />}
        {ifaceData?.uptime_seconds && <InfoRow label="Uptime" value={formatUptime(ifaceData.uptime_seconds)} />}
      </div>

      {/* CPU e Memória */}
      {(ifaceData?.cpu_pct !== null && ifaceData?.cpu_pct !== undefined) && (
        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-dark-400 flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU</span>
            <span className="text-dark-300 font-mono">{ifaceData.cpu_pct.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-dark-700 rounded-full h-1.5">
            <div className={`h-1.5 rounded-full transition-all ${
              ifaceData.cpu_pct > 80 ? 'bg-red-500' : ifaceData.cpu_pct > 60 ? 'bg-yellow-500' : 'bg-green-500'
            }`} style={{ width: `${Math.min(ifaceData.cpu_pct, 100)}%` }} />
          </div>
        </div>
      )}
      {(ifaceData?.mem_pct !== null && ifaceData?.mem_pct !== undefined) && (
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-dark-400 flex items-center gap-1"><MemoryStick className="w-3 h-3" /> Memória</span>
            <span className="text-dark-300 font-mono">{ifaceData.mem_pct.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-dark-700 rounded-full h-1.5">
            <div className={`h-1.5 rounded-full transition-all ${
              ifaceData.mem_pct > 85 ? 'bg-red-500' : ifaceData.mem_pct > 70 ? 'bg-yellow-500' : 'bg-blue-500'
            }`} style={{ width: `${Math.min(ifaceData.mem_pct, 100)}%` }} />
          </div>
        </div>
      )}

      {/* Interfaces */}
      {ifaceData?.interfaces && ifaceData.interfaces.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-dark-500 uppercase tracking-wider">Interfaces</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400">{upInterfaces.length} UP</span>
              {downInterfaces.length > 0 && <span className="text-red-400">{downInterfaces.length} DOWN</span>}
            </div>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {ifaceData.interfaces.map((iface: any) => (
              <div key={iface.index} className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${
                iface.is_up ? 'hover:bg-dark-700/30' : 'opacity-60 hover:bg-dark-700/30'
              }`}>
                <div className="flex items-center gap-2 min-w-0">
                  {iface.is_up
                    ? <Wifi className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    : <WifiOff className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                  <span className="text-xs font-mono text-dark-300 truncate">{iface.name}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {iface.in_bps !== null && (
                    <span className="text-xs text-green-300 font-mono flex items-center gap-0.5">
                      <ArrowDown className="w-2.5 h-2.5" />{formatBps(iface.in_bps)}
                    </span>
                  )}
                  {iface.out_bps !== null && (
                    <span className="text-xs text-blue-300 font-mono flex items-center gap-0.5">
                      <ArrowUp className="w-2.5 h-2.5" />{formatBps(iface.out_bps)}
                    </span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    iface.is_up ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                  }`}>
                    {iface.is_up ? 'UP' : 'DOWN'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── VlansTab ──────────────────────────────────────────────────────────────────
function VlansTab({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editVlan, setEditVlan] = useState<any>(null)

  const { data: vlans, isLoading } = useQuery({
    queryKey: ['vlans', deviceId],
    queryFn: () => devicesApi.getVlans(deviceId).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (vlanId: string) => devicesApi.deleteVlan(deviceId, vlanId),
    onSuccess: () => {
      toast.success('VLAN removida')
      queryClient.invalidateQueries({ queryKey: ['vlans', deviceId] })
    },
    onError: () => toast.error('Erro ao remover VLAN'),
  })

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['vlans', deviceId] })
    setShowModal(false)
    setEditVlan(null)
  }

  const handleEdit = (vlan: any) => {
    setEditVlan(vlan)
    setShowModal(true)
  }

  const handleDelete = (vlan: any) => {
    if (confirm(`Remover VLAN ${vlan.vlan_id} (${vlan.name || 'sem nome'})?`)) {
      deleteMutation.mutate(vlan.id)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">VLANs Configuradas</h3>
        {canEdit && (
          <button onClick={() => { setEditVlan(null); setShowModal(true) }} className="btn btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Adicionar VLAN
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-dark-700 rounded animate-pulse" />)}</div>
      ) : !vlans || vlans.length === 0 ? (
        <div className="text-center py-8 text-dark-500">
          <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma VLAN configurada</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-400 uppercase tracking-wider">
                <th className="pb-3 pr-4">VLAN ID</th>
                <th className="pb-3 pr-4">Nome</th>
                <th className="pb-3 pr-4">IP</th>
                <th className="pb-3 pr-4">Gateway</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Gerência</th>
                {canEdit && <th className="pb-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {vlans.map((vlan: any) => (
                <tr key={vlan.id} className="hover:bg-dark-700/30 transition-colors">
                  <td className="py-3 pr-4 font-mono text-brand-400 font-medium">{vlan.vlan_id}</td>
                  <td className="py-3 pr-4 text-dark-200">{vlan.name || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-green-400 text-sm">{vlan.ip_address || '—'}</td>
                  <td className="py-3 pr-4 font-mono text-dark-300 text-sm">{vlan.gateway || '—'}</td>
                  <td className="py-3 pr-4">
                    <span className={`badge ${vlan.is_active ? 'badge-success' : 'badge-danger'}`}>
                      {vlan.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    {vlan.is_management && <span className="badge badge-info">Gerência</span>}
                  </td>
                  {canEdit && (
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEdit(vlan)}
                          className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-brand-400 transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(vlan)}
                          className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-red-400 transition-colors"
                          title="Remover"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <VlanFormModal
          deviceId={deviceId}
          vlan={editVlan}
          onClose={() => { setShowModal(false); setEditVlan(null) }}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}

// ─── PortsTab ──────────────────────────────────────────────────────────────────
function PortsTab({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editPort, setEditPort] = useState<any>(null)

  const { data: ports, isLoading } = useQuery({
    queryKey: ['ports', deviceId],
    queryFn: () => devicesApi.getPorts(deviceId).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (portId: string) => devicesApi.deletePort(deviceId, portId),
    onSuccess: () => {
      toast.success('Porta removida')
      queryClient.invalidateQueries({ queryKey: ['ports', deviceId] })
    },
    onError: () => toast.error('Erro ao remover porta'),
  })

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['ports', deviceId] })
    setShowModal(false)
    setEditPort(null)
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Portas do Dispositivo</h3>
        {canEdit && (
          <button onClick={() => { setEditPort(null); setShowModal(true) }} className="btn btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Adicionar Porta
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-dark-700 rounded animate-pulse" />)}</div>
      ) : !ports || ports.length === 0 ? (
        <div className="text-center py-8 text-dark-500">
          <Network className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma porta configurada</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-400 uppercase tracking-wider">
                <th className="pb-3 pr-4">Porta</th>
                <th className="pb-3 pr-4">Tipo</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Velocidade</th>
                <th className="pb-3 pr-4">VLAN</th>
                <th className="pb-3 pr-4">Conectado em</th>
                {canEdit && <th className="pb-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {ports.map((port: any) => (
                <tr key={port.id} className="hover:bg-dark-700/30 transition-colors">
                  <td className="py-3 pr-4 font-mono text-brand-400 font-medium">{port.port_name}</td>
                  <td className="py-3 pr-4 text-dark-300">{port.port_type?.toUpperCase()}</td>
                  <td className="py-3 pr-4">
                    <span className={`badge ${
                      port.status === 'up' ? 'badge-success' :
                      port.status === 'down' ? 'badge-danger' : 'badge-warning'
                    }`}>
                      {port.status?.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-dark-300">{port.speed_mbps ? `${port.speed_mbps} Mbps` : '—'}</td>
                  <td className="py-3 pr-4 font-mono text-dark-300">{port.vlan_id || '—'}</td>
                  <td className="py-3 pr-4 text-dark-400">{port.connected_device || '—'}</td>
                  {canEdit && (
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setEditPort(port); setShowModal(true) }}
                          className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-brand-400 transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remover porta ${port.port_name}?`)) deleteMutation.mutate(port.id)
                          }}
                          className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-red-400 transition-colors"
                          title="Remover"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <PortFormModal
          deviceId={deviceId}
          port={editPort}
          onClose={() => { setShowModal(false); setEditPort(null) }}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}

// ─── VpnTab ────────────────────────────────────────────────────────────────────
function VpnTab({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editVpn, setEditVpn] = useState<any>(null)

  const { data: vpnConfigs, isLoading } = useQuery({
    queryKey: ['vpn', deviceId],
    queryFn: () => vpnApi.list(deviceId).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (vpnId: string) => vpnApi.delete(deviceId, vpnId),
    onSuccess: () => {
      toast.success('VPN removida')
      queryClient.invalidateQueries({ queryKey: ['vpn', deviceId] })
    },
    onError: () => toast.error('Erro ao remover VPN'),
  })

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['vpn', deviceId] })
    setShowModal(false)
    setEditVpn(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">Configurações VPN L2TP</h3>
          <p className="text-xs text-dark-500 mt-0.5">Clientes L2TP que se conectam ao servidor VPN</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditVpn(null); setShowModal(true) }} className="btn btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Nova VPN
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}</div>
      ) : !vpnConfigs || vpnConfigs.length === 0 ? (
        <div className="card text-center py-10 text-dark-500">
          <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma VPN configurada</p>
          <p className="text-xs mt-1">Adicione uma conexão L2TP para este dispositivo</p>
        </div>
      ) : (
        <div className="space-y-4">
          {vpnConfigs.map((vpn: any) => (
            <div key={vpn.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-white">{vpn.name}</h4>
                    <span className={`badge ${vpn.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                      {vpn.status === 'active' ? 'Ativo' : vpn.status}
                    </span>
                  </div>
                  <p className="text-sm text-dark-400 mt-1">{vpn.description || 'VPN L2TP'}</p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditVpn(vpn); setShowModal(true) }}
                      className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-brand-400 transition-colors"
                      title="Editar VPN"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Remover VPN "${vpn.name}"?`)) deleteMutation.mutate(vpn.id)
                      }}
                      className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-red-400 transition-colors"
                      title="Remover VPN"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-dark-700">
                <div>
                  <p className="text-xs text-dark-500">Servidor</p>
                  <p className="text-sm font-mono text-green-400">{vpn.server_ip}:{vpn.server_port || 1701}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-500">Tipo</p>
                  <p className="text-sm text-dark-300">{vpn.vpn_type?.toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-500">Autenticação</p>
                  <p className="text-sm text-dark-300">{vpn.authentication_type?.toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-500">IPSec</p>
                  <p className="text-sm text-dark-300">{vpn.ipsec_enabled ? 'Habilitado' : 'Desabilitado'}</p>
                </div>
              </div>
              {vpn.static_routes && vpn.static_routes.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dark-700">
                  <p className="text-xs text-dark-500 mb-2">Rotas via esta VPN ({vpn.static_routes.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {vpn.static_routes.map((route: any) => (
                      <span key={route.id} className="text-xs font-mono bg-dark-700 px-2 py-1 rounded">
                        {route.destination_network} → {route.next_hop}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <VpnFormModal
          deviceId={deviceId}
          vpn={editVpn}
          onClose={() => { setShowModal(false); setEditVpn(null) }}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}

// ─── RoutesTab ─────────────────────────────────────────────────────────────────
function RoutesTab({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editRoute, setEditRoute] = useState<any>(null)

  const { data: routes, isLoading } = useQuery({
    queryKey: ['routes', deviceId],
    queryFn: () => routesApi.list(deviceId).then(r => r.data),
  })

  const { data: vpnConfigs } = useQuery({
    queryKey: ['vpn', deviceId],
    queryFn: () => vpnApi.list(deviceId).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (routeId: string) => routesApi.delete(deviceId, routeId),
    onSuccess: () => {
      toast.success('Rota removida')
      queryClient.invalidateQueries({ queryKey: ['routes', deviceId] })
    },
    onError: () => toast.error('Erro ao remover rota'),
  })

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['routes', deviceId] })
    setShowModal(false)
    setEditRoute(null)
  }

  // Mapa de VPN id → nome para exibição
  const vpnMap: Record<string, string> = {}
  if (vpnConfigs) {
    vpnConfigs.forEach((v: any) => { vpnMap[v.id] = v.name })
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white">Rotas Estáticas</h3>
          <p className="text-xs text-dark-500 mt-0.5">Rotas podem ser vinculadas a uma interface VPN L2TP</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditRoute(null); setShowModal(true) }} className="btn btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Adicionar Rota
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-dark-700 rounded animate-pulse" />)}</div>
      ) : !routes || routes.length === 0 ? (
        <div className="text-center py-8 text-dark-500">
          <GitBranch className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma rota estática configurada</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left text-xs text-dark-400 uppercase tracking-wider">
                <th className="pb-3 pr-4">Destino</th>
                <th className="pb-3 pr-4">Próximo Salto</th>
                <th className="pb-3 pr-4">Interface / VPN</th>
                <th className="pb-3 pr-4">Métrica</th>
                <th className="pb-3 pr-4">Status</th>
                {canEdit && <th className="pb-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {routes.map((route: any) => (
                <tr key={route.id} className="hover:bg-dark-700/30 transition-colors">
                  <td className="py-3 pr-4 font-mono text-brand-400">{route.destination_network}</td>
                  <td className="py-3 pr-4 font-mono text-green-400">{route.next_hop}</td>
                  <td className="py-3 pr-4">
                    {route.vpn_config_id ? (
                      <span className="flex items-center gap-1.5">
                        <Shield className="w-3 h-3 text-brand-400" />
                        <span className="text-brand-400 text-xs font-medium">{vpnMap[route.vpn_config_id] || 'VPN'}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-dark-300">{route.interface || '—'}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-dark-300">{route.metric}</td>
                  <td className="py-3 pr-4">
                    <span className={`badge ${route.is_active ? 'badge-success' : 'badge-danger'}`}>
                      {route.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setEditRoute(route); setShowModal(true) }}
                          className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-brand-400 transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remover rota ${route.destination_network}?`)) deleteMutation.mutate(route.id)
                          }}
                          className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-red-400 transition-colors"
                          title="Remover"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <RouteFormModal
          deviceId={deviceId}
          route={editRoute}
          vpnConfigs={vpnConfigs || []}
          onClose={() => { setShowModal(false); setEditRoute(null) }}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}

// ─── PhotosTab ─────────────────────────────────────────────────────────────────
function PhotosTab({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data: photos, isLoading } = useQuery({
    queryKey: ['photos', deviceId],
    queryFn: () => devicesApi.getPhotos(deviceId).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (photoId: string) => devicesApi.deletePhoto(deviceId, photoId),
    onSuccess: () => {
      toast.success('Foto removida')
      queryClient.invalidateQueries({ queryKey: ['photos', deviceId] })
    },
    onError: () => toast.error('Erro ao remover foto'),
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await devicesApi.uploadPhoto(deviceId, file)
      queryClient.invalidateQueries({ queryKey: ['photos', deviceId] })
      toast.success('Foto enviada com sucesso')
    } catch {
      toast.error('Erro ao enviar foto')
    }
    e.target.value = ''
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Fotos e Documentos</h3>
        {canEdit && (
          <label className="btn btn-primary flex items-center gap-2 text-sm cursor-pointer">
            <Upload className="w-4 h-4" /> Upload
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </label>
        )}
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="aspect-square bg-dark-700 rounded-lg animate-pulse" />)}
        </div>
      ) : !photos || photos.length === 0 ? (
        <div className="text-center py-8 text-dark-500">
          <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma foto cadastrada</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {photos.map((photo: any) => (
            <div key={photo.id} className="relative group aspect-square bg-dark-700 rounded-lg overflow-hidden">
              <img
                src={photo.url}
                alt={photo.original_filename}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setLightbox(photo.url)}
              />
              {photo.is_primary && (
                <span className="absolute top-2 left-2 badge badge-success text-xs">Principal</span>
              )}
              {canEdit && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => {
                      if (confirm('Remover esta foto?')) deleteMutation.mutate(photo.id)
                    }}
                    className="p-1.5 bg-red-500/90 hover:bg-red-500 rounded-lg text-white transition-colors"
                    title="Remover foto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Foto ampliada" className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  )
}

// ─── CredentialsTab ────────────────────────────────────────────────────────────
function CredentialsTab({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editCred, setEditCred] = useState<any>(null)
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({})

  const { data: credentials, isLoading } = useQuery({
    queryKey: ['credentials', deviceId],
    queryFn: () => devicesApi.getCredentials(deviceId).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (credId: string) => devicesApi.deleteCredential(deviceId, credId),
    onSuccess: () => {
      toast.success('Credencial removida')
      queryClient.invalidateQueries({ queryKey: ['credentials', deviceId] })
    },
    onError: () => toast.error('Erro ao remover credencial'),
  })

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['credentials', deviceId] })
    setShowModal(false)
    setEditCred(null)
  }

  const togglePassword = (id: string) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const CRED_TYPE_COLORS: Record<string, string> = {
    ssh: 'badge-success',
    telnet: 'badge-warning',
    snmp: 'badge-info',
    web: 'badge-info',
    api: 'badge-danger',
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Credenciais de Acesso</h3>
        {canEdit && (
          <button onClick={() => { setEditCred(null); setShowModal(true) }} className="btn btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-dark-700 rounded animate-pulse" />)}</div>
      ) : !credentials || credentials.length === 0 ? (
        <div className="text-center py-8 text-dark-500">
          <Key className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Nenhuma credencial adicional</p>
        </div>
      ) : (
        <div className="space-y-2">
          {credentials.map((cred: any) => (
            <div key={cred.id} className="flex items-center justify-between p-3 bg-dark-700/50 rounded-lg">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className={`badge ${CRED_TYPE_COLORS[cred.credential_type] || 'badge-info'} shrink-0`}>
                  {cred.credential_type?.toUpperCase()}
                </span>
                <span className="text-dark-300 text-sm truncate">{cred.username || 'Sem usuário'}</span>
                {cred.description && <span className="text-dark-500 text-xs truncate hidden sm:block">{cred.description}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className={`text-xs ${cred.is_active ? 'text-green-400' : 'text-red-400'}`}>
                  {cred.is_active ? 'Ativo' : 'Inativo'}
                </span>
                {canEdit && (
                  <>
                    <button
                      onClick={() => { setEditCred(cred); setShowModal(true) }}
                      className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-brand-400 transition-colors"
                      title="Editar"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Remover credencial ${cred.credential_type?.toUpperCase()} de "${cred.username}"?`)) {
                          deleteMutation.mutate(cred.id)
                        }
                      }}
                      className="p-1.5 rounded hover:bg-dark-600 text-dark-400 hover:text-red-400 transition-colors"
                      title="Remover"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <CredentialFormModal
          deviceId={deviceId}
          credential={editCred}
          onClose={() => { setShowModal(false); setEditCred(null) }}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
