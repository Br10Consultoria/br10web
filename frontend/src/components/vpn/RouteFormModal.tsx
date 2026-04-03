import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, Route, Loader2, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { routesApi } from '../../utils/api'

interface Props {
  deviceId: string
  route?: any
  vpnConfigs?: any[]   // Lista de VPNs do dispositivo para sugerir interfaces
  onClose: () => void
  onSuccess: () => void
}

export default function RouteFormModal({ deviceId, route, vpnConfigs = [], onClose, onSuccess }: Props) {
  const isEdit = !!route
  const { register, handleSubmit, setValue, watch } = useForm({
    defaultValues: route || { metric: 1, is_active: true, is_persistent: true },
  })

  const interfaceValue = watch('interface')

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit ? routesApi.update(deviceId, route.id, data) : routesApi.create(deviceId, data),
    onSuccess: () => {
      toast.success(isEdit ? 'Rota atualizada!' : 'Rota criada!')
      onSuccess()
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Erro ao salvar rota'),
  })

  // Gerar sugestões de interface a partir das VPNs do dispositivo
  // No Mikrotik, ao criar um cliente L2TP com nome "VPN-SP01", a interface PPP gerada
  // fica com o mesmo nome da conexão configurada
  const vpnInterfaceSuggestions = vpnConfigs
    .filter((v: any) => ['l2tp', 'l2tp_ipsec', 'pptp', 'sstp'].includes(v.vpn_type))
    .map((v: any) => ({
      label: `${v.name} (${v.vpn_type?.toUpperCase()})`,
      value: v.name,
      status: v.status,
    }))

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
              {/* Campo de texto livre com sugestões via datalist */}
              <input
                {...register('interface')}
                className="input"
                placeholder="Selecione ou digite..."
                list="interface-suggestions"
                autoComplete="off"
              />
              <datalist id="interface-suggestions">
                {vpnInterfaceSuggestions.map((s: any) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
                <option value="ether1">ether1</option>
                <option value="ether2">ether2</option>
                <option value="bridge">bridge</option>
                <option value="lo">loopback (lo)</option>
              </datalist>

              {/* Atalhos rápidos para VPNs disponíveis */}
              {vpnInterfaceSuggestions.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-dark-500 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    VPNs deste dispositivo:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {vpnInterfaceSuggestions.map((s: any) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setValue('interface', s.value)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                          interfaceValue === s.value
                            ? 'bg-brand-500/20 border-brand-500/50 text-brand-300'
                            : 'bg-dark-700 border-dark-600 text-dark-400 hover:border-dark-500 hover:text-dark-300'
                        }`}
                      >
                        {s.label}
                        {s.status === 'active' && (
                          <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-400 inline-block align-middle" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
