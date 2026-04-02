import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, Layers, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi } from '../../utils/api'

interface Props {
  deviceId: string
  vlan?: any
  onClose: () => void
  onSuccess: () => void
}

export default function VlanFormModal({ deviceId, vlan, onClose, onSuccess }: Props) {
  const isEdit = !!vlan
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: vlan || {
      vlan_id: '',
      name: '',
      ip_address: '',
      subnet_mask: '',
      gateway: '',
      is_active: true,
      is_management: false,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? devicesApi.updateVlan(deviceId, vlan.id, data)
        : devicesApi.createVlan(deviceId, data),
    onSuccess: () => {
      toast.success(isEdit ? 'VLAN atualizada!' : 'VLAN criada!')
      onSuccess()
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Erro ao salvar VLAN'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 sticky top-0 bg-dark-800">
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold text-white">{isEdit ? 'Editar VLAN' : 'Nova VLAN'}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">VLAN ID *</label>
              <input
                type="number"
                {...register('vlan_id', { required: 'VLAN ID obrigatório', min: 1, max: 4094 })}
                className="input"
                placeholder="100"
              />
              {errors.vlan_id && <p className="text-red-400 text-xs mt-1">{errors.vlan_id.message}</p>}
            </div>
            <div>
              <label className="label">Nome</label>
              <input
                {...register('name')}
                className="input"
                placeholder="Gerência"
              />
            </div>
          </div>

          <div>
            <label className="label">Endereço IP</label>
            <input
              {...register('ip_address')}
              className="input"
              placeholder="192.168.1.1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Máscara de Sub-rede</label>
              <input
                {...register('subnet_mask')}
                className="input"
                placeholder="255.255.255.0"
              />
            </div>
            <div>
              <label className="label">Gateway</label>
              <input
                {...register('gateway')}
                className="input"
                placeholder="192.168.1.254"
              />
            </div>
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...register('is_active')} className="checkbox" />
              <span className="text-sm text-dark-300">VLAN Ativa</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...register('is_management')} className="checkbox" />
              <span className="text-sm text-dark-300">VLAN de Gerência</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary flex-1">
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
