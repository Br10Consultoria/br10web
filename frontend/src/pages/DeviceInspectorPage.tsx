/**
 * DeviceInspectorPage — Inspeção Read-Only de Dispositivos (Fase 1)
 *
 * Permite consultar dispositivos via SSH/Telnet usando apenas comandos
 * display/show (somente leitura). Suporta:
 *   - Huawei NE40E / NE8000
 *   - Huawei OLT MA5800 / MA5600
 *   - Huawei Switch S5700 / S6730
 *   - Mikrotik RouterOS
 *   - Cisco IOS / IOS-XE
 *   - Genérico
 */
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Monitor, Search, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Loader2, AlertTriangle, Copy,
  Download, Terminal, Wifi, WifiOff, HelpCircle,
  Network, GitBranch, Route, Layers, Cpu, FileText,
  Server, Zap, Plug, BarChart2, Link, Link2, Database,
  Shield, Globe, Share2, GitMerge, Lock, Plus, X,
  Clock, Activity, Eye,
} from 'lucide-react'
import api from '../utils/api'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface DeviceInfo {
  id: string
  name: string
  hostname: string | null
  management_ip: string
  device_type: string
  device_type_label: string
  manufacturer: string | null
  model: string | null
  status: 'online' | 'offline' | 'unknown' | 'maintenance' | 'alert'
  protocol: string
  has_credentials: boolean
  client_name: string | null
  location: string | null
  categories: string[]
  category_labels: Record<string, string>
}

interface CommandResult {
  command: string
  output: string
  success: boolean
  duration_ms: number
  error?: string
}

interface InspectResponse {
  device_id: string
  device_name: string
  device_ip: string
  device_type: string
  protocol: string
  category: string
  category_label: string
  results: CommandResult[]
  total_duration_ms: number
  timestamp: string
}

interface InspectRequest {
  device_id: string
  category: string
  custom_commands?: string[]
  timeout?: number
  interactive?: boolean
}

// ─── Mapa de ícones por categoria ─────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Network, GitBranch, Route, Layers, Cpu, FileText,
  Server, Zap, Plug, BarChart2, Link, Link2, Database,
  Shield, Globe, Share2, GitMerge, Lock, Wifi, WifiOff,
  AlertTriangle, Terminal, Activity,
}

function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] || Terminal
  return <Icon className={className || 'w-4 h-4'} />
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    online:      { label: 'Online',      cls: 'bg-green-500/20 text-green-400 border-green-500/30',  Icon: CheckCircle },
    offline:     { label: 'Offline',     cls: 'bg-red-500/20 text-red-400 border-red-500/30',        Icon: XCircle },
    unknown:     { label: 'Desconhecido', cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30',    Icon: HelpCircle },
    maintenance: { label: 'Manutenção',  cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', Icon: AlertTriangle },
    alert:       { label: 'Alerta',      cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30', Icon: AlertTriangle },
  }
  const s = map[status] || map.unknown
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${s.cls}`}>
      <s.Icon className="w-3 h-3" />
      {s.label}
    </span>
  )
}

// ─── Componente de resultado de comando ───────────────────────────────────────

function CommandOutput({ result, index }: { result: CommandResult; index: number }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(result.output || result.error || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lines = (result.output || result.error || '').split('\n')

  return (
    <div className={`rounded-lg border ${result.success
      ? 'border-slate-700 bg-slate-800/50'
      : 'border-red-500/30 bg-red-900/10'
    }`}>
      {/* Header do comando */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-slate-700/30 rounded-t-lg"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <button className="text-slate-400 hover:text-white transition-colors">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <code className="text-sm font-mono text-blue-300">{result.command}</code>
          {result.success
            ? <CheckCircle className="w-4 h-4 text-green-400" />
            : <XCircle className="w-4 h-4 text-red-400" />
          }
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {result.duration_ms}ms
          </span>
          <span className="text-xs text-slate-500">{lines.length} linhas</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy() }}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
            title="Copiar output"
          >
            {copied ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Output */}
      {expanded && (
        <div className="border-t border-slate-700">
          <pre className="text-xs font-mono text-slate-300 p-4 overflow-x-auto whitespace-pre leading-relaxed max-h-[500px] overflow-y-auto">
            {result.output || result.error || '(sem output)'}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function DeviceInspectorPage() {
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [searchDevice, setSearchDevice] = useState('')
  const [timeout, setTimeout_] = useState(30)
  const [showCustom, setShowCustom] = useState(false)
  const [customCommands, setCustomCommands] = useState('')
  const [history, setHistory] = useState<InspectResponse[]>([])
  const [activeResult, setActiveResult] = useState<InspectResponse | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // ── Busca dispositivos ──────────────────────────────────────────────────────
  const { data: devicesData, isLoading: loadingDevices, refetch: refetchDevices } = useQuery({
    queryKey: ['inspector-devices'],
    queryFn: async () => {
      const res = await api.get('/device-inspector/devices')
      return res.data as { devices: DeviceInfo[]; total: number }
    },
    staleTime: 30_000,
  })

  const devices = devicesData?.devices || []
  const filteredDevices = devices.filter(d =>
    d.name.toLowerCase().includes(searchDevice.toLowerCase()) ||
    d.management_ip.includes(searchDevice) ||
    (d.client_name || '').toLowerCase().includes(searchDevice.toLowerCase()) ||
    (d.location || '').toLowerCase().includes(searchDevice.toLowerCase())
  )

  // ── Busca catálogo para o dispositivo selecionado ───────────────────────────
  const { data: catalogData } = useQuery({
    queryKey: ['inspector-catalog', selectedDevice?.device_type],
    queryFn: async () => {
      if (!selectedDevice) return null
      const res = await api.get(`/device-inspector/catalog/${selectedDevice.device_type}`)
      return res.data as {
        device_type: string
        label: string
        categories: Record<string, { label: string; icon: string; commands: string[] }>
      }
    },
    enabled: !!selectedDevice,
  })

  // ── Mutation de inspeção ────────────────────────────────────────────────────
  const inspectMut = useMutation<InspectResponse, any, InspectRequest>({
    mutationFn: async (body) => {
      const res = await api.post('/device-inspector/inspect', body)
      return res.data
    },
    onSuccess: (data) => {
      setActiveResult(data)
      setHistory(prev => [data, ...prev.slice(0, 9)])
      // Scroll para o resultado
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    },
  })

  const handleInspect = () => {
    if (!selectedDevice) return

    if (showCustom && customCommands.trim()) {
      const cmds = customCommands.split('\n').map(c => c.trim()).filter(Boolean)
      inspectMut.mutate({
        device_id: selectedDevice.id,
        category: 'custom',
        custom_commands: cmds,
        timeout: timeout,
        interactive: true,
      })
    } else if (selectedCategory) {
      inspectMut.mutate({
        device_id: selectedDevice.id,
        category: selectedCategory,
        timeout: timeout,
        interactive: true,
      })
    }
  }

  const handleDownload = (result: InspectResponse) => {
    const content = result.results.map(r =>
      `${'='.repeat(60)}\n# ${r.command}\n${'='.repeat(60)}\n${r.output || r.error || ''}\n`
    ).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${result.device_name}_${result.category}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const canInspect = selectedDevice && (showCustom ? customCommands.trim() : selectedCategory) && !inspectMut.isPending

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-800/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Eye className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Inspeção de Dispositivos</h1>
              <p className="text-sm text-slate-400">Consulta read-only via SSH/Telnet — apenas comandos display/show</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 bg-slate-700 px-2 py-1 rounded-full flex items-center gap-1">
              <Shield className="w-3 h-3 text-green-400" />
              Somente leitura
            </span>
            <button
              onClick={() => refetchDevices()}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Atualizar lista"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">

        {/* ── Sidebar esquerda: lista de dispositivos ─────────────────────── */}
        <div className="w-72 border-r border-slate-700 bg-slate-800/30 flex flex-col">
          {/* Busca */}
          <div className="p-3 border-b border-slate-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={searchDevice}
                onChange={e => setSearchDevice(e.target.value)}
                placeholder="Buscar dispositivo..."
                className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {loadingDevices ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              </div>
            ) : filteredDevices.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Monitor className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Nenhum dispositivo encontrado</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredDevices.map(device => (
                  <button
                    key={device.id}
                    onClick={() => {
                      setSelectedDevice(device)
                      setSelectedCategory('')
                      setActiveResult(null)
                      setShowCustom(false)
                    }}
                    className={`w-full text-left p-3 rounded-lg transition-all ${
                      selectedDevice?.id === device.id
                        ? 'bg-blue-600/20 border border-blue-500/40'
                        : 'hover:bg-slate-700/50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-white truncate">{device.name}</div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{device.management_ip}</div>
                        {device.client_name && (
                          <div className="text-xs text-slate-500 truncate mt-0.5">{device.client_name}</div>
                        )}
                      </div>
                      <StatusBadge status={device.status} />
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">
                        {device.protocol.toUpperCase()}
                      </span>
                      {!device.has_credentials && (
                        <span className="text-xs text-orange-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Sem credenciais
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rodapé com total */}
          <div className="p-3 border-t border-slate-700 text-xs text-slate-500 text-center">
            {filteredDevices.length} de {devices.length} dispositivos
          </div>
        </div>

        {/* ── Área principal ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {!selectedDevice ? (
            // Estado vazio
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="p-4 bg-slate-800 rounded-2xl mb-4">
                <Monitor className="w-12 h-12 text-slate-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-300 mb-2">Selecione um dispositivo</h2>
              <p className="text-sm text-slate-500 max-w-sm">
                Escolha um dispositivo na lista à esquerda para visualizar as categorias de consulta disponíveis.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-xs text-slate-500">
                {[
                  { icon: <Network className="w-4 h-4" />, label: 'Interfaces & IPs' },
                  { icon: <GitBranch className="w-4 h-4" />, label: 'BGP & Roteamento' },
                  { icon: <Layers className="w-4 h-4" />, label: 'VLANs & Portas' },
                  { icon: <Cpu className="w-4 h-4" />, label: 'CPU & Memória' },
                  { icon: <Zap className="w-4 h-4" />, label: 'Sinal Óptico (OLT)' },
                  { icon: <FileText className="w-4 h-4" />, label: 'Logs & Alarmes' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg">
                    <span className="text-blue-400">{item.icon}</span>
                    {item.label}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">

              {/* Info do dispositivo selecionado */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-lg font-bold text-white">{selectedDevice.name}</h2>
                      <StatusBadge status={selectedDevice.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
                      <span className="font-mono text-blue-300">{selectedDevice.management_ip}</span>
                      <span>{selectedDevice.device_type_label}</span>
                      {selectedDevice.manufacturer && <span>{selectedDevice.manufacturer}</span>}
                      {selectedDevice.model && <span>{selectedDevice.model}</span>}
                      {selectedDevice.client_name && <span>Cliente: {selectedDevice.client_name}</span>}
                      {selectedDevice.location && <span>📍 {selectedDevice.location}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full border ${
                      selectedDevice.protocol === 'ssh'
                        ? 'bg-green-500/10 text-green-400 border-green-500/30'
                        : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                    }`}>
                      {selectedDevice.protocol.toUpperCase()}
                    </span>
                    {!selectedDevice.has_credentials && (
                      <span className="text-xs px-2 py-1 rounded-full border bg-orange-500/10 text-orange-400 border-orange-500/30 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Sem credenciais
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Seleção de categoria */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-blue-400" />
                    Selecionar Consulta
                  </h3>
                  <button
                    onClick={() => { setShowCustom(!showCustom); setSelectedCategory('') }}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1 ${
                      showCustom
                        ? 'bg-purple-500/20 text-purple-400 border-purple-500/40'
                        : 'text-slate-400 border-slate-600 hover:border-slate-500'
                    }`}
                  >
                    <Plus className="w-3 h-3" />
                    Comando customizado
                  </button>
                </div>

                {showCustom ? (
                  // Input de comandos customizados
                  <div className="space-y-3">
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-xs text-yellow-400 flex items-start gap-2">
                      <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        Apenas comandos <strong>display</strong> e <strong>show</strong> são permitidos.
                        Comandos de configuração são bloqueados automaticamente.
                      </span>
                    </div>
                    <textarea
                      value={customCommands}
                      onChange={e => setCustomCommands(e.target.value)}
                      placeholder={`display interface brief\ndisplay bgp summary\ndisplay version`}
                      rows={5}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-sm font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none"
                    />
                    <p className="text-xs text-slate-500">Um comando por linha</p>
                  </div>
                ) : (
                  // Grid de categorias
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {catalogData ? (
                      Object.entries(catalogData.categories).map(([catId, cat]) => (
                        <button
                          key={catId}
                          onClick={() => setSelectedCategory(catId)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            selectedCategory === catId
                              ? 'bg-blue-600/20 border-blue-500/50 text-white'
                              : 'bg-slate-700/30 border-slate-600 text-slate-300 hover:bg-slate-700/60 hover:border-slate-500'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <CategoryIcon name={cat.icon} className="w-4 h-4 text-blue-400" />
                            <span className="text-xs font-medium truncate">{cat.label}</span>
                          </div>
                          <div className="text-xs text-slate-500">{cat.commands.length} cmd{cat.commands.length > 1 ? 's' : ''}</div>
                        </button>
                      ))
                    ) : (
                      // Fallback com categorias do dispositivo
                      selectedDevice.categories.map(catId => (
                        <button
                          key={catId}
                          onClick={() => setSelectedCategory(catId)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            selectedCategory === catId
                              ? 'bg-blue-600/20 border-blue-500/50 text-white'
                              : 'bg-slate-700/30 border-slate-600 text-slate-300 hover:bg-slate-700/60 hover:border-slate-500'
                          }`}
                        >
                          <div className="text-xs font-medium">
                            {selectedDevice.category_labels[catId] || catId}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {/* Configurações e botão executar */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700">
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-400">Timeout:</label>
                    <select
                      value={timeout}
                      onChange={e => setTimeout_(Number(e.target.value))}
                      className="bg-slate-700 border border-slate-600 rounded text-xs text-white px-2 py-1 focus:outline-none"
                    >
                      {[15, 30, 60, 90, 120].map(v => (
                        <option key={v} value={v}>{v}s</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={handleInspect}
                    disabled={!canInspect}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg font-medium text-sm transition-all ${
                      canInspect
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {inspectMut.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Consultando...
                      </>
                    ) : (
                      <>
                        <Terminal className="w-4 h-4" />
                        Executar Consulta
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Erro */}
              {inspectMut.isError && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-red-400 mb-1">Erro na consulta</div>
                    <div className="text-sm text-red-300">
                      {(inspectMut.error as any)?.response?.data?.detail ||
                       (inspectMut.error as any)?.message ||
                       'Erro desconhecido'}
                    </div>
                  </div>
                </div>
              )}

              {/* Resultado */}
              {activeResult && (
                <div ref={outputRef} className="space-y-4">
                  {/* Header do resultado */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <div>
                        <h3 className="font-semibold text-white">
                          {activeResult.category_label}
                          <span className="text-slate-400 font-normal ml-2 text-sm">
                            — {activeResult.device_name} ({activeResult.device_ip})
                          </span>
                        </h3>
                        <div className="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {activeResult.total_duration_ms}ms total
                          </span>
                          <span>{activeResult.results.length} comando{activeResult.results.length > 1 ? 's' : ''}</span>
                          <span>{new Date(activeResult.timestamp).toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownload(activeResult)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Exportar .txt
                    </button>
                  </div>

                  {/* Outputs */}
                  <div className="space-y-3">
                    {activeResult.results.map((r, i) => (
                      <CommandOutput key={i} result={r} index={i} />
                    ))}
                  </div>
                </div>
              )}

              {/* Histórico */}
              {history.length > 1 && (
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                  <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-slate-400" />
                    Histórico desta sessão
                  </h3>
                  <div className="space-y-1">
                    {history.slice(1).map((h, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveResult(h)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors text-sm flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Terminal className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-slate-300">{h.category_label}</span>
                          <span className="text-slate-500 text-xs">{h.device_name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Clock className="w-3 h-3" />
                          {new Date(h.timestamp).toLocaleTimeString('pt-BR')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
