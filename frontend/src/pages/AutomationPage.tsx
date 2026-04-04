import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Terminal, Play, Plus, Pencil, Trash2, Search, Filter,
  ChevronDown, CheckCircle, XCircle, Clock, Loader2,
  BookOpen, History, Cpu, X, Copy, Check, AlertCircle,
  Wifi, WifiOff, RefreshCw
} from 'lucide-react'
import { automationApi, devicesApi, vendorsApi } from '../utils/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CommandTemplate {
  id: string
  name: string
  description?: string
  category: string
  command: string
  vendor_id?: string
  vendor_name?: string
  timeout: number
  is_active: boolean
  is_global: boolean
  created_at: string
  updated_at: string
}

interface CommandExecution {
  id: string
  template_id?: string
  template_name?: string
  device_id: string
  device_name?: string
  device_ip?: string
  command: string
  protocol: string
  status: string
  output?: string
  error_message?: string
  duration_ms?: number
  username?: string
  started_at: string
  finished_at?: string
}

interface Device {
  id: string
  name: string
  management_ip: string
  status?: string
  vendor_name?: string
  primary_protocol?: string
}

// ─── Category labels ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  diagnostics:   'Diagnóstico',
  configuration: 'Configuração',
  backup:        'Backup',
  monitoring:    'Monitoramento',
  routing:       'Roteamento',
  optical:       'Óptico (OLT/ONU)',
  security:      'Segurança',
  other:         'Outros',
}

const CATEGORY_COLORS: Record<string, string> = {
  diagnostics:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  configuration: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  backup:        'bg-purple-500/20 text-purple-300 border-purple-500/30',
  monitoring:    'bg-green-500/20 text-green-300 border-green-500/30',
  routing:       'bg-orange-500/20 text-orange-300 border-orange-500/30',
  optical:       'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  security:      'bg-red-500/20 text-red-300 border-red-500/30',
  other:         'bg-gray-500/20 text-gray-300 border-gray-500/30',
}

// ─── CommandFormModal ─────────────────────────────────────────────────────────

function CommandFormModal({
  template,
  vendors,
  onClose,
  onSave,
}: {
  template?: CommandTemplate | null
  vendors: any[]
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    name:        template?.name || '',
    description: template?.description || '',
    category:    template?.category || 'diagnostics',
    command:     template?.command || '',
    vendor_id:   template?.vendor_id || '',
    vendor_name: template?.vendor_name || '',
    timeout:     template?.timeout || 30,
    is_active:   template?.is_active ?? true,
    is_global:   template?.is_global ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleVendorChange = (vendorId: string) => {
    const vendor = vendors.find((v: any) => v.id === vendorId)
    setForm(f => ({ ...f, vendor_id: vendorId, vendor_name: vendor?.name || '' }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.command.trim()) {
      setError('Nome e Comando são obrigatórios')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        vendor_id: form.vendor_id || null,
        vendor_name: form.vendor_name || null,
      }
      if (template) {
        await automationApi.updateCommand(template.id, payload)
      } else {
        await automationApi.createCommand(payload)
      }
      onSave()
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao salvar comando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1e2a3a] border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">
              {template ? 'Editar Comando' : 'Novo Comando'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Ver sessões BGP"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Categoria</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full bg-[#141e2b] border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500/50 text-sm"
              >
                {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Vendor (opcional)</label>
              <select
                value={form.vendor_id}
                onChange={e => handleVendorChange(e.target.value)}
                className="w-full bg-[#141e2b] border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500/50 text-sm"
              >
                <option value="">Todos os vendors</option>
                {vendors.map((v: any) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Comando(s) *
                <span className="text-gray-500 font-normal ml-2">— múltiplos comandos: um por linha</span>
              </label>
              <textarea
                value={form.command}
                onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                placeholder="display bgp all summary"
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 text-sm font-mono resize-none"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Descrição</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Exibe o resumo das sessões BGP ativas"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Timeout (segundos)</label>
              <input
                type="number"
                value={form.timeout}
                onChange={e => setForm(f => ({ ...f, timeout: parseInt(e.target.value) || 30 }))}
                min={5}
                max={300}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500/50 text-sm"
              />
            </div>

            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-500"
                />
                <span className="text-sm text-gray-300">Ativo</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_global}
                  onChange={e => setForm(f => ({ ...f, is_global: e.target.checked }))}
                  className="w-4 h-4 rounded accent-blue-500"
                />
                <span className="text-sm text-gray-300">Global</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {template ? 'Salvar Alterações' : 'Criar Comando'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── ExecutorPanel ────────────────────────────────────────────────────────────

function ExecutorPanel({
  template,
  devices,
  onClose,
  onExecuted,
}: {
  template: CommandTemplate
  devices: Device[]
  onClose: () => void
  onExecuted: () => void
}) {
  const [deviceId, setDeviceId] = useState('')
  const [protocol, setProtocol] = useState('auto')
  const [interactive, setInteractive] = useState(false)
  const [customCommand, setCustomCommand] = useState(template.command)
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<CommandExecution | null>(null)
  const [copied, setCopied] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  const selectedDevice = devices.find(d => d.id === deviceId)

  const handleExecute = async () => {
    if (!deviceId) return
    setExecuting(true)
    setResult(null)
    try {
      const resp = await automationApi.execute({
        device_id: deviceId,
        template_id: template.id,
        command: customCommand,
        protocol,
        interactive,
        timeout: template.timeout,
      })
      setResult(resp.data)
      onExecuted()
    } catch (err: any) {
      setResult({
        id: '',
        device_id: deviceId,
        command: customCommand,
        protocol,
        status: 'error',
        error_message: err.response?.data?.detail || err.message || 'Erro desconhecido',
        started_at: new Date().toISOString(),
      })
    } finally {
      setExecuting(false)
    }
  }

  const handleCopy = () => {
    const text = result?.output || result?.error_message || ''
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1e2a3a] border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
              <Play className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{template.name}</h2>
              <p className="text-xs text-gray-400">
                {CATEGORY_LABELS[template.category] || template.category}
                {template.vendor_name && ` · ${template.vendor_name}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Config */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Dispositivo *</label>
              <select
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                className="w-full bg-[#141e2b] border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-green-500/50 text-sm"
              >
                <option value="">Selecionar dispositivo...</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.management_ip})
                  </option>
                ))}
              </select>
              {selectedDevice && (
                <p className="text-xs text-gray-500 mt-1">
                  Vendor: {selectedDevice.vendor_name || '—'} · Protocolo padrão: {selectedDevice.primary_protocol?.toUpperCase() || 'SSH'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Protocolo</label>
              <select
                value={protocol}
                onChange={e => setProtocol(e.target.value)}
                className="w-full bg-[#141e2b] border border-white/10 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-green-500/50 text-sm"
              >
                <option value="auto">Auto (padrão do dispositivo)</option>
                <option value="ssh">SSH</option>
                <option value="telnet">Telnet</option>
              </select>
            </div>
          </div>

          {/* Comando editável */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Comando
              <span className="text-gray-500 font-normal ml-2">— pode editar antes de executar</span>
            </label>
            <textarea
              value={customCommand}
              onChange={e => setCustomCommand(e.target.value)}
              rows={3}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-green-300 font-mono text-sm focus:outline-none focus:border-green-500/50 resize-none"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={interactive}
                onChange={e => setInteractive(e.target.checked)}
                className="w-4 h-4 rounded accent-green-500"
              />
              <span className="text-sm text-gray-300">Modo interativo</span>
              <span className="text-xs text-gray-500">(para Huawei, ZTE e outros que não suportam exec direto)</span>
            </label>
          </div>

          {/* Resultado */}
          {executing && (
            <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm text-blue-300 font-medium">Executando comando...</p>
                <p className="text-xs text-gray-400">Conectando ao dispositivo e aguardando resposta</p>
              </div>
            </div>
          )}

          {result && !executing && (
            <div className={`rounded-xl border overflow-hidden ${
              result.status === 'success'
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-red-500/30 bg-red-500/5'
            }`}>
              {/* Result header */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${
                result.status === 'success' ? 'border-green-500/20' : 'border-red-500/20'
              }`}>
                <div className="flex items-center gap-2">
                  {result.status === 'success'
                    ? <CheckCircle className="w-4 h-4 text-green-400" />
                    : <XCircle className="w-4 h-4 text-red-400" />
                  }
                  <span className={`text-sm font-medium ${
                    result.status === 'success' ? 'text-green-300' : 'text-red-300'
                  }`}>
                    {result.status === 'success' ? 'Comando executado com sucesso' : 'Erro na execução'}
                  </span>
                  {result.duration_ms != null && (
                    <span className="text-xs text-gray-500">· {result.duration_ms}ms</span>
                  )}
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>

              {/* Output */}
              <pre
                ref={outputRef}
                className="p-4 text-xs font-mono text-gray-200 whitespace-pre-wrap overflow-x-auto max-h-80 overflow-y-auto leading-relaxed"
              >
                {result.output || result.error_message || '(sem saída)'}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-5 border-t border-white/10 flex-shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Fechar
          </button>
          <button
            onClick={handleExecute}
            disabled={!deviceId || executing}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {executing
              ? <><Loader2 className="w-4 h-4 animate-spin" />Executando...</>
              : <><Play className="w-4 h-4" />Executar Agora</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── HistoryPanel ─────────────────────────────────────────────────────────────

function HistoryPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [deviceFilter, setDeviceFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: historyData, isLoading } = useQuery({
    queryKey: ['automation-history', deviceFilter, statusFilter],
    queryFn: () => automationApi.listHistory({
      device_id: deviceFilter || undefined,
      status: statusFilter || undefined,
      limit: 100,
    }),
    refetchInterval: 10000,
  })

  const { data: devicesData } = useQuery({
    queryKey: ['devices-list-automation'],
    queryFn: () => devicesApi.list(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => automationApi.deleteExecution(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation-history'] }),
  })

  const history: CommandExecution[] = historyData?.data || []
  const devices: Device[] = devicesData?.data?.devices || devicesData?.data || []

  const statusIcon = (s: string) => {
    if (s === 'success') return <CheckCircle className="w-4 h-4 text-green-400" />
    if (s === 'error') return <XCircle className="w-4 h-4 text-red-400" />
    if (s === 'running') return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
    return <Clock className="w-4 h-4 text-gray-400" />
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1e2a3a] border border-white/10 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center">
              <History className="w-5 h-5 text-purple-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Histórico de Execuções</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filtros */}
        <div className="flex gap-3 p-4 border-b border-white/10 flex-shrink-0">
          <select
            value={deviceFilter}
            onChange={e => setDeviceFilter(e.target.value)}
            className="bg-[#141e2b] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50 flex-1"
          >
            <option value="">Todos os dispositivos</option>
            {devices.map((d: Device) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#141e2b] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
          >
            <option value="">Todos os status</option>
            <option value="success">Sucesso</option>
            <option value="error">Erro</option>
            <option value="running">Em execução</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <History className="w-12 h-12 text-gray-600 mb-3" />
              <p className="text-gray-400">Nenhuma execução encontrada</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-[#1e2a3a]">
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Dispositivo</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Comando</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Protocolo</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Duração</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Executado em</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {history.map(exec => (
                  <tr key={exec.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">{statusIcon(exec.status)}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-white">{exec.device_name || '—'}</p>
                      <p className="text-xs text-gray-500">{exec.device_ip}</p>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-xs font-mono text-gray-300 truncate">{exec.command}</p>
                      {exec.template_name && (
                        <p className="text-xs text-gray-500">{exec.template_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400 uppercase">{exec.protocol}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">
                        {exec.duration_ms != null ? `${exec.duration_ms}ms` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">
                        {new Date(exec.started_at).toLocaleString('pt-BR')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteMutation.mutate(exec.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── AutomationPage ───────────────────────────────────────────────────────────

export default function AutomationPage() {
  const queryClient = useQueryClient()

  // State
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editTemplate, setEditTemplate] = useState<CommandTemplate | null>(null)
  const [executeTemplate, setExecuteTemplate] = useState<CommandTemplate | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Queries
  const { data: commandsData, isLoading: loadingCommands } = useQuery({
    queryKey: ['automation-commands', search, categoryFilter, vendorFilter],
    queryFn: () => automationApi.listCommands({
      search: search || undefined,
      category: categoryFilter || undefined,
      vendor_id: vendorFilter || undefined,
    }),
  })

  const { data: devicesData } = useQuery({
    queryKey: ['devices-list-automation'],
    queryFn: () => devicesApi.list(),
  })

  const { data: vendorsData } = useQuery({
    queryKey: ['vendors-list-automation'],
    queryFn: () => vendorsApi.listVendors(),
  })

  const { data: historyData } = useQuery({
    queryKey: ['automation-history-count'],
    queryFn: () => automationApi.listHistory({ limit: 5 }),
    refetchInterval: 30000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => automationApi.deleteCommand(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-commands'] })
      setDeleteConfirm(null)
    },
  })

  const commands: CommandTemplate[] = commandsData?.data || []
  const devices: Device[] = devicesData?.data?.devices || devicesData?.data || []
  const vendors: any[] = vendorsData?.data || []
  const recentHistory: CommandExecution[] = historyData?.data || []

  // Group commands by category
  const grouped = commands.reduce((acc: Record<string, CommandTemplate[]>, cmd) => {
    const cat = cmd.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(cmd)
    return acc
  }, {})

  const handleEdit = (template: CommandTemplate) => {
    setEditTemplate(template)
    setShowForm(true)
  }

  const handleCloseForm = () => {
    setShowForm(false)
    setEditTemplate(null)
  }

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['automation-commands'] })
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Automações</h1>
          <p className="text-gray-400 text-sm mt-1">
            Biblioteca de comandos por vendor — execute em qualquer dispositivo cadastrado
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm font-medium rounded-lg transition-colors"
          >
            <History className="w-4 h-4" />
            Histórico
            {recentHistory.length > 0 && (
              <span className="bg-purple-500/30 text-purple-300 text-xs px-1.5 py-0.5 rounded-full">
                {recentHistory.length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setEditTemplate(null); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Comando
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total de Comandos', value: commands.length, color: 'blue', icon: BookOpen },
          { label: 'Dispositivos', value: devices.length, color: 'green', icon: Cpu },
          { label: 'Categorias', value: Object.keys(grouped).length, color: 'purple', icon: Filter },
          { label: 'Execuções Recentes', value: recentHistory.length, color: 'orange', icon: History },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className={`bg-white/5 border border-white/10 rounded-xl p-4`}>
            <div className={`w-8 h-8 bg-${color}-500/20 rounded-lg flex items-center justify-center mb-3`}>
              <Icon className={`w-4 h-4 text-${color}-400`} />
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar comandos..."
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 text-sm"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="bg-[#1e2a3a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50"
        >
          <option value="">Todas as categorias</option>
          {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <select
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value)}
          className="bg-[#1e2a3a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500/50"
        >
          <option value="">Todos os vendors</option>
          {vendors.map((v: any) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        {(search || categoryFilter || vendorFilter) && (
          <button
            onClick={() => { setSearch(''); setCategoryFilter(''); setVendorFilter('') }}
            className="flex items-center gap-1.5 px-3 py-2.5 text-gray-400 hover:text-white text-sm transition-colors"
          >
            <X className="w-4 h-4" />
            Limpar
          </button>
        )}
      </div>

      {/* Lista de comandos */}
      {loadingCommands ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
      ) : commands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-4">
            <Terminal className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Nenhum comando cadastrado</h3>
          <p className="text-gray-400 text-sm max-w-sm mb-6">
            Crie sua biblioteca de comandos por vendor para executar em qualquer dispositivo com um clique.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Criar Primeiro Comando
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${CATEGORY_COLORS[category] || CATEGORY_COLORS.other}`}>
                  {CATEGORY_LABELS[category] || category}
                </span>
                <span className="text-xs text-gray-500">{cmds.length} comando{cmds.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {cmds.map(cmd => (
                  <div
                    key={cmd.id}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-white truncate">{cmd.name}</h3>
                        {cmd.vendor_name && (
                          <p className="text-xs text-gray-500 mt-0.5">{cmd.vendor_name}</p>
                        )}
                      </div>
                      {!cmd.is_active && (
                        <span className="text-xs text-gray-500 bg-gray-500/20 px-1.5 py-0.5 rounded flex-shrink-0">Inativo</span>
                      )}
                    </div>

                    {cmd.description && (
                      <p className="text-xs text-gray-400 mb-3 line-clamp-2">{cmd.description}</p>
                    )}

                    <div className="bg-black/30 rounded-lg px-3 py-2 mb-3">
                      <code className="text-xs text-green-300 font-mono line-clamp-2">{cmd.command}</code>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">timeout: {cmd.timeout}s</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setExecuteTemplate(cmd)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-600/80 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          <Play className="w-3 h-3" />
                          Executar
                        </button>
                        <button
                          onClick={() => handleEdit(cmd)}
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {deleteConfirm === cmd.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteMutation.mutate(cmd.id)}
                              className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg transition-colors"
                            >
                              Confirmar
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-2 py-1 text-gray-400 hover:text-white text-xs transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(cmd.id)}
                            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modais */}
      {showForm && (
        <CommandFormModal
          template={editTemplate}
          vendors={vendors}
          onClose={handleCloseForm}
          onSave={handleSaved}
        />
      )}

      {executeTemplate && (
        <ExecutorPanel
          template={executeTemplate}
          devices={devices}
          onClose={() => setExecuteTemplate(null)}
          onExecuted={() => queryClient.invalidateQueries({ queryKey: ['automation-history-count'] })}
        />
      )}

      {showHistory && (
        <HistoryPanel onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
