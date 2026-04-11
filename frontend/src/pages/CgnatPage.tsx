/**
 * BR10 NetManager — Gerador CGNAT
 *
 * Gera scripts RouterOS para CGNAT com:
 * - 8, 16, 32 ou 64 clientes por IP público
 * - Blackhole, Fasttrack, protocolos TCP/UDP ou apenas TCP
 * - RouterOS v6 ou v7
 * - Armazenamento do mapeamento de portas por IP privado
 * - Consulta de IP privado → IP público + portas
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Network, Plus, RefreshCw, Trash2, Copy, Download, Search,
  ChevronDown, ChevronUp, X, Loader2, CheckCircle, List,
  Settings, Code, Table2, Eye, Save, AlertTriangle
} from 'lucide-react'
import api from '../utils/api'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
  ip: string
  found: boolean
  results: Array<{
    config_id: string
    config_name: string
    private_ip: string
    private_subnet: string
    public_ip: string
    port_start: number
    port_end: number
    chain_name: string
    public_prefix: string
  }>
}

// ─── Formulário de geração ────────────────────────────────────────────────────

const DEFAULT_FORM = {
  name: '',
  description: '',
  private_network: '100.64.0.0',
  public_prefix: '',
  clients_per_ip: 32,
  sequential_chain: 0,
  use_blackhole: true,
  use_fasttrack: true,
  protocol: 'tcp_udp',
  ros_version: '6',
  save: false,
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CgnatPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Abas
  const [activeTab, setActiveTab] = useState<'generator' | 'configs' | 'lookup'>('generator')

  // Formulário
  const [form, setForm] = useState({ ...DEFAULT_FORM })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Resultado da geração
  const [result, setResult] = useState<CgnatGenerateResult | null>(null)
  const [resultTab, setResultTab] = useState<'script' | 'mapping'>('script')

  // Modal de mapeamento de config salva
  const [mappingModal, setMappingModal] = useState<CgnatConfig | null>(null)
  const [mappingSearch, setMappingSearch] = useState('')
  const [mappingPage, setMappingPage] = useState(1)

  // Lookup
  const [lookupIp, setLookupIp] = useState('')
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: configsData, isLoading: configsLoading } = useQuery({
    queryKey: ['cgnat-configs'],
    queryFn: () => api.get('/cgnat/configs?per_page=50').then(r => r.data),
    enabled: activeTab === 'configs',
  })

  const { data: mappingData, isLoading: mappingLoading } = useQuery({
    queryKey: ['cgnat-mappings', mappingModal?.id, mappingPage, mappingSearch],
    queryFn: () => api.get(
      `/cgnat/configs/${mappingModal!.id}/mappings?page=${mappingPage}&per_page=100${mappingSearch ? `&search=${encodeURIComponent(mappingSearch)}` : ''}`
    ).then(r => r.data),
    enabled: !!mappingModal,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/cgnat/generate', data).then(r => r.data),
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

    // Validar formato do prefixo público
    const prefixRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
    if (form.public_prefix && !prefixRegex.test(form.public_prefix.trim())) {
      errors.public_prefix = 'Formato inválido. Use: 170.83.186.128/28'
    }

    // Validar IP privado
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
    if (!lookupIp.trim()) return
    setLookupLoading(true)
    try {
      const res = await api.get(`/cgnat/lookup?ip=${encodeURIComponent(lookupIp.trim())}`)
      setLookupResult(res.data)
    } catch {
      toast.error('Erro ao consultar IP')
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

  const downloadScript = () => {
    if (!result?.script) return
    const blob = new Blob([result.script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cgnat_${form.public_prefix.replace(/[./]/g, '_')}.rsc`
    a.click()
    URL.revokeObjectURL(url)
  }

  const clientsLabel = (n: number) => {
    const ports = Math.floor(64512 / n)
    return `${n} clientes [~${ports} portas]`
  }

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
            Gera scripts RouterOS para CGNAT com mapeamento de portas por cliente
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
        {[
          { id: 'generator', label: 'Gerador', icon: Code },
          { id: 'configs', label: 'Configurações Salvas', icon: List },
          { id: 'lookup', label: 'Consultar IP', icon: Search },
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
                {generateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Code className="w-4 h-4" />
                )}
                Gerar Script
              </button>
              <button
                onClick={() => handleGenerate(true)}
                disabled={generateMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Gerar e Salvar
              </button>
            </div>
          </div>

          {/* Resultado */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col">
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
                    Mapeamento de Portas
                    {result.mappings.length > 0 && (
                      <span className="bg-slate-700 text-slate-300 text-xs px-1.5 py-0.5 rounded-full">
                        {result.mappings.length}
                      </span>
                    )}
                  </button>
                </div>

                {resultTab === 'script' && (
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700">
                      <button
                        onClick={copyScript}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copiar
                      </button>
                      <button
                        onClick={downloadScript}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> Download .rsc
                      </button>
                      {result.saved && (
                        <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
                          <CheckCircle className="w-3.5 h-3.5" /> Salvo
                        </span>
                      )}
                    </div>
                    <pre className="flex-1 overflow-auto p-4 text-xs text-green-300 font-mono leading-relaxed bg-slate-950 rounded-b-xl whitespace-pre-wrap">
                      {result.script}
                    </pre>
                  </div>
                )}

                {resultTab === 'mapping' && (
                  <div className="flex-1 overflow-auto">
                    {result.mappings.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                        <Table2 className="w-8 h-8 mb-2 opacity-40" />
                        <p className="text-sm">
                          {result.saved
                            ? 'Mapeamento salvo no banco. Use "Configurações Salvas" para consultar.'
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
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-850'}>
                              <td className="px-3 py-1.5 text-cyan-300 font-mono">{m.private_ip}</td>
                              <td className="px-3 py-1.5 text-slate-400 font-mono">{m.private_subnet}</td>
                              <td className="px-3 py-1.5 text-green-300 font-mono">{m.public_ip}</td>
                              <td className="px-3 py-1.5 text-yellow-300 font-mono">
                                {m.port_start}–{m.port_end}
                              </td>
                              <td className="px-3 py-1.5 text-slate-400">{m.chain_name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
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
                      {cfg.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{cfg.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => { setMappingModal(cfg); setMappingPage(1); setMappingSearch('') }}
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

      {/* ── ABA: CONSULTAR IP ─────────────────────────────────────────────── */}
      {activeTab === 'lookup' && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-cyan-400" />
              Consultar IP Privado
            </h2>
            <p className="text-sm text-slate-400 mb-4">
              Informe um IP privado para descobrir qual IP público e range de portas está mapeado para ele.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={lookupIp}
                onChange={e => setLookupIp(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder="ex: 100.64.0.15"
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
              />
              <button
                onClick={handleLookup}
                disabled={lookupLoading || !lookupIp.trim()}
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
                    IP encontrado em {lookupResult.results.length} configuração(ões)
                  </div>
                  {lookupResult.results.map((r, i) => (
                    <div key={i} className="bg-slate-900 rounded-lg p-4 space-y-3">
                      <div className="text-sm font-medium text-white">{r.config_name}</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
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
                    <div className="font-medium text-white">IP não encontrado</div>
                    <div className="text-sm">
                      O IP <span className="font-mono text-cyan-300">{lookupResult.ip}</span> não está
                      mapeado em nenhuma configuração CGNAT salva.
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
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Mapeamento de Portas — {mappingModal.name}
                </h3>
                <p className="text-sm text-slate-400 mt-0.5">
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

            {/* Busca */}
            <div className="p-4 border-b border-slate-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={mappingSearch}
                  onChange={e => { setMappingSearch(e.target.value); setMappingPage(1) }}
                  placeholder="Buscar por IP privado, público ou chain..."
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>

            {/* Tabela */}
            <div className="flex-1 overflow-auto">
              {mappingLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-900 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-slate-400 font-medium">IP Privado</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-medium">Sub-rede</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-medium">IP Público</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-medium">Portas</th>
                      <th className="px-4 py-3 text-left text-slate-400 font-medium">Chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappingData?.items?.map((m: CgnatMappingItem, i: number) => (
                      <tr
                        key={m.id || i}
                        className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                          i % 2 === 0 ? '' : 'bg-slate-900/30'
                        }`}
                      >
                        <td className="px-4 py-2 text-cyan-300 font-mono">{m.private_ip}</td>
                        <td className="px-4 py-2 text-slate-400 font-mono text-xs">{m.private_subnet}</td>
                        <td className="px-4 py-2 text-green-300 font-mono">{m.public_ip}</td>
                        <td className="px-4 py-2 text-yellow-300 font-mono">
                          {m.port_start} – {m.port_end}
                        </td>
                        <td className="px-4 py-2 text-slate-400 text-xs">{m.chain_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginação */}
            {mappingData && mappingData.pages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-slate-700">
                <span className="text-sm text-slate-400">
                  {mappingData.total.toLocaleString()} registros · Página {mappingData.page} de {mappingData.pages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMappingPage(p => Math.max(1, p - 1))}
                    disabled={mappingPage <= 1}
                    className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded disabled:opacity-40 transition-colors"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setMappingPage(p => Math.min(mappingData.pages, p + 1))}
                    disabled={mappingPage >= mappingData.pages}
                    className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded disabled:opacity-40 transition-colors"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
