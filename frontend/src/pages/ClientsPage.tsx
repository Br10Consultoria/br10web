import { useState, useEffect } from 'react'
import {
  Users, Plus, Search, Edit2, Trash2, Building2,
  Phone, Mail, MapPin, ChevronRight, X, Check, AlertCircle
} from 'lucide-react'
import { clientsApi } from '../utils/api'
import toast from 'react-hot-toast'

interface Client {
  id: string
  name: string
  short_name?: string
  document?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  notes?: string
  is_active: boolean
  device_count: number
  created_at?: string
}

const emptyForm = {
  name: '',
  short_name: '',
  document: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  notes: '',
  is_active: true,
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const loadClients = async () => {
    try {
      setLoading(true)
      const res = await clientsApi.list()
      setClients(res.data)
    } catch {
      toast.error('Erro ao carregar clientes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadClients() }, [])

  const openCreate = () => {
    setEditingClient(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (client: Client) => {
    setEditingClient(client)
    setForm({
      name: client.name || '',
      short_name: client.short_name || '',
      document: client.document || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      contact_name: client.contact_name || '',
      contact_email: client.contact_email || '',
      contact_phone: client.contact_phone || '',
      notes: client.notes || '',
      is_active: client.is_active,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Nome do cliente é obrigatório')
      return
    }
    setSaving(true)
    try {
      if (editingClient) {
        await clientsApi.update(editingClient.id, form)
        toast.success('Cliente atualizado com sucesso')
      } else {
        await clientsApi.create(form)
        toast.success('Cliente criado com sucesso')
      }
      setShowModal(false)
      loadClients()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Erro ao salvar cliente')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await clientsApi.delete(id)
      toast.success('Cliente removido')
      setDeleteConfirm(null)
      loadClients()
    } catch {
      toast.error('Erro ao remover cliente')
    }
  }

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.short_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.city || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clientes</h1>
          <p className="text-dark-400 text-sm mt-1">Gerencie os clientes de consultoria</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Novo Cliente
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-dark-400 text-sm">Total de Clientes</p>
          <p className="text-2xl font-bold text-white mt-1">{clients.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-dark-400 text-sm">Clientes Ativos</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{clients.filter(c => c.is_active).length}</p>
        </div>
        <div className="card p-4">
          <p className="text-dark-400 text-sm">Total de Dispositivos</p>
          <p className="text-2xl font-bold text-brand-400 mt-1">{clients.reduce((s, c) => s + c.device_count, 0)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
        <input
          type="text"
          placeholder="Buscar clientes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input pl-10 w-full"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 className="w-12 h-12 text-dark-600 mx-auto mb-3" />
          <p className="text-dark-400">Nenhum cliente encontrado</p>
          <button onClick={openCreate} className="btn-primary mt-4">Adicionar Primeiro Cliente</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(client => (
            <div key={client.id} className="card p-5 hover:border-dark-600 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-white">{client.name}</h3>
                      {client.short_name && (
                        <span className="text-xs text-dark-400 bg-dark-700 px-2 py-0.5 rounded">{client.short_name}</span>
                      )}
                      {!client.is_active && (
                        <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded">Inativo</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 mt-2">
                      {client.city && (
                        <span className="flex items-center gap-1 text-sm text-dark-400">
                          <MapPin className="w-3.5 h-3.5" />
                          {client.city}{client.state ? `/${client.state}` : ''}
                        </span>
                      )}
                      {client.email && (
                        <span className="flex items-center gap-1 text-sm text-dark-400">
                          <Mail className="w-3.5 h-3.5" />
                          {client.email}
                        </span>
                      )}
                      {client.phone && (
                        <span className="flex items-center gap-1 text-sm text-dark-400">
                          <Phone className="w-3.5 h-3.5" />
                          {client.phone}
                        </span>
                      )}
                    </div>
                    {client.contact_name && (
                      <p className="text-sm text-dark-500 mt-1">Contato: {client.contact_name}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">{client.device_count}</p>
                    <p className="text-xs text-dark-500">dispositivos</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(client)}
                      className="btn-ghost p-2 rounded-lg hover:text-brand-400"
                      title="Editar"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(client.id)}
                      className="btn-ghost p-2 rounded-lg hover:text-red-400"
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Criação/Edição */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-dark-700">
              <h2 className="text-lg font-semibold text-white">
                {editingClient ? 'Editar Cliente' : 'Novo Cliente'}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="btn-ghost p-2 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              {/* Dados da Empresa */}
              <div>
                <h3 className="text-sm font-medium text-dark-300 uppercase tracking-wider mb-3">Dados da Empresa</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm text-dark-300 mb-1">Nome <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Nome completo do cliente"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">Nome Curto</label>
                    <input
                      type="text"
                      value={form.short_name}
                      onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))}
                      placeholder="Ex: ACME"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">CNPJ/CPF</label>
                    <input
                      type="text"
                      value={form.document}
                      onChange={e => setForm(f => ({ ...f, document: e.target.value }))}
                      placeholder="00.000.000/0001-00"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">E-mail</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="empresa@email.com"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">Telefone</label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="(00) 0000-0000"
                      className="input w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Endereço */}
              <div>
                <h3 className="text-sm font-medium text-dark-300 uppercase tracking-wider mb-3">Endereço</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm text-dark-300 mb-1">Endereço</label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      placeholder="Rua, número, bairro"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">Cidade</label>
                    <input
                      type="text"
                      value={form.city}
                      onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                      placeholder="Cidade"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">Estado</label>
                    <input
                      type="text"
                      value={form.state}
                      onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase().slice(0, 2) }))}
                      placeholder="BA"
                      maxLength={2}
                      className="input w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Contato Técnico */}
              <div>
                <h3 className="text-sm font-medium text-dark-300 uppercase tracking-wider mb-3">Contato Técnico</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm text-dark-300 mb-1">Nome do Responsável</label>
                    <input
                      type="text"
                      value={form.contact_name}
                      onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                      placeholder="Nome do responsável técnico"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">E-mail do Contato</label>
                    <input
                      type="email"
                      value={form.contact_email}
                      onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                      placeholder="contato@email.com"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-dark-300 mb-1">Telefone do Contato</label>
                    <input
                      type="text"
                      value={form.contact_phone}
                      onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                      placeholder="(00) 00000-0000"
                      className="input w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Observações */}
              <div>
                <label className="block text-sm text-dark-300 mb-1">Observações</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Informações adicionais sobre o cliente..."
                  rows={3}
                  className="input w-full resize-none"
                />
              </div>

              {/* Status */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`w-10 h-6 rounded-full transition-colors ${form.is_active ? 'bg-green-500' : 'bg-dark-600'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full mx-1 transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span className="text-sm text-dark-300">Cliente ativo</span>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-dark-700">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
                {saving ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Check className="w-4 h-4" />}
                {editingClient ? 'Salvar Alterações' : 'Criar Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Remover Cliente</h3>
                <p className="text-sm text-dark-400">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <p className="text-dark-300 text-sm mb-5">
              Os dispositivos associados a este cliente não serão removidos, apenas a associação será desfeita.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancelar</button>
              <button type="button" onClick={() => handleDelete(deleteConfirm)} className="btn-danger flex-1">Remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
