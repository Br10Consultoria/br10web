/**
 * BR10 NetManager — Monitor RPKI
 *
 * Dashboard de monitoramento contínuo de prefixos/ASNs via RPKI.
 * - Cadastro de blocos para monitoramento automático (3x/dia)
 * - Status atual com semáforo visual (válido / inválido / não encontrado)
 * - Verificação manual hierárquica: bloco completo → /23 → /24 (IPv4) ou /33 → /40 (IPv6)
 * - Histórico de verificações por bloco
 * - Descoberta de prefixos IPv6 do ASN para validação manual
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, ShieldX, ShieldAlert, Shield, Plus, RefreshCw,
  Trash2, Play, Clock, ChevronDown, ChevronUp, X, Loader2,
  CheckCircle, XCircle, HelpCircle, AlertTriangle, Globe, Server,
  Edit2, BarChart3, Zap, Network, List
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

interface HierarchicalLevel {
  status: string
  total: number
  valid: number
  invalid: number
  not_found: number
  unknown: number
  error: number
  prefixes: Array<{ prefix: string; status: string; roas?: RoaEntry[]; error?: string }>
}

interface HierarchicalResult {
  prefix: string
  asn?: number
  consolidated_status: string
  main_block: {
    prefix: string
    status: string
    roas: RoaEntry[]
    origin_asns: number[]
    country?: string
    rir?: string
    sources_checked: string[]
    errors: string[]
  }
  sub_levels: Record<string, HierarchicalLevel>
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
  hierarchical?: HierarchicalResult
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

interface Ipv6Prefix {
  prefix: string
  prefixlen: number
  timelines?: any[]
}

interface Ipv6CheckResult {
  asn: number
  total_announced: number
  checked: Array<{ prefix: string; status: string; roas: RoaEntry[] }>
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

// ─── Modal de Resultado Hierárquico ──────────────────────────────────────────

function HierarchicalModal({ result, monitorName, onClose }: {
  result: HierarchicalResult
  monitorName: string
  onClose: () => void
}) {
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null)

  const mainCfg = getStatus(result.main_block.status)
  const MainIcon = mainCfg.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-brand-400" />
              Validação Hierárquica — {monitorName}
            </h2>
            <p className="text-xs text-dark-500 font-mono mt-0.5">
              {result.prefix}{result.asn ? ` · AS${result.asn}` : ''}
              {' · '}
              <span className={getStatus(result.consolidated_status).color}>
                Status consolidado: {getStatus(result.consolidated_status).label}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Bloco principal */}
          <div>
            <h3 className="text-xs font-medium text-dark-400 uppercase tracking-wide mb-2">
              Bloco Principal
            </h3>
            <div className={`p-3 rounded-xl border ${mainCfg.border} ${mainCfg.bg}`}>
              <div className="flex items-center gap-2">
                <MainIcon className={`w-4 h-4 ${mainCfg.color}`} />
                <span className="font-mono text-sm text-white">{result.main_block.prefix}</span>
                <span className={`text-xs font-semibold ${mainCfg.color}`}>{mainCfg.label}</span>
                {result.main_block.country && (
                  <span className="text-xs text-dark-500 flex items-center gap-1">
                    <Globe className="w-3 h-3" />{result.main_block.country}
                  </span>
                )}
                {result.main_block.rir && (
                  <span className="text-xs text-dark-500">{result.main_block.rir}</span>
                )}
              </div>
              {result.main_block.roas.length > 0 && (
                <div className="mt-2 space-y-1">
                  {result.main_block.roas.map((roa, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs font-mono text-dark-400">
                      <span className="text-brand-400">AS{roa.asn}</span>
                      <span>{roa.prefix}</span>
                      {roa.max_length && <span className="text-dark-600">max/{roa.max_length}</span>}
                      {roa.validity && <span className={getStatus(roa.validity).color}>{getStatus(roa.validity).label}</span>}
                    </div>
                  ))}
                </div>
              )}
              {result.main_block.errors.length > 0 && (
                <p className="text-xs text-orange-400 mt-1">{result.main_block.errors.join('; ')}</p>
              )}
            </div>
          </div>

          {/* Sub-níveis */}
          {Object.entries(result.sub_levels).map(([level, data]) => {
            const levelCfg = getStatus(data.status)
            const LevelIcon = levelCfg.icon
            const isExpanded = expandedLevel === level

            return (
              <div key={level}>
                <h3 className="text-xs font-medium text-dark-400 uppercase tracking-wide mb-2">
                  Sub-blocos {level}
                </h3>
                <div className={`rounded-xl border ${levelCfg.border} overflow-hidden`}>
                  {/* Resumo do nível */}
                  <button
                    onClick={() => setExpandedLevel(isExpanded ? null : level)}
                    className={`w-full flex items-center justify-between p-3 ${levelCfg.bg} hover:opacity-90 transition-opacity`}
                  >
                    <div className="flex items-center gap-3">
                      <LevelIcon className={`w-4 h-4 ${levelCfg.color}`} />
                      <span className={`text-xs font-semibold ${levelCfg.color}`}>
                        Status consolidado: {levelCfg.label}
                      </span>
                      <span className="text-xs text-dark-400">{data.total} prefixos</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {data.valid > 0 && <span className="text-emerald-400">{data.valid} válidos</span>}
                      {data.invalid > 0 && <span className="text-red-400">{data.invalid} inválidos</span>}
                      {data.not_found > 0 && <span className="text-yellow-400">{data.not_found} sem ROA</span>}
                      {data.error > 0 && <span className="text-orange-400">{data.error} erros</span>}
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-dark-400" /> : <ChevronDown className="w-3.5 h-3.5 text-dark-400" />}
                    </div>
                  </button>

                  {/* Lista de prefixos expandida */}
                  {isExpanded && (
                    <div className="bg-dark-900/50 max-h-64 overflow-y-auto">
                      {data.prefixes.map((p, i) => {
                        const pCfg = getStatus(p.status)
                        const PIcon = pCfg.icon
                        return (
                          <div key={i} className="flex items-center gap-3 px-3 py-1.5 border-b border-dark-800 last:border-0">
                            <PIcon className={`w-3 h-3 flex-shrink-0 ${pCfg.color}`} />
                            <span className="font-mono text-xs text-dark-300 flex-1">{p.prefix}</span>
                            <span className={`text-xs ${pCfg.color}`}>{pCfg.label}</span>
                            {p.error && <span className="text-xs text-orange-400 truncate max-w-[200px]">{p.error}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {Object.keys(result.sub_levels).length === 0 && (
            <p className="text-xs text-dark-500 text-center py-4">
              Bloco /{result.prefix.split('/')[1]} não possui sub-blocos para validação hierárquica.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal de Prefixos IPv6 ───────────────────────────────────────────────────

function Ipv6PrefixesModal({ monitor, onClose }: { monitor: Monitor; onClose: () => void }) {
  const { accessToken } = useAuthStore()
  const token = accessToken || localStorage.getItem('access_token')
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {}
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['rpki-ipv6', monitor.id],
    queryFn: () => api.get(`/rpki-monitor/monitors/${monitor.id}/ipv6-prefixes`, { headers: authHeader }).then(r => r.data),
  })

  const prefixes: Ipv6Prefix[] = data?.ipv6_prefixes ?? []

  const createMut = useMutation({
    mutationFn: (prefix: string) => api.post('/rpki-monitor/monitors', {
      name: `IPv6 ${prefix} (AS${monitor.asn})`,
      asn: monitor.asn,
      prefix,
      active: true,
      alert_on_invalid: true,
      alert_on_not_found: false,
    }, { headers: authHeader }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rpki-monitors'] })
      qc.invalidateQueries({ queryKey: ['rpki-summary'] })
      toast.success('Monitor IPv6 criado!')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Erro ao criar monitor'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Network className="w-4 h-4 text-sky-400" />
              Prefixos IPv6 — AS{monitor.asn}
            </h2>
            <p className="text-xs text-dark-500 mt-0.5">
              Prefixos IPv6 anunciados pelo ASN via RIPE Stat. Clique em "+" para criar um monitor.
            </p>
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
          ) : error ? (
            <div className="text-center py-12 text-red-400 text-sm">
              {(error as any)?.response?.data?.detail || 'Erro ao buscar prefixos IPv6'}
            </div>
          ) : prefixes.length === 0 ? (
            <div className="text-center py-12 text-dark-500">
              <Network className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Nenhum prefixo IPv6 encontrado para AS{monitor.asn}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-dark-500 mb-3">{prefixes.length} prefixo(s) IPv6 encontrado(s)</p>
              {prefixes.map((p, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-dark-900/50 border border-dark-700 hover:border-dark-600 transition-colors">
                  <Network className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                  <span className="font-mono text-sm text-white flex-1">{p.prefix}</span>
                  <span className="text-xs text-dark-500">/{p.prefixlen}</span>
                  <button
                    onClick={() => createMut.mutate(p.prefix)}
                    disabled={createMut.isPending}
                    className="btn-ghost p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1"
                    title="Criar monitor para este prefixo"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Monitor
                  </button>
                </div>
              ))}
            </div>
          )}

          {data?.errors?.length > 0 && (
            <div className="mt-3 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <p className="text-xs text-orange-400">{data.errors.join('; ')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
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
                placeholder="177.75.0.0/20 ou 2001:db8::/32"
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
                // Verificar se tem dados hierárquicos
                const hasHierarchical = c.hierarchical != null
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
                        {hasHierarchical && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-sky-600/20 text-sky-400">
                            Hierárquico
                          </span>
                        )}
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
  onIpv6: () => void
  checking: boolean
  lastCheckResult?: { monitor: Monitor; check: Check; ipv6?: Ipv6CheckResult | null } | null
}

function MonitorCard({ monitor, onEdit, onDelete, onCheck, onHistory, onIpv6, checking, lastCheckResult }: MonitorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showHierarchical, setShowHierarchical] = useState(false)
  const cfg = getStatus(monitor.last_status)
  const Icon = cfg.icon

  // Verificar se o último check tem dados hierárquicos
  const hierarchicalResult = lastCheckResult?.check?.hierarchical

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
            {/* Botão de resultado hierárquico (aparece após verificação manual) */}
            {hierarchicalResult && (
              <button
                onClick={() => setShowHierarchical(true)}
                className="btn-ghost p-1.5 rounded-lg text-sky-400 hover:text-sky-300"
                title="Ver resultado hierárquico"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Botão IPv6 (só aparece se tem ASN) */}
            {monitor.asn && (
              <button
                onClick={onIpv6}
                className="btn-ghost p-1.5 rounded-lg text-sky-400 hover:text-sky-300"
                title="Descobrir prefixos IPv6 do ASN"
              >
                <Network className="w-3.5 h-3.5" />
              </button>
            )}
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
              title="Verificar agora (hierárquico)"
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
          <p className="text-xs font-medium text-dark-400 mb-2">ROAs encontrados (IPv4)</p>
          <div className="space-y-1">
            {monitor.last_roas
              .filter((roa: any) => !roa._hierarchical)
              .map((roa, i) => (
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

      {/* Resultados IPv6 auto-check */}
      {expanded && lastCheckResult?.ipv6 && lastCheckResult.ipv6.checked.length > 0 && (
        <div className="border-t border-dark-700 px-4 py-3 bg-dark-900/50">
          <p className="text-xs font-medium text-dark-400 mb-2">
            Prefixos IPv6 — AS{lastCheckResult.ipv6.asn}
            <span className="ml-2 text-dark-500">({lastCheckResult.ipv6.total_announced} anunciados, exibindo top 5)</span>
          </p>
          <div className="space-y-1">
            {lastCheckResult.ipv6.checked.map((item, i) => {
              const cfg = getStatus(item.status as any)
              return (
                <div key={i} className="flex items-center gap-3 text-xs font-mono">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <span className="text-dark-300">{item.prefix}</span>
                  <span className={cfg.color}>{cfg.label}</span>
                  {item.roas.length > 0 && (
                    <span className="text-dark-500">{item.roas.length} ROA(s)</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {expanded && monitor.last_error && (
        <div className="border-t border-dark-700 px-4 py-3 bg-dark-900/50">
          <p className="text-xs text-orange-400">{monitor.last_error}</p>
        </div>
      )}

      {/* Modal de resultado hierárquico */}
      {showHierarchical && hierarchicalResult && (
        <HierarchicalModal
          result={hierarchicalResult}
          monitorName={monitor.name}
          onClose={() => setShowHierarchical(false)}
        />
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
  const [ipv6Monitor, setIpv6Monitor] = useState<Monitor | null>(null)
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set())
  const [checkingAll, setCheckingAll] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  // Armazena o último resultado hierárquico por monitor_id (inclui ipv6 auto-check)
  const [lastCheckResults, setLastCheckResults] = useState<Record<string, { monitor: Monitor; check: Check; ipv6?: Ipv6CheckResult | null }>>({})

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

  // Verificar um monitor (hierárquico)
  const handleCheck = useCallback(async (monitor: Monitor) => {
    setCheckingIds(s => new Set(s).add(monitor.id))
    try {
      const res = await api.post(`/rpki-monitor/monitors/${monitor.id}/check`, {}, { headers: authHeader })
      const data = res.data as { monitor: Monitor; check: Check; ipv6?: Ipv6CheckResult | null }

      // Armazenar resultado (hierárquico + IPv6 auto-check)
      setLastCheckResults(prev => ({ ...prev, [monitor.id]: data }))

      const statusLabel = getStatus(data.check?.status || null).label
      const ipv6Msg = data.ipv6 ? ` | ${data.ipv6.checked.length} prefixo(s) IPv6 verificado(s)` : ''
      toast.success(`${monitor.name}: ${statusLabel}${ipv6Msg}`)
      qc.invalidateQueries({ queryKey: ['rpki-monitors'] })
      qc.invalidateQueries({ queryKey: ['rpki-summary'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Erro ao verificar monitor')
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
              onIpv6={() => setIpv6Monitor(m)}
              checking={checkingIds.has(m.id)}
              lastCheckResult={lastCheckResults[m.id] ?? null}
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
      {ipv6Monitor && (
        <Ipv6PrefixesModal
          monitor={ipv6Monitor}
          onClose={() => setIpv6Monitor(null)}
        />
      )}
    </div>
  )
}
