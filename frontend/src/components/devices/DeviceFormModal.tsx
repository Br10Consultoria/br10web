import { useState } from 'react'
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
  { value: 'ssh', label: 'SSH', defaultPort: 22, field: 'ssh_port' },
  { value: 'telnet', label: 'Telnet', defaultPort: 23, field: 'telnet_port' },
  { value: 'winbox', label: 'Winbox', defaultPort: 8291, field: 'winbox_port' },
  { value: 'http', label: 'HTTP', defaultPort: 80, field: 'http_port' },
  { value: 'https', label: 'HTTPS', defaultPort: 443, field: 'https_port' },
]

interface Props {
  device?: any
  onClose: () => void
  onSuccess: () => void
}

export default function DeviceFormModal({ device, onClose, onSuccess }: Props) {
  const isEdit = !!device

  // ── Campos de identificação ────────────────────────────────────────────────
  const [name, setName] = useState(device?.name || '')
  const [hostname, setHostname] = useState(device?.hostname || '')
  const [description, setDescription] = useState(device?.description || '')
  const [location, setLocation] = useState(device?.location || '')
  const [site, setSite] = useState(device?.site || '')
  const [deviceType, setDeviceType] = useState(device?.device_type || '')
  const [manufacturer, setManufacturer] = useState(device?.manufacturer || '')
  const [model, setModel] = useState(device?.model || '')
  const [firmwareVersion, setFirmwareVersion] = useState(device?.firmware_version || '')
  const [serialNumber, setSerialNumber] = useState(device?.serial_number || '')
  const [notes, setNotes] = useState(device?.notes || '')

  // ── Campos de rede ─────────────────────────────────────────────────────────
  const [managementIp, setManagementIp] = useState(device?.management_ip || '')
  const [subnetMask, setSubnetMask] = useState(device?.subnet_mask || '')
  const [gateway, setGateway] = useState(device?.gateway || '')
  const [dnsPrimary, setDnsPrimary] = useState(device?.dns_primary || '')
  const [dnsSecondary, setDnsSecondary] = useState(device?.dns_secondary || '')
  const [loopbackIp, setLoopbackIp] = useState(device?.loopback_ip || '')

  // ── Credenciais ────────────────────────────────────────────────────────────
  const [username, setUsername] = useState(device?.username || '')
  const [password, setPassword] = useState('')
  const [enablePassword, setEnablePassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // ── Protocolos e portas ────────────────────────────────────────────────────
  const initEnabled = () => {
    if (!device) return { ssh: true, telnet: false, winbox: false, http: false, https: false }
    return {
      ssh: device.ssh_port != null && device.ssh_port > 0,
      telnet: device.telnet_port != null && device.telnet_port > 0,
      winbox: !!device.winbox_port,
      http: !!device.http_port,
      https: !!device.https_port,
    }
  }
  const initPorts = () => ({
    ssh: device?.ssh_port || 22,
    telnet: device?.telnet_port || 23,
    winbox: device?.winbox_port || 8291,
    http: device?.http_port || 80,
    https: device?.https_port || 443,
  })

  const [enabledProtocols, setEnabledProtocols] = useState<Record<string, boolean>>(initEnabled)
  const [ports, setPorts] = useState<Record<string, number>>(initPorts)

  // primary_protocol: controlado por useState, não por react-hook-form
  const [primaryProtocol, setPrimaryProtocol] = useState<string>(device?.primary_protocol || 'ssh')

  const toggleProtocol = (proto: string) => {
    setEnabledProtocols(prev => {
      const next = { ...prev, [proto]: !prev[proto] }
      // Se o protocolo principal foi desabilitado, trocar para o primeiro habilitado
      if (!next[primaryProtocol]) {
        const first = PROTOCOLS.find(p => next[p.value])
        if (first) setPrimaryProtocol(first.value)
      }
      return next
    })
  }

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Validação ──────────────────────────────────────────────────────────────
  const validate = () => {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Campo obrigatório'
    if (!managementIp.trim()) errs.managementIp = 'Campo obrigatório'
    if (!isEdit && !deviceType) errs.deviceType = 'Campo obrigatório'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Mutation ───────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? devicesApi.update(device.id, payload) : devicesApi.create(payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Dispositivo atualizado!' : 'Dispositivo cadastrado!')
      onSuccess()
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail
      if (Array.isArray(detail)) {
        toast.error(detail.map((d: any) => d.msg).join(', '))
      } else {
        toast.error(detail || 'Erro ao salvar dispositivo')
      }
    },
  })

  const handleSave = () => {
    if (!validate()) return

    // Montar portas
    const portData: Record<string, number | null> = {}
    for (const p of PROTOCOLS) {
      portData[p.field] = enabledProtocols[p.value] ? (ports[p.value] || p.defaultPort) : null
    }
    // ssh_port e telnet_port são NOT NULL no banco — garantir valor mínimo
    if (!portData.ssh_port) portData.ssh_port = 22
    if (!portData.telnet_port) portData.telnet_port = 23

    const payload: Record<string, any> = {
      name: name.trim(),
      hostname: hostname.trim() || null,
      description: description.trim() || null,
      location: location.trim() || null,
      site: site.trim() || null,
      device_type: deviceType || undefined,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      firmware_version: firmwareVersion.trim() || null,
      serial_number: serialNumber.trim() || null,
      management_ip: managementIp.trim(),
      primary_protocol: primaryProtocol,
      username: username.trim() || null,
      subnet_mask: subnetMask.trim() || null,
      gateway: gateway.trim() || null,
      dns_primary: dnsPrimary.trim() || null,
      dns_secondary: dnsSecondary.trim() || null,
      loopback_ip: loopbackIp.trim() || null,
      notes: notes.trim() || null,
      ...portData,
    }

    // Só incluir senha se preenchida
    if (password) payload.password = password
    if (enablePassword) payload.enable_password = enablePassword

    mutation.mutate(payload)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
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

        {/* Conteúdo — NÃO é um <form>, usa botão com onClick para evitar submit nativo */}
        <div className="p-6 space-y-6">

          {/* Identificação */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">Identificação</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label">Nome *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input"
                  placeholder="Ex: Core Router SP01"
                />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className="label">Hostname</label>
                <input value={hostname} onChange={e => setHostname(e.target.value)} className="input" placeholder="router-sp01.br10.net" />
              </div>
              <div>
                <label className="label">Tipo de Dispositivo {!isEdit && '*'}</label>
                <select value={deviceType} onChange={e => setDeviceType(e.target.value)} className="input">
                  <option value="">Selecione...</option>
                  {DEVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {errors.deviceType && <p className="text-red-400 text-xs mt-1">{errors.deviceType}</p>}
              </div>
              <div>
                <label className="label">Fabricante</label>
                <input value={manufacturer} onChange={e => setManufacturer(e.target.value)} className="input" placeholder="Huawei" />
              </div>
              <div>
                <label className="label">Modelo</label>
                <input value={model} onChange={e => setModel(e.target.value)} className="input" placeholder="NE8000-M8" />
              </div>
              <div>
                <label className="label">Local / Rack</label>
                <input value={location} onChange={e => setLocation(e.target.value)} className="input" placeholder="DC São Paulo - Rack A3" />
              </div>
              <div>
                <label className="label">Site / Cliente</label>
                <input value={site} onChange={e => setSite(e.target.value)} className="input" placeholder="Cliente ABC" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Descrição</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} className="input resize-none" rows={2} placeholder="Descrição do dispositivo..." />
              </div>
            </div>
          </div>

          {/* Acesso e Conectividade */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-3">Acesso e Conectividade</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">IP de Gerência *</label>
                <input
                  value={managementIp}
                  onChange={e => setManagementIp(e.target.value)}
                  className="input font-mono"
                  placeholder="192.168.1.1"
                />
                {errors.managementIp && <p className="text-red-400 text-xs mt-1">{errors.managementIp}</p>}
              </div>
              <div>
                <label className="label">Protocolo Principal</label>
                <select
                  value={primaryProtocol}
                  onChange={e => setPrimaryProtocol(e.target.value)}
                  className="input"
                >
                  {PROTOCOLS.filter(p => enabledProtocols[p.value]).map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                  {!PROTOCOLS.some(p => enabledProtocols[p.value]) && (
                    <option value="">Nenhum protocolo habilitado</option>
                  )}
                </select>
              </div>
              <div>
                <label className="label">Usuário</label>
                <input value={username} onChange={e => setUsername(e.target.value)} className="input" placeholder="admin" autoComplete="off" />
              </div>
              <div>
                <label className="label">Senha</label>
                <div className="relative">
                  <input
                    value={password}
                    onChange={e => setPassword(e.target.value)}
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
                <input value={enablePassword} onChange={e => setEnablePassword(e.target.value)} type="password" className="input" placeholder="enable password" autoComplete="new-password" />
              </div>
              <div>
                <label className="label">Número de Série</label>
                <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} className="input font-mono" placeholder="SN123456789" />
              </div>
            </div>
          </div>

          {/* Portas de Acesso */}
          <div>
            <h3 className="text-sm font-semibold text-dark-300 uppercase tracking-wider mb-1">Portas de Acesso</h3>
            <p className="text-xs text-dark-400 mb-3">Selecione os protocolos disponíveis neste dispositivo e configure as portas.</p>
            <div className="space-y-2">
              {PROTOCOLS.map(({ value: proto, label, defaultPort }) => (
                <div
                  key={proto}
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                    enabledProtocols[proto] ? 'border-brand-600/40 bg-brand-600/5' : 'border-dark-700 bg-dark-900/30'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleProtocol(proto)}
                    className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                      enabledProtocols[proto] ? 'bg-brand-600 border-brand-600' : 'bg-transparent border-2 border-dark-600 hover:border-dark-400'
                    }`}
                  >
                    {enabledProtocols[proto] && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span
                    className={`w-16 text-sm font-medium cursor-pointer select-none ${enabledProtocols[proto] ? 'text-white' : 'text-dark-500'}`}
                    onClick={() => toggleProtocol(proto)}
                  >
                    {label}
                  </span>
                  {enabledProtocols[proto] ? (
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-xs text-dark-400">Porta:</span>
                      <input
                        type="number"
                        value={ports[proto]}
                        onChange={e => setPorts(prev => ({ ...prev, [proto]: parseInt(e.target.value) || defaultPort }))}
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
                  <input value={subnetMask} onChange={e => setSubnetMask(e.target.value)} className="input font-mono" placeholder="255.255.255.0" />
                </div>
                <div>
                  <label className="label">Gateway</label>
                  <input value={gateway} onChange={e => setGateway(e.target.value)} className="input font-mono" placeholder="192.168.1.254" />
                </div>
                <div>
                  <label className="label">DNS Primário</label>
                  <input value={dnsPrimary} onChange={e => setDnsPrimary(e.target.value)} className="input font-mono" placeholder="8.8.8.8" />
                </div>
                <div>
                  <label className="label">DNS Secundário</label>
                  <input value={dnsSecondary} onChange={e => setDnsSecondary(e.target.value)} className="input font-mono" placeholder="8.8.4.4" />
                </div>
                <div>
                  <label className="label">IP Loopback</label>
                  <input value={loopbackIp} onChange={e => setLoopbackIp(e.target.value)} className="input font-mono" placeholder="10.0.0.1" />
                </div>
                <div>
                  <label className="label">Versão Firmware</label>
                  <input value={firmwareVersion} onChange={e => setFirmwareVersion(e.target.value)} className="input" placeholder="V800R021C10" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Notas / Observações</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input resize-none" rows={3} placeholder="Observações sobre o dispositivo..." />
                </div>
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-dark-700">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={mutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {mutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
              ) : isEdit ? 'Salvar Alterações' : 'Cadastrar Dispositivo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
