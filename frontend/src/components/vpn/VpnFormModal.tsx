import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { X, Shield, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { vpnApi } from '../../utils/api'

interface Props {
  deviceId: string
  vpn?: any
  onClose: () => void
  onSuccess: () => void
}

export default function VpnFormModal({ deviceId, vpn, onClose, onSuccess }: Props) {
  const isEdit = !!vpn
  const { register, handleSubmit, watch } = useForm({
    defaultValues: vpn ? {
      name: vpn.name,
      description: vpn.description || '',
      vpn_type: vpn.vpn_type,
      server_ip: vpn.server_ip,
      server_port: vpn.server_port || 1701,
      username: vpn.username || '',
      password: '',
      preshared_key: '',
      local_ip: vpn.local_ip || '',
      remote_ip: vpn.remote_ip || '',
      local_subnet: vpn.local_subnet || '',
      remote_subnet: vpn.remote_subnet || '',
      tunnel_ip: vpn.tunnel_ip || '',
      authentication_type: vpn.authentication_type || 'chap',
      mtu: vpn.mtu || 1460,
      mru: vpn.mru || 1460,
      ipsec_enabled: vpn.ipsec_enabled || false,
      ipsec_encryption: vpn.ipsec_encryption || 'aes256',
      ipsec_hash: vpn.ipsec_hash || 'sha256',
      ipsec_dh_group: vpn.ipsec_dh_group || 'modp2048',
      auto_reconnect: vpn.auto_reconnect !== false,
      keepalive_interval: vpn.keepalive_interval || 60,
    } : {
      vpn_type: 'l2tp',
      server_port: 1701,
      authentication_type: 'chap',
      mtu: 1460,
      mru: 1460,
      ipsec_enabled: false,
      ipsec_encryption: 'aes256',
      ipsec_hash: 'sha256',
      ipsec_dh_group: 'modp2048',
      auto_reconnect: true,
      keepalive_interval: 60,
    },
  })

  const ipsecEnabled = watch('ipsec_enabled')

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit ? vpnApi.update(deviceId, vpn.id, data) : vpnApi.create(deviceId, data),
    onSuccess: () => {
      toast.success(isEdit ? 'VPN atualizada!' : 'VPN criada!')
      onSuccess()
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Erro ao salvar VPN'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-800 border border-dark-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 sticky top-0 bg-dark-800">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-purple-400" />
            <h2 className="font-semibold text-white">{isEdit ? 'Editar VPN' : 'Nova VPN L2TP'}</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <form
          onSubmit={e => { e.preventDefault(); e.stopPropagation(); handleSubmit(d => mutation.mutate(d))(e) }}
          className="p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nome da Conexão *</label>
              <input {...register('name', { required: true })} className="input" placeholder="VPN-Cliente-SP01" />
            </div>
            <div>
              <label className="label">Tipo VPN</label>
              <select {...register('vpn_type')} className="input">
                <option value="l2tp">L2TP</option>
                <option value="l2tp_ipsec">L2TP/IPSec</option>
                <option value="pptp">PPTP</option>
                <option value="ipsec">IPSec</option>
              </select>
            </div>
            <div>
              <label className="label">Autenticação</label>
              <select {...register('authentication_type')} className="input">
                <option value="chap">CHAP</option>
                <option value="pap">PAP</option>
                <option value="mschapv2">MS-CHAPv2</option>
              </select>
            </div>
            <div>
              <label className="label">IP do Servidor *</label>
              <input {...register('server_ip', { required: true })} className="input font-mono" placeholder="203.0.113.1" />
            </div>
            <div>
              <label className="label">Porta</label>
              <input {...register('server_port', { valueAsNumber: true })} type="number" className="input font-mono" />
            </div>
            <div>
              <label className="label">Usuário</label>
              <input {...register('username')} className="input" placeholder="vpnuser" />
            </div>
            <div>
              <label className="label">Senha</label>
              <input {...register('password')} type="password" className="input" placeholder={isEdit ? '(manter atual)' : 'senha'} />
            </div>
            <div>
              <label className="label">Chave Pré-Compartilhada (PSK)</label>
              <input {...register('preshared_key')} type="password" className="input" placeholder="psk-secret" />
            </div>
            <div>
              <label className="label">IP Local (Túnel)</label>
              <input {...register('local_ip')} className="input font-mono" placeholder="10.0.0.1" />
            </div>
            <div>
              <label className="label">IP Remoto (Túnel)</label>
              <input {...register('remote_ip')} className="input font-mono" placeholder="10.0.0.2" />
            </div>
            <div>
              <label className="label">Sub-rede Local</label>
              <input {...register('local_subnet')} className="input font-mono" placeholder="192.168.1.0/24" />
            </div>
            <div>
              <label className="label">Sub-rede Remota</label>
              <input {...register('remote_subnet')} className="input font-mono" placeholder="192.168.2.0/24" />
            </div>
            <div>
              <label className="label">MTU</label>
              <input {...register('mtu', { valueAsNumber: true })} type="number" className="input" />
            </div>
            <div>
              <label className="label">MRU</label>
              <input {...register('mru', { valueAsNumber: true })} type="number" className="input" />
            </div>
            <div>
              <label className="label">Keepalive (segundos)</label>
              <input {...register('keepalive_interval', { valueAsNumber: true })} type="number" className="input" />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input {...register('ipsec_enabled')} type="checkbox" id="ipsec" className="w-4 h-4 rounded" />
              <label htmlFor="ipsec" className="text-sm text-dark-300">Habilitar IPSec</label>
            </div>
          </div>

          {ipsecEnabled && (
            <div className="bg-dark-900 border border-purple-500/30 rounded-xl p-4">
              <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">Configurações IPSec</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Criptografia</label>
                  <select {...register('ipsec_encryption')} className="input">
                    <option value="aes128">AES-128</option>
                    <option value="aes256">AES-256</option>
                    <option value="3des">3DES</option>
                  </select>
                </div>
                <div>
                  <label className="label">Hash</label>
                  <select {...register('ipsec_hash')} className="input">
                    <option value="sha256">SHA-256</option>
                    <option value="sha512">SHA-512</option>
                    <option value="md5">MD5</option>
                  </select>
                </div>
                <div>
                  <label className="label">Grupo DH</label>
                  <select {...register('ipsec_dh_group')} className="input">
                    <option value="modp1024">Group 2 (1024)</option>
                    <option value="modp2048">Group 14 (2048)</option>
                    <option value="modp4096">Group 16 (4096)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="label">Descrição</label>
            <textarea {...register('description')} className="input resize-none" rows={2} placeholder="Descrição da conexão VPN..." />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Salvar' : 'Criar VPN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
