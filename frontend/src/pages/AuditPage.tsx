import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Search, RefreshCw, Shield } from 'lucide-react'
import { auditApi } from '../utils/api'

const ACTION_COLORS: Record<string, string> = {
  login: 'bg-green-500/10 text-green-400 border-green-500/20',
  logout: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  login_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  device_created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  device_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  device_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  terminal_session_started: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  terminal_session_ended: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  vpn_created: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  backup_created: 'bg-green-500/10 text-green-400 border-green-500/20',
}

const STATUS_COLORS: Record<string, string> = {
  success: 'badge-online',
  failure: 'badge-offline',
  warning: 'badge-maintenance',
}

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const perPage = 50

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit', page, search],
    queryFn: () => auditApi.list({ page, per_page: perPage, search }).then(r => r.data),
  })

  const logs = data?.items || []
  const total = data?.total || 0

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
              placeholder="Buscar por usuário, ação, IP..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="input pl-10"
            />
          </div>
        </div>

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
                      <td className="text-dark-400 text-sm">{log.device_name || '—'}</td>
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

            {total > perPage && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-dark-700">
                <p className="text-sm text-dark-500">
                  Mostrando {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} de {total}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * perPage >= total}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    Próximo
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
