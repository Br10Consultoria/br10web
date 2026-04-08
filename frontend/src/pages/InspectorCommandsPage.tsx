/**
 * InspectorCommandsPage — Gerenciador de Comandos de Inspeção por Vendor
 *
 * Permite criar, editar e excluir comandos agrupados por tipo de dispositivo
 * e categoria. Os comandos cadastrados aqui são usados na tela de Inspeção.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Terminal, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  Loader2, AlertTriangle, CheckCircle, X, Save, RefreshCw,
  Database, Server, Network, Cpu, Layers, GitBranch, Route,
  Shield, Globe, Share2, GitMerge, Lock, Link, FileText,
  Zap, Plug, BarChart2, WifiOff, Wifi, Search, Download,
  Upload, Copy,
} from 'lucide-react'
import api from '../utils/api'
import toast from 'react-hot-toast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface InspectorCommand {
  id: string
  device_type: string
  category_id: string
  category_label: string
  category_icon: string
  command: string
  description: string | null
  sort_order: number
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

interface DeviceType {
  value: string
  label: string
}

// ─── Ícones ───────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Network, GitBranch, Route, Layers, Cpu, FileText,
  Server, Zap, Plug, BarChart2, Link, Database,
  Shield, Globe, Share2, GitMerge, Lock, Wifi, WifiOff,
  AlertTriangle, Terminal,
}

function CatIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] || Terminal
  return <Icon className={className || 'w-4 h-4'} />
}

const AVAILABLE_ICONS = Object.keys(ICON_MAP)

// ─── Modal de criação/edição de comando ───────────────────────────────────────

interface CommandModalProps {
  command?: InspectorCommand | null
  deviceTypes: DeviceType[]
  defaultDeviceType?: string
  defaultCategoryId?: string
  defaultCategoryLabel?: string
  defaultCategoryIcon?: string
  onClose: () => void
  onSave: (data: any) => void
  isSaving: boolean
}

function CommandModal({
  command, deviceTypes, defaultDeviceType = '', defaultCategoryId = '',
  defaultCategoryLabel = '', defaultCategoryIcon = 'Terminal',
  onClose, onSave, isSaving,
}: CommandModalProps) {
  const [deviceType, setDeviceType] = useState(command?.device_type || defaultDeviceType)
  const [categoryId, setCategoryId] = useState(command?.category_id || defaultCategoryId)
  const [categoryLabel, setCategoryLabel] = useState(command?.category_label || defaultCategoryLabel)
  const [categoryIcon, setCategoryIcon] = useState(command?.category_icon || defaultCategoryIcon)
  const [cmd, setCmd] = useState(command?.command || '')
  const [description, setDescription] = useState(command?.description || '')
  const [sortOrder, setSortOrder] = useState(command?.sort_order ?? 0)
  const [isActive, setIsActive] = useState(command?.is_active ?? true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!deviceType || !categoryId || !categoryLabel || !cmd.trim()) {
      toast.error('Preencha todos os campos obrigatórios')
      return
    }
    onSave({
      device_type: deviceType,
      category_id: categoryId,
      category_label: categoryLabel,
      category_icon: categoryIcon,
      command: cmd.trim(),
      description: description || null,
      sort_order: sortOrder,
      is_active: isActive,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-blue-400" />
            {command ? 'Editar Comando' : 'Novo Comando'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Vendor */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tipo de Dispositivo (Vendor) *</label>
            <select
              value={deviceType}
              onChange={e => setDeviceType(e.target.value)}
              disabled={!!command}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">Selecione...</option>
              {deviceTypes.map(dt => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
          </div>

          {/* Categoria */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">ID da Categoria *</label>
              <input
                value={categoryId}
                onChange={e => setCategoryId(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                disabled={!!command}
                placeholder="ex: interfaces, bgp"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Nome da Categoria *</label>
              <input
                value={categoryLabel}
                onChange={e => setCategoryLabel(e.target.value)}
                placeholder="ex: Interfaces, BGP"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Ícone */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Ícone da Categoria</label>
            <div className="flex items-center gap-2">
              <select
                value={categoryIcon}
                onChange={e => setCategoryIcon(e.target.value)}
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {AVAILABLE_ICONS.map(icon => (
                  <option key={icon} value={icon}>{icon}</option>
                ))}
              </select>
              <div className="w-9 h-9 bg-slate-700 border border-slate-600 rounded-lg flex items-center justify-center text-blue-400">
                <CatIcon name={categoryIcon} />
              </div>
            </div>
          </div>

          {/* Comando */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Comando *</label>
            <input
              value={cmd}
              onChange={e => setCmd(e.target.value)}
              placeholder="ex: display interface brief"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-green-300 placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Descrição (opcional)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Breve descrição do que o comando retorna"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Ordem e Ativo */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Ordem</label>
              <input
                type="number"
                value={sortOrder}
                onChange={e => setSortOrder(Number(e.target.value))}
                min={0}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-2 mt-4">
              <input
                type="checkbox"
                id="is_active"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500"
              />
              <label htmlFor="is_active" className="text-sm text-slate-300">Ativo</label>
            </div>
          </div>

          {/* Botões */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal de adição em lote ──────────────────────────────────────────────────

interface BulkModalProps {
  deviceType: string
  deviceLabel: string
  onClose: () => void
  onSave: (data: any) => void
  isSaving: boolean
}

function BulkModal({ deviceType, deviceLabel, onClose, onSave, isSaving }: BulkModalProps) {
  const [categoryId, setCategoryId] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('')
  const [categoryIcon, setCategoryIcon] = useState('Terminal')
  const [commandsText, setCommandsText] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const commands = commandsText.split('\n').map(c => c.trim()).filter(Boolean)
    if (!categoryId || !categoryLabel || commands.length === 0) {
      toast.error('Preencha todos os campos e insira ao menos um comando')
      return
    }
    onSave({ device_type: deviceType, category_id: categoryId, category_label: categoryLabel, category_icon: categoryIcon, commands })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-green-400" />
            Adicionar Comandos em Lote — {deviceLabel}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">ID da Categoria *</label>
              <input value={categoryId} onChange={e => setCategoryId(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                placeholder="ex: access_user" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Nome da Categoria *</label>
              <input value={categoryLabel} onChange={e => setCategoryLabel(e.target.value)}
                placeholder="ex: Usuários de Acesso" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Ícone</label>
            <select value={categoryIcon} onChange={e => setCategoryIcon(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
              {AVAILABLE_ICONS.map(icon => <option key={icon} value={icon}>{icon}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Comandos (um por linha) *</label>
            <textarea value={commandsText} onChange={e => setCommandsText(e.target.value)} rows={6}
              placeholder={"display access-user username <user> verbose\ndisplay access-user slot 0 | include GE0/1/4.1000 | exclude PPPoE | count\ndisplay current-configuration"}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-green-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-600 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" disabled={isSaving} className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Adicionar Comandos
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function InspectorCommandsPage() {
  const qc = useQueryClient()
  const [selectedDeviceType, setSelectedDeviceType] = useState<string>('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [searchText, setSearchText] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [editingCommand, setEditingCommand] = useState<InspectorCommand | null>(null)
  const [defaultCatInfo, setDefaultCatInfo] = useState({ id: '', label: '', icon: 'Terminal' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: deviceTypesData } = useQuery({
    queryKey: ['inspector-device-types'],
    queryFn: async () => {
      const res = await api.get('/inspector-commands/device-types')
      return res.data as { device_types: DeviceType[] }
    },
  })

  const deviceTypes = deviceTypesData?.device_types || []

  const { data: commandsData, isLoading } = useQuery({
    queryKey: ['inspector-commands', selectedDeviceType],
    queryFn: async () => {
      const params: any = { active_only: false }
      if (selectedDeviceType) params.device_type = selectedDeviceType
      const res = await api.get('/inspector-commands', { params })
      return res.data as { commands: InspectorCommand[]; total: number }
    },
  })

  const commands = commandsData?.commands || []

  // Filtrar por busca
  const filteredCommands = commands.filter(c =>
    !searchText ||
    c.command.toLowerCase().includes(searchText.toLowerCase()) ||
    c.category_label.toLowerCase().includes(searchText.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(searchText.toLowerCase())
  )

  // Agrupar por device_type → category_id
  const grouped: Record<string, Record<string, InspectorCommand[]>> = {}
  for (const cmd of filteredCommands) {
    if (!grouped[cmd.device_type]) grouped[cmd.device_type] = {}
    if (!grouped[cmd.device_type][cmd.category_id]) grouped[cmd.device_type][cmd.category_id] = []
    grouped[cmd.device_type][cmd.category_id].push(cmd)
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: (data: any) => api.post('/inspector-commands', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspector-commands'] })
      setShowModal(false)
      setEditingCommand(null)
      toast.success('Comando criado com sucesso')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Erro ao criar comando'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.put(`/inspector-commands/${id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspector-commands'] })
      setShowModal(false)
      setEditingCommand(null)
      toast.success('Comando atualizado')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Erro ao atualizar'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/inspector-commands/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspector-commands'] })
      setConfirmDelete(null)
      toast.success('Comando removido')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Erro ao remover'),
  })

  const bulkMut = useMutation({
    mutationFn: (data: any) => api.post('/inspector-commands/bulk', data).then(r => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['inspector-commands'] })
      setShowBulkModal(false)
      toast.success(`${data.created} comandos adicionados com sucesso`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Erro ao adicionar comandos'),
  })

  const seedMut = useMutation({
    mutationFn: () => api.post('/inspector-commands/seed').then(r => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['inspector-commands'] })
      toast.success(`Seed concluído: ${data.created} comandos padrão adicionados`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Erro no seed'),
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleSave = (data: any) => {
    if (editingCommand) {
      updateMut.mutate({ id: editingCommand.id, data })
    } else {
      createMut.mutate(data)
    }
  }

  const toggleCategory = (key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const isSaving = createMut.isPending || updateMut.isPending

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-800/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Terminal className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Comandos de Inspeção</h1>
              <p className="text-sm text-slate-400">Gerencie os comandos disponíveis por vendor e categoria</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {commands.length === 0 && (
              <button
                onClick={() => seedMut.mutate()}
                disabled={seedMut.isPending}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 rounded-lg transition-colors"
                title="Importar comandos padrão do catálogo embutido"
              >
                {seedMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Importar Padrões
              </button>
            )}
            <button
              onClick={() => { setShowBulkModal(true) }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              Adicionar em Lote
            </button>
            <button
              onClick={() => { setEditingCommand(null); setDefaultCatInfo({ id: '', label: '', icon: 'Terminal' }); setShowModal(true) }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo Comando
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Filtros */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Buscar comando..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={selectedDeviceType}
            onChange={e => setSelectedDeviceType(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos os vendors</option>
            {deviceTypes.map(dt => (
              <option key={dt.value} value={dt.value}>{dt.label}</option>
            ))}
          </select>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['inspector-commands'] })}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-500 ml-auto">
            {filteredCommands.length} comando{filteredCommands.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Estado vazio */}
        {!isLoading && commands.length === 0 && (
          <div className="text-center py-16 bg-slate-800/50 rounded-xl border border-slate-700">
            <Database className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-300 mb-2">Nenhum comando cadastrado</h3>
            <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
              Clique em "Importar Padrões" para carregar os comandos do catálogo embutido,
              ou crie comandos manualmente.
            </p>
            <button
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {seedMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Importar Comandos Padrão
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
        )}

        {/* Lista agrupada por vendor → categoria */}
        {Object.entries(grouped).map(([dt, categories]) => {
          const dtLabel = deviceTypes.find(d => d.value === dt)?.label || dt
          return (
            <div key={dt} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              {/* Header do vendor */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-700/40 border-b border-slate-700">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold text-white">{dtLabel}</span>
                  <span className="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded-full">
                    {Object.values(categories).flat().length} cmd{Object.values(categories).flat().length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSelectedDeviceType(dt)
                    setShowBulkModal(true)
                  }}
                  className="text-xs flex items-center gap-1 text-slate-400 hover:text-green-400 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Adicionar categoria
                </button>
              </div>

              {/* Categorias */}
              {Object.entries(categories).map(([catId, catCmds]) => {
                const catKey = `${dt}:${catId}`
                const isExpanded = expandedCategories.has(catKey)
                const catLabel = catCmds[0]?.category_label || catId
                const catIcon = catCmds[0]?.category_icon || 'Terminal'

                return (
                  <div key={catId} className="border-b border-slate-700/50 last:border-0">
                    {/* Header da categoria */}
                    <button
                      onClick={() => toggleCategory(catKey)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-700/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded
                          ? <ChevronDown className="w-4 h-4 text-slate-400" />
                          : <ChevronRight className="w-4 h-4 text-slate-400" />
                        }
                        <CatIcon name={catIcon} className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-medium text-slate-200">{catLabel}</span>
                        <span className="text-xs text-slate-500">
                          {catCmds.length} cmd{catCmds.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setEditingCommand(null)
                          setDefaultCatInfo({ id: catId, label: catLabel, icon: catIcon })
                          setSelectedDeviceType(dt)
                          setShowModal(true)
                        }}
                        className="text-xs flex items-center gap-1 text-slate-500 hover:text-blue-400 transition-colors px-2 py-1 rounded hover:bg-slate-700"
                      >
                        <Plus className="w-3 h-3" />
                        Adicionar
                      </button>
                    </button>

                    {/* Comandos da categoria */}
                    {isExpanded && (
                      <div className="px-4 pb-3 space-y-1">
                        {catCmds.sort((a, b) => a.sort_order - b.sort_order).map(cmd => (
                          <div
                            key={cmd.id}
                            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${
                              cmd.is_active ? 'bg-slate-700/30' : 'bg-slate-800/50 opacity-50'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-xs text-slate-500 w-5 text-right shrink-0">{cmd.sort_order}</span>
                              <code className="text-sm font-mono text-green-300 truncate">{cmd.command}</code>
                              {cmd.description && (
                                <span className="text-xs text-slate-500 truncate hidden md:block">— {cmd.description}</span>
                              )}
                              {!cmd.is_active && (
                                <span className="text-xs text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded shrink-0">inativo</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => navigator.clipboard.writeText(cmd.command).then(() => toast.success('Copiado!'))}
                                className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded transition-colors"
                                title="Copiar comando"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { setEditingCommand(cmd); setShowModal(true) }}
                                className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
                                title="Editar"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDelete(cmd.id)}
                                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                                title="Remover"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Modal criar/editar */}
      {showModal && (
        <CommandModal
          command={editingCommand}
          deviceTypes={deviceTypes}
          defaultDeviceType={selectedDeviceType}
          defaultCategoryId={defaultCatInfo.id}
          defaultCategoryLabel={defaultCatInfo.label}
          defaultCategoryIcon={defaultCatInfo.icon}
          onClose={() => { setShowModal(false); setEditingCommand(null) }}
          onSave={handleSave}
          isSaving={isSaving}
        />
      )}

      {/* Modal bulk */}
      {showBulkModal && (
        <BulkModal
          deviceType={selectedDeviceType}
          deviceLabel={deviceTypes.find(d => d.value === selectedDeviceType)?.label || selectedDeviceType}
          onClose={() => setShowBulkModal(false)}
          onSave={data => bulkMut.mutate(data)}
          isSaving={bulkMut.isPending}
        />
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="font-semibold text-white">Remover Comando</h3>
            </div>
            <p className="text-sm text-slate-400 mb-6">
              Tem certeza que deseja remover este comando? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-600 rounded-lg transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => deleteMut.mutate(confirmDelete)}
                disabled={deleteMut.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
