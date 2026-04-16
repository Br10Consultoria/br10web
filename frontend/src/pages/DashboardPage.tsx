import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Server, Wifi, WifiOff, AlertTriangle, Activity,
  Shield, Network, HardDrive, Clock, RefreshCw,
  CheckCircle, TrendingUp, TrendingDown, Zap, ChevronRight
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { devicesApi } from '../utils/api'
import { useAuthStore } from '../store/authStore'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../utils/api'

const STATUS_COLORS: Record<string, string> = {
  Online: '#22c55e',
  Offline: '#ef4444',
  Desconhecido: '#64748b',
}

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

const STATUS_CONFIG: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  online: { color: 'text-green-400', bg: 'bg-green-500/10', dot: 'bg-green-400', label: 'Online' },
  offline: { color: 'text-red-400', bg: 'bg-red-500/10', dot: 'bg-red-400', label: 'Offline' },
  unknown: { color: 'text-slate-400', bg: 'bg-slate-500/10', dot: 'bg-slate-400', label: 'Desconhecido' },
}

const STATUS_DOT_COLORS: Record<string, string> = {
  online: 'bg-green-400',
  offline: 'bg-red-400',
  unknown: 'bg-slate-400',
}

const STATUS_TEXT_COLORS: Record<string, string> = {
  online: 'text-green-400',
  offline: 'text-red-400',
  unknown: 'text-slate-400',
}

function StatCard({ icon: Icon, label, value, color, sub, onClick }: any) {
  const isClickable = !!onClick
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`card transition-all duration-200 ${
        isClickable
          ? 'cursor-pointer hover:border-brand-500/50 hover:shadow-lg hover:shadow-brand-500/10 hover:-translate-y-0.5'
          : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-1">
          {sub !== undefined && (
            <span className="text-xs text-dark-500">{sub}</span>
          )}
          {isClickable && (
            <ChevronRight className="w-4 h-4 text-dark-500" />
          )}
        </div>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-sm text-dark-400 mt-1">{label}</p>
    </motion.div>
  )
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [lastCheck, setLastCheck] = useState<Date | null>(null)

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['device-stats'],
    queryFn: () => devicesApi.stats().then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: devices, refetch: refetchDevices } = useQuery({
    queryKey: ['devices-recent'],
    queryFn: () => devicesApi.list({ limit: 10 }).then(r => r.data),
    refetchInterval: 60000,
  })

  // Botão "Verificar Status Agora"
  const checkStatusMutation = useMutation({
    mutationFn: () => api.post('/devices/check-status'),
    onSuccess: (res) => {
      const data = res.data
      setLastCheck(new Date())

      // Notificações de mudança de status
      if (data.changes && data.changes.length > 0) {
        data.changes.forEach((change: any) => {
          if (change.new_status === 'online') {
            toast.success(`${change.name} voltou a ficar online`, { duration: 5000 })
          } else if (change.new_status === 'offline') {
            toast.error(`${change.name} ficou offline!`, { duration: 8000 })
          }
        })
      } else {
        toast.success(`Verificação concluída — ${data.checked} dispositivos verificados`, { duration: 3000 })
      }

      // Atualizar queries
      queryClient.invalidateQueries({ queryKey: ['device-stats'] })
      queryClient.invalidateQueries({ queryKey: ['devices-recent'] })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: () => toast.error('Erro ao verificar status dos dispositivos'),
  })

  // Pie chart: apenas Online, Offline e Desconhecido (sem Manutenção)
  const pieData = stats ? [
    { name: 'Online', value: stats.online || 0 },
    { name: 'Offline', value: stats.offline || 0 },
    { name: 'Desconhecido', value: stats.unknown || 0 },
  ].filter(d => d.value > 0) : []

  // Calcular disponibilidade geral
  // Considera apenas dispositivos monitorados (online + offline), excluindo desconhecidos
  const monitoredDevices = stats ? (stats.online || 0) + (stats.offline || 0) : 0
  const availability = stats && monitoredDevices > 0
    ? Math.round((stats.online / monitoredDevices) * 100)
    : null

  // Agrupar dispositivos por tipo + status usando by_type_status do backend
  const typeStatusData: { typeKey: string; label: string; statuses: Record<string, number>; total: number }[] = []
  if (stats?.by_type_status) {
    Object.entries(stats.by_type_status).forEach(([typeKey, statusCounts]: [string, any]) => {
      const total = Object.values(statusCounts as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
      if (total > 0) {
        const label = DEVICE_TYPE_LABELS[typeKey] || typeKey.replace(/_/g, ' ').toUpperCase()
        typeStatusData.push({ typeKey, label, statuses: statusCounts, total })
      }
    })
    // Ordenar por total decrescente
    typeStatusData.sort((a, b) => b.total - a.total)
  } else if (stats?.by_type) {
    // Fallback: usar by_type sem breakdown de status
    Object.entries(stats.by_type).forEach(([typeKey, count]) => {
      if ((count as number) > 0) {
        const label = DEVICE_TYPE_LABELS[typeKey] || typeKey.replace(/_/g, ' ').toUpperCase()
        typeStatusData.push({ typeKey, label, statuses: {}, total: count as number })
      }
    })
    typeStatusData.sort((a, b) => b.total - a.total)
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-dark-400 text-sm mt-1">
            Bem-vindo, <span className="text-brand-400 font-medium">{user?.full_name}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastCheck && (
            <span className="text-xs text-dark-500 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-green-400" />
              Verificado às {lastCheck.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => checkStatusMutation.mutate()}
            disabled={checkStatusMutation.isPending}
            className="btn btn-primary flex items-center gap-2 text-sm"
          >
            {checkStatusMutation.isPending ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Verificando...</>
            ) : (
              <><Zap className="w-4 h-4" /> Verificar Status Agora</>
            )}
          </button>
          <span className="text-xs text-dark-500 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Auto a cada 5 min
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <StatCard
          icon={Server}
          label="Total de Dispositivos"
          value={stats?.total ?? 0}
          color="bg-brand-600/20 text-brand-400"
          onClick={() => navigate('/devices')}
        />
        <StatCard
          icon={Wifi}
          label="Online"
          value={stats?.online ?? 0}
          color="bg-green-500/20 text-green-400"
          onClick={() => navigate('/devices?status=online')}
        />
        <StatCard
          icon={WifiOff}
          label="Offline"
          value={stats?.offline ?? 0}
          color="bg-red-500/20 text-red-400"
          onClick={() => navigate('/devices?status=offline')}
        />
        <StatCard
          icon={AlertTriangle}
          label="Desconhecido"
          value={stats?.unknown ?? 0}
          color="bg-slate-500/20 text-slate-400"
          onClick={() => navigate('/devices?status=unknown')}
        />
      </div>

      {/* Charts + Uptime Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Pie Chart */}
        <div className="card lg:col-span-1">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-brand-400" />
            Status dos Dispositivos
          </h3>
          {stats && stats.total > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={STATUS_COLORS[entry.name] || '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '0.5rem',
                      color: '#f1f5f9',
                    }}
                  />
                  <Legend
                    formatter={(value) => <span className="text-dark-300 text-xs">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-dark-500">
              <div className="text-center">
                <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum dispositivo cadastrado</p>
              </div>
            </div>
          )}
        </div>

        {/* Dashboard de Uptime / Disponibilidade */}
        <div className="card lg:col-span-2">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-400" />
            Disponibilidade da Rede
          </h3>

          {/* Indicador principal de disponibilidade */}
          <div className="flex items-center gap-6 mb-6">
            <div className="relative w-24 h-24 shrink-0">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="40" fill="none"
                  stroke={availability !== null &&
                    (availability >= 90 ? '#f59e0b' : availability >= 70 ? '#f59e0b' : '#ef4444')}
                  strokeWidth="10"
                  strokeDasharray={`${(availability ?? 0) * 2.51} 251`}
                  strokeLinecap="round"
                />
                {/* Camada verde por cima proporcional à disponibilidade */}
                {availability !== null && availability > 0 && (
                  <circle
                    cx="50" cy="50" r="40" fill="none"
                    stroke={availability >= 95 ? '#22c55e' : availability >= 80 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="10"
                    strokeDasharray={`${availability * 2.51} 251`}
                    strokeLinecap="round"
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-bold text-white">{availability ?? '—'}%</span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-dark-400 text-sm mb-3">Disponibilidade geral dos dispositivos monitorados</p>
              <div className="space-y-2">
                {[
                  { label: 'Online', count: stats?.online ?? 0, color: 'bg-green-400' },
                  { label: 'Offline', count: stats?.offline ?? 0, color: 'bg-red-400' },
                  { label: 'Desconhecido', count: stats?.unknown ?? 0, color: 'bg-slate-400' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${item.color} shrink-0`} />
                    <span className="text-xs text-dark-400 flex-1">{item.label}</span>
                    <span className="text-xs font-mono text-dark-300">{item.count}</span>
                    {stats?.total ? (
                      <div className="w-20 h-1.5 bg-dark-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${item.color} rounded-full`}
                          style={{ width: `${Math.round((item.count / stats.total) * 100)}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tipos de dispositivos com breakdown por status */}
          {typeStatusData.length > 0 && (
            <div className="pt-4 border-t border-dark-700">
              <p className="text-xs text-dark-500 uppercase tracking-wider mb-3">Por Tipo de Equipamento</p>
              <div className="flex flex-wrap gap-2">
                {typeStatusData.map(({ typeKey, label, statuses, total }) => {
                  const onlineCount = statuses.online || 0
                  const offlineCount = statuses.offline || 0
                  const unknownCount = statuses.unknown || 0
                  const hasBreakdown = Object.keys(statuses).length > 0

                  return (
                    <div key={typeKey} className="flex items-center gap-2 bg-dark-700/60 rounded-lg px-3 py-2">
                      <Network className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                      <span className="text-xs text-dark-300 font-medium">{label}</span>
                      {hasBreakdown ? (
                        <div className="flex items-center gap-1.5 ml-1">
                          {onlineCount > 0 && (
                            <span className="flex items-center gap-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                              <span className="text-xs font-bold text-green-400">{onlineCount}</span>
                            </span>
                          )}
                          {offlineCount > 0 && (
                            <span className="flex items-center gap-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                              <span className="text-xs font-bold text-red-400">{offlineCount}</span>
                            </span>
                          )}
                          {unknownCount > 0 && (
                            <span className="flex items-center gap-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                              <span className="text-xs font-bold text-slate-400">{unknownCount}</span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-bold text-white ml-1">{total}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Devices */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Server className="w-4 h-4 text-brand-400" />
            Dispositivos Recentes
          </h3>
          <a href="/devices" className="text-xs text-brand-400 hover:text-brand-300">
            Ver todos →
          </a>
        </div>

        {devices && devices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700 text-left text-xs text-dark-400 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Dispositivo</th>
                  <th className="pb-3 pr-4">IP</th>
                  <th className="pb-3 pr-4">Tipo</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Local</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/50">
                {devices.map((device: any) => {
                  const sc = STATUS_CONFIG[device.status] || STATUS_CONFIG.unknown
                  return (
                    <tr key={device.id} className="hover:bg-dark-700/30 transition-colors">
                      <td className="py-3 pr-4">
                        <a href={`/devices/${device.id}`} className="text-brand-400 hover:text-brand-300 font-medium">
                          {device.name}
                        </a>
                      </td>
                      <td className="py-3 pr-4 font-mono text-dark-300 text-xs">{device.management_ip}</td>
                      <td className="py-3 pr-4 text-dark-400 text-xs">
                        {DEVICE_TYPE_LABELS[device.device_type] || device.device_type?.replace(/_/g, ' ').toUpperCase()}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${sc.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} animate-pulse`} />
                          {sc.label}
                        </span>
                      </td>
                      <td className="py-3 text-dark-400 text-xs">{device.location || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-10 text-dark-500">
            <Server className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Nenhum dispositivo cadastrado ainda.</p>
            <a href="/devices" className="btn btn-primary mt-3 inline-flex text-sm">
              Adicionar Dispositivo
            </a>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { href: '/devices', icon: Server, label: 'Novo Dispositivo', color: 'text-brand-400' },
          { href: '/vpn', icon: Shield, label: 'Config. VPN', color: 'text-purple-400' },
          { href: '/backup', icon: HardDrive, label: 'Fazer Backup', color: 'text-green-400' },
          { href: '/audit', icon: Activity, label: 'Ver Auditoria', color: 'text-yellow-400' },
        ].map(({ href, icon: Icon, label, color }) => (
          <a
            key={href}
            href={href}
            className="card flex flex-col items-center justify-center py-5 gap-2 text-center hover:border-dark-600 transition-colors cursor-pointer"
          >
            <Icon className={`w-6 h-6 ${color}`} />
            <span className="text-xs text-dark-300 font-medium">{label}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
