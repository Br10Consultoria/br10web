/**
 * BR10 NetManager — Gerador CGNAT
 *
 * Funcionalidades:
 * - Geração de scripts RouterOS para CGNAT (8/16/32/64 clientes por IP)
 * - Vinculação a cliente cadastrado
 * - Armazenamento do mapeamento completo de portas
 * - Filtros avançados: IP privado, IP público, porta, chain
 * - Consulta de IP (privado ou público) e porta
 * - Exportação do script como .rsc para MikroTik
 * - Cópia do script para área de transferência
 */
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Network, Plus, RefreshCw, Trash2, Copy, Download, Search,
  X, Loader2, CheckCircle, List, Settings, Code, Table2, Eye,
  Save, AlertTriangle, Filter, ChevronLeft, ChevronRight, User
} from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ClientOption {
  id: string
  name: string
  short_name?: string
}

interface CgnatStats {
  total_private_ips: number
  total_public_ips: number
  ports_per_client: number
  total_chains: number
  private_range_start: string
  private_range_end: string
}

interface CgnatGenerateResult {
  script: string
  config_id: string | null
  saved: boolean
  stats: CgnatStats
  mappings: CgnatMappingItem[]
}

interface CgnatConfig {
  id: string
  name: string
  description?: string
  client_id?: string
  client_name?: string
  private_network: string
  public_prefix: string
  clients_per_ip: number
  sequential_chain: number
  use_blackhole: boolean
  use_fasttrack: boolean
  protocol: string
  ros_version: string
  total_private_ips: number
  total_public_ips: number
  ports_per_client: number
  total_chains: number
  created_at: string
}

interface CgnatMappingItem {
  id?: string
  private_ip: string
  private_subnet: string
  public_ip: string
  port_start: number
  port_end: number
  chain_index: number
  chain_name: string
}

interface LookupResult {
  query: { ip?: string; public_ip?: string; port?: number }
  found: boolean
  results: Array<{
    config_id: string
    config_name: string
    client_name?: string
    private_ip: string
    private_subnet: string
    public_ip: string
    port_start: number
    port_end: number
    chain_name: string
    public_prefix: string
  }>
}

// ─── Formulário padrão ────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  name: '',
  description: '',
  client_id: '',
  private_network: '100.64.0.0',
  public_prefix: '',
  clients_per_ip: 32,
  sequential_chain: 0,
  use_blackhole: true,
  use_fasttrack: true,
  protocol: 'tcp_udp',
  ros_version: '6',
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CgnatPage() {
  const queryClient = useQueryClient()

  // Abas principais
  const [activeTab, setActiveTab] = useState<'generator' | 'configs' | 'lookup'>('generator')

  // Formulário de geração
  const [form, setForm] = useState({ ...DEFAULT_FORM })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Resultado da geração
  const [result, setResult] = useState<CgnatGenerateResult | null>(null)
  const [resultTab, setResultTab] = useState<'script' | 'mapping'>('script')

  // Modal de mapeamento de config salva
  const [mappingModal, setMappingModal] = useState<CgnatConfig | null>(null)
  const [mappingFilters, setMappingFilters] = useState({
    private_ip: '',
    public_ip: '',
    port: '',
    chain: '',
  })
  const [mappingPage, setMappingPage] = useState(1)

  // Filtro de configs salvas
  const [configSearch, setConfigSearch] = useState('')
  const [configClientFilter, setConfigClientFilter] = useState('')

  // Lookup
  const [lookupType, setLookupType] = useState<'private_ip' | 'public_ip' | 'port'>('private_ip')
  const [lookupValue, setLookupValue] = useState('')
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: clients } = useQuery<ClientOption[]>({
    queryKey: ['cgnat-clients'],
    queryFn: () => api.get('/cgnat/clients').then(r => r.data),
  })

  const { data: configsData, isLoading: configsLoading } = useQuery({
    queryKey: ['cgnat-configs', configSearch, configClientFilter],
    queryFn: () => {
      const params = new URLSearchParams({ per_page: '50' })
      if (configSearch) params.set('search', configSearch)
      if (configClientFilter) params.set('client_id', configClientFilter)
      return api.get(`/cgnat/configs?${params}`).then(r => r.data)
    },
    enabled: activeTab === 'configs',
  })

  const mappingQueryParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(mappingPage), per_page: '100' })
    if (mappingFilters.private_ip) params.set('private_ip', mappingFilters.private_ip)
    if (mappingFilters.public_ip) params.set('public_ip', mappingFilters.public_ip)
    if (mappingFilters.port) params.set('port', mappingFilters.port)
    if (mappingFilters.chain) params.set('chain', mappingFilters.chain)
    return params.toString()
  }, [mappingFilters, mappingPage])

  const { data: mappingData, isLoading: mappingLoading } = useQuery({
    queryKey: ['cgnat-mappings', mappingModal?.id, mappingFilters, mappingPage],
    queryFn: () => api.get(
      `/cgnat/configs/${mappingModal!.id}/mappings?${mappingQueryParams()}`
    ).then(r => r.data),
    enabled: !!mappingModal,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: (data: typeof form & { save: boolean }) =>
      api.post('/cgnat/generate', data).then(r => r.data),
    onSuccess: (data: CgnatGenerateResult) => {
      setResult(data)
      setResultTab('script')
      if (data.saved) {
        toast.success('Configuração CGNAT salva com sucesso!')
        queryClient.invalidateQueries({ queryKey: ['cgnat-configs'] })
      }
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Erro ao gerar script CGNAT'
      toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/cgnat/configs/${id}`),
    onSuccess: () => {
      toast.success('Configuração removida')
      queryClient.invalidateQueries({ queryKey: ['cgnat-configs'] })
    },
    onError: () => toast.error('Erro ao remover configuração'),
  })

  const getScriptMutation = useMutation({
    mutationFn: (id: string) => api.get(`/cgnat/configs/${id}/script`).then(r => r.data),
    onSuccess: (data) => {
      setResult({
        script: data.script,
        config_id: data.config.id,
        saved: true,
        stats: {
          total_private_ips: data.config.total_private_ips,
          total_public_ips: data.config.total_public_ips,
          ports_per_client: data.config.ports_per_client,
          total_chains: data.config.total_chains,
          private_range_start: data.config.private_network,
          private_range_end: '',
        },
        mappings: [],
      })
      setResultTab('script')
      setActiveTab('generator')
    },
    onError: () => toast.error('Erro ao carregar script'),
  })

  // ── Validação ──────────────────────────────────────────────────────────────

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = 'Nome é obrigatório'
    if (!form.public_prefix.trim()) errors.public_prefix = 'Prefixo público é obrigatório'
    if (!form.private_network.trim()) errors.private_network = 'Rede privada é obrigatória'

    const prefixRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
    if (form.public_prefix && !prefixRegex.test(form.public_prefix.trim())) {
      errors.public_prefix = 'Formato inválido. Use: 170.83.186.128/28'
    }

    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/
    if (form.private_network && !ipRegex.test(form.private_network.trim())) {
      errors.private_network = 'Formato inválido. Use: 100.64.0.0'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleGenerate = (save: boolean) => {
    if (!validate()) return
    generateMutation.mutate({ ...form, save })
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  const handleLookup = async () => {
    if (!lookupValue.trim()) return
    setLookupLoading(true)
    try {
      const params = new URLSearchParams()
      if (lookupType === 'private_ip') params.set('ip', lookupValue.trim())
      else if (lookupType === 'public_ip') params.set('public_ip', lookupValue.trim())
      else if (lookupType === 'port') params.set('port', lookupValue.trim())

      const res = await api.get(`/cgnat/lookup?${params}`)
      setLookupResult(res.data)
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Erro ao consultar'
      toast.error(msg)
    } finally {
      setLookupLoading(false)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const copyScript = () => {
    if (!result?.script) return
    navigator.clipboard.writeText(result.script)
    toast.success('Script copiado!')
  }

  const downloadScript = (script: string, prefix: string) => {
    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cgnat_${prefix.replace(/[./]/g, '_')}.rsc`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadSavedScript = async (cfg: CgnatConfig) => {
    try {
      const res = await api.get(`/cgnat/configs/${cfg.id}/script`)
      downloadScript(res.data.script, cfg.public_prefix)
      toast.success('Script baixado!')
    } catch {
      toast.error('Erro ao baixar script')
    }
  }

  const clientsLabel = (n: number) => {
    const ports = Math.floor(64512 / n)
    return `${n} clientes [~${ports} portas]`
  }

  const resetMappingFilters = () => {
    setMappingFilters({ private_ip: '', public_ip: '', port: '', chain: '' })
    setMappingPage(1)
  }

  const hasActiveFilters = Object.values(mappingFilters).some(v => v !== '')

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Network className="w-7 h-7 text-cyan-400" />
            Gerador CGNAT
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Gera scripts RouterOS para CGNAT com mapeamento completo de portas por cliente
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
        {[
          { id: 'generator', label: 'Gerador', icon: Code },
          { id: 'configs', label: 'Configurações Salvas', icon: List },
          { id: 'lookup', label: 'Consultar', icon: Search },
        ].map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── ABA: GERADOR ─────────────────────────────────────────────────── */}
      {activeTab === 'generator' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Formulário */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 space-y-5">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-cyan-400" />
              Parâmetros
            </h2>

            {/* Nome */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Nome da configuração <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="ex: CGNAT Bloco Principal"
                className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                  formErrors.name ? 'border-red-500' : 'border-slate-600'
                }`}
              />
              {formErrors.name && <p className="text-red-400 text-xs mt-1">{formErrors.name}</p>}
            </div>

            {/* Cliente */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                Cliente (opcional)
              </label>
              <select
                value={form.client_id}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">— Sem cliente associado —</option>
                {clients?.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.short_name ? ` (${c.short_name})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Rede privada + Prefixo público */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Rede privada inicial <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.private_network}
                  onChange={e => setForm(f => ({ ...f, private_network: e.target.value }))}
                  placeholder="100.64.0.0"
                  className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                    formErrors.private_network ? 'border-red-500' : 'border-slate-600'
                  }`}
                />
                {formErrors.private_network && (
                  <p className="text-red-400 text-xs mt-1">{formErrors.private_network}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Prefixo público <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.public_prefix}
                  onChange={e => setForm(f => ({ ...f, public_prefix: e.target.value }))}
                  placeholder="170.83.186.128/28"
                  className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                    formErrors.public_prefix ? 'border-red-500' : 'border-slate-600'
                  }`}
                />
                {formErrors.public_prefix && (
                  <p className="text-red-400 text-xs mt-1">{formErrors.public_prefix}</p>
                )}
              </div>
            </div>

            {/* Clientes por IP + Chain sequencial */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Clientes por IP público
                </label>
                <select
                  value={form.clients_per_ip}
                  onChange={e => setForm(f => ({ ...f, clients_per_ip: Number(e.target.value) }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {[8, 16, 32, 64].map(n => (
                    <option key={n} value={n}>{clientsLabel(n)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Sequencial Chain(s)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.sequential_chain}
                  onChange={e => setForm(f => ({ ...f, sequential_chain: Number(e.target.value) }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>

            {/* Protocolos + RouterOS */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Protocolos</label>
                <div className="space-y-2">
                  {[
                    { value: 'tcp_udp', label: 'TCP/UDP (Recomendado)' },
                    { value: 'tcp_only', label: 'Apenas TCP' },
                  ].map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="protocol"
                        value={opt.value}
                        checked={form.protocol === opt.value}
                        onChange={() => setForm(f => ({ ...f, protocol: opt.value }))}
                        className="accent-cyan-500"
                      />
                      <span className="text-sm text-slate-300">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">RouterOS</label>
                <div className="space-y-2">
                  {[
                    { value: '6', label: 'Versão 6.x' },
                    { value: '7', label: 'Versão 7.x' },
                  ].map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="ros_version"
                        value={opt.value}
                        checked={form.ros_version === opt.value}
                        onChange={() => setForm(f => ({ ...f, ros_version: opt.value }))}
                        className="accent-cyan-500"
                      />
                      <span className="text-sm text-slate-300">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Blackhole + Fasttrack */}
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.use_blackhole}
                  onChange={e => setForm(f => ({ ...f, use_blackhole: e.target.checked }))}
                  className="accent-cyan-500 w-4 h-4"
                />
                <span className="text-sm text-slate-300">Blackhole (Recomendado)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.use_fasttrack}
                  onChange={e => setForm(f => ({ ...f, use_fasttrack: e.target.checked }))}
                  className="accent-cyan-500 w-4 h-4"
                />
                <span className="text-sm text-slate-300">Fasttrack (Recomendado)</span>
              </label>
            </div>

            {/* Descrição */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Descrição (opcional)
              </label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Observações sobre esta configuração..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
              />
            </div>

            {/* Botões */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => handleGenerate(false)}
                disabled={generateMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
              >
                {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code className="w-4 h-4" />}
                Gerar Script
              </button>
              <button
                onClick={() => handleGenerate(true)}
                disabled={generateMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
              >
                {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Gerar e Salvar
              </button>
            </div>
          </div>

          {/* Resultado */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col min-h-[500px]">
            {result ? (
              <>
                {/* Stats */}
                <div className="p-4 border-b border-slate-700">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'IPs Privados', value: result.stats.total_private_ips.toLocaleString() },
                      { label: 'IPs Públicos', value: result.stats.total_public_ips.toLocaleString() },
                      { label: 'Portas/Cliente', value: result.stats.ports_per_client.toLocaleString() },
                      { label: 'Chains', value: result.stats.total_chains.toLocaleString() },
                    ].map(stat => (
                      <div key={stat.label} className="bg-slate-900 rounded-lg p-3 text-center">
                        <div className="text-xl font-bold text-cyan-400">{stat.value}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                  {result.stats.private_range_end && (
                    <p className="text-xs text-slate-400 mt-2 text-center">
                      Range privado: {result.stats.private_range_start} → {result.stats.private_range_end}
                    </p>
                  )}
                </div>

                {/* Abas resultado */}
                <div className="flex border-b border-slate-700">
                  <button
                    onClick={() => setResultTab('script')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                      resultTab === 'script'
                        ? 'border-cyan-500 text-cyan-400'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    <Code className="w-4 h-4" />
                    Script RouterOS
                  </button>
                  <button
                    onClick={() => setResultTab('mapping')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                      resultTab === 'mapping'
                        ? 'border-cyan-500 text-cyan-400'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    <Table2 className="w-4 h-4" />
                    Mapeamento
                    {result.mappings.length > 0 && (
                      <span className="bg-cyan-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                        {result.mappings.length}
                      </span>
                    )}
                  </button>

                  {/* Ações */}
                  <div className="ml-auto flex items-center gap-1 pr-3">
                    <button
                      onClick={copyScript}
                      title="Copiar script"
                      className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => downloadScript(result.script, form.public_prefix)}
                      title="Baixar como .rsc (MikroTik)"
                      className="p-2 text-slate-400 hover:text-green-400 hover:bg-slate-700 rounded transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Conteúdo do resultado */}
                <div className="flex-1 overflow-auto">
                  {resultTab === 'script' ? (
                    <pre className="p-4 text-xs font-mono text-green-300 whitespace-pre-wrap leading-relaxed">
                      {result.script}
                    </pre>
                  ) : result.mappings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
                      <Table2 className="w-8 h-8 opacity-30" />
                      <p className="text-sm">
                        {result.saved
                          ? 'Mapeamento salvo. Use "Configurações Salvas" para consultar.'
                          : 'Clique em "Gerar e Salvar" para armazenar o mapeamento.'}
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">IP Privado</th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">Sub-rede</th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">IP Público</th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">Portas</th>
                          <th className="px-3 py-2 text-left text-slate-400 font-medium">Chain</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.mappings.map((m, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/50'}>
                            <td className="px-3 py-1.5 text-cyan-300 font-mono">{m.private_ip}</td>
                            <td className="px-3 py-1.5 text-slate-400 font-mono">{m.private_subnet}</td>
                            <td className="px-3 py-1.5 text-green-300 font-mono">{m.public_ip}</td>
                            <td className="px-3 py-1.5 text-yellow-300 font-mono">{m.port_start}–{m.port_end}</td>
                            <td className="px-3 py-1.5 text-slate-400">{m.chain_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 p-12 text-slate-500">
                <Network className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-lg font-medium text-slate-400">Nenhum script gerado</p>
                <p className="text-sm mt-1 text-center">
                  Preencha os parâmetros ao lado e clique em "Gerar Script"
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ABA: CONFIGURAÇÕES SALVAS ─────────────────────────────────────── */}
      {activeTab === 'configs' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={configSearch}
                onChange={e => setConfigSearch(e.target.value)}
                placeholder="Buscar por nome, prefixo..."
                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <select
              value={configClientFilter}
              onChange={e => setConfigClientFilter(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">Todos os clientes</option>
              {clients?.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {configsLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          ) : !configsData?.items?.length ? (
            <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col items-center justify-center h-48 text-slate-500">
              <List className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-base text-slate-400">Nenhuma configuração salva</p>
              <p className="text-sm mt-1">Use "Gerar e Salvar" no Gerador para armazenar configurações</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {configsData.items.map((cfg: CgnatConfig) => (
                <div key={cfg.id} className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-white">{cfg.name}</h3>
                      {cfg.client_name && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3 text-cyan-400" />
                          <span className="text-xs text-cyan-400">{cfg.client_name}</span>
                        </div>
                      )}
                      {cfg.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{cfg.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => { setMappingModal(cfg); setMappingPage(1); resetMappingFilters() }}
                        title="Ver mapeamento de portas"
                        className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 rounded transition-colors"
                      >
                        <Table2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => getScriptMutation.mutate(cfg.id)}
                        title="Ver script"
                        className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-slate-700 rounded transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => downloadSavedScript(cfg)}
                        title="Baixar script .rsc"
                        className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remover "${cfg.name}"?`)) deleteMutation.mutate(cfg.id)
                        }}
                        title="Remover"
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-900 rounded p-2">
                      <div className="text-slate-400">Prefixo Público</div>
                      <div className="text-white font-mono mt-0.5">{cfg.public_prefix}</div>
                    </div>
                    <div className="bg-slate-900 rounded p-2">
                      <div className="text-slate-400">Rede Privada</div>
                      <div className="text-white font-mono mt-0.5">{cfg.private_network}</div>
                    </div>
                    <div className="bg-slate-900 rounded p-2">
                      <div className="text-slate-400">Clientes/IP</div>
                      <div className="text-cyan-400 font-semibold mt-0.5">{cfg.clients_per_ip}</div>
                    </div>
                    <div className="bg-slate-900 rounded p-2">
                      <div className="text-slate-400">Portas/Cliente</div>
                      <div className="text-yellow-400 font-semibold mt-0.5">{cfg.ports_per_client?.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-900 rounded p-2">
                      <div className="text-slate-400">IPs Privados</div>
                      <div className="text-white mt-0.5">{cfg.total_private_ips?.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-900 rounded p-2">
                      <div className="text-slate-400">RouterOS</div>
                      <div className="text-white mt-0.5">v{cfg.ros_version} · {cfg.protocol === 'tcp_udp' ? 'TCP+UDP' : 'TCP'}</div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-500">
                    Criado em {new Date(cfg.created_at).toLocaleString('pt-BR')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ABA: CONSULTAR ───────────────────────────────────────────────── */}
      {activeTab === 'lookup' && (
        <div className="max-w-3xl space-y-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-cyan-400" />
              Consultar Mapeamento CGNAT
            </h2>

            {/* Tipo de consulta */}
            <div className="flex gap-2 mb-4">
              {[
                { id: 'private_ip', label: 'IP Privado', placeholder: 'ex: 100.64.0.15' },
                { id: 'public_ip', label: 'IP Público', placeholder: 'ex: 170.83.186.130' },
                { id: 'port', label: 'Porta', placeholder: 'ex: 5432' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { setLookupType(opt.id as any); setLookupValue(''); setLookupResult(null) }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    lookupType === opt.id
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <p className="text-sm text-slate-400 mb-3">
              {lookupType === 'private_ip' && 'Informe um IP privado para descobrir qual IP público e range de portas está mapeado.'}
              {lookupType === 'public_ip' && 'Informe um IP público para ver todos os IPs privados mapeados a ele.'}
              {lookupType === 'port' && 'Informe uma porta para descobrir qual IP privado usa essa porta no CGNAT.'}
            </p>

            <div className="flex gap-3">
              <input
                type={lookupType === 'port' ? 'number' : 'text'}
                value={lookupValue}
                onChange={e => setLookupValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder={
                  lookupType === 'private_ip' ? 'ex: 100.64.0.15' :
                  lookupType === 'public_ip' ? 'ex: 170.83.186.130' :
                  'ex: 5432'
                }
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
              />
              <button
                onClick={handleLookup}
                disabled={lookupLoading || !lookupValue.trim()}
                className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-2 px-5 rounded-lg transition-colors disabled:opacity-50"
              >
                {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Consultar
              </button>
            </div>
          </div>

          {lookupResult && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              {lookupResult.found ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-400 font-medium">
                    <CheckCircle className="w-5 h-5" />
                    {lookupResult.results.length} resultado(s) encontrado(s)
                  </div>
                  {lookupResult.results.map((r, i) => (
                    <div key={i} className="bg-slate-900 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-white">{r.config_name}</div>
                        {r.client_name && (
                          <div className="flex items-center gap-1 text-xs text-cyan-400">
                            <User className="w-3 h-3" />
                            {r.client_name}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div>
                          <div className="text-slate-400 text-xs">IP Privado</div>
                          <div className="text-cyan-300 font-mono">{r.private_ip}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs">Sub-rede (Chain)</div>
                          <div className="text-slate-300 font-mono">{r.private_subnet}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs">IP Público</div>
                          <div className="text-green-300 font-mono font-semibold">{r.public_ip}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs">Range de Portas</div>
                          <div className="text-yellow-300 font-mono font-semibold">
                            {r.port_start} – {r.port_end}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs">Chain RouterOS</div>
                          <div className="text-slate-300 font-mono">{r.chain_name}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs">Prefixo Público</div>
                          <div className="text-slate-300 font-mono">{r.public_prefix}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 text-slate-400">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  <div>
                    <div className="font-medium text-white">Nenhum resultado encontrado</div>
                    <div className="text-sm">
                      Nenhum mapeamento CGNAT encontrado para este valor.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: MAPEAMENTO DE PORTAS ───────────────────────────────────── */}
      {mappingModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700 shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Table2 className="w-5 h-5 text-cyan-400" />
                  Mapeamento de Portas — {mappingModal.name}
                </h3>
                {mappingModal.client_name && (
                  <div className="flex items-center gap-1 mt-0.5 text-xs text-cyan-400">
                    <User className="w-3 h-3" />
                    {mappingModal.client_name}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {mappingModal.public_prefix} · {mappingModal.clients_per_ip} clientes/IP ·{' '}
                  {mappingModal.ports_per_client?.toLocaleString()} portas/cliente
                </p>
              </div>
              <button
                onClick={() => setMappingModal(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filtros avançados */}
            <div className="p-4 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-2 mb-3">
                <Filter className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-300">Filtros</span>
                {hasActiveFilters && (
                  <button
                    onClick={resetMappingFilters}
                    className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Limpar filtros
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">IP Privado</label>
                  <input
                    type="text"
                    value={mappingFilters.private_ip}
                    onChange={e => { setMappingFilters(f => ({ ...f, private_ip: e.target.value })); setMappingPage(1) }}
                    placeholder="ex: 100.64.0"
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">IP Público</label>
                  <input
                    type="text"
                    value={mappingFilters.public_ip}
                    onChange={e => { setMappingFilters(f => ({ ...f, public_ip: e.target.value })); setMappingPage(1) }}
                    placeholder="ex: 170.83.186"
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Porta</label>
                  <input
                    type="number"
                    value={mappingFilters.port}
                    onChange={e => { setMappingFilters(f => ({ ...f, port: e.target.value })); setMappingPage(1) }}
                    placeholder="ex: 5432"
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Chain</label>
                  <input
                    type="text"
                    value={mappingFilters.chain}
                    onChange={e => { setMappingFilters(f => ({ ...f, chain: e.target.value })); setMappingPage(1) }}
                    placeholder="ex: CGNAT_5"
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Tabela */}
            <div className="flex-1 overflow-auto">
              {mappingLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                </div>
              ) : !mappingData?.items?.length ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
                  <Table2 className="w-8 h-8 opacity-30" />
                  <p className="text-sm">Nenhum resultado encontrado</p>
                  {hasActiveFilters && (
                    <button onClick={resetMappingFilters} className="text-xs text-cyan-400 hover:underline">
                      Limpar filtros
                    </button>
                  )}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-900 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-medium">IP Privado</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-medium">Sub-rede</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-medium">IP Público</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-medium">Portas</th>
                      <th className="px-3 py-2.5 text-left text-slate-400 font-medium">Chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappingData.items.map((m: CgnatMappingItem, i: number) => (
                      <tr key={i} className={`hover:bg-slate-700/30 ${i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/50'}`}>
                        <td className="px-3 py-2 text-cyan-300 font-mono">{m.private_ip}</td>
                        <td className="px-3 py-2 text-slate-400 font-mono">{m.private_subnet}</td>
                        <td className="px-3 py-2 text-green-300 font-mono">{m.public_ip}</td>
                        <td className="px-3 py-2 text-yellow-300 font-mono">{m.port_start}–{m.port_end}</td>
                        <td className="px-3 py-2 text-slate-400">{m.chain_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginação */}
            {mappingData && mappingData.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 shrink-0">
                <span className="text-xs text-slate-400">
                  {mappingData.total?.toLocaleString()} registros · Página {mappingPage} de {mappingData.pages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMappingPage(p => Math.max(1, p - 1))}
                    disabled={mappingPage <= 1}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setMappingPage(p => Math.min(mappingData.pages, p + 1))}
                    disabled={mappingPage >= mappingData.pages}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Rodapé com total */}
            {mappingData && (
              <div className="px-5 py-2 border-t border-slate-700 shrink-0 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {hasActiveFilters
                    ? `${mappingData.total?.toLocaleString()} resultado(s) filtrado(s) de ${mappingModal.total_private_ips?.toLocaleString()} total`
                    : `${mappingData.total?.toLocaleString()} IPs privados mapeados`}
                </span>
                <button
                  onClick={() => downloadSavedScript(mappingModal)}
                  className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar script .rsc
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
