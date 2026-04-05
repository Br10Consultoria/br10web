/**
 * NetworkToolsPage — Ferramentas de diagnóstico de rede
 *
 * Ferramentas disponíveis:
 * 1. Ping ICMP — IPv4 e IPv6, com estatísticas de RTT e perda de pacotes
 * 2. Validação RPKI — verifica o estado RPKI de um prefixo IP (valid/invalid/not-found)
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Activity, Shield, Wifi, WifiOff, AlertTriangle,
  CheckCircle, XCircle, HelpCircle, Loader2,
  ChevronDown, ChevronRight, Globe, Server,
  ArrowRight, Clock, BarChart2, Info, Search,
} from 'lucide-react'
import api from '../utils/api'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PingResult {
  target: string
  resolved_ip: string
  ip_version: number
  success: boolean
  packets_sent: number
  packets_received: number
  packet_loss_pct: number
  rtt_min_ms: number
  rtt_avg_ms: number
  rtt_max_ms: number
  rtt_mdev_ms: number
  elapsed_ms: number
  raw_lines: string[]
  raw_output: string
  return_code: number
  error?: string
}

interface RoaEntry {
  asn: string | number
  prefix: string
  max_length: number
  match?: boolean
  validity?: string
}

interface RpkiResult {
  prefix: string
  ip_version: number
  rpki_status: 'valid' | 'invalid' | 'not-found' | 'unknown'
  roas: RoaEntry[]
  origin_asns: number[]
  country: string | null
  rir: string | null
  announced: boolean | null
  cloudflare_checked: boolean
  ripe_checked: boolean
  errors: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RPKI_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.FC<any>; desc: string }> = {
  valid: {
    label: 'Válido',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-500/30',
    icon: CheckCircle,
    desc: 'ROA encontrado e o ASN de origem corresponde ao prefixo. Rota é legítima.',
  },
  invalid: {
    label: 'Inválido',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-500/30',
    icon: XCircle,
    desc: 'ROA encontrado, mas o ASN de origem NÃO corresponde. Possível route hijack ou misconfiguration.',
  },
  'not-found': {
    label: 'Não Encontrado',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-500/30',
    icon: HelpCircle,
    desc: 'Nenhum ROA (Route Origin Authorization) encontrado para este prefixo. O prefixo não está coberto por RPKI.',
  },
  unknown: {
    label: 'Desconhecido',
    color: 'text-gray-400',
    bg: 'bg-gray-400/10',
    border: 'border-gray-500/30',
    icon: HelpCircle,
    desc: 'Não foi possível determinar o estado RPKI. Verifique os erros abaixo.',
  },
}

function formatRtt(ms: number) {
  if (ms === 0) return '—'
  return `${ms.toFixed(2)} ms`
}

function LossBar({ pct }: { pct: number }) {
  const color = pct === 0 ? 'bg-emerald-500' : pct < 25 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-dark-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono font-semibold ${pct === 0 ? 'text-emerald-400' : pct < 25 ? 'text-yellow-400' : 'text-red-400'}`}>
        {pct}%
      </span>
    </div>
  )
}

// ─── Componente Ping ──────────────────────────────────────────────────────────

function PingTool() {
  const [target, setTarget] = useState('')
  const [count, setCount] = useState(4)
  const [ipVersion, setIpVersion] = useState<4 | 6>(4)
  const [showRaw, setShowRaw] = useState(false)

  const pingMutation = useMutation<PingResult, any, void>({
    mutationFn: () =>
      api.post('/network-tools/ping', { target, count, ip_version: ipVersion }).then(r => r.data),
  })

  const result = pingMutation.data

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!target.trim()) return
    pingMutation.mutate()
  }

  return (
    <div className="space-y-5">
      {/* Formulário */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-dark-500 mb-1.5">IP ou Hostname</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input
                type="text"
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder="8.8.8.8 ou google.com"
                className="input w-full pl-10"
                disabled={pingMutation.isPending}
              />
            </div>
          </div>

          <div className="w-28">
            <label className="block text-xs text-dark-500 mb-1.5">Pacotes</label>
            <select
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              className="input w-full"
              disabled={pingMutation.isPending}
            >
              {[1, 2, 3, 4, 5, 10, 20].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div className="w-32">
            <label className="block text-xs text-dark-500 mb-1.5">Versão IP</label>
            <div className="flex rounded-lg overflow-hidden border border-dark-600">
              <button
                type="button"
                onClick={() => setIpVersion(4)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  ipVersion === 4 ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-400 hover:bg-dark-700'
                }`}
                disabled={pingMutation.isPending}
              >
                IPv4
              </button>
              <button
                type="button"
                onClick={() => setIpVersion(6)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  ipVersion === 6 ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-400 hover:bg-dark-700'
                }`}
                disabled={pingMutation.isPending}
              >
                IPv6
              </button>
            </div>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={pingMutation.isPending || !target.trim()}
              className="btn-primary flex items-center gap-2 h-10"
            >
              {pingMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Pingando...</>
              ) : (
                <><Activity className="w-4 h-4" /> Ping</>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Erro de requisição */}
      {pingMutation.isError && (
        <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium text-sm">Erro ao executar ping</p>
            <p className="text-red-300/70 text-xs mt-0.5">
              {(pingMutation.error as any)?.response?.data?.detail || 'Verifique o alvo e tente novamente.'}
            </p>
          </div>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="space-y-4">
          {/* Status banner */}
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${
            result.success
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            {result.success ? (
              <Wifi className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-400 flex-shrink-0" />
            )}
            <div className="flex-1">
              <p className={`font-semibold ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {result.success ? 'Host acessível' : 'Host inacessível'}
              </p>
              <p className="text-dark-400 text-xs">
                {result.target !== result.resolved_ip
                  ? `${result.target} → ${result.resolved_ip} (IPv${result.ip_version})`
                  : `${result.resolved_ip} (IPv${result.ip_version})`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-dark-400 text-xs">Tempo total</p>
              <p className="text-white font-mono text-sm">{result.elapsed_ms} ms</p>
            </div>
          </div>

          {/* Estatísticas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Enviados" value={result.packets_sent} unit="pkts" />
            <StatBox label="Recebidos" value={result.packets_received} unit="pkts"
              color={result.packets_received === result.packets_sent ? 'text-emerald-400' : 'text-yellow-400'} />
            <StatBox label="RTT Médio" value={formatRtt(result.rtt_avg_ms)} />
            <StatBox label="RTT Máximo" value={formatRtt(result.rtt_max_ms)} />
          </div>

          {/* Perda de pacotes */}
          <div className="card p-4">
            <p className="text-dark-500 text-xs mb-2">Perda de Pacotes</p>
            <LossBar pct={result.packet_loss_pct} />
          </div>

          {/* RTT detalhado */}
          {result.success && (
            <div className="card p-4">
              <p className="text-dark-500 text-xs uppercase tracking-wider mb-3">RTT Detalhado</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-dark-500 text-xs">Mínimo</p>
                  <p className="text-white font-mono text-sm font-semibold">{formatRtt(result.rtt_min_ms)}</p>
                </div>
                <div>
                  <p className="text-dark-500 text-xs">Médio</p>
                  <p className="text-brand-400 font-mono text-sm font-semibold">{formatRtt(result.rtt_avg_ms)}</p>
                </div>
                <div>
                  <p className="text-dark-500 text-xs">Máximo</p>
                  <p className="text-white font-mono text-sm font-semibold">{formatRtt(result.rtt_max_ms)}</p>
                </div>
                <div>
                  <p className="text-dark-500 text-xs">Jitter</p>
                  <p className="text-white font-mono text-sm font-semibold">{formatRtt(result.rtt_mdev_ms)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Respostas individuais */}
          {result.raw_lines.length > 0 && (
            <div className="card p-4">
              <p className="text-dark-500 text-xs uppercase tracking-wider mb-2">Respostas</p>
              <div className="space-y-1">
                {result.raw_lines.map((line, i) => (
                  <p key={i} className="font-mono text-xs text-dark-300 bg-dark-800 px-3 py-1.5 rounded">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Output bruto (colapsável) */}
          <button
            onClick={() => setShowRaw(r => !r)}
            className="flex items-center gap-1.5 text-dark-500 hover:text-dark-300 text-xs transition-colors"
          >
            {showRaw ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Output bruto do comando
          </button>
          {showRaw && (
            <pre className="bg-dark-900 border border-dark-700 rounded-lg p-4 text-xs font-mono text-dark-300 overflow-x-auto whitespace-pre-wrap">
              {result.raw_output || result.error || 'Sem output'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, unit, color = 'text-white' }: {
  label: string; value: string | number; unit?: string; color?: string
}) {
  return (
    <div className="card p-3 text-center">
      <p className="text-dark-500 text-xs mb-1">{label}</p>
      <p className={`font-mono font-bold text-lg ${color}`}>
        {value}{unit && <span className="text-xs text-dark-500 ml-1">{unit}</span>}
      </p>
    </div>
  )
}

// ─── Componente RPKI ──────────────────────────────────────────────────────────

function RpkiTool() {
  const [prefix, setPrefix] = useState('')
  const [asn, setAsn] = useState('')
  const [showRoas, setShowRoas] = useState(true)

  const rpkiMutation = useMutation<RpkiResult, any, void>({
    mutationFn: () =>
      api.post('/network-tools/rpki', {
        prefix: prefix.trim(),
        asn: asn.trim() ? Number(asn.replace(/^AS/i, '')) : undefined,
      }).then(r => r.data),
  })

  const result = rpkiMutation.data
  const cfg = result ? (RPKI_CONFIG[result.rpki_status] ?? RPKI_CONFIG.unknown) : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!prefix.trim()) return
    rpkiMutation.mutate()
  }

  return (
    <div className="space-y-5">
      {/* Formulário */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-dark-500 mb-1.5">Prefixo IP (CIDR)</label>
            <div className="relative">
              <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input
                type="text"
                value={prefix}
                onChange={e => setPrefix(e.target.value)}
                placeholder="177.75.0.0/20"
                className="input w-full pl-10 font-mono"
                disabled={rpkiMutation.isPending}
              />
            </div>
          </div>

          <div className="w-40">
            <label className="block text-xs text-dark-500 mb-1.5">ASN de Origem (opcional)</label>
            <input
              type="text"
              value={asn}
              onChange={e => setAsn(e.target.value)}
              placeholder="AS12345"
              className="input w-full font-mono"
              disabled={rpkiMutation.isPending}
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={rpkiMutation.isPending || !prefix.trim()}
              className="btn-primary flex items-center gap-2 h-10"
            >
              {rpkiMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Validando...</>
              ) : (
                <><Shield className="w-4 h-4" /> Validar RPKI</>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 bg-dark-800 rounded-lg border border-dark-700">
          <Info className="w-4 h-4 text-dark-500 flex-shrink-0 mt-0.5" />
          <p className="text-dark-500 text-xs">
            Se o ASN não for informado, o sistema consulta automaticamente o ASN de origem via RIPE Stat.
            A validação usa a API pública do Cloudflare RPKI + RIPE Stat.
          </p>
        </div>
      </form>

      {/* Erro de requisição */}
      {rpkiMutation.isError && (
        <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium text-sm">Erro ao validar RPKI</p>
            <p className="text-red-300/70 text-xs mt-0.5">
              {(rpkiMutation.error as any)?.response?.data?.detail || 'Verifique o prefixo e tente novamente.'}
            </p>
          </div>
        </div>
      )}

      {/* Resultado */}
      {result && cfg && (
        <div className="space-y-4">
          {/* Status banner */}
          <div className={`flex items-start gap-4 p-5 rounded-xl border ${cfg.bg} ${cfg.border}`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
              <cfg.icon className={`w-6 h-6 ${cfg.color}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <span className={`text-xl font-bold ${cfg.color}`}>{cfg.label}</span>
                <span className="font-mono text-white text-lg">{result.prefix}</span>
                <span className="text-dark-500 text-sm">IPv{result.ip_version}</span>
              </div>
              <p className="text-dark-400 text-sm">{cfg.desc}</p>
            </div>
          </div>

          {/* Informações do prefixo */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoCard label="RIR" value={result.rir || '—'} />
            <InfoCard label="País" value={result.country || '—'} />
            <InfoCard
              label="Anunciado"
              value={result.announced === null ? '—' : result.announced ? 'Sim' : 'Não'}
              color={result.announced ? 'text-emerald-400' : result.announced === false ? 'text-red-400' : 'text-dark-400'}
            />
            <InfoCard
              label="ASNs de Origem"
              value={result.origin_asns.length > 0 ? result.origin_asns.map(a => `AS${a}`).join(', ') : '—'}
              mono
            />
          </div>

          {/* ROAs */}
          {result.roas.length > 0 && (
            <div className="card overflow-hidden">
              <button
                onClick={() => setShowRoas(r => !r)}
                className="w-full flex items-center justify-between p-4 hover:bg-dark-800/40 transition-colors"
              >
                <span className="text-sm font-medium text-white">
                  ROAs Encontrados ({result.roas.length})
                </span>
                {showRoas ? <ChevronDown className="w-4 h-4 text-dark-500" /> : <ChevronRight className="w-4 h-4 text-dark-500" />}
              </button>
              {showRoas && (
                <div className="border-t border-dark-700 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-dark-500 border-b border-dark-700">
                        <th className="text-left px-4 py-2.5 font-medium">ASN</th>
                        <th className="text-left px-4 py-2.5 font-medium">Prefixo</th>
                        <th className="text-left px-4 py-2.5 font-medium">Max Length</th>
                        <th className="text-left px-4 py-2.5 font-medium">Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.roas.map((roa, i) => (
                        <tr key={i} className="border-b border-dark-800 hover:bg-dark-800/30">
                          <td className="px-4 py-2.5 font-mono text-brand-400 font-semibold">
                            AS{roa.asn}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-dark-300">{roa.prefix}</td>
                          <td className="px-4 py-2.5 font-mono text-dark-400">/{roa.max_length}</td>
                          <td className="px-4 py-2.5">
                            {roa.match !== undefined ? (
                              roa.match ? (
                                <span className="flex items-center gap-1 text-emerald-400 text-xs">
                                  <CheckCircle className="w-3.5 h-3.5" /> Corresponde
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-red-400 text-xs">
                                  <XCircle className="w-3.5 h-3.5" /> Não corresponde
                                </span>
                              )
                            ) : (
                              <span className="text-dark-500 text-xs">{roa.validity || '—'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Fontes consultadas */}
          <div className="flex items-center gap-3 text-xs text-dark-500">
            <span>Fontes consultadas:</span>
            {result.cloudflare_checked && (
              <span className="flex items-center gap-1 text-dark-400">
                <CheckCircle className="w-3 h-3 text-emerald-500" /> Cloudflare RPKI
              </span>
            )}
            {result.ripe_checked && (
              <span className="flex items-center gap-1 text-dark-400">
                <CheckCircle className="w-3 h-3 text-emerald-500" /> RIPE Stat
              </span>
            )}
          </div>

          {/* Erros (se houver) */}
          {result.errors.length > 0 && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-400 text-xs font-medium mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Avisos
              </p>
              {result.errors.map((err, i) => (
                <p key={i} className="text-yellow-300/70 text-xs">{err}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InfoCard({ label, value, color = 'text-white', mono = false }: {
  label: string; value: string; color?: string; mono?: boolean
}) {
  return (
    <div className="card p-3">
      <p className="text-dark-500 text-xs mb-1">{label}</p>
      <p className={`font-semibold text-sm ${color} ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────

type Tool = 'ping' | 'rpki'

const TOOLS: { id: Tool; label: string; icon: React.FC<any>; desc: string }[] = [
  {
    id: 'ping',
    label: 'Ping ICMP',
    icon: Activity,
    desc: 'Teste de conectividade IPv4 e IPv6 com estatísticas de RTT e perda de pacotes',
  },
  {
    id: 'rpki',
    label: 'Validação RPKI',
    icon: Shield,
    desc: 'Verifica o estado RPKI de prefixos IP: valid, invalid ou not-found',
  },
]

export default function NetworkToolsPage() {
  const [activeTool, setActiveTool] = useState<Tool>('ping')

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Ferramentas de Rede</h1>
        <p className="text-dark-500 text-sm">Diagnóstico e validação de infraestrutura de rede</p>
      </div>

      {/* Seleção de ferramenta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TOOLS.map(tool => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            className={`text-left p-4 rounded-xl border transition-all ${
              activeTool === tool.id
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-dark-700 bg-dark-800/40 hover:border-dark-600'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                activeTool === tool.id ? 'bg-brand-500/20' : 'bg-dark-700'
              }`}>
                <tool.icon className={`w-5 h-5 ${activeTool === tool.id ? 'text-brand-400' : 'text-dark-400'}`} />
              </div>
              <div>
                <p className={`font-semibold text-sm ${activeTool === tool.id ? 'text-brand-300' : 'text-white'}`}>
                  {tool.label}
                </p>
                <p className="text-dark-500 text-xs mt-0.5">{tool.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Ferramenta ativa */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-dark-700">
          {activeTool === 'ping' ? (
            <Activity className="w-5 h-5 text-brand-400" />
          ) : (
            <Shield className="w-5 h-5 text-brand-400" />
          )}
          <div>
            <h2 className="text-base font-semibold text-white">
              {TOOLS.find(t => t.id === activeTool)?.label}
            </h2>
            <p className="text-dark-500 text-xs">
              {TOOLS.find(t => t.id === activeTool)?.desc}
            </p>
          </div>
        </div>

        {activeTool === 'ping' && <PingTool />}
        {activeTool === 'rpki' && <RpkiTool />}
      </div>
    </div>
  )
}
