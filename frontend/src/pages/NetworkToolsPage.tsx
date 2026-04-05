/**
 * NetworkToolsPage — Ferramentas de diagnóstico de rede
 * - Ping ICMP (IPv4/IPv6)
 * - Traceroute (IPv4/IPv6)
 * - DNS Lookup + DNSSEC
 * - Validação RPKI
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Activity, Shield, Wifi, WifiOff, AlertTriangle,
  CheckCircle, XCircle, HelpCircle, Loader2,
  ChevronDown, ChevronRight, Globe, Server,
  Clock, Info, Search, ArrowRight, MapPin,
  Wrench, Network, Database,
} from 'lucide-react'
import api from '../utils/api'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PingResult {
  target: string; resolved_ip: string; ip_version: number; success: boolean
  packets_sent: number; packets_received: number; packet_loss_pct: number
  rtt_min_ms: number; rtt_avg_ms: number; rtt_max_ms: number; rtt_mdev_ms: number
  elapsed_ms: number; raw_lines: string[]; raw_output: string; return_code: number; error?: string
}

interface TracerouteHop {
  hop: number; hostname: string | null; ip: string | null
  rtts_ms: number[]; avg_rtt_ms: number | null; timeout: boolean
}

interface TracerouteResult {
  target: string; resolved_ip: string; ip_version: number
  hops: TracerouteHop[]; total_hops: number; elapsed_ms: number; raw_output: string
}

interface DnsRecord { [key: string]: any }
interface DnssecResult {
  enabled: boolean; validated: boolean; status: string; details: string[]; error: string | null
}
interface DnsResult {
  target: string; record_type: string; nameserver_used: string
  records: DnsRecord[]; ttl: number | null; dnssec: DnssecResult | null; error: string | null
}

interface RoaEntry {
  asn: string | number; prefix: string; max_length: number; match?: boolean; validity?: string
}
interface RpkiResult {
  prefix: string; ip_version: number; rpki_status: 'valid' | 'invalid' | 'not-found' | 'unknown'
  roas: RoaEntry[]; origin_asns: number[]; country: string | null; rir: string | null
  announced: boolean | null; sources_checked: string[]; errors: string[]
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const RPKI_CONFIG = {
  valid: { label: 'Válido', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-500/30', icon: CheckCircle, desc: 'ROA encontrado e o ASN de origem corresponde. Rota é legítima.' },
  invalid: { label: 'Inválido', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-500/30', icon: XCircle, desc: 'ROA encontrado mas ASN não corresponde. Possível route hijack.' },
  'not-found': { label: 'Não Encontrado', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-500/30', icon: HelpCircle, desc: 'Nenhum ROA encontrado. O prefixo não está coberto por RPKI.' },
  unknown: { label: 'Desconhecido', color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-500/30', icon: HelpCircle, desc: 'Não foi possível determinar o estado RPKI.' },
}

const DNS_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'PTR', 'CAA', 'SRV', 'DNSKEY', 'DS']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRtt(ms: number) { return ms === 0 ? '—' : `${ms.toFixed(2)} ms` }

function LossBar({ pct }: { pct: number }) {
  const color = pct === 0 ? 'bg-emerald-500' : pct < 25 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-dark-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono font-semibold ${pct === 0 ? 'text-emerald-400' : pct < 25 ? 'text-yellow-400' : 'text-red-400'}`}>{pct}%</span>
    </div>
  )
}

function StatBox({ label, value, unit, color = 'text-white' }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-dark-500 text-xs mb-1">{label}</p>
      <p className={`font-mono font-bold text-lg ${color}`}>{value}{unit && <span className="text-xs text-dark-500 ml-1">{unit}</span>}</p>
    </div>
  )
}

function ErrorBanner({ error }: { error: any }) {
  const msg = error?.response?.data?.detail || error?.message || 'Erro desconhecido'
  return (
    <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
      <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-red-400 font-medium text-sm">Erro</p>
        <p className="text-red-300/70 text-xs mt-0.5">{msg}</p>
      </div>
    </div>
  )
}

function IpVersionToggle({ value, onChange, disabled }: { value: 4 | 6; onChange: (v: 4 | 6) => void; disabled?: boolean }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-dark-600">
      {([4, 6] as const).map(v => (
        <button key={v} type="button" onClick={() => onChange(v)} disabled={disabled}
          className={`flex-1 py-2 px-3 text-sm font-medium transition-colors ${value === v ? 'bg-brand-600 text-white' : 'bg-dark-800 text-dark-400 hover:bg-dark-700'}`}>
          IPv{v}
        </button>
      ))}
    </div>
  )
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

function PingTool() {
  const [target, setTarget] = useState('')
  const [count, setCount] = useState(4)
  const [ipVersion, setIpVersion] = useState<4 | 6>(4)
  const [showRaw, setShowRaw] = useState(false)

  const mut = useMutation<PingResult, any, void>({
    mutationFn: () => api.post('/network-tools/ping', { target, count, ip_version: ipVersion }).then(r => r.data),
  })

  const r = mut.data

  return (
    <div className="space-y-5">
      <form onSubmit={e => { e.preventDefault(); if (target.trim()) mut.mutate() }} className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="block text-xs text-dark-500 mb-1.5">IP ou Hostname</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input value={target} onChange={e => setTarget(e.target.value)} placeholder="8.8.8.8 ou google.com" className="input w-full pl-10" disabled={mut.isPending} />
          </div>
        </div>
        <div className="w-28">
          <label className="block text-xs text-dark-500 mb-1.5">Pacotes</label>
          <select value={count} onChange={e => setCount(Number(e.target.value))} className="input w-full" disabled={mut.isPending}>
            {[1, 2, 3, 4, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="w-32">
          <label className="block text-xs text-dark-500 mb-1.5">Versão IP</label>
          <IpVersionToggle value={ipVersion} onChange={setIpVersion} disabled={mut.isPending} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={mut.isPending || !target.trim()} className="btn-primary flex items-center gap-2 h-10">
            {mut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Pingando...</> : <><Activity className="w-4 h-4" /> Ping</>}
          </button>
        </div>
      </form>

      {mut.isError && <ErrorBanner error={mut.error} />}

      {r && (
        <div className="space-y-4">
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${r.success ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            {r.success ? <Wifi className="w-5 h-5 text-emerald-400" /> : <WifiOff className="w-5 h-5 text-red-400" />}
            <div className="flex-1">
              <p className={`font-semibold ${r.success ? 'text-emerald-400' : 'text-red-400'}`}>{r.success ? 'Host acessível' : 'Host inacessível'}</p>
              <p className="text-dark-400 text-xs">{r.target !== r.resolved_ip ? `${r.target} → ${r.resolved_ip}` : r.resolved_ip} (IPv{r.ip_version})</p>
            </div>
            <div className="text-right">
              <p className="text-dark-400 text-xs">Tempo total</p>
              <p className="text-white font-mono text-sm">{r.elapsed_ms} ms</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Enviados" value={r.packets_sent} unit="pkts" />
            <StatBox label="Recebidos" value={r.packets_received} unit="pkts" color={r.packets_received === r.packets_sent ? 'text-emerald-400' : 'text-yellow-400'} />
            <StatBox label="RTT Médio" value={formatRtt(r.rtt_avg_ms)} />
            <StatBox label="RTT Máximo" value={formatRtt(r.rtt_max_ms)} />
          </div>

          <div className="card p-4">
            <p className="text-dark-500 text-xs mb-2">Perda de Pacotes</p>
            <LossBar pct={r.packet_loss_pct} />
          </div>

          {r.success && (
            <div className="card p-4">
              <p className="text-dark-500 text-xs uppercase tracking-wider mb-3">RTT Detalhado</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                {[['Mínimo', r.rtt_min_ms], ['Médio', r.rtt_avg_ms], ['Máximo', r.rtt_max_ms], ['Jitter', r.rtt_mdev_ms]].map(([l, v]) => (
                  <div key={l as string}>
                    <p className="text-dark-500 text-xs">{l}</p>
                    <p className={`font-mono text-sm font-semibold ${l === 'Médio' ? 'text-brand-400' : 'text-white'}`}>{formatRtt(v as number)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {r.raw_lines.length > 0 && (
            <div className="card p-4">
              <p className="text-dark-500 text-xs uppercase tracking-wider mb-2">Respostas</p>
              {r.raw_lines.map((line, i) => <p key={i} className="font-mono text-xs text-dark-300 bg-dark-800 px-3 py-1.5 rounded mb-1">{line}</p>)}
            </div>
          )}

          <button onClick={() => setShowRaw(x => !x)} className="flex items-center gap-1.5 text-dark-500 hover:text-dark-300 text-xs">
            {showRaw ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Output bruto
          </button>
          {showRaw && <pre className="bg-dark-900 border border-dark-700 rounded-lg p-4 text-xs font-mono text-dark-300 overflow-x-auto whitespace-pre-wrap">{r.raw_output || r.error}</pre>}
        </div>
      )}
    </div>
  )
}

// ─── Traceroute ───────────────────────────────────────────────────────────────

function TracerouteTool() {
  const [target, setTarget] = useState('')
  const [ipVersion, setIpVersion] = useState<4 | 6>(4)
  const [maxHops, setMaxHops] = useState(30)
  const [showRaw, setShowRaw] = useState(false)

  const mut = useMutation<TracerouteResult, any, void>({
    mutationFn: () => api.post('/network-tools/traceroute', { target, ip_version: ipVersion, max_hops: maxHops }).then(r => r.data),
  })

  const r = mut.data

  return (
    <div className="space-y-5">
      <form onSubmit={e => { e.preventDefault(); if (target.trim()) mut.mutate() }} className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="block text-xs text-dark-500 mb-1.5">IP ou Hostname</label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input value={target} onChange={e => setTarget(e.target.value)} placeholder="8.8.8.8 ou google.com" className="input w-full pl-10" disabled={mut.isPending} />
          </div>
        </div>
        <div className="w-28">
          <label className="block text-xs text-dark-500 mb-1.5">Max Hops</label>
          <select value={maxHops} onChange={e => setMaxHops(Number(e.target.value))} className="input w-full" disabled={mut.isPending}>
            {[15, 20, 30, 40, 64].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="w-32">
          <label className="block text-xs text-dark-500 mb-1.5">Versão IP</label>
          <IpVersionToggle value={ipVersion} onChange={setIpVersion} disabled={mut.isPending} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={mut.isPending || !target.trim()} className="btn-primary flex items-center gap-2 h-10">
            {mut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Traçando...</> : <><ArrowRight className="w-4 h-4" /> Traceroute</>}
          </button>
        </div>
      </form>

      {mut.isPending && (
        <div className="flex items-center gap-3 p-4 bg-dark-800 rounded-lg border border-dark-700">
          <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
          <div>
            <p className="text-white text-sm font-medium">Executando traceroute...</p>
            <p className="text-dark-500 text-xs">Pode levar até {maxHops * 3} segundos dependendo do número de hops</p>
          </div>
        </div>
      )}

      {mut.isError && <ErrorBanner error={mut.error} />}

      {r && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-dark-800/60 rounded-lg border border-dark-700">
            <div>
              <p className="text-white font-semibold">{r.target}</p>
              {r.target !== r.resolved_ip && <p className="text-dark-400 text-xs">{r.resolved_ip} (IPv{r.ip_version})</p>}
            </div>
            <div className="text-right">
              <p className="text-dark-400 text-xs">{r.total_hops} hops em</p>
              <p className="text-white font-mono text-sm">{(r.elapsed_ms / 1000).toFixed(1)}s</p>
            </div>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dark-500 border-b border-dark-700 text-xs">
                  <th className="text-center px-3 py-2.5 w-10">#</th>
                  <th className="text-left px-3 py-2.5">IP / Hostname</th>
                  <th className="text-right px-3 py-2.5">RTT 1</th>
                  <th className="text-right px-3 py-2.5">RTT 2</th>
                  <th className="text-right px-3 py-2.5">Média</th>
                </tr>
              </thead>
              <tbody>
                {r.hops.map(hop => (
                  <tr key={hop.hop} className="border-b border-dark-800/60 hover:bg-dark-800/30">
                    <td className="text-center px-3 py-2.5 text-dark-500 font-mono text-xs">{hop.hop}</td>
                    <td className="px-3 py-2.5">
                      {hop.timeout ? (
                        <span className="text-dark-600 font-mono">* * *</span>
                      ) : (
                        <div>
                          <span className="font-mono text-brand-400 text-xs">{hop.ip}</span>
                          {hop.hostname && <span className="text-dark-500 text-xs ml-2">({hop.hostname})</span>}
                        </div>
                      )}
                    </td>
                    <td className="text-right px-3 py-2.5 font-mono text-xs text-dark-300">
                      {hop.rtts_ms[0] != null ? `${hop.rtts_ms[0].toFixed(2)} ms` : '—'}
                    </td>
                    <td className="text-right px-3 py-2.5 font-mono text-xs text-dark-300">
                      {hop.rtts_ms[1] != null ? `${hop.rtts_ms[1].toFixed(2)} ms` : '—'}
                    </td>
                    <td className={`text-right px-3 py-2.5 font-mono text-xs font-semibold ${
                      hop.timeout ? 'text-dark-600' :
                      hop.avg_rtt_ms == null ? 'text-dark-500' :
                      hop.avg_rtt_ms < 20 ? 'text-emerald-400' :
                      hop.avg_rtt_ms < 100 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {hop.timeout ? '—' : hop.avg_rtt_ms != null ? `${hop.avg_rtt_ms.toFixed(2)} ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={() => setShowRaw(x => !x)} className="flex items-center gap-1.5 text-dark-500 hover:text-dark-300 text-xs">
            {showRaw ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Output bruto
          </button>
          {showRaw && <pre className="bg-dark-900 border border-dark-700 rounded-lg p-4 text-xs font-mono text-dark-300 overflow-x-auto whitespace-pre-wrap">{r.raw_output}</pre>}
        </div>
      )}
    </div>
  )
}

// ─── DNS Lookup ───────────────────────────────────────────────────────────────

function DnsTool() {
  const [target, setTarget] = useState('')
  const [recordType, setRecordType] = useState('A')
  const [nameserver, setNameserver] = useState('')
  const [checkDnssec, setCheckDnssec] = useState(false)

  const mut = useMutation<DnsResult, any, void>({
    mutationFn: () => api.post('/network-tools/dns', {
      target, record_type: recordType,
      nameserver: nameserver.trim() || undefined,
      check_dnssec: checkDnssec,
    }).then(r => r.data),
  })

  const r = mut.data

  const dnssecStatus = r?.dnssec ? {
    validated: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-500/30', label: 'Validado' },
    signed: { color: 'text-brand-400', bg: 'bg-brand-400/10', border: 'border-brand-500/30', label: 'Assinado' },
    'dnskey-only': { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-500/30', label: 'DNSKEY sem DS' },
    unsigned: { color: 'text-dark-400', bg: 'bg-dark-700', border: 'border-dark-600', label: 'Não assinado' },
    unknown: { color: 'text-dark-400', bg: 'bg-dark-700', border: 'border-dark-600', label: 'Desconhecido' },
    nxdomain: { color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-500/30', label: 'NXDOMAIN' },
  }[r.dnssec.status] ?? { color: 'text-dark-400', bg: 'bg-dark-700', border: 'border-dark-600', label: r.dnssec.status } : null

  const renderRecord = (rec: any, type: string) => {
    if (typeof rec === 'string') return <span className="font-mono text-dark-200">{rec}</span>
    if (type === 'MX') return <span className="font-mono text-dark-200"><span className="text-brand-400">{rec.priority}</span> {rec.exchange}</span>
    if (type === 'SOA') return (
      <div className="text-xs space-y-0.5">
        {Object.entries(rec).map(([k, v]) => <div key={k}><span className="text-dark-500">{k}:</span> <span className="font-mono text-dark-200">{String(v)}</span></div>)}
      </div>
    )
    if (type === 'SRV') return <span className="font-mono text-dark-200">{rec.priority} {rec.weight} {rec.port} {rec.target}</span>
    if (type === 'CAA') return <span className="font-mono text-dark-200">{rec.flags} {rec.tag} "{rec.value}"</span>
    return <span className="font-mono text-dark-200">{JSON.stringify(rec)}</span>
  }

  return (
    <div className="space-y-5">
      <form onSubmit={e => { e.preventDefault(); if (target.trim()) mut.mutate() }} className="space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-dark-500 mb-1.5">Domínio ou IP</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input value={target} onChange={e => setTarget(e.target.value)} placeholder="google.com ou 8.8.8.8" className="input w-full pl-10" disabled={mut.isPending} />
            </div>
          </div>
          <div className="w-36">
            <label className="block text-xs text-dark-500 mb-1.5">Tipo de Registro</label>
            <select value={recordType} onChange={e => setRecordType(e.target.value)} className="input w-full" disabled={mut.isPending}>
              {DNS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="w-44">
            <label className="block text-xs text-dark-500 mb-1.5">Nameserver (opcional)</label>
            <input value={nameserver} onChange={e => setNameserver(e.target.value)} placeholder="8.8.8.8" className="input w-full font-mono" disabled={mut.isPending} />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={mut.isPending || !target.trim()} className="btn-primary flex items-center gap-2 h-10">
              {mut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Consultando...</> : <><Database className="w-4 h-4" /> Consultar</>}
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <input type="checkbox" checked={checkDnssec} onChange={e => setCheckDnssec(e.target.checked)} className="w-4 h-4 rounded accent-brand-500" disabled={mut.isPending} />
          <span className="text-sm text-dark-400">Verificar DNSSEC</span>
        </label>
      </form>

      {mut.isError && <ErrorBanner error={mut.error} />}

      {r && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-dark-800/60 rounded-lg border border-dark-700">
            <div>
              <span className="text-white font-semibold">{r.target}</span>
              <span className="ml-2 px-2 py-0.5 bg-brand-500/20 text-brand-400 text-xs rounded font-mono">{r.record_type}</span>
            </div>
            <div className="text-right">
              <p className="text-dark-500 text-xs">Servidor DNS</p>
              <p className="font-mono text-dark-300 text-xs">{r.nameserver_used}</p>
            </div>
          </div>

          {/* Erro DNS */}
          {r.error && (
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{r.error}</p>
            </div>
          )}

          {/* Registros */}
          {!r.error && r.records.length > 0 && (
            <div className="card overflow-hidden">
              <div className="p-3 border-b border-dark-700 flex items-center justify-between">
                <p className="text-dark-400 text-xs uppercase tracking-wider">Registros ({r.records.length})</p>
                {r.ttl != null && <p className="text-dark-500 text-xs font-mono">TTL: {r.ttl}s</p>}
              </div>
              <div className="divide-y divide-dark-800">
                {r.records.map((rec, i) => (
                  <div key={i} className="px-4 py-2.5 hover:bg-dark-800/30">
                    {renderRecord(rec, r.record_type)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DNSSEC */}
          {r.dnssec && dnssecStatus && (
            <div className={`p-4 rounded-lg border ${dnssecStatus.bg} ${dnssecStatus.border}`}>
              <div className="flex items-center gap-3 mb-2">
                <Shield className={`w-5 h-5 ${dnssecStatus.color}`} />
                <div>
                  <p className={`font-semibold text-sm ${dnssecStatus.color}`}>DNSSEC: {dnssecStatus.label}</p>
                  {r.dnssec.error && <p className="text-red-300/70 text-xs">{r.dnssec.error}</p>}
                </div>
              </div>
              {r.dnssec.details.length > 0 && (
                <ul className="space-y-1 ml-8">
                  {r.dnssec.details.map((d, i) => (
                    <li key={i} className="text-dark-400 text-xs flex items-start gap-1.5">
                      <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" /> {d}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── RPKI ─────────────────────────────────────────────────────────────────────

function RpkiTool() {
  const [prefix, setPrefix] = useState('')
  const [asn, setAsn] = useState('')
  const [showRoas, setShowRoas] = useState(true)

  const mut = useMutation<RpkiResult, any, void>({
    mutationFn: () => api.post('/network-tools/rpki', {
      prefix: prefix.trim(),
      asn: asn.trim() ? Number(asn.replace(/^AS/i, '')) : undefined,
    }).then(r => r.data),
  })

  const r = mut.data
  const cfg = r ? (RPKI_CONFIG[r.rpki_status] ?? RPKI_CONFIG.unknown) : null

  return (
    <div className="space-y-5">
      <form onSubmit={e => { e.preventDefault(); if (prefix.trim()) mut.mutate() }} className="space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-dark-500 mb-1.5">Prefixo IP (CIDR)</label>
            <div className="relative">
              <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="177.75.0.0/20" className="input w-full pl-10 font-mono" disabled={mut.isPending} />
            </div>
          </div>
          <div className="w-40">
            <label className="block text-xs text-dark-500 mb-1.5">ASN de Origem (opcional)</label>
            <input value={asn} onChange={e => setAsn(e.target.value)} placeholder="AS12345" className="input w-full font-mono" disabled={mut.isPending} />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={mut.isPending || !prefix.trim()} className="btn-primary flex items-center gap-2 h-10">
              {mut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Validando...</> : <><Shield className="w-4 h-4" /> Validar RPKI</>}
            </button>
          </div>
        </div>
        <div className="flex items-start gap-2 p-3 bg-dark-800 rounded-lg border border-dark-700">
          <Info className="w-4 h-4 text-dark-500 flex-shrink-0 mt-0.5" />
          <p className="text-dark-500 text-xs">Se o ASN não for informado, é buscado automaticamente via RIPE Stat. Usa RIPE rpki-validation como fonte primária.</p>
        </div>
      </form>

      {mut.isError && <ErrorBanner error={mut.error} />}

      {r && cfg && (
        <div className="space-y-4">
          <div className={`flex items-start gap-4 p-5 rounded-xl border ${cfg.bg} ${cfg.border}`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
              <cfg.icon className={`w-6 h-6 ${cfg.color}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <span className={`text-xl font-bold ${cfg.color}`}>{cfg.label}</span>
                <span className="font-mono text-white text-lg">{r.prefix}</span>
                <span className="text-dark-500 text-sm">IPv{r.ip_version}</span>
              </div>
              <p className="text-dark-400 text-sm">{cfg.desc}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['RIR', r.rir || '—'],
              ['País', r.country || '—'],
              ['Anunciado', r.announced === null ? '—' : r.announced ? 'Sim' : 'Não'],
              ['ASNs', r.origin_asns.length > 0 ? r.origin_asns.map(a => `AS${a}`).join(', ') : '—'],
            ].map(([l, v]) => (
              <div key={l} className="card p-3">
                <p className="text-dark-500 text-xs mb-1">{l}</p>
                <p className="font-semibold text-sm text-white font-mono">{v}</p>
              </div>
            ))}
          </div>

          {r.roas.length > 0 && (
            <div className="card overflow-hidden">
              <button onClick={() => setShowRoas(x => !x)} className="w-full flex items-center justify-between p-4 hover:bg-dark-800/40">
                <span className="text-sm font-medium text-white">ROAs Encontrados ({r.roas.length})</span>
                {showRoas ? <ChevronDown className="w-4 h-4 text-dark-500" /> : <ChevronRight className="w-4 h-4 text-dark-500" />}
              </button>
              {showRoas && (
                <div className="border-t border-dark-700 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-dark-500 border-b border-dark-700 text-xs">
                        <th className="text-left px-4 py-2.5">ASN</th>
                        <th className="text-left px-4 py-2.5">Prefixo</th>
                        <th className="text-left px-4 py-2.5">Max Length</th>
                        <th className="text-left px-4 py-2.5">Validade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.roas.map((roa, i) => (
                        <tr key={i} className="border-b border-dark-800 hover:bg-dark-800/30">
                          <td className="px-4 py-2.5 font-mono text-brand-400 font-semibold">AS{roa.asn}</td>
                          <td className="px-4 py-2.5 font-mono text-dark-300">{roa.prefix}</td>
                          <td className="px-4 py-2.5 font-mono text-dark-400">/{roa.max_length}</td>
                          <td className="px-4 py-2.5">
                            {roa.match ? (
                              <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle className="w-3.5 h-3.5" /> Válido</span>
                            ) : (
                              <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3.5 h-3.5" /> {roa.validity || 'Inválido'}</span>
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

          {r.sources_checked.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-dark-500">
              <span>Fontes:</span>
              {r.sources_checked.map(s => (
                <span key={s} className="flex items-center gap-1 text-dark-400">
                  <CheckCircle className="w-3 h-3 text-emerald-500" /> {s}
                </span>
              ))}
            </div>
          )}

          {r.errors.length > 0 && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-400 text-xs font-medium mb-1.5 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Avisos</p>
              {r.errors.map((err, i) => <p key={i} className="text-yellow-300/70 text-xs">{err}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────

type Tool = 'ping' | 'traceroute' | 'dns' | 'rpki'

const TOOLS: { id: Tool; label: string; icon: React.FC<any>; desc: string }[] = [
  { id: 'ping', label: 'Ping ICMP', icon: Activity, desc: 'Teste de conectividade IPv4/IPv6 com RTT e perda de pacotes' },
  { id: 'traceroute', label: 'Traceroute', icon: ArrowRight, desc: 'Rota hop a hop até o destino com latência por salto' },
  { id: 'dns', label: 'DNS Lookup', icon: Database, desc: 'Consulta registros DNS (A, MX, TXT, NS, SOA...) + validação DNSSEC' },
  { id: 'rpki', label: 'Validação RPKI', icon: Shield, desc: 'Verifica estado RPKI de prefixos: valid, invalid ou not-found' },
]

export default function NetworkToolsPage() {
  const [activeTool, setActiveTool] = useState<Tool>('ping')

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Ferramentas de Rede</h1>
        <p className="text-dark-500 text-sm">Diagnóstico e validação de infraestrutura de rede</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TOOLS.map(tool => (
          <button key={tool.id} onClick={() => setActiveTool(tool.id)}
            className={`text-left p-4 rounded-xl border transition-all ${activeTool === tool.id ? 'border-brand-500 bg-brand-500/10' : 'border-dark-700 bg-dark-800/40 hover:border-dark-600'}`}>
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${activeTool === tool.id ? 'bg-brand-500/20' : 'bg-dark-700'}`}>
              <tool.icon className={`w-4 h-4 ${activeTool === tool.id ? 'text-brand-400' : 'text-dark-400'}`} />
            </div>
            <p className={`font-semibold text-sm ${activeTool === tool.id ? 'text-brand-300' : 'text-white'}`}>{tool.label}</p>
            <p className="text-dark-500 text-xs mt-0.5 leading-relaxed">{tool.desc}</p>
          </button>
        ))}
      </div>

      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-dark-700">
          {(() => { const T = TOOLS.find(t => t.id === activeTool)!; return <T.icon className="w-5 h-5 text-brand-400" /> })()}
          <div>
            <h2 className="text-base font-semibold text-white">{TOOLS.find(t => t.id === activeTool)?.label}</h2>
            <p className="text-dark-500 text-xs">{TOOLS.find(t => t.id === activeTool)?.desc}</p>
          </div>
        </div>

        {activeTool === 'ping' && <PingTool />}
        {activeTool === 'traceroute' && <TracerouteTool />}
        {activeTool === 'dns' && <DnsTool />}
        {activeTool === 'rpki' && <RpkiTool />}
      </div>
    </div>
  )
}
