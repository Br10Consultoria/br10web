import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, Network, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi } from '../../utils/api'

interface Props {
  deviceId: string
  port?: any
  onClose: () => void
  onSuccess: () => void
}

export default function PortFormModal({ deviceId, port, onClose, onSuccess }: Props) {
  const isEdit = !!port
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: port || {
      port_name: '',
      port_type: 'ethernet',
      status: 'down',
      speed_mbps: 1000,
      vlan_id: '',
      connected_device: '',
      description: '',
    },
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? devicesApi.updatePort(deviceId, port.id, data)
        : devicesApi.createPort(deviceId, data),
    onSuccess: () => {
      toast.success(isEdit ? 'Porta atualizada!' : 'Porta criada!')
      onSuccess()
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Erro ao salvar porta'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 sticky top-0 bg-dark-800">
          <div className="flex items-center gap-3">
            <Network className="w-5 h-5 text-cyan-400" />
            <h2 className="font-semibold text-white">{isEdit ? 'Editar Porta' : 'Nova Porta'}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-4">
          <div>
            <label className="label">Nome da Porta *</label>
            <input
              {...register('port_name', { required: 'Nome da porta obrigatório' })}
              className="input"
              placeholder="GigabitEthernet0/0/1"
            />
            {errors.port_name && <p className="text-red-400 text-xs mt-1">{errors.port_name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tipo</label>
              <select {...register('port_type')} className="input">
                <option value="ethernet">Ethernet</option>
                <option value="fiber">Fibra</option>
                <option value="sfp">SFP</option>
                <option value="sfp+">SFP+</option>
                <option value="qsfp">QSFP</option>
                <option value="virtual">Virtual</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select {...register('status')} className="input">
                <option value="up">UP</option>
                <option value="down">DOWN</option>
                <option value="admin_down">Admin Down</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Velocidade (Mbps)</label>
              <input
                type="number"
                {...register('speed_mbps')}
                className="input"
                placeholder="1000"
              />
            </div>
            <div>
              <label className="label">VLAN ID</label>
              <input
                type="number"
                {...register('vlan_id')}
                className="input"
                placeholder="100"
              />
            </div>
          </div>

          <div>
            <label className="label">Dispositivo Conectado</label>
            <input
              {...register('connected_device')}
              className="input"
              placeholder="Switch Core 01"
            />
          </div>

          <div>
            <label className="label">Descrição</label>
            <textarea
              {...register('description')}
              className="input"
              rows={2}
              placeholder="Uplink para core"
            />
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
