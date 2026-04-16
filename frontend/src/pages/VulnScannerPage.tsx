/**
 * BR10 NetManager — Scanner de Vulnerabilidades
 *
 * Executa varreduras com Nmap ou OpenVAS em IPs/ranges.
 * Exibe resultados em tela com filtros por severidade e permite download de PDF.
 * Retenção de 90 dias por varredura.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Shield, ShieldAlert, ShieldX, ShieldCheck, Play, Trash2,
  Download, RefreshCw, Plus, X, ChevronDown, ChevronUp,
  Loader2, AlertTriangle, CheckCircle, Clock, Server,
  Search, Filter, FileText, Zap, Globe, Lock
} from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Scan {
  id: string
  name: string
  target: string
  scanner: 'nmap' | 'openvas'
  status: 'pending' | 'running' | 'completed' | 'failed'
  hosts_up: number
  hosts_down: number
  total_findings: number
  duration_s: number | null
  started_by: string
  error_msg: string | null
  created_at: string
}

interface Finding {
  id: string
  host: string
  hostname: string | null
  port: number | null
  protocol: string | null
  service: string | null
  service_version: string | null
  port_state: string | null
  vuln_id: string | null
  title: string
  description: string | null
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  cvss_score: number | null
  solution: string | null
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  critical: { label: 'Crítico',  color: '#dc2626', bg: 'bg-red-900/30',    border: 'border-red-700',    icon: ShieldX },
  high:     { label: 'Alto',     color: '#ea580c', bg: 'bg-orange-900/30', border: 'border-orange-700', icon: ShieldAlert },
  medium:   { label: 'Médio',    color: '#d97706', bg: 'bg-yellow-900/30', border: 'border-yellow-700', icon: Shield },
  low:      { label: 'Baixo',    color: '#2563eb', bg: 'bg-blue-900/30',   border: 'border-blue-700',   icon: ShieldCheck },
  info:     { label: 'Info',     color: '#6b7280', bg: 'bg-gray-800',      border: 'border-gray-700',   icon: Shield },
}

const STATUS_CONFIG = {
  pending:   { label: 'Aguardando', color: 'text-gray-400',  icon: Clock },
  running:   { label: 'Executando', color: 'text-blue-400',  icon: Loader2 },
  completed: { label: 'Concluído',  color: 'text-green-400', icon: CheckCircle },
  failed:    { label: 'Falhou',     color: 'text-red-400',   icon: AlertTriangle },
}

function formatDuration(s: number | null): string {
  if (!s) return '—'
  if (s < 60) return `${s.toFixed(0)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ─── Modal de Nova Varredura ──────────────────────────────────────────────────
function NewScanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    target: '',
    scanner: 'nmap' as 'nmap' | 'openvas',
    scan_type: 'quick',
    ports: '',
    timing: 'T4',
    os_detection: false,
    openvas_config: 'full',
    timeout_s: 600,
  })
  const [loading, setLoading] = useState(false)
  const [openvasAvailable, setOpenvasAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    api.get('/vuln-scanner/openvas/status')
      .then(r => setOpenvasAvailable(r.data.available))
      .catch(() => setOpenvasAvailable(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.target.trim()) {
      toast.error('Nome e alvo são obrigatórios')
      return
    }
    setLoading(true)
    try {
      await api.post('/vuln-scanner/scans', form)
      toast.success(`Varredura "${form.name}" iniciada!`)
      onCreated()
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao iniciar varredura')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            <h2 className="text-white font-semibold">Nova Varredura</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Nome da Varredura *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Varredura Rede Cliente X"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Alvo */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Alvo (IP, CIDR ou hostname) *</label>
            <input
              type="text"
              value={form.target}
              onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
              placeholder="Ex: 192.168.1.0/24 ou 10.0.0.1"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Scanner */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Scanner</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, scanner: 'nmap' }))}
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                  form.scanner === 'nmap'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              >
                <Zap className="w-4 h-4" />
                Nmap
                <span className="text-xs opacity-70">(rápido)</span>
              </button>
              <button
                type="button"
                onClick={() => openvasAvailable && setForm(f => ({ ...f, scanner: 'openvas' }))}
                disabled={!openvasAvailable}
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                  form.scanner === 'openvas'
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : openvasAvailable
                    ? 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                    : 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                }`}
              >
                <Lock className="w-4 h-4" />
                OpenVAS
                {openvasAvailable === false && <span className="text-xs text-red-400">(offline)</span>}
                {openvasAvailable === true && <span className="text-xs opacity-70">(completo)</span>}
                {openvasAvailable === null && <Loader2 className="w-3 h-3 animate-spin" />}
              </button>
            </div>
          </div>

          {/* Opções Nmap */}
          {form.scanner === 'nmap' && (
            <div className="space-y-3 border border-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-400 font-medium">Opções Nmap</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tipo de Varredura</label>
                  <select
                    value={form.scan_type}
                    onChange={e => setForm(f => ({ ...f, scan_type: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                  >
                    <option value="quick">Rápida (top 100 portas)</option>
                    <option value="full">Completa (todas as portas)</option>
                    <option value="vuln">Vulnerabilidades (NSE vuln)</option>
                    <option value="custom">Personalizada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Velocidade</label>
                  <select
                    value={form.timing}
                    onChange={e => setForm(f => ({ ...f, timing: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                  >
                    <option value="T1">T1 — Muito lento (furtivo)</option>
                    <option value="T2">T2 — Lento</option>
                    <option value="T3">T3 — Normal</option>
                    <option value="T4">T4 — Rápido (recomendado)</option>
                    <option value="T5">T5 — Agressivo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Portas (opcional)</label>
                <input
                  type="text"
                  value={form.ports}
                  onChange={e => setForm(f => ({ ...f, ports: e.target.value }))}
                  placeholder="Ex: 22,80,443 ou 1-1000 ou all"
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.os_detection}
                  onChange={e => setForm(f => ({ ...f, os_detection: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-xs text-gray-300">Detecção de SO (requer root)</span>
              </label>
            </div>
          )}

          {/* Opções OpenVAS */}
          {form.scanner === 'openvas' && (
            <div className="space-y-3 border border-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-400 font-medium">Opções OpenVAS</p>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Configuração de Varredura</label>
                <select
                  value={form.openvas_config}
                  onChange={e => setForm(f => ({ ...f, openvas_config: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                >
                  <option value="full">Full and Fast (completo)</option>
                  <option value="fast">Discovery (descoberta rápida)</option>
                </select>
              </div>
              <p className="text-xs text-yellow-400">
                Varreduras OpenVAS podem levar de 15 minutos a várias horas por host.
              </p>
            </div>
          )}

          {/* Timeout */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Timeout (segundos)</label>
            <input
              type="number"
              value={form.timeout_s}
              onChange={e => setForm(f => ({ ...f, timeout_s: parseInt(e.target.value) || 600 }))}
              min={60}
              max={86400}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Iniciar Varredura
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Painel de Findings ───────────────────────────────────────────────────────
function FindingsPanel({ scan }: { scan: Scan }) {
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSev, setFilterSev] = useState<string>('all')
  const [filterHost, setFilterHost] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (scan.status !== 'completed') { setLoading(false); return }
    api.get(`/vuln-scanner/scans/${scan.id}/findings?limit=2000`)
      .then(r => setFindings(r.data))
      .catch(() => toast.error('Erro ao carregar findings'))
      .finally(() => setLoading(false))
  }, [scan.id, scan.status])

  const filtered = findings.filter(f => {
    if (filterSev !== 'all' && f.severity !== filterSev) return false
    if (filterHost && !f.host.includes(filterHost) && !(f.hostname || '').includes(filterHost)) return false
    return true
  })

  // Agrupar por host
  const byHost: Record<string, Finding[]> = {}
  filtered.forEach(f => {
    if (!byHost[f.host]) byHost[f.host] = []
    byHost[f.host].push(f)
  })

  // Contagem por severidade
  const sevCounts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const downloadPdf = async () => {
    try {
      const resp = await api.get(`/vuln-scanner/scans/${scan.id}/report/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `vuln-scan-${scan.name.replace(/\s+/g, '_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('PDF baixado com sucesso!')
    } catch {
      toast.error('Erro ao gerar PDF')
    }
  }

  if (scan.status === 'pending' || scan.status === 'running') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-blue-400" />
        <p className="text-sm">Varredura em andamento...</p>
        <p className="text-xs mt-1">Os resultados aparecerão aqui ao concluir</p>
      </div>
    )
  }

  if (scan.status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-red-400">
        <AlertTriangle className="w-8 h-8 mb-3" />
        <p className="text-sm font-medium">Varredura falhou</p>
        <p className="text-xs mt-1 text-gray-400">{scan.error_msg}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Resumo de severidade */}
      <div className="grid grid-cols-5 gap-2">
        {(Object.entries(SEVERITY_CONFIG) as [string, typeof SEVERITY_CONFIG.critical][]).map(([sev, cfg]) => (
          <button
            key={sev}
            onClick={() => setFilterSev(filterSev === sev ? 'all' : sev)}
            className={`p-2 rounded-lg border text-center transition-colors ${
              filterSev === sev ? `${cfg.bg} ${cfg.border}` : 'bg-gray-800 border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="text-lg font-bold" style={{ color: cfg.color }}>
              {sevCounts[sev] || 0}
            </div>
            <div className="text-xs text-gray-400">{cfg.label}</div>
          </button>
        ))}
      </div>

      {/* Filtros e ações */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={filterHost}
            onChange={e => setFilterHost(e.target.value)}
            placeholder="Filtrar por IP ou hostname..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={downloadPdf}
          className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm"
        >
          <Download className="w-4 h-4" />
          PDF
        </button>
      </div>

      {/* Findings por host */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        </div>
      ) : Object.keys(byHost).length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Nenhum finding encontrado</p>
        </div>
      ) : (
        Object.entries(byHost).map(([host, hFindings]) => (
          <div key={host} className="border border-gray-700 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-800">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-400" />
                <span className="text-white font-mono text-sm">{host}</span>
                {hFindings[0].hostname && (
                  <span className="text-gray-400 text-xs">({hFindings[0].hostname})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(['critical','high','medium','low','info'] as const).map(sev => {
                  const cnt = hFindings.filter(f => f.severity === sev).length
                  if (!cnt) return null
                  return (
                    <span
                      key={sev}
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: SEVERITY_CONFIG[sev].color + '33', color: SEVERITY_CONFIG[sev].color }}
                    >
                      {cnt}
                    </span>
                  )
                })}
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="text-left px-4 py-2">Porta</th>
                  <th className="text-left px-4 py-2">Serviço</th>
                  <th className="text-left px-4 py-2">Título</th>
                  <th className="text-left px-4 py-2">Severidade</th>
                  <th className="text-left px-4 py-2">CVE/ID</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {hFindings
                  .sort((a, b) => {
                    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
                    return (order[a.severity] || 4) - (order[b.severity] || 4)
                  })
                  .map(f => (
                    <>
                      <tr
                        key={f.id}
                        className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                        onClick={() => (f.description || f.solution) && toggleExpand(f.id)}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-gray-300">
                          {f.port ? `${f.port}/${f.protocol}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-300 text-xs">
                          {f.service || '—'}
                          {f.service_version && (
                            <span className="text-gray-500 ml-1">{f.service_version}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-200 text-xs max-w-xs truncate">
                          {f.title}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: SEVERITY_CONFIG[f.severity]?.color + '33',
                              color: SEVERITY_CONFIG[f.severity]?.color
                            }}
                          >
                            {SEVERITY_CONFIG[f.severity]?.label || f.severity}
                            {f.cvss_score !== null && ` ${f.cvss_score.toFixed(1)}`}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-blue-400">
                          {f.vuln_id || '—'}
                        </td>
                        <td className="px-4 py-2">
                          {(f.description || f.solution) && (
                            expanded.has(f.id)
                              ? <ChevronUp className="w-3 h-3 text-gray-400" />
                              : <ChevronDown className="w-3 h-3 text-gray-400" />
                          )}
                        </td>
                      </tr>
                      {expanded.has(f.id) && (
                        <tr key={`${f.id}-detail`} className="border-b border-gray-800">
                          <td colSpan={6} className="px-4 py-3 bg-gray-900">
                            {f.description && (
                              <div className="mb-2">
                                <p className="text-xs text-gray-400 font-medium mb-1">Descrição</p>
                                <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono bg-gray-800 rounded p-2">
                                  {f.description}
                                </pre>
                              </div>
                            )}
                            {f.solution && (
                              <div>
                                <p className="text-xs text-green-400 font-medium mb-1">Solução</p>
                                <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono bg-gray-800 rounded p-2">
                                  {f.solution}
                                </pre>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────
export default function VulnScannerPage() {
  const [scans, setScans] = useState<Scan[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewModal, setShowNewModal] = useState(false)
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null)
  const [filterScanner, setFilterScanner] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const fetchScans = useCallback(async () => {
    try {
      const params: Record<string, string> = {}
      if (filterScanner !== 'all') params.scanner = filterScanner
      if (filterStatus !== 'all') params.status = filterStatus
      const resp = await api.get('/vuln-scanner/scans', { params })
      setScans(resp.data.items || [])
      // Atualizar scan selecionado se estiver rodando
      if (selectedScan && (selectedScan.status === 'pending' || selectedScan.status === 'running')) {
        const updated = (resp.data.items || []).find((s: Scan) => s.id === selectedScan.id)
        if (updated) setSelectedScan(updated)
      }
    } catch {
      // silencioso
    } finally {
      setLoading(false)
    }
  }, [filterScanner, filterStatus, selectedScan?.id])

  useEffect(() => {
    fetchScans()
    const interval = setInterval(fetchScans, 5000)
    return () => clearInterval(interval)
  }, [fetchScans])

  const deleteScan = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Remover esta varredura e todos os seus findings?')) return
    try {
      await api.delete(`/vuln-scanner/scans/${id}`)
      toast.success('Varredura removida')
      if (selectedScan?.id === id) setSelectedScan(null)
      fetchScans()
    } catch {
      toast.error('Erro ao remover varredura')
    }
  }

  // Estatísticas gerais
  const stats = {
    total:     scans.length,
    running:   scans.filter(s => s.status === 'running' || s.status === 'pending').length,
    completed: scans.filter(s => s.status === 'completed').length,
    findings:  scans.reduce((acc, s) => acc + (s.total_findings || 0), 0),
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600/20 rounded-lg">
            <Shield className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Scanner de Vulnerabilidades</h1>
            <p className="text-xs text-gray-400">Nmap e OpenVAS — Retenção de 90 dias</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchScans}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Varredura
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4 border-b border-gray-800">
        {[
          { label: 'Total de Varreduras', value: stats.total,     color: 'text-white' },
          { label: 'Em Execução',         value: stats.running,   color: 'text-blue-400' },
          { label: 'Concluídas',          value: stats.completed, color: 'text-green-400' },
          { label: 'Findings Totais',     value: stats.findings,  color: 'text-orange-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Conteúdo principal */}
      <div className="flex flex-1 overflow-hidden">
        {/* Lista de varreduras */}
        <div className="w-80 border-r border-gray-800 flex flex-col">
          {/* Filtros */}
          <div className="p-3 border-b border-gray-800 space-y-2">
            <select
              value={filterScanner}
              onChange={e => setFilterScanner(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            >
              <option value="all">Todos os scanners</option>
              <option value="nmap">Nmap</option>
              <option value="openvas">OpenVAS</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
            >
              <option value="all">Todos os status</option>
              <option value="pending">Aguardando</option>
              <option value="running">Executando</option>
              <option value="completed">Concluído</option>
              <option value="failed">Falhou</option>
            </select>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
              </div>
            ) : scans.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhuma varredura</p>
                <p className="text-xs mt-1">Clique em "Nova Varredura" para começar</p>
              </div>
            ) : (
              scans.map(scan => {
                const stCfg = STATUS_CONFIG[scan.status]
                const StIcon = stCfg.icon
                const isSelected = selectedScan?.id === scan.id
                return (
                  <div
                    key={scan.id}
                    onClick={() => setSelectedScan(scan)}
                    className={`p-3 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50 transition-colors ${
                      isSelected ? 'bg-gray-800 border-l-2 border-l-blue-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{scan.name}</p>
                        <p className="text-xs text-gray-400 font-mono truncate">{scan.target}</p>
                      </div>
                      <button
                        onClick={e => deleteScan(scan.id, e)}
                        className="p-1 text-gray-600 hover:text-red-400 flex-shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                          scan.scanner === 'nmap'
                            ? 'bg-blue-900/40 text-blue-300'
                            : 'bg-purple-900/40 text-purple-300'
                        }`}>
                          {scan.scanner === 'nmap' ? <Zap className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                          {scan.scanner.toUpperCase()}
                        </span>
                        <span className={`flex items-center gap-1 text-xs ${stCfg.color}`}>
                          <StIcon className={`w-3 h-3 ${scan.status === 'running' ? 'animate-spin' : ''}`} />
                          {stCfg.label}
                        </span>
                      </div>
                      {scan.total_findings > 0 && (
                        <span className="text-xs text-orange-400">{scan.total_findings} findings</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{formatDate(scan.created_at)}</p>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Painel de detalhes */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedScan ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Shield className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg font-medium">Selecione uma varredura</p>
              <p className="text-sm mt-1">Ou inicie uma nova varredura para ver os resultados</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header do scan */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">{selectedScan.name}</h2>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                    <span className="font-mono">{selectedScan.target}</span>
                    <span>•</span>
                    <span>{selectedScan.scanner.toUpperCase()}</span>
                    <span>•</span>
                    <span>{formatDate(selectedScan.created_at)}</span>
                    {selectedScan.duration_s && (
                      <>
                        <span>•</span>
                        <span>{formatDuration(selectedScan.duration_s)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedScan.status === 'completed' && (
                    <>
                      <div className="text-right text-sm">
                        <div className="text-green-400 font-medium">{selectedScan.hosts_up} hosts ativos</div>
                        <div className="text-gray-400">{selectedScan.total_findings} findings</div>
                      </div>
                    </>
                  )}
                  {(selectedScan.status === 'pending' || selectedScan.status === 'running') && (
                    <div className="flex items-center gap-2 text-blue-400">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">Executando...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Findings */}
              <FindingsPanel scan={selectedScan} />
            </div>
          )}
        </div>
      </div>

      {/* Modal de nova varredura */}
      {showNewModal && (
        <NewScanModal
          onClose={() => setShowNewModal(false)}
          onCreated={fetchScans}
        />
      )}
    </div>
  )
}
