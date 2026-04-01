import { useState } from 'react'
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
  { value: 'winbox', label: 'Winbox (Mikrotik)' },
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
]

interface Props {
  device?: any
  onClose: () => void
  onSuccess: () => void
}

export default function DeviceFormModal({ device, onClose, onSuccess }: Props) {
  const [showPassword, setShowPassword] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isEdit = !!device

  const { register, handleSubmit, formState: { errors }, watch } = useForm({
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
      primary_protocol: device.primary_protocol,
      username: device.username || '',
      password: '',
      enable_password: '',
      ssh_port: device.ssh_port || 22,
      telnet_port: device.telnet_port || 23,
      winbox_port: device.winbox_port || 8291,
      http_port: device.http_port || 80,
      https_port: device.https_port || 443,
      subnet_mask: device.subnet_mask || '',
      gateway: device.gateway || '',
      dns_primary: device.dns_primary || '',
      dns_secondary: device.dns_secondary || '',
      loopback_ip: device.loopback_ip || '',
      notes: device.notes || '',
    } : {
      primary_protocol: 'ssh',
      ssh_port: 22,
      telnet_port: 23,
      winbox_port: 8291,
      http_port: 80,
      https_port: 443,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit ? devicesApi.update(device.id, data) : devicesApi.create(data),
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
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-6">
          {/* Identificação */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">
              Identificação
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label">Nome *</label>
                <input {...register('name', { required: true })} className="input" placeholder="Ex: Core Router SP01" />
              </div>
              <div>
                <label className="label">Hostname</label>
                <input {...register('hostname')} className="input" placeholder="router-sp01.br10.net" />
              </div>
              <div>
                <label className="label">Tipo de Dispositivo *</label>
                <select {...register('device_type', { required: true })} className="input">
                  <option value="">Selecione...</option>
                  {DEVICE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
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
              </div>
              <div>
                <label className="label">Protocolo Principal</label>
                <select {...register('primary_protocol')} className="input">
                  {PROTOCOLS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
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

          {/* Portas */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">
              Portas de Acesso
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'SSH', field: 'ssh_port' },
                { label: 'Telnet', field: 'telnet_port' },
                { label: 'Winbox', field: 'winbox_port' },
                { label: 'HTTP', field: 'http_port' },
                { label: 'HTTPS', field: 'https_port' },
              ].map(({ label, field }) => (
                <div key={field}>
                  <label className="label">{label}</label>
                  <input {...register(field as any, { valueAsNumber: true })} type="number" className="input text-center font-mono" />
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
