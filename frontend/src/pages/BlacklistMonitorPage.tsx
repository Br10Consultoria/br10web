/**
 * BR10 NetManager - Página de Monitoramento de Blacklist / Reputação IP
 *
 * Funcionalidades:
 *  - Consulta manual de IP, domínio ou ASN
 *  - Cadastro de monitores para verificação automática diária (02h)
 *  - Histórico de verificações por monitor
 *  - Configuração da chave de API do MxToolbox
 */
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle, XCircle, Search, Plus, Trash2,
  RefreshCw, Key, Eye, EyeOff, ChevronDown, ChevronUp,
  Clock, Shield, Globe, Loader2, Settings, X, Building2,
  ExternalLink, AlertCircle, Info, Play
} from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BlacklistMonitor {
  id: string
  name: string
  description?: string
  target: string
  target_type: string
  client_id?: string
  client_name?: string
  last_status?: string
  last_checked_at?: string
  last_listed_count: number
  last_checked_count: number
  last_blacklists: BlacklistEntry[]
  last_error?: string
  active: boolean
  alert_on_listed: boolean
  created_at: string
}

interface BlacklistEntry {
  name: string
  url?: string
  info?: string
  status: 'listed' | 'clean'
}

interface BlacklistCheck {
  id: string
  target: string
  target_type: string
  status: string
  listed_count: number
  checked_count: number
  blacklists_found: BlacklistEntry[]
  all_results: BlacklistEntry[]
  error_message?: string
  trigger_type: string
  duration_ms?: number
  checked_at: string
}

interface Summary {
  total_monitors: number
  listed: number
  clean: number
  errors: number
  never_checked: number
  last_check_at?: string
  api_key_configured: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  clean: {
    label: 'Limpo',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-500/30',
    icon: CheckCircle,
  },
  listed: {
    label: 'Listado',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-500/30',
    icon: XCircle,
  },
  error: {
    label: 'Erro',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-500/30',
    icon: AlertCircle,
  },
  unknown: {
    label: 'Não verificado',
    color: 'text-dark-400',
    bg: 'bg-dark-700/50',
    border: 'border-dark-600',
    icon: Clock,
  },
}

function StatusBadge({ status }: { status?: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.unknown
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function BlacklistMonitorPage() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'monitors' | 'manual' | 'settings'>('monitors')

  // ── Consulta manual ──
  const [manualTarget, setManualTarget] = useState('')
  const [manualType, setManualType] = useState('ip')
  const [manualResult, setManualResult] = useState<BlacklistCheck | null>(null)
  const [showAllResults, setShowAllResults] = useState(false)

  // ── Novo monitor ──
  const [showAddForm, setShowAddForm] = useState(false)
  const [newMonitor, setNewMonitor] = useState({
    name: '', target: '', target_type: 'ip', client_id: '', description: '', alert_on_listed: true,
  })

  // ── Clientes cadastrados ──
  const [clients, setClients] = useState<{id: string; name: string}[]>([])
  useEffect(() => {
    api.get('/clients').then(r => setClients(r.data || [])).catch(() => {})
  }, [])

  // ── Histórico expandido ──
  const [expandedMonitor, setExpandedMonitor] = useState<string | null>(null)

  // ── Configuração de API Key ──
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)

  // ── Dados ──
  const { data: summary } = useQuery<Summary>({
    queryKey: ['blacklist-summary'],
    queryFn: () => api.get('/blacklist/summary').then(r => r.data),
    refetchInterval: 60_000,
  })

  const { data: monitors = [], isLoading: loadingMonitors } = useQuery<BlacklistMonitor[]>({
    queryKey: ['blacklist-monitors'],
    queryFn: () => api.get('/blacklist/monitors').then(r => r.data),
  })

  const { data: history = [], isLoading: loadingHistory } = useQuery<BlacklistCheck[]>({
    queryKey: ['blacklist-history', expandedMonitor],
    queryFn: () => api.get(`/blacklist/monitors/${expandedMonitor}/history?limit=20`).then(r => r.data),
    enabled: !!expandedMonitor,
  })

  // ── Mutations ──
  const manualCheckMut = useMutation({
    mutationFn: (data: { target: string; target_type: string }) =>
      api.post('/blacklist/check', data).then(r => r.data),
    onSuccess: (data) => {
      setManualResult(data)
      setShowAllResults(false)
    },
    onError: () => toast.error('Erro ao consultar blacklist'),
  })

  const createMonitorMut = useMutation({
    mutationFn: (data: typeof newMonitor) => {
      const payload = {
        ...data,
        client_id: data.client_id && data.client_id.trim() ? data.client_id : null,
      }
      return api.post('/blacklist/monitors', payload).then(r => r.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blacklist-monitors'] })
      qc.invalidateQueries({ queryKey: ['blacklist-summary'] })
      setShowAddForm(false)
      setNewMonitor({ name: '', target: '', target_type: 'ip', client_id: '', description: '', alert_on_listed: true })
      toast.success('Monitor criado com sucesso!')
    },
    onError: () => toast.error('Erro ao criar monitor'),
  })

  const deleteMonitorMut = useMutation({
    mutationFn: (id: string) => api.delete(`/blacklist/monitors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blacklist-monitors'] })
      qc.invalidateQueries({ queryKey: ['blacklist-summary'] })
      toast.success('Monitor removido')
    },
    onError: () => toast.error('Erro ao remover monitor'),
  })

  const checkNowMut = useMutation({
    mutationFn: (id: string) => api.post(`/blacklist/monitors/${id}/check`).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['blacklist-monitors'] })
      qc.invalidateQueries({ queryKey: ['blacklist-summary'] })
      qc.invalidateQueries({ queryKey: ['blacklist-history', data.monitor_id] })
      const st = data.status === 'clean' ? 'Limpo ✓' : data.status === 'listed' ? `Listado em ${data.listed_count} blacklist(s)!` : 'Erro na verificação'
      data.status === 'listed' ? toast.error(st) : toast.success(st)
    },
    onError: () => toast.error('Erro ao verificar'),
  })

  const saveApiKeyMut = useMutation({
    mutationFn: (key: string) =>
      api.post('/blacklist/api-keys', { service: 'mxtoolbox', api_key: key, label: 'MxToolbox API Key' }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blacklist-summary'] })
      toast.success('Chave de API salva com sucesso!')
      setApiKey('')
    },
    onError: () => toast.error('Erro ao salvar chave de API'),
  })

  const testApiKeyMut = useMutation({
    mutationFn: () => api.post('/blacklist/api-keys/mxtoolbox/test').then(r => r.data),
    onSuccess: (data) => {
      data.valid ? toast.success('Chave válida! API funcionando.') : toast.error(`Chave inválida: ${data.error}`)
    },
    onError: () => toast.error('Erro ao testar chave'),
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <AlertTriangle className="w-7 h-7 text-orange-400" />
            Blacklist / Reputação IP
          </h1>
          <p className="text-dark-400 mt-1 text-sm">
            Monitoramento de IPs, domínios e prefixos contra blacklists via MxToolbox.
            Verificação automática diária às 02h.
          </p>
        </div>
        {!summary?.api_key_configured && (
          <button
            onClick={() => setActiveTab('settings')}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg hover:bg-orange-500/20 text-sm"
          >
            <Key className="w-4 h-4" />
            Configurar API Key
          </button>
        )}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Monitores', value: summary.total_monitors, color: 'text-white', bg: 'bg-dark-800' },
            { label: 'Limpos', value: summary.clean, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { label: 'Listados', value: summary.listed, color: 'text-red-400', bg: 'bg-red-500/10' },
            { label: 'Erros', value: summary.errors, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
            { label: 'Nunca Verificados', value: summary.never_checked, color: 'text-dark-400', bg: 'bg-dark-800' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} border border-dark-700 rounded-xl p-4 text-center`}>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-dark-400 text-xs mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-dark-700">
        {[
          { id: 'monitors', label: 'Monitores', icon: Shield },
          { id: 'manual', label: 'Consulta Manual', icon: Search },
          { id: 'settings', label: 'Configurações', icon: Settings },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-dark-400 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Monitores ── */}
      {activeTab === 'monitors' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-dark-400 text-sm">
              {monitors.length} monitor(es) cadastrado(s) — verificação automática diária às 02h
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              Novo Monitor
            </button>
          </div>

          {/* Formulário de novo monitor */}
          {showAddForm && (
            <div className="card border border-brand-500/30 bg-brand-500/5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">Novo Monitor de Blacklist</h3>
                <button onClick={() => setShowAddForm(false)} className="btn-ghost p-1 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-dark-300 mb-1">Nome *</label>
                  <input
                    className="input w-full"
                    placeholder="ex: IP Principal AS12345"
                    value={newMonitor.name}
                    onChange={e => setNewMonitor(p => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm text-dark-300 mb-1">Alvo *</label>
                  <input
                    className="input w-full"
                    placeholder="ex: 200.71.84.1 ou dominio.com"
                    value={newMonitor.target}
                    onChange={e => setNewMonitor(p => ({ ...p, target: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm text-dark-300 mb-1">Tipo</label>
                  <select
                    className="input w-full"
                    value={newMonitor.target_type}
                    onChange={e => setNewMonitor(p => ({ ...p, target_type: e.target.value }))}
                  >
                    <option value="ip">IP / CIDR</option>
                    <option value="domain">Domínio</option>
                    <option value="asn">ASN</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-dark-300 mb-1">Cliente (opcional)</label>
                  <select
                    className="input w-full"
                    value={newMonitor.client_id}
                    onChange={e => setNewMonitor(p => ({ ...p, client_id: e.target.value }))}
                  >
                    <option value="">-- Sem cliente --</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-dark-300 mb-1">Descrição (opcional)</label>
                  <input
                    className="input w-full"
                    placeholder="Descrição do monitor"
                    value={newMonitor.description}
                    onChange={e => setNewMonitor(p => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="alert_on_listed"
                    checked={newMonitor.alert_on_listed}
                    onChange={e => setNewMonitor(p => ({ ...p, alert_on_listed: e.target.checked }))}
                    className="rounded"
                  />
                  <label htmlFor="alert_on_listed" className="text-sm text-dark-300">
                    Alertar quando listado em blacklist
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setShowAddForm(false)} className="btn-secondary text-sm">
                  Cancelar
                </button>
                <button
                  onClick={() => createMonitorMut.mutate(newMonitor)}
                  disabled={!newMonitor.name || !newMonitor.target || createMonitorMut.isPending}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  {createMonitorMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Criar Monitor
                </button>
              </div>
            </div>
          )}

          {/* Lista de monitores */}
          {loadingMonitors ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
            </div>
          ) : monitors.length === 0 ? (
            <div className="card text-center py-12">
              <AlertTriangle className="w-12 h-12 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400">Nenhum monitor cadastrado.</p>
              <p className="text-dark-500 text-sm mt-1">Clique em "Novo Monitor" para começar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {monitors.map(monitor => (
                <div key={monitor.id} className="card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-white">{monitor.name}</h3>
                        <StatusBadge status={monitor.last_status} />
                        {monitor.last_listed_count > 0 && (
                          <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                            {monitor.last_listed_count} blacklist(s)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                        <span className="text-sm text-brand-400 font-mono">{monitor.target}</span>
                        <span className="text-xs text-dark-500 uppercase">{monitor.target_type}</span>
                        {monitor.client_name && (
                          <span className="flex items-center gap-1 text-xs text-dark-400">
                            <Building2 className="w-3 h-3" />
                            {monitor.client_name}
                          </span>
                        )}
                        {monitor.last_checked_at && (
                          <span className="flex items-center gap-1 text-xs text-dark-500">
                            <Clock className="w-3 h-3" />
                            {formatDate(monitor.last_checked_at)}
                          </span>
                        )}
                        {monitor.last_checked_count > 0 && (
                          <span className="text-xs text-dark-500">
                            {monitor.last_checked_count} blacklists verificadas
                          </span>
                        )}
                      </div>
                      {monitor.last_error && (
                        <p className="text-xs text-yellow-400 mt-1">{monitor.last_error}</p>
                      )}
                      {/* Blacklists onde está listado */}
                      {monitor.last_blacklists && monitor.last_blacklists.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {monitor.last_blacklists.map((bl, i) => (
                            <span key={i} className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded">
                              {bl.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => checkNowMut.mutate(monitor.id)}
                        disabled={checkNowMut.isPending}
                        title="Verificar agora"
                        className="btn-ghost p-2 rounded-lg text-brand-400 hover:text-brand-300"
                      >
                        {checkNowMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => setExpandedMonitor(expandedMonitor === monitor.id ? null : monitor.id)}
                        title="Ver histórico"
                        className="btn-ghost p-2 rounded-lg text-dark-400 hover:text-white"
                      >
                        {expandedMonitor === monitor.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remover monitor "${monitor.name}"?`)) deleteMonitorMut.mutate(monitor.id)
                        }}
                        title="Remover"
                        className="btn-ghost p-2 rounded-lg text-dark-500 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Histórico expandido */}
                  {expandedMonitor === monitor.id && (
                    <div className="mt-4 pt-4 border-t border-dark-700">
                      <h4 className="text-sm font-medium text-dark-300 mb-3">Histórico de Verificações</h4>
                      {loadingHistory ? (
                        <div className="flex items-center gap-2 text-dark-400 text-sm">
                          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
                        </div>
                      ) : history.length === 0 ? (
                        <p className="text-dark-500 text-sm">Nenhuma verificação registrada.</p>
                      ) : (
                        <div className="space-y-2">
                          {history.map(check => (
                            <div key={check.id} className="flex items-center gap-4 text-sm py-2 border-b border-dark-800 last:border-0">
                              <StatusBadge status={check.status} />
                              <span className="text-dark-400">{formatDate(check.checked_at)}</span>
                              {check.listed_count > 0 && (
                                <span className="text-red-400">{check.listed_count}/{check.checked_count} blacklists</span>
                              )}
                              {check.listed_count === 0 && check.checked_count > 0 && (
                                <span className="text-dark-500">{check.checked_count} blacklists verificadas</span>
                              )}
                              <span className="text-dark-600 text-xs capitalize">{check.trigger_type}</span>
                              {check.duration_ms && (
                                <span className="text-dark-600 text-xs">{check.duration_ms}ms</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Consulta Manual ── */}
      {activeTab === 'manual' && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-brand-400" />
              Consulta Manual de Blacklist
            </h3>
            <p className="text-dark-400 text-sm mb-4">
              Verifique qualquer IP, domínio ou prefixo CIDR contra centenas de blacklists em tempo real.
              Esta consulta não é salva como monitor.
            </p>
            <div className="flex gap-3">
              <select
                className="input w-32 flex-shrink-0"
                value={manualType}
                onChange={e => setManualType(e.target.value)}
              >
                <option value="ip">IP / CIDR</option>
                <option value="domain">Domínio</option>
              </select>
              <input
                className="input flex-1"
                placeholder={manualType === 'ip' ? 'ex: 200.71.84.1 ou 200.71.84.0/24' : 'ex: dominio.com.br'}
                value={manualTarget}
                onChange={e => setManualTarget(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && manualTarget && manualCheckMut.mutate({ target: manualTarget, target_type: manualType })}
              />
              <button
                onClick={() => manualCheckMut.mutate({ target: manualTarget, target_type: manualType })}
                disabled={!manualTarget || manualCheckMut.isPending || !summary?.api_key_configured}
                className="btn-primary flex items-center gap-2 flex-shrink-0"
              >
                {manualCheckMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Consultar
              </button>
            </div>
            {!summary?.api_key_configured && (
              <p className="text-yellow-400 text-sm mt-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Configure a chave de API do MxToolbox na aba Configurações para usar esta funcionalidade.
              </p>
            )}
          </div>

          {/* Resultado da consulta manual */}
          {manualResult && (
            <div className="card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-white font-mono">{manualResult.target}</h3>
                    <StatusBadge status={manualResult.status} />
                  </div>
                  <p className="text-dark-400 text-sm mt-1">
                    {manualResult.listed_count > 0
                      ? `Listado em ${manualResult.listed_count} de ${manualResult.checked_count} blacklists`
                      : `Limpo — verificado em ${manualResult.checked_count} blacklists`
                    }
                    {manualResult.duration_ms && ` · ${manualResult.duration_ms}ms`}
                  </p>
                </div>
                <button onClick={() => setManualResult(null)} className="btn-ghost p-1.5 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {manualResult.error_message && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
                  <p className="text-yellow-400 text-sm">{manualResult.error_message}</p>
                </div>
              )}

              {/* Blacklists onde está listado */}
              {manualResult.blacklists_found.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-red-400 mb-2">
                    Listado em {manualResult.blacklists_found.length} blacklist(s):
                  </h4>
                  <div className="space-y-2">
                    {manualResult.blacklists_found.map((bl, i) => (
                      <div key={i} className="flex items-start gap-3 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-red-300 font-medium text-sm">{bl.name}</p>
                          {bl.info && <p className="text-dark-400 text-xs mt-0.5">{bl.info}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Todos os resultados */}
              {manualResult.all_results.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowAllResults(!showAllResults)}
                    className="flex items-center gap-2 text-sm text-dark-400 hover:text-white transition-colors"
                  >
                    {showAllResults ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    {showAllResults ? 'Ocultar' : 'Ver'} todos os resultados ({manualResult.all_results.length})
                  </button>
                  {showAllResults && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
                      {manualResult.all_results.map((r, i) => (
                        <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                          r.status === 'listed'
                            ? 'bg-red-500/5 border border-red-500/20 text-red-300'
                            : 'bg-dark-800 border border-dark-700 text-dark-400'
                        }`}>
                          {r.status === 'listed'
                            ? <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                            : <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                          }
                          {r.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Botão para adicionar como monitor */}
              {manualResult.status !== 'error' && (
                <div className="mt-4 pt-4 border-t border-dark-700">
                  <button
                    onClick={() => {
                      setNewMonitor(p => ({ ...p, target: manualResult.target, target_type: manualResult.target_type, name: `Monitor ${manualResult.target}` }))
                      setShowAddForm(true)
                      setActiveTab('monitors')
                    }}
                    className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar como monitor automático
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Configurações ── */}
      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-2xl">
          <div className="card">
            <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
              <Key className="w-5 h-5 text-brand-400" />
              Chave de API — MxToolbox
            </h3>
            <p className="text-dark-400 text-sm mb-4">
              A API do MxToolbox é usada para verificar IPs e domínios contra blacklists.
              Obtenha sua chave gratuita em{' '}
              <a
                href="https://mxtoolbox.com/api/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-1"
              >
                mxtoolbox.com/api <ExternalLink className="w-3 h-3" />
              </a>.
            </p>

            <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${summary?.api_key_configured ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-sm text-dark-300">
                  Status: {summary?.api_key_configured ? 'Chave configurada' : 'Chave não configurada'}
                </span>
              </div>
              {summary?.last_check_at && (
                <p className="text-xs text-dark-500">
                  Última verificação: {formatDate(summary.last_check_at)}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-dark-300 mb-1">Nova Chave de API</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    className="input w-full pr-10"
                    placeholder="Cole aqui sua chave do MxToolbox"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-white"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => saveApiKeyMut.mutate(apiKey)}
                  disabled={!apiKey || saveApiKeyMut.isPending}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  {saveApiKeyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  Salvar Chave
                </button>
                {summary?.api_key_configured && (
                  <button
                    onClick={() => testApiKeyMut.mutate()}
                    disabled={testApiKeyMut.isPending}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    {testApiKeyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Testar Chave Atual
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
              <Info className="w-5 h-5 text-brand-400" />
              Sobre o MxToolbox
            </h3>
            <div className="space-y-2 text-sm text-dark-400">
              <p>O MxToolbox verifica IPs e domínios contra mais de 100 blacklists simultaneamente, incluindo:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Spamhaus (SBL, XBL, PBL, DBL)</li>
                <li>Barracuda Reputation Block List (BRBL)</li>
                <li>SpamCop Blocking List (SCBL)</li>
                <li>Sorbs (DUHL, SPAM, HTTP)</li>
                <li>URIBL, SURBL, DNSBL e muitas outras</li>
              </ul>
              <p className="mt-3">
                <strong className="text-dark-300">Plano gratuito:</strong> 100 requisições/dia.
                Para monitoramento contínuo de muitos IPs, considere um plano pago.
              </p>
              <p>
                <strong className="text-dark-300">Verificação automática:</strong> Executada diariamente às 02h (horário de Brasília).
                Cada monitor consome 1 requisição da API.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
