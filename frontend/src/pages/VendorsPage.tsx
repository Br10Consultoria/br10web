import { useState, useEffect } from 'react'
import {
  Cpu, Plus, Edit2, Trash2, ChevronDown, ChevronRight,
  X, Check, AlertCircle, Router, Network, Radio, Server,
  Shield, Wifi, HardDrive, Package
} from 'lucide-react'
import { vendorsApi } from '../utils/api'
import toast from 'react-hot-toast'

interface VendorModel {
  id: string
  vendor_id: string
  vendor_name?: string
  name: string
  description?: string
  default_ssh_port?: number
  default_telnet_port?: number
  default_http_port?: number
  default_https_port?: number
  default_winbox_port?: number
  notes?: string
  is_active: boolean
}

interface Vendor {
  id: string
  group_id: string
  group_name?: string
  group_type?: string
  name: string
  description?: string
  website?: string
  is_active: boolean
  models: VendorModel[]
}

interface VendorGroup {
  id: string
  name: string
  group_type: string
  description?: string
  icon?: string
  is_active: boolean
  vendors: Vendor[]
}

const GROUP_TYPE_LABELS: Record<string, string> = {
  router: 'Roteadores',
  switch: 'Switches',
  olt: 'OLTs',
  onu: 'ONUs',
  firewall: 'Firewalls',
  server: 'Servidores',
  access_point: 'Access Points',
  other: 'Outros',
}

const GROUP_TYPE_ICONS: Record<string, any> = {
  router: Router,
  switch: Network,
  olt: Radio,
  onu: Wifi,
  firewall: Shield,
  server: Server,
  access_point: Wifi,
  other: Package,
}

export default function VendorsPage() {
  const [groups, setGroups] = useState<VendorGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())

  // Modal states
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [showVendorModal, setShowVendorModal] = useState(false)
  const [showModelModal, setShowModelModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<VendorGroup | null>(null)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [editingModel, setEditingModel] = useState<VendorModel | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Form states
  const [groupForm, setGroupForm] = useState({ name: '', group_type: 'router', description: '', is_active: true })
  const [vendorForm, setVendorForm] = useState({ group_id: '', name: '', description: '', website: '', is_active: true })
  const [modelForm, setModelForm] = useState({
    vendor_id: '', name: '', description: '',
    default_ssh_port: 22, default_telnet_port: 23,
    default_http_port: '', default_https_port: '', default_winbox_port: '',
    notes: '', is_active: true
  })

  const loadGroups = async () => {
    try {
      setLoading(true)
      const res = await vendorsApi.listGroups()
      setGroups(res.data)
    } catch {
      toast.error('Erro ao carregar grupos de vendors')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadGroups() }, [])

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleVendor = (id: string) => {
    setExpandedVendors(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Group handlers
  const openCreateGroup = () => {
    setEditingGroup(null)
    setGroupForm({ name: '', group_type: 'router', description: '', is_active: true })
    setShowGroupModal(true)
  }

  const openEditGroup = (group: VendorGroup) => {
    setEditingGroup(group)
    setGroupForm({ name: group.name, group_type: group.group_type, description: group.description || '', is_active: group.is_active })
    setShowGroupModal(true)
  }

  const saveGroup = async () => {
    if (!groupForm.name.trim()) { toast.error('Nome do grupo é obrigatório'); return }
    setSaving(true)
    try {
      if (editingGroup) {
        await vendorsApi.updateGroup(editingGroup.id, groupForm)
        toast.success('Grupo atualizado')
      } else {
        await vendorsApi.createGroup(groupForm)
        toast.success('Grupo criado')
      }
      setShowGroupModal(false)
      loadGroups()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar grupo')
    } finally {
      setSaving(false)
    }
  }

  // Vendor handlers
  const openCreateVendor = (groupId: string) => {
    setEditingVendor(null)
    setVendorForm({ group_id: groupId, name: '', description: '', website: '', is_active: true })
    setShowVendorModal(true)
  }

  const openEditVendor = (vendor: Vendor) => {
    setEditingVendor(vendor)
    setVendorForm({ group_id: vendor.group_id, name: vendor.name, description: vendor.description || '', website: vendor.website || '', is_active: vendor.is_active })
    setShowVendorModal(true)
  }

  const saveVendor = async () => {
    if (!vendorForm.name.trim()) { toast.error('Nome do vendor é obrigatório'); return }
    setSaving(true)
    try {
      if (editingVendor) {
        await vendorsApi.updateVendor(editingVendor.id, vendorForm)
        toast.success('Vendor atualizado')
      } else {
        await vendorsApi.createVendor(vendorForm)
        toast.success('Vendor criado')
      }
      setShowVendorModal(false)
      loadGroups()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar vendor')
    } finally {
      setSaving(false)
    }
  }

  // Model handlers
  const openCreateModel = (vendorId: string) => {
    setEditingModel(null)
    setModelForm({ vendor_id: vendorId, name: '', description: '', default_ssh_port: 22, default_telnet_port: 23, default_http_port: '', default_https_port: '', default_winbox_port: '', notes: '', is_active: true })
    setShowModelModal(true)
  }

  const openEditModel = (model: VendorModel) => {
    setEditingModel(model)
    setModelForm({
      vendor_id: model.vendor_id, name: model.name, description: model.description || '',
      default_ssh_port: model.default_ssh_port ?? 22,
      default_telnet_port: model.default_telnet_port ?? 23,
      default_http_port: model.default_http_port?.toString() ?? '',
      default_https_port: model.default_https_port?.toString() ?? '',
      default_winbox_port: model.default_winbox_port?.toString() ?? '',
      notes: model.notes || '', is_active: model.is_active
    })
    setShowModelModal(true)
  }

  const saveModel = async () => {
    if (!modelForm.name.trim()) { toast.error('Nome do modelo é obrigatório'); return }
    setSaving(true)
    const payload = {
      ...modelForm,
      default_http_port: modelForm.default_http_port ? parseInt(modelForm.default_http_port as string) : null,
      default_https_port: modelForm.default_https_port ? parseInt(modelForm.default_https_port as string) : null,
      default_winbox_port: modelForm.default_winbox_port ? parseInt(modelForm.default_winbox_port as string) : null,
    }
    try {
      if (editingModel) {
        await vendorsApi.updateModel(editingModel.id, payload)
        toast.success('Modelo atualizado')
      } else {
        await vendorsApi.createModel(payload)
        toast.success('Modelo criado')
      }
      setShowModelModal(false)
      loadGroups()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar modelo')
    } finally {
      setSaving(false)
    }
  }

  // Delete handler
  const handleDelete = async () => {
    if (!deleteConfirm) return
    try {
      if (deleteConfirm.type === 'group') await vendorsApi.deleteGroup(deleteConfirm.id)
      else if (deleteConfirm.type === 'vendor') await vendorsApi.deleteVendor(deleteConfirm.id)
      else if (deleteConfirm.type === 'model') await vendorsApi.deleteModel(deleteConfirm.id)
      toast.success('Removido com sucesso')
      setDeleteConfirm(null)
      loadGroups()
    } catch {
      toast.error('Erro ao remover')
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vendors & Modelos</h1>
          <p className="text-dark-400 text-sm mt-1">Gerencie grupos de equipamentos, fabricantes e modelos</p>
        </div>
        <button onClick={openCreateGroup} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Novo Grupo
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-dark-400 text-sm">Grupos</p>
          <p className="text-2xl font-bold text-white mt-1">{groups.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-dark-400 text-sm">Vendors</p>
          <p className="text-2xl font-bold text-brand-400 mt-1">{groups.reduce((s, g) => s + g.vendors.length, 0)}</p>
        </div>
        <div className="card p-4">
          <p className="text-dark-400 text-sm">Modelos</p>
          <p className="text-2xl font-bold text-purple-400 mt-1">{groups.reduce((s, g) => s + g.vendors.reduce((sv, v) => sv + v.models.length, 0), 0)}</p>
        </div>
      </div>

      {/* Groups Tree */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card p-12 text-center">
          <Cpu className="w-12 h-12 text-dark-600 mx-auto mb-3" />
          <p className="text-dark-400">Nenhum grupo cadastrado</p>
          <button onClick={openCreateGroup} className="btn-primary mt-4">Criar Primeiro Grupo</button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => {
            const GroupIcon = GROUP_TYPE_ICONS[group.group_type] || Package
            const isGroupExpanded = expandedGroups.has(group.id)
            return (
              <div key={group.id} className="card overflow-hidden">
                {/* Group Header */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-dark-700/50 transition-colors"
                  onClick={() => toggleGroup(group.id)}
                >
                  <div className="w-9 h-9 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
                    <GroupIcon className="w-4 h-4 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{group.name}</span>
                      <span className="text-xs text-dark-400 bg-dark-700 px-2 py-0.5 rounded">
                        {GROUP_TYPE_LABELS[group.group_type] || group.group_type}
                      </span>
                    </div>
                    {group.description && <p className="text-sm text-dark-400 truncate">{group.description}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-dark-400">{group.vendors.length} vendor(s)</span>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openCreateVendor(group.id)} className="btn-ghost p-1.5 rounded hover:text-green-400" title="Adicionar Vendor">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => openEditGroup(group)} className="btn-ghost p-1.5 rounded hover:text-brand-400" title="Editar">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteConfirm({ type: 'group', id: group.id })} className="btn-ghost p-1.5 rounded hover:text-red-400" title="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {isGroupExpanded ? <ChevronDown className="w-4 h-4 text-dark-500" /> : <ChevronRight className="w-4 h-4 text-dark-500" />}
                  </div>
                </div>

                {/* Vendors */}
                {isGroupExpanded && (
                  <div className="border-t border-dark-700">
                    {group.vendors.length === 0 ? (
                      <div className="p-4 text-center">
                        <p className="text-dark-500 text-sm">Nenhum vendor neste grupo</p>
                        <button onClick={() => openCreateVendor(group.id)} className="btn-ghost text-sm mt-2 text-brand-400">
                          + Adicionar Vendor
                        </button>
                      </div>
                    ) : (
                      group.vendors.map(vendor => {
                        const isVendorExpanded = expandedVendors.has(vendor.id)
                        return (
                          <div key={vendor.id} className="border-b border-dark-700/50 last:border-0">
                            {/* Vendor Row */}
                            <div
                              className="flex items-center gap-3 px-6 py-3 cursor-pointer hover:bg-dark-700/30 transition-colors"
                              onClick={() => toggleVendor(vendor.id)}
                            >
                              <div className="w-7 h-7 rounded bg-purple-600/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
                                <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-white text-sm">{vendor.name}</span>
                                {vendor.description && <p className="text-xs text-dark-400 truncate">{vendor.description}</p>}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-dark-400">{vendor.models.length} modelo(s)</span>
                                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                  <button onClick={() => openCreateModel(vendor.id)} className="btn-ghost p-1 rounded hover:text-green-400" title="Adicionar Modelo">
                                    <Plus className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => openEditVendor(vendor)} className="btn-ghost p-1 rounded hover:text-brand-400" title="Editar">
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => setDeleteConfirm({ type: 'vendor', id: vendor.id })} className="btn-ghost p-1 rounded hover:text-red-400" title="Remover">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                                {isVendorExpanded ? <ChevronDown className="w-3.5 h-3.5 text-dark-500" /> : <ChevronRight className="w-3.5 h-3.5 text-dark-500" />}
                              </div>
                            </div>

                            {/* Models */}
                            {isVendorExpanded && (
                              <div className="bg-dark-900/50">
                                {vendor.models.length === 0 ? (
                                  <div className="px-12 py-3 text-center">
                                    <p className="text-dark-500 text-xs">Nenhum modelo cadastrado</p>
                                    <button onClick={() => openCreateModel(vendor.id)} className="btn-ghost text-xs mt-1 text-brand-400">
                                      + Adicionar Modelo
                                    </button>
                                  </div>
                                ) : (
                                  vendor.models.map(model => (
                                    <div key={model.id} className="flex items-center gap-3 px-12 py-2.5 border-b border-dark-700/30 last:border-0 hover:bg-dark-700/20">
                                      <Cpu className="w-3.5 h-3.5 text-dark-500 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <span className="text-sm text-white">{model.name}</span>
                                        {model.description && <span className="text-xs text-dark-500 ml-2">{model.description}</span>}
                                      </div>
                                      <div className="flex items-center gap-2 text-xs text-dark-500">
                                        {model.default_ssh_port && <span>SSH:{model.default_ssh_port}</span>}
                                        {model.default_telnet_port && <span>Telnet:{model.default_telnet_port}</span>}
                                        {model.default_winbox_port && <span>Winbox:{model.default_winbox_port}</span>}
                                      </div>
                                      <div className="flex gap-1">
                                        <button onClick={() => openEditModel(model)} className="btn-ghost p-1 rounded hover:text-brand-400">
                                          <Edit2 className="w-3 h-3" />
                                        </button>
                                        <button onClick={() => setDeleteConfirm({ type: 'model', id: model.id })} className="btn-ghost p-1 rounded hover:text-red-400">
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Grupo */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-dark-700">
              <h2 className="font-semibold text-white">{editingGroup ? 'Editar Grupo' : 'Novo Grupo de Equipamentos'}</h2>
              <button type="button" onClick={() => setShowGroupModal(false)} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-dark-300 mb-1">Nome <span className="text-red-400">*</span></label>
                <input type="text" value={groupForm.name} onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Roteadores Huawei" className="input w-full" />
              </div>
              <div>
                <label className="block text-sm text-dark-300 mb-1">Tipo de Equipamento</label>
                <select value={groupForm.group_type} onChange={e => setGroupForm(f => ({ ...f, group_type: e.target.value }))} className="input w-full">
                  {Object.entries(GROUP_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-dark-300 mb-1">Descrição</label>
                <input type="text" value={groupForm.description} onChange={e => setGroupForm(f => ({ ...f, description: e.target.value }))} placeholder="Descrição opcional" className="input w-full" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-dark-700">
              <button type="button" onClick={() => setShowGroupModal(false)} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={saveGroup} disabled={saving} className="btn-primary flex items-center gap-2">
                {saving ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Check className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Vendor */}
      {showVendorModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-dark-700">
              <h2 className="font-semibold text-white">{editingVendor ? 'Editar Vendor' : 'Novo Vendor/Fabricante'}</h2>
              <button type="button" onClick={() => setShowVendorModal(false)} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-dark-300 mb-1">Nome <span className="text-red-400">*</span></label>
                <input type="text" value={vendorForm.name} onChange={e => setVendorForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Huawei, ZTE, Mikrotik" className="input w-full" />
              </div>
              <div>
                <label className="block text-sm text-dark-300 mb-1">Descrição</label>
                <input type="text" value={vendorForm.description} onChange={e => setVendorForm(f => ({ ...f, description: e.target.value }))} placeholder="Descrição opcional" className="input w-full" />
              </div>
              <div>
                <label className="block text-sm text-dark-300 mb-1">Website</label>
                <input type="url" value={vendorForm.website} onChange={e => setVendorForm(f => ({ ...f, website: e.target.value }))} placeholder="https://vendor.com" className="input w-full" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-dark-700">
              <button type="button" onClick={() => setShowVendorModal(false)} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={saveVendor} disabled={saving} className="btn-primary flex items-center gap-2">
                {saving ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Check className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Modelo */}
      {showModelModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-dark-700">
              <h2 className="font-semibold text-white">{editingModel ? 'Editar Modelo' : 'Novo Modelo de Equipamento'}</h2>
              <button type="button" onClick={() => setShowModelModal(false)} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm text-dark-300 mb-1">Nome do Modelo <span className="text-red-400">*</span></label>
                  <input type="text" value={modelForm.name} onChange={e => setModelForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: NE8000, CX600, CCR1036" className="input w-full" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-dark-300 mb-1">Descrição</label>
                  <input type="text" value={modelForm.description} onChange={e => setModelForm(f => ({ ...f, description: e.target.value }))} placeholder="Descrição opcional" className="input w-full" />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-dark-300 uppercase tracking-wider mb-3">Portas Padrão</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">SSH</label>
                    <input type="number" value={modelForm.default_ssh_port} onChange={e => setModelForm(f => ({ ...f, default_ssh_port: parseInt(e.target.value) || 22 }))} className="input w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Telnet</label>
                    <input type="number" value={modelForm.default_telnet_port} onChange={e => setModelForm(f => ({ ...f, default_telnet_port: parseInt(e.target.value) || 23 }))} className="input w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Winbox</label>
                    <input type="number" value={modelForm.default_winbox_port} onChange={e => setModelForm(f => ({ ...f, default_winbox_port: e.target.value }))} placeholder="8291" className="input w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">HTTP</label>
                    <input type="number" value={modelForm.default_http_port} onChange={e => setModelForm(f => ({ ...f, default_http_port: e.target.value }))} placeholder="80" className="input w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">HTTPS</label>
                    <input type="number" value={modelForm.default_https_port} onChange={e => setModelForm(f => ({ ...f, default_https_port: e.target.value }))} placeholder="443" className="input w-full text-sm" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm text-dark-300 mb-1">Observações</label>
                <textarea value={modelForm.notes} onChange={e => setModelForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="input w-full resize-none text-sm" placeholder="Notas sobre o modelo..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-dark-700">
              <button type="button" onClick={() => setShowModelModal(false)} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={saveModel} disabled={saving} className="btn-primary flex items-center gap-2">
                {saving ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Check className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação Exclusão */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Confirmar Exclusão</h3>
                <p className="text-sm text-dark-400">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancelar</button>
              <button type="button" onClick={handleDelete} className="btn-danger flex-1">Remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
