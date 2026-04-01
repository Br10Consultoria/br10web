import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, Route, Loader2 } from 'lucide-react'
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
  const { register, handleSubmit } = useForm({
    defaultValues: route || { metric: 1, is_active: true, is_persistent: true },
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit ? routesApi.update(deviceId, route.id, data) : routesApi.create(deviceId, data),
    onSuccess: () => {
      toast.success(isEdit ? 'Rota atualizada!' : 'Rota criada!')
      onSuccess()
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Erro ao salvar rota'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <div className="flex items-center gap-3">
            <Route className="w-5 h-5 text-green-400" />
            <h2 className="font-semibold text-white">{isEdit ? 'Editar Rota' : 'Nova Rota Estática'}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="label">Rede de Destino *</label>
            <input {...register('destination_network', { required: true })} className="input font-mono" placeholder="192.168.10.0/24" />
          </div>
          <div>
            <label className="label">Próximo Salto (Next Hop) *</label>
            <input {...register('next_hop', { required: true })} className="input font-mono" placeholder="10.0.0.1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Interface</label>
              <input {...register('interface')} className="input" placeholder="ppp0, eth0, tunnel1" />
            </div>
            <div>
              <label className="label">Métrica</label>
              <input {...register('metric', { valueAsNumber: true })} type="number" min={1} max={255} className="input" />
            </div>
          </div>
          <div>
            <label className="label">Descrição</label>
            <input {...register('description')} className="input" placeholder="Rota para rede do cliente..." />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
              <input {...register('is_active')} type="checkbox" className="w-4 h-4 rounded" />
              Rota Ativa
            </label>
            <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
              <input {...register('is_persistent')} type="checkbox" className="w-4 h-4 rounded" />
              Persistente
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="btn-success">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Salvar' : 'Criar Rota'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
