import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Server, Plus, Search, Filter, Terminal, Edit2, Trash2,
  Wifi, WifiOff, AlertTriangle, RefreshCw, ChevronDown,
  Network, Shield, ExternalLink, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi } from '../utils/api'
import DeviceFormModal from '../components/devices/DeviceFormModal'

const DEVICE_TYPE_LABELS: Record<string, string> = {
  huawei_ne8000: 'Huawei NE8000',
  huawei_6730: 'Huawei 6730',
  datacom: 'Datacom',
  vsol_olt: 'VSOL OLT',
  mikrotik: 'Mikrotik',
  cisco: 'Cisco',
  juniper: 'Juniper',
  generic_router: 'Roteador',
  generic_switch: 'Switch',
  generic_olt: 'OLT',
  other: 'Outro',
}

const STATUS_LABELS: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  maintenance: 'Manutenção',
  unknown: 'Desconhecido',
  alert: 'Alerta',
}

const STATUS_BADGE_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  online:  { color: 'text-green-300',  bg: 'bg-green-500/15',  border: 'border-green-500/40' },
  offline: { color: 'text-red-300',    bg: 'bg-red-500/15',    border: 'border-red-500/40' },
  unknown: { color: 'text-slate-300',  bg: 'bg-slate-500/15',  border: 'border-slate-500/40' },
  maintenance: { color: 'text-yellow-300', bg: 'bg-yellow-500/15', border: 'border-yellow-500/40' },
  alert:   { color: 'text-orange-300', bg: 'bg-orange-500/15', border: 'border-orange-500/40' },
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: any; label: string; cls: string }> = {
    online: { icon: Wifi, label: 'Online', cls: 'badge-online' },
    offline: { icon: WifiOff, label: 'Offline', cls: 'badge-offline' },
    maintenance: { icon: AlertTriangle, label: 'Manutenção', cls: 'badge-maintenance' },
    unknown: { icon: Network, label: 'Desconhecido', cls: 'badge-unknown' },
    alert: { icon: AlertTriangle, label: 'Alerta', cls: 'badge-alert' },
  }
  const c = config[status] || config.unknown
  const Icon = c.icon
  return (
    <span className={c.cls}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  )
}

export default function DevicesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  // Ler o filtro de status da URL (?status=online, ?status=offline, etc.)
  const urlParams = new URLSearchParams(location.search)
  const urlStatus = urlParams.get('status') || ''

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState(urlStatus)
  const [showModal, setShowModal] = useState(false)
  const [editDevice, setEditDevice] = useState<any>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)

  // Sincronizar filterStatus quando a URL mudar (ex: ao clicar em outro card do dashboard)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const s = params.get('status') || ''
    setFilterStatus(s)
  }, [location.search])

  // Atualizar a URL quando o filtro de status mudar manualmente
  const handleStatusChange = (value: string) => {
    setFilterStatus(value)
    if (value) {
      navigate(`/devices?status=${value}`, { replace: true })
    } else {
      navigate('/devices', { replace: true })
    }
  }

  const { data: devices = [], isLoading, refetch } = useQuery({
    queryKey: ['devices', search, filterType, filterStatus],
    queryFn: () => devicesApi.list({
      search: search || undefined,
      device_type: filterType || undefined,
      status: filterStatus || undefined,
    }).then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => devicesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['device-stats'] })
      toast.success('Dispositivo removido com sucesso')
    },
    onError: () => toast.error('Erro ao remover dispositivo'),
  })

  const handleDelete = (device: any) => {
    if (confirm(`Remover "${device.name}"? Esta ação não pode ser desfeita.`)) {
      deleteMutation.mutate(device.id)
    }
  }

  // Buscar dispositivo completo antes de abrir o modal de edição
  const handleEditDevice = async (device: any) => {
    setLoadingEdit(true)
    try {
      const res = await devicesApi.get(device.id)
      setEditDevice(res.data)
      setShowModal(true)
    } catch {
      toast.error('Erro ao carregar dados do dispositivo')
    } finally {
      setLoadingEdit(false)
    }
  }

  // Badge de filtro ativo
  const activeStatusConfig = filterStatus ? STATUS_BADGE_CONFIG[filterStatus] : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispositivos</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-dark-400 text-sm">{devices.length} dispositivo(s) encontrado(s)</p>
            {filterStatus && activeStatusConfig && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${activeStatusConfig.bg} ${activeStatusConfig.color} ${activeStatusConfig.border}`}
              >
                Filtro: {STATUS_LABELS[filterStatus] || filterStatus}
                <button
                  onClick={() => handleStatusChange('')}
                  className="hover:opacity-70 transition-opacity"
                  title="Remover filtro"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => { setEditDevice(null); setShowModal(true) }}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Novo Dispositivo
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              type="text"
              placeholder="Buscar por nome, IP, hostname..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="input sm:w-48"
          >
            <option value="">Todos os tipos</option>
            {Object.entries(DEVICE_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => handleStatusChange(e.target.value)}
            className="input sm:w-40"
          >
            <option value="">Todos os status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="maintenance">Manutenção</option>
            <option value="unknown">Desconhecido</option>
          </select>
          <button onClick={() => refetch()} className="btn-secondary">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Devices Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 text-brand-400 animate-spin" />
        </div>
      ) : devices.length === 0 ? (
        <div className="card text-center py-16">
          <Server className="w-16 h-16 mx-auto mb-4 text-dark-600" />
          <h3 className="text-lg font-semibold text-white mb-2">
            {filterStatus
              ? `Nenhum dispositivo ${STATUS_LABELS[filterStatus]?.toLowerCase() || filterStatus}`
              : 'Nenhum dispositivo encontrado'}
          </h3>
          <p className="text-dark-400 mb-6">
            {filterStatus
              ? 'Tente remover o filtro ou verificar outros status'
              : 'Cadastre seu primeiro dispositivo de rede'}
          </p>
          {filterStatus ? (
            <button
              onClick={() => handleStatusChange('')}
              className="btn-secondary"
            >
              <X className="w-4 h-4" />
              Remover Filtro
            </button>
          ) : (
            <button
              onClick={() => { setEditDevice(null); setShowModal(true) }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Adicionar Dispositivo
            </button>
          )}
        </div>
      ) : (
        <div className="devices-grid">
          {devices.map((device: any, i: number) => (
            <motion.div
              key={device.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card group hover:border-brand-500/40 transition-all duration-200"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-dark-700 rounded-xl flex items-center justify-center flex-shrink-0">
                    {device.photo_url ? (
                      <img src={device.photo_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
                    ) : (
                      <Server className="w-5 h-5 text-dark-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-white truncate">{device.name}</h3>
                    <p className="text-xs text-dark-500 font-mono">{device.management_ip}</p>
                  </div>
                </div>
                <StatusBadge status={device.status} />
              </div>

              {/* Info */}
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-dark-500">Tipo</span>
                  <span className="text-dark-300">{DEVICE_TYPE_LABELS[device.device_type] || device.device_type}</span>
                </div>
                {device.location && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-dark-500">Local</span>
                    <span className="text-dark-300 truncate ml-4">{device.location}</span>
                  </div>
                )}
                {device.model && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-dark-500">Modelo</span>
                    <span className="text-dark-300">{device.model}</span>
                  </div>
                )}
                {device.last_seen && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-dark-500">Visto</span>
                    <span className="text-dark-400">
                      {new Date(device.last_seen).toLocaleString('pt-BR')}
                    </span>
                  </div>
                )}
              </div>

              {/* Tags */}
              {device.tags && device.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {device.tags.slice(0, 3).map((tag: string) => (
                    <span key={tag} className="badge bg-dark-700 text-dark-400 border border-dark-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-dark-700">
                <button
                  onClick={() => navigate(`/devices/${device.id}/terminal`)}
                  className="btn-primary btn-sm flex-1"
                  title="Abrir Terminal"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Terminal
                </button>
                <button
                  onClick={() => navigate(`/devices/${device.id}`)}
                  className="btn-secondary btn-sm"
                  title="Ver Detalhes"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleEditDevice(device)}
                  disabled={loadingEdit}
                  className="btn-secondary btn-sm"
                  title="Editar"
                >
                  {loadingEdit ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Edit2 className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(device)}
                  className="btn-ghost btn-sm text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  title="Remover"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Device Form Modal */}
      {showModal && (
        <DeviceFormModal
          device={editDevice}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false)
            queryClient.invalidateQueries({ queryKey: ['devices'] })
            queryClient.invalidateQueries({ queryKey: ['device-stats'] })
          }}
        />
      )}
    </div>
  )
}
