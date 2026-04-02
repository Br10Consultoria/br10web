import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, RefreshCw, Shield, Filter } from 'lucide-react'
import { auditApi } from '../utils/api'

const ACTION_COLORS: Record<string, string> = {
  login: 'bg-green-500/10 text-green-400 border-green-500/20',
  logout: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  login_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  password_changed: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  '2fa_enabled': 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  '2fa_disabled': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  device_created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  device_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  device_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  device_connected: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  device_disconnected: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  terminal_session_started: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  terminal_session_ended: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  terminal_command: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  vpn_created: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  vpn_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  vpn_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  vpn_connected: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  vpn_disconnected: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  backup_created: 'bg-green-500/10 text-green-400 border-green-500/20',
  backup_restored: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  user_created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  user_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  user_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  route_created: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  route_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  route_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const ACTION_GROUPS: Record<string, string[]> = {
  'Autenticação': ['login', 'logout', 'login_failed', 'password_changed', '2fa_enabled', '2fa_disabled'],
  'Dispositivos': ['device_created', 'device_updated', 'device_deleted', 'device_connected', 'device_disconnected'],
  'Terminal': ['terminal_session_started', 'terminal_session_ended', 'terminal_command'],
  'VPN': ['vpn_created', 'vpn_updated', 'vpn_deleted', 'vpn_connected', 'vpn_disconnected'],
  'Backup': ['backup_created', 'backup_restored'],
  'Usuários': ['user_created', 'user_updated', 'user_deleted'],
  'Rotas': ['route_created', 'route_updated', 'route_deleted'],
}

const STATUS_COLORS: Record<string, string> = {
  success: 'badge-online',
  failure: 'badge-offline',
  warning: 'badge-maintenance',
}

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const perPage = 50

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit', page, search, actionFilter, statusFilter],
    queryFn: () => auditApi.list({
      page,
      per_page: perPage,
      search: search || undefined,
      action: actionFilter || undefined,
      status: statusFilter || undefined,
    }).then(r => r.data),
  })

  const logs = data?.items || []
  const total = data?.total || 0

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handleActionFilter = (v: string) => { setActionFilter(v); setPage(1) }
  const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(1) }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Log de Auditoria</h1>
          <p className="text-dark-400 text-sm">Registro completo de todas as ações do sistema</p>
        </div>
        <button onClick={() => refetch()} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              type="text"
              placeholder="Buscar por usuário, descrição, IP..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-dark-500 shrink-0" />
            <select
              value={actionFilter}
              onChange={e => handleActionFilter(e.target.value)}
              className="input min-w-[180px]"
            >
              <option value="">Todas as ações</option>
              {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
                <optgroup key={group} label={group}>
                  {actions.map(action => (
                    <option key={action} value={action}>{action.replace(/_/g, ' ')}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={e => handleStatusFilter(e.target.value)}
              className="input min-w-[130px]"
            >
              <option value="">Todos os status</option>
              <option value="success">Sucesso</option>
              <option value="failure">Falha</option>
              <option value="warning">Aviso</option>
            </select>
          </div>
        </div>
        {(actionFilter || statusFilter) && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {actionFilter && (
              <span className="badge bg-brand-500/10 text-brand-400 border border-brand-500/20 text-xs">
                Ação: {actionFilter.replace(/_/g, ' ')}
                <button onClick={() => handleActionFilter('')} className="ml-2 hover:text-white">×</button>
              </span>
            )}
            {statusFilter && (
              <span className="badge bg-brand-500/10 text-brand-400 border border-brand-500/20 text-xs">
                Status: {statusFilter}
                <button onClick={() => handleStatusFilter('')} className="ml-2 hover:text-white">×</button>
              </span>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-10 bg-dark-700 rounded animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-10 text-dark-500">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">Nenhum registro encontrado</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ação</th>
                    <th>Usuário</th>
                    <th>IP</th>
                    <th>Dispositivo</th>
                    <th>Descrição</th>
                    <th>Status</th>
                    <th>Data/Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => (
                    <tr key={log.id}>
                      <td>
                        <span className={`badge border font-mono text-xs ${ACTION_COLORS[log.action] || 'bg-dark-700 text-dark-400 border-dark-600'}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="font-medium text-white">{log.username || '—'}</td>
                      <td className="font-mono text-dark-400 text-xs">{log.ip_address || '—'}</td>
                      <td className="text-dark-400 text-sm">
                        {log.device_name ? (
                          <span>
                            {log.device_name}
                            {log.device_ip && (
                              <span className="block text-xs text-dark-500 font-mono">{log.device_ip}</span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-dark-300 text-sm max-w-xs truncate">{log.description || '—'}</td>
                      <td>
                        <span className={STATUS_COLORS[log.status] || 'badge-maintenance'}>
                          {log.status}
                        </span>
                      </td>
                      <td className="text-dark-500 text-xs whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-dark-700">
              <p className="text-sm text-dark-500">
                {total > 0
                  ? `Mostrando ${((page - 1) * perPage) + 1}–${Math.min(page * perPage, total)} de ${total} registros`
                  : 'Nenhum registro'}
              </p>
              {total > perPage && (
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span className="text-dark-500 text-sm">
                    {page} / {Math.ceil(total / perPage)}
                  </span>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * perPage >= total}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    Próximo
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
