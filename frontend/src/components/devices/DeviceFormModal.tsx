import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, Server, Eye, EyeOff, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi } from '../../utils/api'

const DEVICE_TYPES = [
  { value: 'huawei_ne8000', label: 'Huawei NE8000' },
  { value: 'huawei_6730', label: 'Huawei 6730' },
  { value: 'datacom', label: 'Datacom' },
  { value: 'vsol_olt', label: 'VSOL OLT' },
  { value: 'mikrotik', label: 'Mikrotik' },
  { value: 'cisco', label: 'Cisco' },
  { value: 'juniper', label: 'Juniper' },
  { value: 'generic_router', label: 'Roteador Genérico' },
  { value: 'generic_switch', label: 'Switch Genérico' },
  { value: 'generic_olt', label: 'OLT Genérica' },
  { value: 'other', label: 'Outro' },
]

const PROTOCOLS = [
  { value: 'ssh', label: 'SSH' },
  { value: 'telnet', label: 'Telnet' },
  { value: 'winbox', label: 'Winbox' },
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
]

// Portas padrão por protocolo
const DEFAULT_PORTS: Record<string, number> = {
  ssh: 22,
  telnet: 23,
  winbox: 8291,
  http: 80,
  https: 443,
}

// Mapeamento de protocolo para campo no backend
const PROTOCOL_FIELD: Record<string, string> = {
  ssh: 'ssh_port',
  telnet: 'telnet_port',
  winbox: 'winbox_port',
  http: 'http_port',
  https: 'https_port',
}

interface Props {
  device?: any
  onClose: () => void
  onSuccess: () => void
}

export default function DeviceFormModal({ device, onClose, onSuccess }: Props) {
  const [showPassword, setShowPassword] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isEdit = !!device

  // Inicializar protocolos habilitados com base no dispositivo existente
  const initEnabledProtocols = (): Record<string, boolean> => {
    if (!device) {
      // Novo dispositivo: SSH habilitado por padrão
      return { ssh: true, telnet: false, winbox: false, http: false, https: false }
    }
    return {
      ssh: !!device.ssh_port,
      telnet: !!device.telnet_port,
      winbox: !!device.winbox_port,
      http: !!device.http_port,
      https: !!device.https_port,
    }
  }

  // Inicializar portas com base no dispositivo existente
  const initPorts = (): Record<string, number> => {
    if (!device) return { ...DEFAULT_PORTS }
    return {
      ssh: device.ssh_port || DEFAULT_PORTS.ssh,
      telnet: device.telnet_port || DEFAULT_PORTS.telnet,
      winbox: device.winbox_port || DEFAULT_PORTS.winbox,
      http: device.http_port || DEFAULT_PORTS.http,
      https: device.https_port || DEFAULT_PORTS.https,
    }
  }

  const [enabledProtocols, setEnabledProtocols] = useState<Record<string, boolean>>(initEnabledProtocols)
  const [ports, setPorts] = useState<Record<string, number>>(initPorts)

  const toggleProtocol = (proto: string) => {
    setEnabledProtocols(prev => ({ ...prev, [proto]: !prev[proto] }))
  }

  const { register, handleSubmit, setValue, formState: { errors } } = useForm({
    defaultValues: device ? {
      name: device.name,
      hostname: device.hostname || '',
      description: device.description || '',
      location: device.location || '',
      site: device.site || '',
      device_type: device.device_type,
      manufacturer: device.manufacturer || '',
      model: device.model || '',
      firmware_version: device.firmware_version || '',
      serial_number: device.serial_number || '',
      management_ip: device.management_ip,
      primary_protocol: device.primary_protocol || 'ssh',
      username: device.username || '',
      password: '',
      enable_password: '',
      subnet_mask: device.subnet_mask || '',
      gateway: device.gateway || '',
      dns_primary: device.dns_primary || '',
      dns_secondary: device.dns_secondary || '',
      loopback_ip: device.loopback_ip || '',
      notes: device.notes || '',
    } : {
      primary_protocol: 'ssh',
    },
  })

  // Sincronizar primary_protocol quando protocolos mudam
  useEffect(() => {
    const enabledList = PROTOCOLS.filter(p => enabledProtocols[p.value])
    if (enabledList.length > 0) {
      const currentProtocol = device?.primary_protocol || 'ssh'
      if (!enabledProtocols[currentProtocol]) {
        setValue('primary_protocol', enabledList[0].value)
      }
    }
  }, [enabledProtocols])

  const mutation = useMutation({
    mutationFn: (data: any) => {
      // Adicionar portas habilitadas ao payload
      const portData: Record<string, number | null> = {}
      for (const proto of Object.keys(enabledProtocols)) {
        const field = PROTOCOL_FIELD[proto]
        portData[field] = enabledProtocols[proto] ? ports[proto] : null
      }
      return isEdit
        ? devicesApi.update(device.id, { ...data, ...portData })
        : devicesApi.create({ ...data, ...portData })
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Dispositivo atualizado!' : 'Dispositivo cadastrado!')
      onSuccess()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Erro ao salvar dispositivo')
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 sticky top-0 bg-dark-800 z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600/20 rounded-lg flex items-center justify-center">
              <Server className="w-4 h-4 text-brand-400" />
            </div>
            <h2 className="font-semibold text-white">
              {isEdit ? 'Editar Dispositivo' : 'Novo Dispositivo'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={e => {
            e.preventDefault()
            e.stopPropagation()
            handleSubmit(d => mutation.mutate(d))(e)
          }}
          className="p-6 space-y-6"
        >
          {/* Identificação */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">
              Identificação
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label">Nome *</label>
                <input {...register('name', { required: true })} className="input" placeholder="Ex: Core Router SP01" />
                {errors.name && <p className="text-red-400 text-xs mt-1">Campo obrigatório</p>}
              </div>
              <div>
                <label className="label">Hostname</label>
                <input {...register('hostname')} className="input" placeholder="router-sp01.br10.net" />
              </div>
              <div>
                <label className="label">Tipo de Dispositivo {!isEdit && '*'}</label>
                <select {...register('device_type', { required: !isEdit })} className="input">
                  <option value="">Selecione...</option>
                  {DEVICE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {errors.device_type && <p className="text-red-400 text-xs mt-1">Campo obrigatório</p>}
              </div>
              <div>
                <label className="label">Fabricante</label>
                <input {...register('manufacturer')} className="input" placeholder="Huawei" />
              </div>
              <div>
                <label className="label">Modelo</label>
                <input {...register('model')} className="input" placeholder="NE8000-M8" />
              </div>
              <div>
                <label className="label">Local / Rack</label>
                <input {...register('location')} className="input" placeholder="DC São Paulo - Rack A3" />
              </div>
              <div>
                <label className="label">Site / Cliente</label>
                <input {...register('site')} className="input" placeholder="Cliente ABC" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Descrição</label>
                <textarea {...register('description')} className="input resize-none" rows={2} placeholder="Descrição do dispositivo..." />
              </div>
            </div>
          </div>

          {/* Acesso */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">
              Acesso e Conectividade
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">IP de Gerência *</label>
                <input {...register('management_ip', { required: true })} className="input font-mono" placeholder="192.168.1.1" />
                {errors.management_ip && <p className="text-red-400 text-xs mt-1">Campo obrigatório</p>}
              </div>
              <div>
                <label className="label">Protocolo Principal</label>
                <select {...register('primary_protocol')} className="input">
                  {PROTOCOLS.filter(p => enabledProtocols[p.value]).map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                  {!Object.values(enabledProtocols).some(Boolean) && (
                    <option value="">Nenhum protocolo habilitado</option>
                  )}
                </select>
              </div>
              <div>
                <label className="label">Usuário</label>
                <input {...register('username')} className="input" placeholder="admin" autoComplete="off" />
              </div>
              <div>
                <label className="label">Senha</label>
                <div className="relative">
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder={isEdit ? '(manter atual)' : 'senha123'}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Senha Enable / Privilegiada</label>
                <input {...register('enable_password')} type="password" className="input" placeholder="enable password" autoComplete="new-password" />
              </div>
              <div>
                <label className="label">Número de Série</label>
                <input {...register('serial_number')} className="input font-mono" placeholder="SN123456789" />
              </div>
            </div>
          </div>

          {/* Portas de Acesso com checkboxes */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-1">
              Portas de Acesso
            </h3>
            <p className="text-xs text-dark-400 mb-3">
              Selecione os protocolos disponíveis neste dispositivo e configure as portas.
            </p>
            <div className="space-y-2">
              {PROTOCOLS.map(({ value: proto, label }) => (
                <div
                  key={proto}
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                    enabledProtocols[proto]
                      ? 'border-brand-600/40 bg-brand-600/5'
                      : 'border-dark-700 bg-dark-900/30'
                  }`}
                >
                  {/* Checkbox toggle */}
                  <button
                    type="button"
                    onClick={() => toggleProtocol(proto)}
                    className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                      enabledProtocols[proto]
                        ? 'bg-brand-600 border-brand-600'
                        : 'bg-transparent border-2 border-dark-600 hover:border-dark-400'
                    }`}
                  >
                    {enabledProtocols[proto] && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  {/* Label */}
                  <span
                    className={`w-16 text-sm font-medium cursor-pointer select-none ${
                      enabledProtocols[proto] ? 'text-white' : 'text-dark-500'
                    }`}
                    onClick={() => toggleProtocol(proto)}
                  >
                    {label}
                  </span>

                  {/* Campo de porta — só aparece quando habilitado */}
                  {enabledProtocols[proto] ? (
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-xs text-dark-400">Porta:</span>
                      <input
                        type="number"
                        value={ports[proto]}
                        onChange={e => setPorts(prev => ({ ...prev, [proto]: parseInt(e.target.value) || DEFAULT_PORTS[proto] }))}
                        className="input w-24 text-center font-mono py-1.5 text-sm"
                        min={1}
                        max={65535}
                      />
                    </div>
                  ) : (
                    <span className="ml-auto text-xs text-dark-600 italic">Desabilitado</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Configurações Avançadas */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-dark-400 hover:text-dark-200 w-full"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Configurações de Rede Avançadas
            </button>

            {showAdvanced && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Máscara de Sub-rede</label>
                  <input {...register('subnet_mask')} className="input font-mono" placeholder="255.255.255.0" />
                </div>
                <div>
                  <label className="label">Gateway</label>
                  <input {...register('gateway')} className="input font-mono" placeholder="192.168.1.254" />
                </div>
                <div>
                  <label className="label">DNS Primário</label>
                  <input {...register('dns_primary')} className="input font-mono" placeholder="8.8.8.8" />
                </div>
                <div>
                  <label className="label">DNS Secundário</label>
                  <input {...register('dns_secondary')} className="input font-mono" placeholder="8.8.4.4" />
                </div>
                <div>
                  <label className="label">IP Loopback</label>
                  <input {...register('loopback_ip')} className="input font-mono" placeholder="10.0.0.1" />
                </div>
                <div>
                  <label className="label">Versão Firmware</label>
                  <input {...register('firmware_version')} className="input" placeholder="V800R021C10" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Notas / Observações</label>
                  <textarea {...register('notes')} className="input resize-none" rows={3} placeholder="Observações sobre o dispositivo..." />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-dark-700">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isEdit ? 'Salvar Alterações' : 'Cadastrar Dispositivo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
