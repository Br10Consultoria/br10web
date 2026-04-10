/**
 * BR10 NetManager — Monitor RPKI
 *
 * Dashboard de monitoramento contínuo de prefixos/ASNs via RPKI.
 * - Cadastro de blocos para monitoramento automático (3x/dia)
 * - Status atual com semáforo visual (válido / inválido / não encontrado)
 * - Histórico de verificações por bloco
 * - Verificação manual a qualquer momento
 */
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, ShieldX, ShieldAlert, Shield, Plus, RefreshCw,
  Trash2, Play, Clock, ChevronDown, ChevronUp, X, Loader2,
  CheckCircle, XCircle, HelpCircle, AlertTriangle, Globe, Server,
  Edit2, Eye, BarChart3, Zap
} from 'lucide-react'
import api from '../utils/api'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RoaEntry {
  asn: number | string
  prefix: string
  max_length?: number
  validity?: string
}

interface Monitor {
  id: string
  name: string
  description?: string
  asn?: number
  prefix: string
  last_status: 'valid' | 'invalid' | 'not-found' | 'unknown' | 'error' | null
  last_checked_at: string | null
  last_roas: RoaEntry[]
  last_origin_asns: number[]
  last_country: string | null
  last_rir: string | null
  last_error: string | null
  active: boolean
  alert_on_invalid: boolean
  alert_on_not_found: boolean
  created_at: string
}

interface Check {
  id: string
  monitor_id: string
  status: string
  prefix_checked: string
  asn_used?: number
  roas: RoaEntry[]
  origin_asns: number[]
  country?: string
  rir?: string
  sources_checked: string[]
  error_message?: string
  trigger_type: string
  duration_ms?: number
  checked_at: string
}

interface Summary {
  total: number
  active: number
  counts: {
    valid: number
    invalid: number
    'not-found': number
    unknown: number
    error: number
    never: number
  }
  last_check: string | null
}

// ─── Configuração visual por status ───────────────────────────────────────────

const STATUS_CONFIG = {
  valid: {
    label: 'Válido',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-500/30',
    icon: CheckCircle,
    dot: 'bg-emerald-400',
    desc: 'ROA encontrado e ASN de origem corresponde. Rota é legítima.',
  },
  invalid: {
    label: 'Inválido',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-500/30',
    icon: XCircle,
    dot: 'bg-red-400',
    desc: 'ROA encontrado mas ASN não corresponde. Possível route hijack.',
  },
  'not-found': {
    label: 'Sem ROA',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-500/30',
    icon: HelpCircle,
    dot: 'bg-yellow-400',
    desc: 'Nenhum ROA encontrado. Prefixo não coberto por RPKI.',
  },
  unknown: {
    label: 'Desconhecido',
    color: 'text-gray-400',
    bg: 'bg-gray-400/10',
    border: 'border-gray-500/30',
    icon: HelpCircle,
    dot: 'bg-gray-400',
    desc: 'Não foi possível determinar o estado RPKI.',
  },
  error: {
    label: 'Erro',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
    border: 'border-orange-500/30',
    icon: AlertTriangle,
    dot: 'bg-orange-400',
    desc: 'Erro ao verificar o prefixo.',
  },
  never: {
    label: 'Nunca verificado',
    color: 'text-dark-500',
    bg: 'bg-dark-700/50',
    border: 'border-dark-600',
    icon: Clock,
    dot: 'bg-dark-600',
    desc: 'Aguardando primeira verificação.',
  },
}

function getStatus(s: string | null) {
  if (!s) return STATUS_CONFIG.never
  return STATUS_CONFIG[s as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.unknown
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(ms?: number) {
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ─── Modal de Cadastro/Edição ─────────────────────────────────────────────────

interface MonitorFormProps {
  initial?: Monitor | null
  onClose: () => void
  onSaved: () => void
}

function MonitorForm({ initial, onClose, onSaved }: MonitorFormProps) {
  const { accessToken } = useAuthStore()
  const token = accessToken || localStorage.getItem('access_token')
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    asn: initial?.asn ? String(initial.asn) : '',
    prefix: initial?.prefix ?? '',
    active: initial?.active ?? true,
    alert_on_invalid: initial?.alert_on_invalid ?? true,
    alert_on_not_found: initial?.alert_on_not_found ?? false,
  })

  const qc = useQueryClient()

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        asn: form.asn.trim() ? Number(form.asn.replace(/^AS/i, '')) : undefined,
        prefix: form.prefix.trim(),
        active: form.active,
        alert_on_invalid: form.alert_on_invalid,
        alert_on_not_found: form.alert_on_not_found,
      }
      if (initial) {
        return api.put(`/rpki-monitor/monitors/${initial.id}`, body, { headers: authHeader })
      }
      return api.post('/rpki-monitor/monitors', body, { headers: authHeader })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rpki-monitors'] })
      qc.invalidateQueries({ queryKey: ['rpki-summary'] })
      toast.success(initial ? 'Monitor atualizado!' : 'Monitor criado com sucesso!')
      onSaved()
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar monitor')
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-600/20 border border-brand-500/30 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                {initial ? 'Editar Monitor RPKI' : 'Novo Monitor RPKI'}
              </h2>
              <p className="text-xs text-dark-500">
                {initial ? 'Atualize as informações do bloco' : 'Cadastre um ASN/prefixo para monitoramento'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-dark-500 mb-1.5">Nome do Monitor *</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Bloco Principal AS12345"
              className="input w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-dark-500 mb-1.5">Prefixo IP *</label>
              <input
                value={form.prefix}
                onChange={e => setForm(f => ({ ...f, prefix: e.target.value }))}
                placeholder="177.75.0.0/20"
                className="input w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-dark-500 mb-1.5">ASN de Origem (opcional)</label>
              <input
                value={form.asn}
                onChange={e => setForm(f => ({ ...f, asn: e.target.value }))}
                placeholder="AS12345"
                className="input w-full font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-dark-500 mb-1.5">Descrição (opcional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Descrição do bloco ou finalidade..."
              className="input w-full resize-none"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${form.active ? 'bg-brand-600' : 'bg-dark-600'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-dark-300">Monitor ativo</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setForm(f => ({ ...f, alert_on_invalid: !f.alert_on_invalid }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${form.alert_on_invalid ? 'bg-red-600' : 'bg-dark-600'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.alert_on_invalid ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-dark-300">Alertar quando inválido</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setForm(f => ({ ...f, alert_on_not_found: !f.alert_on_not_found }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${form.alert_on_not_found ? 'bg-yellow-600' : 'bg-dark-600'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.alert_on_not_found ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-dark-300">Alertar quando sem ROA</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-700">
          <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-lg text-sm">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.name.trim() || !form.prefix.trim()}
            className="btn-primary flex items-center gap-2 px-5 py-2 rounded-lg text-sm"
          >
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {initial ? 'Salvar Alterações' : 'Criar Monitor'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de Histórico ───────────────────────────────────────────────────────

function HistoryModal({ monitor, onClose }: { monitor: Monitor; onClose: () => void }) {
  const { accessToken } = useAuthStore()
  const token = accessToken || localStorage.getItem('access_token')
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

  const { data, isLoading } = useQuery({
    queryKey: ['rpki-history', monitor.id],
    queryFn: () => api.get(`/rpki-monitor/monitors/${monitor.id}/history?limit=50`, { headers: authHeader }).then(r => r.data),
  })

  const history: Check[] = data?.history ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Histórico — {monitor.name}</h2>
            <p className="text-xs text-dark-500 font-mono">{monitor.prefix}{monitor.asn ? ` · AS${monitor.asn}` : ''}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-dark-500">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Nenhuma verificação registrada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(c => {
                const cfg = getStatus(c.status)
                const Icon = cfg.icon
                return (
                  <div key={c.id} className={`flex items-start gap-3 p-3 rounded-xl border ${cfg.border} ${cfg.bg}`}>
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                        {c.asn_used && <span className="text-xs text-dark-400 font-mono">AS{c.asn_used}</span>}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${c.trigger_type === 'manual' ? 'bg-brand-600/20 text-brand-400' : 'bg-dark-700 text-dark-400'}`}>
                          {c.trigger_type === 'manual' ? 'Manual' : 'Automático'}
                        </span>
                        {c.duration_ms && <span className="text-xs text-dark-600">{fmtDuration(c.duration_ms)}</span>}
                      </div>
                      <p className="text-xs text-dark-500 mt-0.5">{fmtDate(c.checked_at)}</p>
                      {c.error_message && (
                        <p className="text-xs text-orange-400 mt-1 truncate">{c.error_message}</p>
                      )}
                      {c.sources_checked?.length > 0 && (
                        <p className="text-xs text-dark-600 mt-0.5">{c.sources_checked.join(' · ')}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Card de Monitor ──────────────────────────────────────────────────────────

interface MonitorCardProps {
  monitor: Monitor
  onEdit: () => void
  onDelete: () => void
  onCheck: () => void
  onHistory: () => void
  checking: boolean
}

function MonitorCard({ monitor, onEdit, onDelete, onCheck, onHistory, checking }: MonitorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cfg = getStatus(monitor.last_status)
  const Icon = cfg.icon

  return (
    <div className={`bg-dark-800 border rounded-xl overflow-hidden transition-all ${cfg.border}`}>
      {/* Header do card */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Status dot */}
          <div className="flex-shrink-0 mt-1">
            <div className={`w-3 h-3 rounded-full ${cfg.dot} ${monitor.last_status === 'valid' ? 'shadow-[0_0_6px_rgba(52,211,153,0.6)]' : monitor.last_status === 'invalid' ? 'shadow-[0_0_6px_rgba(248,113,113,0.6)]' : ''}`} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white truncate">{monitor.name}</h3>
              {!monitor.active && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-dark-700 text-dark-400">Inativo</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs font-mono text-brand-400">{monitor.prefix}</span>
              {monitor.asn && <span className="text-xs font-mono text-dark-400">AS{monitor.asn}</span>}
              {monitor.last_rir && <span className="text-xs text-dark-500">{monitor.last_rir}</span>}
              {monitor.last_country && (
                <span className="text-xs text-dark-500 flex items-center gap-1">
                  <Globe className="w-3 h-3" />{monitor.last_country}
                </span>
              )}
            </div>
            {monitor.description && (
              <p className="text-xs text-dark-500 mt-1 truncate">{monitor.description}</p>
            )}
          </div>

          {/* Status badge */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium flex-shrink-0 ${cfg.bg} ${cfg.border} ${cfg.color}`}>
            <Icon className="w-3.5 h-3.5" />
            {cfg.label}
          </div>
        </div>

        {/* Footer do card */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-dark-700">
          <div className="flex items-center gap-1 text-xs text-dark-500">
            <Clock className="w-3 h-3" />
            {monitor.last_checked_at ? fmtDate(monitor.last_checked_at) : 'Nunca verificado'}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onHistory}
              className="btn-ghost p-1.5 rounded-lg"
              title="Histórico"
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onEdit}
              className="btn-ghost p-1.5 rounded-lg"
              title="Editar"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onCheck}
              disabled={checking}
              className="btn-ghost p-1.5 rounded-lg text-brand-400 hover:text-brand-300"
              title="Verificar agora"
            >
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setExpanded(e => !e)}
              className="btn-ghost p-1.5 rounded-lg"
              title="Detalhes"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onDelete}
              className="btn-ghost p-1.5 rounded-lg text-red-400 hover:text-red-300"
              title="Remover"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Detalhes expandidos */}
      {expanded && monitor.last_roas && monitor.last_roas.length > 0 && (
        <div className="border-t border-dark-700 px-4 py-3 bg-dark-900/50">
          <p className="text-xs font-medium text-dark-400 mb-2">ROAs encontrados</p>
          <div className="space-y-1">
            {monitor.last_roas.map((roa, i) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-brand-400">AS{roa.asn}</span>
                <span className="text-dark-300">{roa.prefix}</span>
                {roa.max_length && <span className="text-dark-500">max/{roa.max_length}</span>}
                {roa.validity && (
                  <span className={getStatus(roa.validity).color}>{getStatus(roa.validity).label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {expanded && monitor.last_error && (
        <div className="border-t border-dark-700 px-4 py-3 bg-dark-900/50">
          <p className="text-xs text-orange-400">{monitor.last_error}</p>
        </div>
      )}
    </div>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function RpkiMonitorPage() {
  const { accessToken } = useAuthStore()
  const token = accessToken || localStorage.getItem('access_token')
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}

  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editMonitor, setEditMonitor] = useState<Monitor | null>(null)
  const [historyMonitor, setHistoryMonitor] = useState<Monitor | null>(null)
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set())
  const [checkingAll, setCheckingAll] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  // Queries
  const { data: summary, isLoading: summaryLoading } = useQuery<Summary>({
    queryKey: ['rpki-summary'],
    queryFn: () => api.get('/rpki-monitor/summary', { headers: authHeader }).then(r => r.data),
    refetchInterval: 60_000,
  })

  const { data: monitors = [], isLoading: monitorsLoading, refetch } = useQuery<Monitor[]>({
    queryKey: ['rpki-monitors'],
    queryFn: () => api.get('/rpki-monitor/monitors', { headers: authHeader }).then(r => r.data),
    refetchInterval: 60_000,
  })

  // Deletar monitor
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/rpki-monitor/monitors/${id}`, { headers: authHeader }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rpki-monitors'] })
      qc.invalidateQueries({ queryKey: ['rpki-summary'] })
      toast.success('Monitor removido')
    },
    onError: () => toast.error('Erro ao remover monitor'),
  })

  // Verificar um monitor
  const handleCheck = useCallback(async (monitor: Monitor) => {
    setCheckingIds(s => new Set(s).add(monitor.id))
    try {
      await api.post(`/rpki-monitor/monitors/${monitor.id}/check`, {}, { headers: authHeader })
      toast.success(`${monitor.name} verificado!`)
      qc.invalidateQueries({ queryKey: ['rpki-monitors'] })
      qc.invalidateQueries({ queryKey: ['rpki-summary'] })
    } catch {
      toast.error('Erro ao verificar monitor')
    } finally {
      setCheckingIds(s => { const n = new Set(s); n.delete(monitor.id); return n })
    }
  }, [authHeader, qc])

  // Verificar todos
  const handleCheckAll = useCallback(async () => {
    setCheckingAll(true)
    try {
      const res = await api.post('/rpki-monitor/check-all', {}, { headers: authHeader })
      toast.success(`${res.data.checked} monitor(es) verificado(s)`)
      qc.invalidateQueries({ queryKey: ['rpki-monitors'] })
      qc.invalidateQueries({ queryKey: ['rpki-summary'] })
    } catch {
      toast.error('Erro ao verificar todos os monitores')
    } finally {
      setCheckingAll(false)
    }
  }, [authHeader, qc])

  // Filtrar monitores
  const filtered = monitors.filter(m => {
    if (filterStatus === 'all') return true
    if (filterStatus === 'never') return !m.last_status
    return m.last_status === filterStatus
  })

  const isLoading = summaryLoading || monitorsLoading

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-400" />
            Monitor RPKI
          </h1>
          <p className="text-sm text-dark-500 mt-0.5">
            Monitoramento automático de prefixos — verificação às 06h, 12h e 22h
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="btn-ghost flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleCheckAll}
            disabled={checkingAll || monitors.length === 0}
            className="btn-ghost flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-brand-400 hover:text-brand-300"
          >
            {checkingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Verificar Todos
          </button>
          <button
            onClick={() => { setEditMonitor(null); setShowForm(true) }}
            className="btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          >
            <Plus className="w-4 h-4" />
            Novo Monitor
          </button>
        </div>
      </div>

      {/* Cards de resumo */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { key: 'total', label: 'Total', value: summary.total, color: 'text-white', bg: 'bg-dark-800', icon: Shield },
            { key: 'valid', label: 'Válidos', value: summary.counts.valid, color: 'text-emerald-400', bg: 'bg-emerald-400/10', icon: CheckCircle },
            { key: 'invalid', label: 'Inválidos', value: summary.counts.invalid, color: 'text-red-400', bg: 'bg-red-400/10', icon: XCircle },
            { key: 'not-found', label: 'Sem ROA', value: summary.counts['not-found'], color: 'text-yellow-400', bg: 'bg-yellow-400/10', icon: HelpCircle },
            { key: 'error', label: 'Erros', value: summary.counts.error, color: 'text-orange-400', bg: 'bg-orange-400/10', icon: AlertTriangle },
            { key: 'never', label: 'Pendentes', value: summary.counts.never, color: 'text-dark-400', bg: 'bg-dark-700', icon: Clock },
          ].map(({ key, label, value, color, bg, icon: CardIcon }) => (
            <button
              key={key}
              onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
              className={`${bg} border rounded-xl p-4 text-left transition-all hover:opacity-80 ${filterStatus === key ? 'border-brand-500/50 ring-1 ring-brand-500/30' : 'border-dark-700'}`}
            >
              <CardIcon className={`w-5 h-5 ${color} mb-2`} />
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-dark-500 mt-0.5">{label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Última verificação */}
      {summary?.last_check && (
        <div className="flex items-center gap-2 text-xs text-dark-500">
          <Clock className="w-3.5 h-3.5" />
          Última verificação automática: {fmtDate(summary.last_check)}
        </div>
      )}

      {/* Filtro ativo */}
      {filterStatus !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-dark-500">Filtrando por:</span>
          <span className="text-xs px-2 py-1 bg-brand-600/20 text-brand-400 rounded-lg border border-brand-500/30">
            {STATUS_CONFIG[filterStatus as keyof typeof STATUS_CONFIG]?.label ?? filterStatus}
          </span>
          <button onClick={() => setFilterStatus('all')} className="text-xs text-dark-500 hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Lista de monitores */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-dark-500">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-base font-medium text-dark-400">
            {monitors.length === 0 ? 'Nenhum monitor cadastrado' : 'Nenhum monitor com este status'}
          </p>
          <p className="text-sm mt-1">
            {monitors.length === 0
              ? 'Clique em "Novo Monitor" para cadastrar um ASN/prefixo'
              : 'Clique em "Total" para ver todos os monitores'
            }
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map(m => (
            <MonitorCard
              key={m.id}
              monitor={m}
              onEdit={() => { setEditMonitor(m); setShowForm(true) }}
              onDelete={() => {
                if (confirm(`Remover monitor "${m.name}"?`)) deleteMut.mutate(m.id)
              }}
              onCheck={() => handleCheck(m)}
              onHistory={() => setHistoryMonitor(m)}
              checking={checkingIds.has(m.id)}
            />
          ))}
        </div>
      )}

      {/* Modais */}
      {showForm && (
        <MonitorForm
          initial={editMonitor}
          onClose={() => { setShowForm(false); setEditMonitor(null) }}
          onSaved={() => { setShowForm(false); setEditMonitor(null) }}
        />
      )}
      {historyMonitor && (
        <HistoryModal
          monitor={historyMonitor}
          onClose={() => setHistoryMonitor(null)}
        />
      )}
    </div>
  )
}
