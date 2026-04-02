import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, Key, Loader2, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { devicesApi } from '../../utils/api'

interface Props {
  deviceId: string
  credential?: any
  onClose: () => void
  onSuccess: () => void
}

export default function CredentialFormModal({ deviceId, credential, onClose, onSuccess }: Props) {
  const isEdit = !!credential
  const [showPassword, setShowPassword] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: credential || {
      credential_type: 'ssh',
      username: '',
      password: '',
      private_key: '',
      description: '',
      is_active: true,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? devicesApi.createCredential(deviceId, { ...data, id: credential.id })
        : devicesApi.createCredential(deviceId, data),
    onSuccess: () => {
      toast.success(isEdit ? 'Credencial atualizada!' : 'Credencial adicionada!')
      onSuccess()
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Erro ao salvar credencial'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 sticky top-0 bg-dark-800">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-yellow-400" />
            <h2 className="font-semibold text-white">{isEdit ? 'Editar Credencial' : 'Nova Credencial'}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="label">Tipo de Credencial</label>
            <select {...register('credential_type')} className="input">
              <option value="ssh">SSH</option>
              <option value="telnet">Telnet</option>
              <option value="snmp">SNMP</option>
              <option value="web">Web/HTTP</option>
              <option value="api">API</option>
            </select>
          </div>

          <div>
            <label className="label">Usuário *</label>
            <input
              {...register('username', { required: 'Usuário obrigatório' })}
              className="input"
              placeholder="admin"
            />
            {errors.username && <p className="text-red-400 text-xs mt-1">{String(errors.username.message)}</p>}
          </div>

          <div>
            <label className="label">{isEdit ? 'Nova Senha (deixe em branco para manter)' : 'Senha'}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                {...register('password')}
                className="input pr-10"
                placeholder={isEdit ? '••••••••' : '••••••••'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Chave Privada (SSH)</label>
            <textarea
              {...register('private_key')}
              className="input font-mono text-xs"
              rows={3}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
            />
          </div>

          <div>
            <label className="label">Descrição</label>
            <input
              {...register('description')}
              className="input"
              placeholder="Credencial de acesso SSH principal"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('is_active')} className="checkbox" defaultChecked />
            <span className="text-sm text-dark-300">Credencial Ativa</span>
          </label>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
              {mutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
              ) : (
                isEdit ? 'Atualizar' : 'Adicionar'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
