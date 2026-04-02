import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, GitBranch, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { routesApi } from '../../utils/api'

interface Props {
  deviceId: string
  route?: any
  onClose: () => void
  onSuccess: () => void
}

export default function RouteFormModal({ deviceId, route, onClose, onSuccess }: Props) {
  const isEdit = !!route
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: route || {
      destination_network: '',
      next_hop: '',
      interface: '',
      metric: 1,
      is_active: true,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? routesApi.update(deviceId, route.id, data)
        : routesApi.create(deviceId, data),
    onSuccess: () => {
      toast.success(isEdit ? 'Rota atualizada!' : 'Rota criada!')
      onSuccess()
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Erro ao salvar rota'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 sticky top-0 bg-dark-800">
          <div className="flex items-center gap-3">
            <GitBranch className="w-5 h-5 text-indigo-400" />
            <h2 className="font-semibold text-white">{isEdit ? 'Editar Rota' : 'Nova Rota Estática'}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="label">Rede de Destino *</label>
            <input
              {...register('destination_network', { required: 'Rede de destino obrigatória' })}
              className="input"
              placeholder="192.168.10.0/24"
            />
            {errors.destination_network && (
              <p className="text-red-400 text-xs mt-1">{errors.destination_network.message}</p>
            )}
          </div>

          <div>
            <label className="label">Próximo Salto (Next Hop) *</label>
            <input
              {...register('next_hop', { required: 'Next hop obrigatório' })}
              className="input"
              placeholder="192.168.1.1"
            />
            {errors.next_hop && <p className="text-red-400 text-xs mt-1">{errors.next_hop.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Interface</label>
              <input
                {...register('interface')}
                className="input"
                placeholder="GigabitEthernet0/0/1"
              />
            </div>
            <div>
              <label className="label">Métrica</label>
              <input
                type="number"
                {...register('metric', { min: 1 })}
                className="input"
                placeholder="1"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('is_active')} className="checkbox" />
            <span className="text-sm text-dark-300">Rota Ativa</span>
          </label>

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
