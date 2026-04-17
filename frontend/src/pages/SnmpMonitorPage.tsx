import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity, Plus, RefreshCw, Trash2, Edit2, Play, ChevronDown, ChevronUp,
  Wifi, WifiOff, AlertTriangle, CheckCircle, Clock, Server, Cpu, MemoryStick,
  ArrowUpDown, Network, Settings, History, Zap, X, Save, Eye, EyeOff,
  ArrowDown, ArrowUp, TrendingUp, MapPin, User, Info, Users
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SnmpTarget {
  id: string
  name: string
  host: string
  port: number
  snmp_version: string
  poll_interval: number
  active: boolean
  collect_interfaces: boolean
  collect_bgp: boolean
  collect_cpu: boolean
  collect_memory: boolean
  cpu_threshold: number | null
  memory_threshold: number | null
  last_polled_at: string | null
  last_status: string | null
  last_error: string | null
  sys_name: string | null
  sys_descr: string | null
  sys_location: string | null
  sys_contact: string | null
  device_id: string | null
}

interface SnmpInterface {
  index: string
  name: string
  oper_status: number
  is_up: boolean
  last_seen: string | null
  in_bps: number | null
  out_bps: number | null
  in_errors: number | null
  out_errors: number | null
}

interface InterfacesData {
  interfaces: SnmpInterface[]
  uptime_seconds: number | null
  cpu_pct: number | null
  mem_pct: number | null
  sys_name: string | null
  sys_descr: string | null
  sys_location: string | null
  sys_contact: string | null
}

interface BgpSession {
  peer_ip: string
  remote_as_str: string
  state: number
  state_name: string
  is_established: boolean
  last_seen: string | null
}

interface MetricPoint {
  metric_type: string
  object_id: string | null
  object_name: string | null
  value_float: number | null
  value_int: number | null
  timestamp: string
}

interface SnmpAlert {
  id: string
  severity: string
  metric_type: string
  message: string
  value: number
  threshold: number
  acknowledged: boolean
  created_at: string
}

interface Summary {
  total_targets: number
  active_targets: number
  ok: number
  error: number
  never_polled: number
  open_alerts: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatUptime = (seconds: number): string => {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const formatBps = (bps: number | null): string => {
  if (bps === null || bps === undefined) return '—'
  if (bps === 0) return '0 bps'
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  return `${bps} bps`
}

const formatTimestamp = (ts: string | null): string => {
  if (!ts) return 'Nunca'
  try {
    return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  } catch { return ts }
}

const statusColor = (status: string | null) => {
  if (status === 'ok') return 'text-green-400'
  if (status === 'error') return 'text-red-400'
  return 'text-dark-500'
}

const bgpStateColor = (state: number) => {
  if (state === 6) return 'text-green-400 bg-green-400/10'
  if (state >= 3) return 'text-yellow-400 bg-yellow-400/10'
  return 'text-red-400 bg-red-400/10'
}

// ─── Modal: Criar/Editar Target ───────────────────────────────────────────────

function TargetModal({ target, onClose, onSave }: {
  target: SnmpTarget | null
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    name: target?.name || '',
    host: target?.host || '',
    port: target?.port || 161,
    community: '',
    poll_interval: target?.poll_interval || 300,
    active: target?.active ?? true,
    collect_interfaces: target?.collect_interfaces ?? true,
    collect_bgp: target?.collect_bgp ?? true,
    collect_cpu: target?.collect_cpu ?? true,
    collect_memory: target?.collect_memory ?? true,
    cpu_threshold: target?.cpu_threshold ?? 80,
    memory_threshold: target?.memory_threshold ?? 85,
    device_id: target?.device_id || null as string | null,
  })
  const [showCommunity, setShowCommunity] = useState(false)
  const [saving, setSaving] = useState(false)

  // Seletor de dispositivo
  const [devices, setDevices] = useState<any[]>([])
  const [deviceSearch, setDeviceSearch] = useState('')
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false)
  const [selectedDeviceName, setSelectedDeviceName] = useState('')
  const deviceSearchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/devices?limit=500').then(r => {
      setDevices(r.data || [])
      // Se estiver editando e tiver device_id, preenche o nome
      if (target?.device_id) {
        const dev = (r.data || []).find((d: any) => d.id === target.device_id)
        if (dev) setSelectedDeviceName(`${dev.name} (${dev.management_ip || dev.hostname || ''})`)
      }
    }).catch(() => {})
  }, [])

  const filteredDevices = deviceSearch.length >= 1
    ? devices.filter(d =>
        d.name?.toLowerCase().includes(deviceSearch.toLowerCase()) ||
        d.management_ip?.includes(deviceSearch) ||
        d.hostname?.toLowerCase().includes(deviceSearch.toLowerCase())
      ).slice(0, 10)
    : devices.slice(0, 10)

  const handleSelectDevice = (dev: any) => {
    setForm(f => ({
      ...f,
      name: f.name || dev.name,
      host: f.host || dev.management_ip || '',
      device_id: dev.id,
    }))
    setSelectedDeviceName(`${dev.name} (${dev.management_ip || dev.hostname || ''})`)
    setDeviceSearch('')
    setShowDeviceDropdown(false)
  }

  const handleClearDevice = () => {
    setForm(f => ({ ...f, device_id: null }))
    setSelectedDeviceName('')
    setDeviceSearch('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (target) {
        const payload: Record<string, unknown> = { ...form }
        if (!payload.community) delete payload.community
        await api.put(`/snmp/targets/${target.id}`, payload)
        toast.success('Target atualizado')
      } else {
        await api.post('/snmp/targets', form)
        toast.success('Target criado')
      }
      onSave()
      onClose()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e?.response?.data?.detail || 'Erro ao salvar target')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-dark-700">
          <h2 className="text-lg font-semibold text-white">
            {target ? 'Editar Target SNMP' : 'Novo Target SNMP'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Seletor de dispositivo cadastrado */}
          <div>
            <label className="block text-sm text-dark-400 mb-1">Dispositivo Cadastrado (opcional)</label>
            {selectedDeviceName ? (
              <div className="flex items-center gap-2 bg-brand-600/10 border border-brand-500/30 rounded-lg px-3 py-2">
                <Server className="w-4 h-4 text-brand-400 shrink-0" />
                <span className="text-sm text-brand-300 flex-1 truncate">{selectedDeviceName}</span>
                <button type="button" onClick={handleClearDevice} className="text-dark-500 hover:text-dark-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative" ref={deviceSearchRef}>
                <input
                  className="input w-full"
                  value={deviceSearch}
                  onChange={e => { setDeviceSearch(e.target.value); setShowDeviceDropdown(true) }}
                  onFocus={() => setShowDeviceDropdown(true)}
                  placeholder="Buscar por nome, IP ou hostname..."
                />
                {showDeviceDropdown && filteredDevices.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-dark-800 border border-dark-600 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
                    {filteredDevices.map((dev: any) => (
                      <button
                        key={dev.id}
                        type="button"
                        onClick={() => handleSelectDevice(dev)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-dark-700 transition-colors text-left"
                      >
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          dev.status === 'online' ? 'bg-green-400' :
                          dev.status === 'offline' ? 'bg-red-400' : 'bg-slate-400'
                        }`} />
                        <div className="min-w-0">
                          <p className="text-sm text-dark-200 font-medium truncate">{dev.name}</p>
                          <p className="text-xs text-dark-500 font-mono">{dev.management_ip || dev.hostname || '—'}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-dark-600 mt-1">Selecione um dispositivo para pré-preencher nome e IP automaticamente</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm text-dark-400 mb-1">Nome *</label>
              <input className="input w-full" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Huawei NE8000 - Core" required />
            </div>
            <div>
              <label className="block text-sm text-dark-400 mb-1">Host / IP *</label>
              <input className="input w-full" value={form.host}
                onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                placeholder="192.168.1.1" required />
            </div>
            <div>
              <label className="block text-sm text-dark-400 mb-1">Porta SNMP</label>
              <input className="input w-full" type="number" value={form.port}
                onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-dark-400 mb-1">
                Community String {target ? '(deixe vazio para manter)' : '*'}
              </label>
              <div className="relative">
                <input className="input w-full pr-10"
                  type={showCommunity ? 'text' : 'password'}
                  value={form.community}
                  onChange={e => setForm(f => ({ ...f, community: e.target.value }))}
                  placeholder={target ? '••••••••' : 'public'}
                  required={!target} />
                <button type="button" onClick={() => setShowCommunity(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300">
                  {showCommunity ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm text-dark-400 mb-1">Intervalo de Poll (s)</label>
              <select className="input w-full" value={form.poll_interval}
                onChange={e => setForm(f => ({ ...f, poll_interval: parseInt(e.target.value) }))}>
                <option value={60}>1 minuto</option>
                <option value={300}>5 minutos</option>
                <option value={600}>10 minutos</option>
                <option value={900}>15 minutos</option>
                <option value={1800}>30 minutos</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-dark-400 mb-1">Status</label>
              <select className="input w-full" value={form.active ? 'true' : 'false'}
                onChange={e => setForm(f => ({ ...f, active: e.target.value === 'true' }))}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </div>
          </div>

          <div className="border-t border-dark-700 pt-4">
            <p className="text-sm font-medium text-dark-300 mb-3">O que coletar</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'collect_cpu', label: 'CPU' },
                { key: 'collect_memory', label: 'Memória' },
                { key: 'collect_interfaces', label: 'Interfaces' },
                { key: 'collect_bgp', label: 'Sessões BGP' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={form[key as keyof typeof form] as boolean}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                    className="rounded border-dark-600" />
                  <span className="text-sm text-dark-300">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-dark-400 mb-1">Alerta CPU (%)</label>
              <input className="input w-full" type="number" min="0" max="100"
                value={form.cpu_threshold ?? ''}
                onChange={e => setForm(f => ({ ...f, cpu_threshold: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="Ex: 80" />
            </div>
            <div>
              <label className="block text-sm text-dark-400 mb-1">Alerta Memória (%)</label>
              <input className="input w-full" type="number" min="0" max="100"
                value={form.memory_threshold ?? ''}
                onChange={e => setForm(f => ({ ...f, memory_threshold: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="Ex: 85" />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal: Ação de Gestão ────────────────────────────────────────────────────

function ActionModal({ target, initialObjectId, initialActionType, onClose }: {
  target: SnmpTarget
  initialObjectId?: string
  initialActionType?: string
  onClose: () => void
}) {
  const [actionType, setActionType] = useState(initialActionType || 'if_enable')
  const [objectId, setObjectId] = useState(initialObjectId || '')
  const [localAsn, setLocalAsn] = useState('')
  const [remoteAsn, setRemoteAsn] = useState('')
  const [description, setDescription] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshPass, setSshPass] = useState('')
  const [sshPort, setSshPort] = useState(22)
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; output?: string; error?: string } | null>(null)

  const isBgp = actionType.startsWith('bgp')

  const handleExecute = async () => {
    if (!objectId.trim()) {
      toast.error('Informe o nome da interface ou IP do peer BGP')
      return
    }
    setExecuting(true)
    setResult(null)
    try {
      const payload: Record<string, unknown> = {
        action_type: actionType,
        object_id: objectId.trim(),
        ssh_port: sshPort,
      }
      if (sshUser) payload.ssh_username = sshUser
      if (sshPass) payload.ssh_password = sshPass
      if (isBgp) {
        if (!localAsn) { toast.error('ASN local é obrigatório para ações BGP'); setExecuting(false); return }
        payload.local_asn = parseInt(localAsn)
        if (remoteAsn) payload.remote_asn = parseInt(remoteAsn)
        if (description) payload.description = description
      }
      const res = await api.post(`/snmp/targets/${target.id}/action`, payload)
      setResult({ success: true, output: res.data.output })
      toast.success('Ação executada com sucesso')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      const msg = e?.response?.data?.detail || 'Erro ao executar ação'
      setResult({ success: false, error: msg })
      toast.error(msg)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-dark-700">
          <div>
            <h2 className="text-lg font-semibold text-white">Ação de Gestão</h2>
            <p className="text-sm text-dark-400">{target.name} — {target.host}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-dark-400 mb-1">Tipo de Ação</label>
            <select className="input w-full" value={actionType} onChange={e => setActionType(e.target.value)}>
              <optgroup label="Interface">
                <option value="if_enable">Ativar Interface</option>
                <option value="if_disable">Desativar Interface (shutdown)</option>
              </optgroup>
              <optgroup label="BGP">
                <option value="bgp_enable">Ativar Sessão BGP (peer enable)</option>
                <option value="bgp_disable">Desativar Sessão BGP (undo peer enable)</option>
                <option value="bgp_create">Criar Peer BGP</option>
                <option value="bgp_remove">Remover Peer BGP</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-sm text-dark-400 mb-1">
              {isBgp ? 'IP do Peer BGP *' : 'Nome da Interface *'}
            </label>
            <input className="input w-full" value={objectId}
              onChange={e => setObjectId(e.target.value)}
              placeholder={isBgp ? 'Ex: 10.0.0.1' : 'Ex: GigabitEthernet0/0/0'} />
          </div>

          {isBgp && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-dark-400 mb-1">ASN Local *</label>
                <input className="input w-full" type="number" value={localAsn}
                  onChange={e => setLocalAsn(e.target.value)} placeholder="Ex: 65001" />
              </div>
              {(actionType === 'bgp_create') && (
                <div>
                  <label className="block text-sm text-dark-400 mb-1">ASN Remoto *</label>
                  <input className="input w-full" type="number" value={remoteAsn}
                    onChange={e => setRemoteAsn(e.target.value)} placeholder="Ex: 65002" />
                </div>
              )}
              {actionType === 'bgp_create' && (
                <div className="col-span-2">
                  <label className="block text-sm text-dark-400 mb-1">Descrição</label>
                  <input className="input w-full" value={description}
                    onChange={e => setDescription(e.target.value)} placeholder="Ex: Peer cliente XYZ" />
                </div>
              )}
            </div>
          )}

          <div className="border-t border-dark-700 pt-4">
            <p className="text-sm font-medium text-dark-300 mb-3">Credenciais SSH (opcional se cadastradas no dispositivo)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-dark-500 mb-1">Usuário</label>
                <input className="input w-full text-sm" value={sshUser}
                  onChange={e => setSshUser(e.target.value)} placeholder="admin" />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">Senha</label>
                <input className="input w-full text-sm" type="password" value={sshPass}
                  onChange={e => setSshPass(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">Porta SSH</label>
                <input className="input w-full text-sm" type="number" value={sshPort}
                  onChange={e => setSshPort(parseInt(e.target.value))} />
              </div>
            </div>
          </div>

          {result && (
            <div className={`rounded-lg p-3 font-mono text-xs whitespace-pre-wrap max-h-48 overflow-y-auto ${
              result.success ? 'bg-green-900/20 border border-green-700/30 text-green-300' : 'bg-red-900/20 border border-red-700/30 text-red-300'
            }`}>
              {result.success ? result.output || 'Ação executada com sucesso.' : `Erro: ${result.error}`}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="btn-secondary">Fechar</button>
            <button onClick={handleExecute} disabled={executing}
              className="btn-primary flex items-center gap-2 bg-orange-600 hover:bg-orange-500">
              {executing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {executing ? 'Executando...' : 'Executar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Consulta PPPoE ───────────────────────────────────────────────────

function PppoeModal({ target, interfaceName, onClose }: {
  target: SnmpTarget
  interfaceName: string
  onClose: () => void
}) {
  const [mode, setMode] = useState<'menu' | 'count' | 'list' | 'username'>('menu')
  const [username, setUsername] = useState('')
  const [slot, setSlot] = useState(0)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<{ command: string; output: string; success: boolean; error?: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastMode, setLastMode] = useState<'count' | 'list' | 'username' | null>(null)

  const runQuery = async (queryMode: 'count' | 'list' | 'username') => {
    setLoading(true)
    setError(null)
    setResults([])
    setMode(queryMode)
    setLastMode(queryMode)
    try {
      const payload: Record<string, unknown> = { slot }
      if (queryMode === 'username') {
        if (!username.trim()) { setError('Informe o username do cliente.'); setLoading(false); return }
        payload.username = username.trim()
      } else {
        payload.interface = interfaceName
      }
      const res = await api.post(`/snmp/targets/${target.id}/pppoe-query`, payload)
      const allResults = res.data.results || []

      // Verificar se algum resultado tem erro de Broken pipe ou falha
      const failedResult = allResults.find((r: { success: boolean; output?: string }) => !r.success)
      if (failedResult) {
        const errMsg = failedResult.output || failedResult.error || 'Erro desconhecido'
        // Enriquecer mensagem de Broken pipe com dica de diagnóstico
        if (errMsg.includes('Broken pipe') || errMsg.includes('Errno 32')) {
          setError(
            `Erro Telnet: Broken pipe — O equipamento fechou a conexão.\n\n` +
            `Possíveis causas:\n` +
            `• Credenciais Telnet incorretas no dispositivo vinculado\n` +
            `• Máximo de sessões VTY atingido no equipamento\n` +
            `• Equipamento configurado para SSH apenas (não Telnet)\n` +
            `• Timeout de negociação de protocolo\n\n` +
            `Verifique os logs do backend para detalhes completos.`
          )
        } else {
          setError(errMsg)
        }
      }

      // Para mode=count, mostrar apenas o primeiro resultado; para list, mostrar o segundo
      if (queryMode === 'count') {
        setResults([allResults[0]].filter(Boolean))
      } else if (queryMode === 'list') {
        setResults([allResults[1] || allResults[0]].filter(Boolean))
      } else {
        setResults(allResults)
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string }
      const detail = e?.response?.data?.detail || e?.message || 'Erro ao executar consulta PPPoE'
      setError(detail)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-700 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-400" />
              Consulta PPPoE
            </h2>
            <p className="text-xs text-dark-400 font-mono mt-0.5">{interfaceName}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Slot selector */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-dark-400">Slot:</label>
            <input
              type="number" min={0} max={20}
              value={slot}
              onChange={e => setSlot(parseInt(e.target.value) || 0)}
              className="input w-20 text-center"
            />
          </div>

          {/* Botões de consulta por interface */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => runQuery('count')}
              disabled={loading}
              className="flex flex-col items-center gap-2 p-4 bg-dark-700/60 hover:bg-dark-600/70 border border-dark-600 hover:border-blue-500/40 rounded-xl transition-colors">
              <Activity className="w-6 h-6 text-blue-400" />
              <div className="text-center">
                <p className="text-sm font-medium text-white">Total de PPPoE</p>
                <p className="text-xs text-dark-400">Contagem de sessões na interface</p>
              </div>
            </button>
            <button
              onClick={() => runQuery('list')}
              disabled={loading}
              className="flex flex-col items-center gap-2 p-4 bg-dark-700/60 hover:bg-dark-600/70 border border-dark-600 hover:border-green-500/40 rounded-xl transition-colors">
              <Users className="w-6 h-6 text-green-400" />
              <div className="text-center">
                <p className="text-sm font-medium text-white">Listar PPPoE Online</p>
                <p className="text-xs text-dark-400">Todos os usuários ativos</p>
              </div>
            </button>
          </div>

          {/* Consulta por username */}
          <div className="border-t border-dark-700 pt-4">
            <p className="text-sm font-medium text-dark-300 mb-2">Consultar por Usuário</p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runQuery('username')}
                placeholder="Login do cliente (ex: cliente123)"
              />
              <button
                onClick={() => runQuery('username')}
                disabled={loading || !username.trim()}
                className="btn-primary flex items-center gap-2">
                {loading && mode === 'username' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
                Consultar
              </button>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-6 gap-3">
              <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
              <span className="text-sm text-dark-400">Executando consulta no roteador...</span>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="bg-red-400/10 border border-red-400/20 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-red-400 text-lg mt-0.5">⚠</span>
                <pre className="text-sm text-red-300 whitespace-pre-wrap font-sans flex-1">{error}</pre>
              </div>
              {lastMode && (
                <button
                  onClick={() => runQuery(lastMode)}
                  disabled={loading}
                  className="flex items-center gap-2 text-xs text-red-400 hover:text-red-200 border border-red-400/30 hover:border-red-400/60 rounded-lg px-3 py-1.5 transition-colors">
                  <RefreshCw className="w-3 h-3" />
                  Tentar novamente
                </button>
              )}
            </div>
          )}

          {/* Resultados */}
          {results.length > 0 && results.map((r, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-dark-500 font-mono bg-dark-900/60 px-2 py-1 rounded">{r.command}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  r.success ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                }`}>{r.success ? 'OK' : 'Erro'}</span>
              </div>
              <pre className="bg-dark-900 border border-dark-700 rounded-lg p-3 text-xs text-dark-200 font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                {r.output || '(sem saída)'}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Painel de Detalhes do Target ─────────────────────────────────────────────

function TargetDetail({ target, onRefresh }: { target: SnmpTarget; onRefresh: () => void }) {
  const [tab, setTab] = useState<'overview' | 'interfaces' | 'bgp' | 'metrics' | 'alerts' | 'actions' | 'log'>('overview')
  const [ifaceData, setIfaceData] = useState<InterfacesData | null>(null)
  const [bgpSessions, setBgpSessions] = useState<BgpSession[]>([])
  const [metrics, setMetrics] = useState<MetricPoint[]>([])
  const [alerts, setAlerts] = useState<SnmpAlert[]>([])
  const [actionLog, setActionLog] = useState<unknown[]>([])
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)
  const [actionModal, setActionModal] = useState<{ objectId?: string; actionType?: string } | null>(null)
  const [pppoeModal, setPppoeModal] = useState<{ interface: string } | null>(null)

  const loadTabData = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'overview' || tab === 'interfaces') {
        const res = await api.get(`/snmp/targets/${target.id}/interfaces`)
        setIfaceData(res.data)
      } else if (tab === 'bgp') {
        const res = await api.get(`/snmp/targets/${target.id}/bgp`)
        setBgpSessions(res.data)
      } else if (tab === 'metrics') {
        const res = await api.get(`/snmp/targets/${target.id}/metrics?hours=24`)
        setMetrics(res.data)
      } else if (tab === 'alerts') {
        const res = await api.get(`/snmp/targets/${target.id}/alerts`)
        setAlerts(res.data)
      } else if (tab === 'log') {
        const res = await api.get(`/snmp/targets/${target.id}/action-log`)
        setActionLog(res.data)
      }
    } catch { /* silently fail */ }
    finally { setLoading(false) }
  }, [tab, target.id])

  useEffect(() => { loadTabData() }, [loadTabData])

  const handlePollNow = async () => {
    setPolling(true)
    try {
      await api.post(`/snmp/targets/${target.id}/poll`)
      toast.success('Poll executado com sucesso')
      onRefresh()
      loadTabData()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e?.response?.data?.detail || 'Erro no poll')
    } finally { setPolling(false) }
  }

  const handleAckAlert = async (alertId: string) => {
    try {
      await api.post(`/snmp/targets/${target.id}/alerts/${alertId}/ack`)
      toast.success('Alerta reconhecido')
      loadTabData()
    } catch { toast.error('Erro ao reconhecer alerta') }
  }

  // Prepara dados para o gráfico de CPU/Memória
  const chartData = (() => {
    const cpuPoints = metrics.filter(m => m.metric_type === 'cpu_usage')
    const memPoints = metrics.filter(m => m.metric_type === 'memory_usage')
    const timeMap: Record<string, { time: string; cpu?: number; mem?: number }> = {}
    cpuPoints.forEach(p => {
      const t = new Date(p.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      timeMap[p.timestamp] = { time: t, cpu: p.value_float ?? undefined }
    })
    memPoints.forEach(p => {
      const t = new Date(p.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      if (timeMap[p.timestamp]) {
        timeMap[p.timestamp].mem = p.value_float ?? undefined
      } else {
        timeMap[p.timestamp] = { time: t, mem: p.value_float ?? undefined }
      }
    })
    return Object.entries(timeMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
  })()

  const tabs = [
    { id: 'overview', label: 'Visão Geral', icon: Server },
    { id: 'interfaces', label: 'Interfaces', icon: Network },
    { id: 'bgp', label: 'BGP', icon: ArrowUpDown },
    { id: 'metrics', label: 'Gráficos', icon: Activity },
    { id: 'alerts', label: `Alertas${alerts.length > 0 ? ` (${alerts.length})` : ''}`, icon: AlertTriangle },
    { id: 'actions', label: 'Gestão', icon: Zap },
    { id: 'log', label: 'Log de Ações', icon: History },
  ]

  const upCount = ifaceData?.interfaces.filter(i => i.is_up).length ?? 0
  const downCount = ifaceData?.interfaces.filter(i => !i.is_up).length ?? 0

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-dark-700">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${target.last_status === 'ok' ? 'bg-green-400' : target.last_status === 'error' ? 'bg-red-400' : 'bg-dark-500'}`} />
          <div>
            <h3 className="font-semibold text-white">{target.name}</h3>
            <p className="text-xs text-dark-400">{target.host}:{target.port} — {target.sys_name || 'Nome não coletado'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePollNow} disabled={polling}
            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5">
            {polling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Poll Agora
          </button>
          <button onClick={() => setActionModal({})}
            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 text-orange-400 hover:text-orange-300">
            <Zap className="w-3.5 h-3.5" />
            Ação
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-dark-700 px-4">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as typeof tab)}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === id ? 'border-brand-400 text-brand-400' : 'border-transparent text-dark-400 hover:text-dark-200'
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 animate-spin text-brand-400" />
          </div>
        )}

        {/* ── VISÃO GERAL ── */}
        {!loading && tab === 'overview' && (
          <div className="space-y-4">
            {/* Cards de métricas principais */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-dark-900/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-3.5 h-3.5 text-brand-400" />
                  <span className="text-xs text-dark-500">Uptime</span>
                </div>
                <p className="text-sm font-medium text-white">
                  {ifaceData?.uptime_seconds ? formatUptime(ifaceData.uptime_seconds) : '—'}
                </p>
              </div>
              <div className="bg-dark-900/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs text-dark-500">CPU</span>
                </div>
                <p className={`text-sm font-bold ${
                  ifaceData?.cpu_pct !== null && ifaceData?.cpu_pct !== undefined
                    ? ifaceData.cpu_pct >= 80 ? 'text-red-400' : ifaceData.cpu_pct >= 60 ? 'text-yellow-400' : 'text-green-400'
                    : 'text-dark-500'
                }`}>
                  {ifaceData?.cpu_pct !== null && ifaceData?.cpu_pct !== undefined ? `${ifaceData.cpu_pct.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="bg-dark-900/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <MemoryStick className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs text-dark-500">Memória</span>
                </div>
                <p className={`text-sm font-bold ${
                  ifaceData?.mem_pct !== null && ifaceData?.mem_pct !== undefined
                    ? ifaceData.mem_pct >= 85 ? 'text-red-400' : ifaceData.mem_pct >= 70 ? 'text-yellow-400' : 'text-green-400'
                    : 'text-dark-500'
                }`}>
                  {ifaceData?.mem_pct !== null && ifaceData?.mem_pct !== undefined ? `${ifaceData.mem_pct.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="bg-dark-900/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Network className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs text-dark-500">Interfaces</span>
                </div>
                <p className="text-sm font-medium text-white">
                  {ifaceData ? (
                    <span>
                      <span className="text-green-400">{upCount} UP</span>
                      {downCount > 0 && <span className="text-red-400 ml-1">/ {downCount} DOWN</span>}
                    </span>
                  ) : '—'}
                </p>
              </div>
            </div>

            {/* Informações do sistema */}
            <div className="bg-dark-900/50 rounded-xl p-4 space-y-2">
              <p className="text-xs text-dark-500 uppercase tracking-wider mb-3">Informações do Sistema</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { label: 'sysName', value: ifaceData?.sys_name || target.sys_name, icon: Server },
                  { label: 'sysDescr', value: ifaceData?.sys_descr || target.sys_descr, icon: Info },
                  { label: 'Localização', value: ifaceData?.sys_location || target.sys_location, icon: MapPin },
                  { label: 'Contato', value: ifaceData?.sys_contact || target.sys_contact, icon: User },
                  { label: 'Último Poll', value: formatTimestamp(target.last_polled_at), icon: Clock },
                  { label: 'Status Poll', value: target.last_status || 'Nunca polled', icon: CheckCircle },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex items-start gap-2">
                    <Icon className="w-3.5 h-3.5 text-dark-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs text-dark-500">{label}: </span>
                      <span className="text-xs text-dark-200 break-words">{value || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview das interfaces UP/DOWN */}
            {ifaceData && ifaceData.interfaces.length > 0 && (
              <div className="bg-dark-900/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-dark-500 uppercase tracking-wider">Interfaces (resumo)</p>
                  <button onClick={() => setTab('interfaces')}
                    className="text-xs text-brand-400 hover:text-brand-300">
                    Ver todas →
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {ifaceData.interfaces.slice(0, 12).map(iface => (
                    <div key={iface.index} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                      iface.is_up ? 'bg-green-400/5 border border-green-400/10' : 'bg-red-400/5 border border-red-400/10'
                    }`}>
                      {iface.is_up
                        ? <Wifi className="w-3 h-3 text-green-400 flex-shrink-0" />
                        : <WifiOff className="w-3 h-3 text-red-400 flex-shrink-0" />}
                      <span className="text-xs font-mono text-dark-300 truncate">{iface.name}</span>
                    </div>
                  ))}
                  {ifaceData.interfaces.length > 12 && (
                    <div className="flex items-center justify-center px-2 py-1.5 rounded-lg bg-dark-700/50 text-xs text-dark-400">
                      +{ifaceData.interfaces.length - 12} mais
                    </div>
                  )}
                </div>
              </div>
            )}

            {target.last_error && (
              <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-3">
                <p className="text-xs text-red-400 font-medium mb-1">Último Erro</p>
                <p className="text-xs text-red-300">{target.last_error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── INTERFACES ── */}
        {!loading && tab === 'interfaces' && (
          <div className="space-y-2">
            {/* Stats rápidos */}
            {ifaceData && ifaceData.interfaces.length > 0 && (
              <div className="flex items-center gap-4 pb-2 border-b border-dark-700 mb-3">
                <span className="text-xs text-dark-400">
                  Total: <span className="text-white font-medium">{ifaceData.interfaces.length}</span>
                </span>
                <span className="text-xs text-green-400">
                  UP: <span className="font-medium">{upCount}</span>
                </span>
                <span className="text-xs text-red-400">
                  DOWN: <span className="font-medium">{downCount}</span>
                </span>
              </div>
            )}

            {!ifaceData || ifaceData.interfaces.length === 0 ? (
              <p className="text-center text-dark-500 py-6 text-sm">Nenhuma interface coletada. Execute um poll primeiro.</p>
            ) : (
              <div className="space-y-1">
                {/* Header da tabela */}
                <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-xs text-dark-500 uppercase tracking-wider">
                  <div className="col-span-4">Interface</div>
                  <div className="col-span-1 text-center">Status</div>
                  <div className="col-span-2 text-right">In</div>
                  <div className="col-span-2 text-right">Out</div>
                  <div className="col-span-1 text-right">Erros</div>
                  <div className="col-span-2 text-right">Ações</div>
                </div>
                {ifaceData.interfaces.map(iface => (
                  <div key={iface.index} className={`grid grid-cols-12 gap-2 items-center py-2 px-3 rounded-lg hover:bg-dark-700/50 transition-colors ${
                    !iface.is_up ? 'opacity-75' : ''
                  }`}>
                    {/* Nome */}
                    <div className="col-span-4 flex items-center gap-2 min-w-0">
                      {iface.is_up
                        ? <Wifi className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                        : <WifiOff className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                      <span className="text-sm text-white font-mono truncate">{iface.name}</span>
                    </div>
                    {/* Status badge */}
                    <div className="col-span-1 flex justify-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        iface.is_up ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                      }`}>
                        {iface.is_up ? 'UP' : 'DOWN'}
                      </span>
                    </div>
                    {/* Tráfego In */}
                    <div className="col-span-2 text-right">
                      {iface.in_bps !== null ? (
                        <span className="text-xs text-green-300 font-mono flex items-center justify-end gap-0.5">
                          <ArrowDown className="w-3 h-3" />
                          {formatBps(iface.in_bps)}
                        </span>
                      ) : (
                        <span className="text-xs text-dark-600">—</span>
                      )}
                    </div>
                    {/* Tráfego Out */}
                    <div className="col-span-2 text-right">
                      {iface.out_bps !== null ? (
                        <span className="text-xs text-blue-300 font-mono flex items-center justify-end gap-0.5">
                          <ArrowUp className="w-3 h-3" />
                          {formatBps(iface.out_bps)}
                        </span>
                      ) : (
                        <span className="text-xs text-dark-600">—</span>
                      )}
                    </div>
                    {/* Erros */}
                    <div className="col-span-1 text-right">
                      {(iface.in_errors !== null || iface.out_errors !== null) ? (
                        <span className={`text-xs font-mono ${
                          ((iface.in_errors || 0) + (iface.out_errors || 0)) > 0 ? 'text-yellow-400' : 'text-dark-600'
                        }`}>
                          {(iface.in_errors || 0) + (iface.out_errors || 0)}
                        </span>
                      ) : (
                        <span className="text-xs text-dark-600">—</span>
                      )}
                    </div>
                    {/* Botões de ação rápida */}
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      {/* Botão PPPoE — apenas para subinterfaces (nome com ponto) */}
                      {iface.name.includes('.') && (
                        <button
                          onClick={() => setPppoeModal({ interface: iface.name })}
                          title="Consultar PPPoE nesta subinterface"
                          className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors">
                          <Users className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setActionModal({ objectId: iface.name, actionType: iface.is_up ? 'if_disable' : 'if_enable' })}
                        title={iface.is_up ? 'Desativar interface' : 'Ativar interface'}
                        className={`p-1 rounded text-xs transition-colors ${
                          iface.is_up
                            ? 'text-red-400 hover:bg-red-400/10'
                            : 'text-green-400 hover:bg-green-400/10'
                        }`}>
                        {iface.is_up ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => setActionModal({ objectId: iface.name })}
                        title="Outras ações"
                        className="p-1 rounded text-dark-400 hover:text-orange-400 hover:bg-orange-400/10 transition-colors">
                        <Zap className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── BGP ── */}
        {!loading && tab === 'bgp' && (
          <div className="space-y-2">
            {bgpSessions.length === 0 ? (
              <p className="text-center text-dark-500 py-6 text-sm">Nenhuma sessão BGP coletada. Execute um poll primeiro.</p>
            ) : (
              bgpSessions.map(session => (
                <div key={session.peer_ip} className="flex items-center justify-between py-2 px-3 rounded-lg bg-dark-900/50">
                  <div>
                    <p className="text-sm font-mono text-white">{session.peer_ip}</p>
                    <p className="text-xs text-dark-400">{session.remote_as_str}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${bgpStateColor(session.state)}`}>
                      {session.state_name}
                    </span>
                    {!session.is_established && (
                      <button
                        onClick={() => setActionModal({ objectId: session.peer_ip, actionType: 'bgp_enable' })}
                        title="Ativar peer BGP"
                        className="p-1 rounded text-green-400 hover:bg-green-400/10 transition-colors">
                        <Zap className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── GRÁFICOS ── */}
        {!loading && tab === 'metrics' && (
          <div className="space-y-4">
            {chartData.length === 0 ? (
              <p className="text-center text-dark-500 py-6 text-sm">Sem dados de métricas nas últimas 24h.</p>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-dark-300 mb-3">CPU e Memória — Últimas 24h</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="time" tick={{ fill: '#6B7280', fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#6B7280', fontSize: 11 }} unit="%" />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                        labelStyle={{ color: '#9CA3AF' }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="cpu" stroke="#60A5FA" name="CPU %" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="mem" stroke="#34D399" name="Memória %" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── ALERTAS ── */}
        {!loading && tab === 'alerts' && (
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-green-400 py-4">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">Nenhum alerta aberto</span>
              </div>
            ) : (
              alerts.map(alert => (
                <div key={alert.id} className={`flex items-start justify-between p-3 rounded-lg border ${
                  alert.severity === 'critical' ? 'bg-red-900/20 border-red-700/30' : 'bg-yellow-900/20 border-yellow-700/30'
                }`}>
                  <div>
                    <p className={`text-sm font-medium ${alert.severity === 'critical' ? 'text-red-300' : 'text-yellow-300'}`}>
                      {alert.message}
                    </p>
                    <p className="text-xs text-dark-400 mt-0.5">{formatTimestamp(alert.created_at)}</p>
                  </div>
                  <button onClick={() => handleAckAlert(alert.id)}
                    className="text-xs text-dark-400 hover:text-white ml-4 flex-shrink-0">
                    Reconhecer
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── GESTÃO ── */}
        {!loading && tab === 'actions' && (
          <div className="space-y-3">
            <p className="text-sm text-dark-400">
              Execute ações de gestão diretamente no roteador via SSH. As ações são registradas no log de auditoria.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { action: 'if_enable', label: 'Ativar Interface', color: 'text-green-400', desc: 'undo shutdown' },
                { action: 'if_disable', label: 'Desativar Interface', color: 'text-red-400', desc: 'shutdown' },
                { action: 'bgp_enable', label: 'Ativar Peer BGP', color: 'text-blue-400', desc: 'peer enable' },
                { action: 'bgp_disable', label: 'Desativar Peer BGP', color: 'text-orange-400', desc: 'undo peer enable' },
                { action: 'bgp_create', label: 'Criar Peer BGP', color: 'text-purple-400', desc: 'peer as-number' },
                { action: 'bgp_remove', label: 'Remover Peer BGP', color: 'text-red-500', desc: 'undo peer' },
              ].map(({ action, label, color, desc }) => (
                <button key={label} onClick={() => setActionModal({ actionType: action })}
                  className="p-3 bg-dark-900/50 rounded-xl text-left hover:bg-dark-700/50 transition-colors">
                  <p className={`text-sm font-medium ${color}`}>{label}</p>
                  <p className="text-xs text-dark-500 font-mono mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── LOG ── */}
        {!loading && tab === 'log' && (
          <div className="space-y-2">
            {(actionLog as Record<string, unknown>[]).length === 0 ? (
              <p className="text-center text-dark-500 py-6 text-sm">Nenhuma ação executada ainda.</p>
            ) : (
              (actionLog as Record<string, unknown>[]).map((log) => (
                <div key={log.id as string} className={`p-3 rounded-lg border ${
                  log.status === 'success' ? 'bg-green-900/10 border-green-700/20' : 'bg-red-900/10 border-red-700/20'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-white font-mono">{log.action_type as string}</span>
                    <span className={`text-xs ${log.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                      {log.status as string}
                    </span>
                  </div>
                  <p className="text-xs text-dark-400">{log.object_id as string} — {formatTimestamp(log.created_at as string)}</p>
                  {log.error && <p className="text-xs text-red-400 mt-1">{log.error as string}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {actionModal !== null && (
        <ActionModal
          target={target}
          initialObjectId={actionModal.objectId}
          initialActionType={actionModal.actionType}
          onClose={() => setActionModal(null)}
        />
      )}

      {pppoeModal !== null && (
        <PppoeModal
          target={target}
          interfaceName={pppoeModal.interface}
          onClose={() => setPppoeModal(null)}
        />
      )}
    </div>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function SnmpMonitorPage() {
  const [targets, setTargets] = useState<SnmpTarget[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<SnmpTarget | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { token } = useAuthStore()

  const loadData = useCallback(async () => {
    try {
      const [targetsRes, summaryRes] = await Promise.all([
        api.get('/snmp/targets'),
        api.get('/snmp/summary'),
      ])
      setTargets(targetsRes.data)
      setSummary(summaryRes.data)
    } catch { toast.error('Erro ao carregar targets SNMP') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleDelete = async (target: SnmpTarget) => {
    if (!confirm(`Remover target "${target.name}"? Isso apagará todas as métricas coletadas.`)) return
    try {
      await api.delete(`/snmp/targets/${target.id}`)
      toast.success('Target removido')
      loadData()
    } catch { toast.error('Erro ao remover target') }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="w-7 h-7 text-brand-400" />
            SNMP Monitor
          </h1>
          <p className="text-dark-400 text-sm mt-1">
            Monitoramento de CPU, memória, interfaces e BGP via SNMPv2c — poll a cada 5 minutos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadData} className="btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
          <button onClick={() => { setEditTarget(null); setShowModal(true) }}
            className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Novo Target
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: 'Total', value: summary.total_targets, color: 'text-white' },
            { label: 'Ativos', value: summary.active_targets, color: 'text-blue-400' },
            { label: 'OK', value: summary.ok, color: 'text-green-400' },
            { label: 'Erro', value: summary.error, color: 'text-red-400' },
            { label: 'Nunca Polled', value: summary.never_polled, color: 'text-dark-400' },
            { label: 'Alertas Abertos', value: summary.open_alerts, color: summary.open_alerts > 0 ? 'text-yellow-400' : 'text-dark-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-dark-800 border border-dark-700 rounded-xl p-3 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-dark-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Targets List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-brand-400" />
        </div>
      ) : targets.length === 0 ? (
        <div className="text-center py-16 bg-dark-800 border border-dark-700 rounded-2xl">
          <Activity className="w-12 h-12 text-dark-600 mx-auto mb-3" />
          <p className="text-dark-400 text-sm">Nenhum target SNMP cadastrado.</p>
          <button onClick={() => { setEditTarget(null); setShowModal(true) }}
            className="btn-primary mt-4 flex items-center gap-2 mx-auto">
            <Plus className="w-4 h-4" />
            Adicionar Primeiro Target
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {targets.map(target => (
            <div key={target.id} className="bg-dark-800 border border-dark-700 rounded-2xl overflow-hidden">
              {/* Target Row */}
              <div className="flex items-center gap-3 p-4">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  !target.active ? 'bg-dark-600' :
                  target.last_status === 'ok' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' :
                  target.last_status === 'error' ? 'bg-red-400' : 'bg-yellow-400'
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{target.name}</span>
                    {!target.active && (
                      <span className="text-xs px-1.5 py-0.5 bg-dark-700 text-dark-400 rounded">Inativo</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-dark-400 font-mono">{target.host}:{target.port}</span>
                    {target.sys_name && (
                      <span className="text-xs text-brand-400 font-medium">{target.sys_name}</span>
                    )}
                    {target.sys_descr && (
                      <span className="text-xs text-dark-500 truncate max-w-xs">{target.sys_descr.split(' ').slice(0, 5).join(' ')}</span>
                    )}
                    <span className="text-xs text-dark-600">
                      Último poll: {formatTimestamp(target.last_polled_at)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => { setEditTarget(target); setShowModal(true) }}
                    className="btn-ghost p-1.5 rounded-lg" title="Editar">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(target)}
                    className="btn-ghost p-1.5 rounded-lg text-red-400 hover:text-red-300" title="Remover">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setExpandedId(expandedId === target.id ? null : target.id)}
                    className="btn-ghost p-1.5 rounded-lg ml-1">
                    {expandedId === target.id
                      ? <ChevronUp className="w-4 h-4" />
                      : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded Detail */}
              {expandedId === target.id && (
                <div className="border-t border-dark-700 p-4">
                  <TargetDetail target={target} onRefresh={loadData} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <TargetModal
          target={editTarget}
          onClose={() => { setShowModal(false); setEditTarget(null) }}
          onSave={loadData}
        />
      )}
    </div>
  )
}
