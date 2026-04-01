import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Server, Wifi, WifiOff, AlertTriangle, Activity,
  Shield, Network, HardDrive, TrendingUp, Clock
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { devicesApi } from '../utils/api'
import { useAuthStore } from '../store/authStore'

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#64748b']

function StatCard({ icon: Icon, label, value, color, trend }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card"
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            trend >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-sm text-dark-400 mt-1">{label}</p>
    </motion.div>
  )
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const { data: stats } = useQuery({
    queryKey: ['device-stats'],
    queryFn: () => devicesApi.stats().then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: devices } = useQuery({
    queryKey: ['devices-recent'],
    queryFn: () => devicesApi.list({ limit: 5 }).then(r => r.data),
  })

  const pieData = stats ? [
    { name: 'Online', value: stats.online },
    { name: 'Offline', value: stats.offline },
    { name: 'Manutenção', value: stats.maintenance },
    { name: 'Desconhecido', value: stats.unknown },
  ] : []

  const deviceTypeData = [
    { name: 'Huawei NE8000', count: 0 },
    { name: 'Huawei 6730', count: 0 },
    { name: 'Datacom', count: 0 },
    { name: 'VSOL OLT', count: 0 },
    { name: 'Mikrotik', count: 0 },
  ]

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
        <div className="flex items-center gap-2 text-xs text-dark-500">
          <Clock className="w-3.5 h-3.5" />
          <span>Atualizado automaticamente a cada 30s</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <StatCard
          icon={Server}
          label="Total de Dispositivos"
          value={stats?.total ?? 0}
          color="bg-brand-600/20 text-brand-400"
        />
        <StatCard
          icon={Wifi}
          label="Online"
          value={stats?.online ?? 0}
          color="bg-green-500/20 text-green-400"
        />
        <StatCard
          icon={WifiOff}
          label="Offline"
          value={stats?.offline ?? 0}
          color="bg-red-500/20 text-red-400"
        />
        <StatCard
          icon={AlertTriangle}
          label="Manutenção"
          value={stats?.maintenance ?? 0}
          color="bg-yellow-500/20 text-yellow-400"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Pie Chart */}
        <div className="card">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-brand-400" />
            Status dos Dispositivos
          </h3>
          {stats && stats.total > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
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
          ) : (
            <div className="h-48 flex items-center justify-center text-dark-500">
              <div className="text-center">
                <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum dispositivo cadastrado</p>
              </div>
            </div>
          )}
        </div>

        {/* Device Types Bar Chart */}
        <div className="card">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Network className="w-4 h-4 text-brand-400" />
            Tipos de Equipamentos
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={deviceTypeData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '0.5rem',
                  color: '#f1f5f9',
                }}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>IP</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Local</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device: any) => (
                  <tr key={device.id}>
                    <td>
                      <a href={`/devices/${device.id}`} className="text-brand-400 hover:text-brand-300 font-medium">
                        {device.name}
                      </a>
                    </td>
                    <td className="font-mono text-dark-300">{device.management_ip}</td>
                    <td className="text-dark-400">{device.device_type?.replace(/_/g, ' ').toUpperCase()}</td>
                    <td>
                      <span className={`badge-${device.status}`}>
                        <span className={`status-dot-${device.status}`} />
                        {device.status}
                      </span>
                    </td>
                    <td className="text-dark-400">{device.location || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-10 text-dark-500">
            <Server className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Nenhum dispositivo cadastrado ainda.</p>
            <a href="/devices" className="btn-primary btn-sm mt-3 inline-flex">
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
            className="card-hover flex flex-col items-center justify-center py-5 gap-2 text-center"
          >
            <Icon className={`w-6 h-6 ${color}`} />
            <span className="text-xs text-dark-300 font-medium">{label}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
