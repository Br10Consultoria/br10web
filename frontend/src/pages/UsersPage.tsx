import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Edit2, Trash2, Shield, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { authApi } from '../utils/api'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  technician: 'Técnico',
  viewer: 'Visualizador',
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-500/20 text-red-400 border-red-500/30',
  technician: 'bg-brand-500/20 text-brand-400 border-brand-500/30',
  viewer: 'bg-dark-600/50 text-dark-400 border-dark-600',
}

function UserModal({ user, onClose, onSuccess }: any) {
  const [showPwd, setShowPwd] = useState(false)
  const isEdit = !!user
  const { register, handleSubmit } = useForm({
    defaultValues: user || { role: 'viewer' },
  })

  const mutation = useMutation({
    mutationFn: (data: any) => isEdit ? authApi.updateUser(user.id, data) : authApi.createUser(data),
    onSuccess: () => { toast.success(isEdit ? 'Usuário atualizado!' : 'Usuário criado!'); onSuccess() },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Erro ao salvar'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h2 className="font-semibold text-white">{isEdit ? 'Editar Usuário' : 'Novo Usuário'}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="label">Nome Completo *</label>
            <input {...register('full_name', { required: true })} className="input" placeholder="João Silva" />
          </div>
          <div>
            <label className="label">Usuário *</label>
            <input {...register('username', { required: true })} className="input" placeholder="joao.silva" disabled={isEdit} />
          </div>
          <div>
            <label className="label">E-mail *</label>
            <input {...register('email', { required: true })} type="email" className="input" placeholder="joao@br10.net" />
          </div>
          {!isEdit && (
            <div>
              <label className="label">Senha *</label>
              <div className="relative">
                <input {...register('password', { required: !isEdit })} type={showPwd ? 'text' : 'password'} className="input pr-10" placeholder="Senha@123" />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="label">Perfil</label>
            <select {...register('role')} className="input">
              <option value="viewer">Visualizador</option>
              <option value="technician">Técnico</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div>
            <label className="label">Telefone</label>
            <input {...register('phone')} className="input" placeholder="+55 71 99999-9999" />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Salvar' : 'Criar Usuário'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<any>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => authApi.getUsers().then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authApi.deleteUser(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); toast.success('Usuário removido') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Erro ao remover'),
  })

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gerenciar Usuários</h1>
          <p className="text-dark-400 text-sm">{users.length} usuário(s) cadastrado(s)</p>
        </div>
        <button onClick={() => { setEditUser(null); setShowModal(true) }} className="btn-primary">
          <Plus className="w-4 h-4" />Novo Usuário
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>2FA</th><th>Último Acesso</th><th>Status</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-brand-600/30 rounded-full flex items-center justify-center">
                          <span className="text-brand-300 text-xs font-semibold">{u.full_name?.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">{u.full_name}</p>
                          <p className="text-xs text-dark-500">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-dark-400 text-sm">{u.email}</td>
                    <td><span className={`badge border ${ROLE_COLORS[u.role]}`}>{ROLE_LABELS[u.role]}</span></td>
                    <td>
                      {u.totp_enabled
                        ? <span className="badge-online"><Shield className="w-3 h-3" />Ativo</span>
                        : <span className="badge-offline">Inativo</span>}
                    </td>
                    <td className="text-dark-500 text-xs">{u.last_login ? new Date(u.last_login).toLocaleString('pt-BR') : 'Nunca'}</td>
                    <td><span className={u.is_active ? 'badge-online' : 'badge-offline'}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditUser(u); setShowModal(true) }} className="btn-secondary btn-sm"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => confirm('Remover usuário?') && deleteMutation.mutate(u.id)} className="btn-ghost btn-sm text-red-400 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <UserModal
          user={editUser}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); queryClient.invalidateQueries({ queryKey: ['users'] }) }}
        />
      )}
    </div>
  )
}
