import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, GitBranch, Loader2, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { routesApi } from '../../utils/api'

interface Props {
  deviceId: string
  route?: any
  vpnConfigs?: any[]
  onClose: () => void
  onSuccess: () => void
}

export default function RouteFormModal({ deviceId, route, vpnConfigs = [], onClose, onSuccess }: Props) {
  const isEdit = !!route
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: route || {
      destination_network: '',
      next_hop: '',
      interface: '',
      vpn_config_id: '',
      metric: 1,
      description: '',
      is_active: true,
    },
  })

  const selectedVpn = watch('vpn_config_id')

  const mutation = useMutation({
    mutationFn: (data: any) => {
      // Se selecionou VPN, limpa o campo interface
      const payload = { ...data }
      if (payload.vpn_config_id) {
        payload.interface = ''
      } else {
        payload.vpn_config_id = null
      }
      return isEdit
        ? routesApi.update(deviceId, route.id, payload)
        : routesApi.create(deviceId, payload)
    },
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
              <p className="text-red-400 text-xs mt-1">{String(errors.destination_network.message)}</p>
            )}
          </div>

          <div>
            <label className="label">Próximo Salto (Next Hop) *</label>
            <input
              {...register('next_hop', { required: 'Next hop obrigatório' })}
              className="input"
              placeholder="192.168.1.1"
            />
            {errors.next_hop && <p className="text-red-400 text-xs mt-1">{String(errors.next_hop.message)}</p>}
          </div>

          {/* Interface VPN ou física */}
          <div className="space-y-3 p-4 bg-dark-700/40 rounded-xl border border-dark-600">
            <p className="text-xs font-medium text-dark-400 uppercase tracking-wider">Interface de Saída</p>

            {vpnConfigs.length > 0 && (
              <div>
                <label className="label flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-brand-400" />
                  Interface VPN L2TP
                </label>
                <select
                  {...register('vpn_config_id')}
                  className="input"
                  onChange={e => {
                    setValue('vpn_config_id', e.target.value)
                    if (e.target.value) setValue('interface', '')
                  }}
                >
                  <option value="">— Não usar VPN —</option>
                  {vpnConfigs.map((vpn: any) => (
                    <option key={vpn.id} value={vpn.id}>
                      {vpn.name} ({vpn.server_ip})
                    </option>
                  ))}
                </select>
                {selectedVpn && (
                  <p className="text-xs text-brand-400 mt-1 flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Rota será roteada via interface VPN selecionada
                  </p>
                )}
              </div>
            )}

            {!selectedVpn && (
              <div>
                <label className="label">Interface Física</label>
                <input
                  {...register('interface')}
                  className="input"
                  placeholder="GigabitEthernet0/0/1"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Métrica</label>
              <input
                type="number"
                {...register('metric', { min: 1 })}
                className="input"
                placeholder="1"
              />
            </div>
            <div>
              <label className="label">Descrição</label>
              <input
                {...register('description')}
                className="input"
                placeholder="Rota para filial..."
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
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
              {mutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
              ) : (
                isEdit ? 'Atualizar' : 'Criar Rota'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
