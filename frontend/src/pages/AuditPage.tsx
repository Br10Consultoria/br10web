import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, RefreshCw, Shield, Filter, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { auditApi } from '../utils/api'

const ACTION_COLORS: Record<string, string> = {
  // Autenticação
  login: 'bg-green-500/10 text-green-400 border-green-500/20',
  logout: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  login_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  password_changed: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  '2fa_enabled': 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  '2fa_disabled': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  // Dispositivos
  device_created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  device_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  device_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  device_connected: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  device_disconnected: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  device_connection_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  // Terminal
  terminal_session_started: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  terminal_session_ended: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  terminal_command: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  terminal_connection_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  // Automação
  command_executed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  command_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  // VPN
  vpn_created: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  vpn_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  vpn_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  vpn_connected: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  vpn_disconnected: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  vpn_connection_failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  // Backup DB
  backup_created: 'bg-green-500/10 text-green-400 border-green-500/20',
  backup_restored: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  // Playbooks
  playbook_created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  playbook_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  playbook_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  playbook_executed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  // Backup de Dispositivos
  backup_schedule_created: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  backup_schedule_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  backup_schedule_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  backup_schedule_executed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  // Monitor RPKI
  rpki_monitor_created: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  rpki_monitor_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  rpki_monitor_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  rpki_monitor_checked: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  // CGNAT
  cgnat_generated: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  cgnat_saved: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  cgnat_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  // Usuários
  user_created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  user_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  user_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  // Rotas
  route_created: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  route_updated: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  route_deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
  // Logs Adicionais
  access_log: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  service_execution: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  backend_error: 'bg-red-500/10 text-red-400 border-red-500/20',
  frontend_error: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  equipment_access: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Login',
  logout: 'Logout',
  login_failed: 'Login Falhou',
  password_changed: 'Senha Alterada',
  '2fa_enabled': '2FA Ativado',
  '2fa_disabled': '2FA Desativado',
  device_created: 'Dispositivo Criado',
  device_updated: 'Dispositivo Atualizado',
  device_deleted: 'Dispositivo Removido',
  device_connected: 'Dispositivo Conectado',
  device_disconnected: 'Dispositivo Desconectado',
  device_connection_failed: 'Falha de Conexão',
  terminal_session_started: 'Terminal Iniciado',
  terminal_session_ended: 'Terminal Encerrado',
  terminal_command: 'Comando Terminal',
  terminal_connection_failed: 'Falha no Terminal',
  command_executed: 'Comando Executado',
  command_failed: 'Comando Falhou',
  vpn_created: 'VPN Criada',
  vpn_updated: 'VPN Atualizada',
  vpn_deleted: 'VPN Removida',
  vpn_connected: 'VPN Conectada',
  vpn_disconnected: 'VPN Desconectada',
  vpn_connection_failed: 'Falha VPN',
  backup_created: 'Backup DB Criado',
  backup_restored: 'Backup DB Restaurado',
  playbook_created: 'Playbook Criado',
  playbook_updated: 'Playbook Atualizado',
  playbook_deleted: 'Playbook Removido',
  playbook_executed: 'Playbook Executado',
  backup_schedule_created: 'Agendamento Criado',
  backup_schedule_updated: 'Agendamento Atualizado',
  backup_schedule_deleted: 'Agendamento Removido',
  backup_schedule_executed: 'Backup Executado',
  rpki_monitor_created: 'Monitor RPKI Criado',
  rpki_monitor_updated: 'Monitor RPKI Atualizado',
  rpki_monitor_deleted: 'Monitor RPKI Removido',
  rpki_monitor_checked: 'Verificação RPKI',
  user_created: 'Usuário Criado',
  user_updated: 'Usuário Atualizado',
  user_deleted: 'Usuário Removido',
  route_created: 'Rota Criada',
  route_updated: 'Rota Atualizada',
  route_deleted: 'Rota Removida',
  export_data: 'Exportação',
  import_data: 'Importação',
  cgnat_generated: 'CGNAT Gerado',
  cgnat_saved: 'CGNAT Salvo',
  cgnat_deleted: 'CGNAT Removido',
  access_log: 'Log de Acesso',
  service_execution: 'Execução de Serviço',
  backend_error: 'Erro de Backend',
  frontend_error: 'Erro de Frontend',
  equipment_access: 'Acesso a Equipamento',
}

const ACTION_GROUPS: Record<string, string[]> = {
  'Autenticação': ['login', 'logout', 'login_failed', 'password_changed', '2fa_enabled', '2fa_disabled'],
  'Dispositivos': ['device_created', 'device_updated', 'device_deleted', 'device_connected', 'device_disconnected', 'device_connection_failed'],
  'Terminal': ['terminal_session_started', 'terminal_session_ended', 'terminal_command', 'terminal_connection_failed'],
  'Automação': ['command_executed', 'command_failed'],
  'VPN': ['vpn_created', 'vpn_updated', 'vpn_deleted', 'vpn_connected', 'vpn_disconnected', 'vpn_connection_failed'],
  'Backup DB': ['backup_created', 'backup_restored'],
  'Playbooks': ['playbook_created', 'playbook_updated', 'playbook_deleted', 'playbook_executed'],
  'Backup Dispositivos': ['backup_schedule_created', 'backup_schedule_updated', 'backup_schedule_deleted', 'backup_schedule_executed'],
  'Monitor RPKI': ['rpki_monitor_created', 'rpki_monitor_updated', 'rpki_monitor_deleted', 'rpki_monitor_checked'],
  'CGNAT': ['cgnat_generated', 'cgnat_saved', 'cgnat_deleted'],
  'Usuários': ['user_created', 'user_updated', 'user_deleted'],
  'Rotas': ['route_created', 'route_updated', 'route_deleted'],
  'Logs de Sistema': ['access_log', 'service_execution', 'backend_error', 'frontend_error', 'equipment_access'],
}

const STATUS_COLORS: Record<string, string> = {
  success: 'badge-online',
  failure: 'badge-offline',
  warning: 'badge-maintenance',
}

const STATUS_LABELS: Record<string, string> = {
  success: 'Sucesso',
  failure: 'Falha',
  warning: 'Aviso',
}

function ExtraDataModal({ log, onClose }: { log: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-dark-900 border border-dark-700 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white text-sm">Detalhes do Evento</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-white text-lg leading-none">×</button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <span className="text-dark-500 text-xs uppercase tracking-wide">Ação</span>
            <p className="text-white mt-0.5">
              <span className={`badge border font-mono text-xs ${ACTION_COLORS[log.action] || 'bg-dark-700 text-dark-400 border-dark-600'}`}>
                {ACTION_LABELS[log.action] || log.action}
              </span>
            </p>
          </div>

          <div>
            <span className="text-dark-500 text-xs uppercase tracking-wide">Descrição</span>
            <p className="text-dark-300 mt-0.5">{log.description || '—'}</p>
          </div>

          {log.error_message && (
            <div>
              <span className="text-dark-500 text-xs uppercase tracking-wide">Mensagem de Erro</span>
              <p className="text-red-400 mt-0.5 font-mono text-xs bg-red-500/5 border border-red-500/20 rounded p-2">
                {log.error_message}
              </p>
            </div>
          )}

          {log.extra_data && (
            <div>
              <span className="text-dark-500 text-xs uppercase tracking-wide">Dados Extras</span>
              <pre className="text-dark-300 mt-0.5 font-mono text-xs bg-dark-800 border border-dark-700 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(log.extra_data, null, 2)}
              </pre>
            </div>
          )}

          {(log.old_values || log.new_values) && (
            <div className="grid grid-cols-2 gap-3">
              {log.old_values && (
                <div>
                  <span className="text-dark-500 text-xs uppercase tracking-wide">Valores Anteriores</span>
                  <pre className="text-dark-300 mt-0.5 font-mono text-xs bg-dark-800 border border-dark-700 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(log.old_values, null, 2)}
                  </pre>
                </div>
              )}
              {log.new_values && (
                <div>
                  <span className="text-dark-500 text-xs uppercase tracking-wide">Novos Valores</span>
                  <pre className="text-dark-300 mt-0.5 font-mono text-xs bg-dark-800 border border-dark-700 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(log.new_values, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-dark-700">
            <div>
              <span className="text-dark-500 text-xs uppercase tracking-wide">Usuário</span>
              <p className="text-white mt-0.5">{log.username || '—'}</p>
            </div>
            <div>
              <span className="text-dark-500 text-xs uppercase tracking-wide">IP do Usuário</span>
              <p className="text-dark-300 font-mono mt-0.5">{log.ip_address || '—'}</p>
            </div>
            {log.device_name && (
              <div>
                <span className="text-dark-500 text-xs uppercase tracking-wide">Dispositivo</span>
                <p className="text-white mt-0.5">{log.device_name}</p>
                {log.device_ip && <p className="text-dark-500 font-mono text-xs">{log.device_ip}</p>}
              </div>
            )}
            <div>
              <span className="text-dark-500 text-xs uppercase tracking-wide">Data/Hora</span>
              <p className="text-dark-300 mt-0.5">{new Date(log.created_at).toLocaleString('pt-BR')}</p>
            </div>
          </div>

          {log.user_agent && (
            <div>
              <span className="text-dark-500 text-xs uppercase tracking-wide">User-Agent</span>
              <p className="text-dark-500 mt-0.5 text-xs truncate">{log.user_agent}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedLog, setSelectedLog] = useState<any>(null)
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
    refetchInterval: 30000, // Auto-refresh a cada 30s
  })

  const logs = data?.items || []
  const total = data?.total || 0

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handleActionFilter = (v: string) => { setActionFilter(v); setPage(1) }
  const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(1) }

  // Estatísticas rápidas
  const failureCount = logs.filter((l: any) => l.status === 'failure').length
  const terminalCount = logs.filter((l: any) => l.action?.startsWith('terminal')).length
  const vpnCount = logs.filter((l: any) => l.action?.startsWith('vpn')).length

  return (
    <div className="space-y-6">
      {selectedLog && (
        <ExtraDataModal log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Log de Auditoria</h1>
          <p className="text-dark-400 text-sm">Registro completo de todas as ações do sistema — atualiza automaticamente a cada 30s</p>
        </div>
        <button onClick={() => refetch()} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      </div>

      {/* Estatísticas rápidas */}
      {!isLoading && logs.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-dark-500">Falhas (página atual)</p>
              <p className="text-lg font-bold text-red-400">{failureCount}</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <span className="text-purple-400 text-xs font-bold">SSH</span>
            </div>
            <div>
              <p className="text-xs text-dark-500">Eventos Terminal</p>
              <p className="text-lg font-bold text-purple-400">{terminalCount}</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <span className="text-indigo-400 text-xs font-bold">VPN</span>
            </div>
            <div>
              <p className="text-xs text-dark-500">Eventos VPN</p>
              <p className="text-lg font-bold text-indigo-400">{vpnCount}</p>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              type="text"
              placeholder="Buscar por usuário, descrição, IP, dispositivo..."
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
              className="input min-w-[200px]"
            >
              <option value="">Todas as ações</option>
              {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
                <optgroup key={group} label={group}>
                  {actions.map(action => (
                    <option key={action} value={action}>
                      {ACTION_LABELS[action] || action.replace(/_/g, ' ')}
                    </option>
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
                Ação: {ACTION_LABELS[actionFilter] || actionFilter.replace(/_/g, ' ')}
                <button onClick={() => handleActionFilter('')} className="ml-2 hover:text-white">×</button>
              </span>
            )}
            {statusFilter && (
              <span className="badge bg-brand-500/10 text-brand-400 border border-brand-500/20 text-xs">
                Status: {STATUS_LABELS[statusFilter] || statusFilter}
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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => (
                    <tr
                      key={log.id}
                      className={log.status === 'failure' ? 'bg-red-500/3' : ''}
                    >
                      <td>
                        <span className={`badge border font-mono text-xs ${ACTION_COLORS[log.action] || 'bg-dark-700 text-dark-400 border-dark-600'}`}>
                          {ACTION_LABELS[log.action] || log.action}
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
                      <td className="text-dark-300 text-sm max-w-xs">
                        <span className="truncate block max-w-[280px]" title={log.description}>
                          {log.description || '—'}
                        </span>
                        {log.error_message && (
                          <span className="block text-xs text-red-400 truncate max-w-[280px]" title={log.error_message}>
                            ↳ {log.error_message}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={STATUS_COLORS[log.status] || 'badge-maintenance'}>
                          {STATUS_LABELS[log.status] || log.status}
                        </span>
                      </td>
                      <td className="text-dark-500 text-xs whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td>
                        {(log.extra_data || log.error_message || log.old_values || log.new_values) && (
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="p-1 rounded hover:bg-dark-700 text-dark-500 hover:text-white transition-colors"
                            title="Ver detalhes"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                        )}
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
