import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Settings, Shield, Key, User, Smartphone, CheckCircle,
  Loader2, Eye, EyeOff, QrCode, Copy, Check
} from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '../utils/api'
import { useAuthStore } from '../store/authStore'

const passwordSchema = z.object({
  current_password: z.string().min(1, 'Senha atual obrigatória'),
  new_password: z.string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Deve conter letra maiúscula')
    .regex(/[0-9]/, 'Deve conter número')
    .regex(/[^A-Za-z0-9]/, 'Deve conter caractere especial'),
  confirm_password: z.string(),
}).refine(d => d.new_password === d.confirm_password, {
  message: 'Senhas não coincidem',
  path: ['confirm_password'],
})

type PasswordForm = z.infer<typeof passwordSchema>

export default function SettingsPage() {
  const { user, updateUser } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | '2fa'>('profile')
  const [showCurrentPwd, setShowCurrentPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [isChangingPwd, setIsChangingPwd] = useState(false)
  const [setup2FAData, setSetup2FAData] = useState<{ qr_code: string; secret: string } | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [is2FALoading, setIs2FALoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  })

  const onChangePassword = async (data: PasswordForm) => {
    setIsChangingPwd(true)
    try {
      await authApi.changePassword(data)
      toast.success('Senha alterada com sucesso!')
      reset()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao alterar senha')
    } finally {
      setIsChangingPwd(false)
    }
  }

  const handleSetup2FA = async () => {
    setIs2FALoading(true)
    try {
      const res = await authApi.setup2fa()
      setSetup2FAData(res.data)
    } catch {
      toast.error('Erro ao configurar 2FA')
    } finally {
      setIs2FALoading(false)
    }
  }

  const handleVerify2FA = async () => {
    if (!totpCode || totpCode.length !== 6) {
      toast.error('Insira o código de 6 dígitos')
      return
    }
    setIs2FALoading(true)
    try {
      await authApi.verify2fa(totpCode)
      toast.success('2FA ativado com sucesso!')
      updateUser({ totp_enabled: true })
      setSetup2FAData(null)
      setTotpCode('')
    } catch {
      toast.error('Código inválido')
    } finally {
      setIs2FALoading(false)
    }
  }

  const handleDisable2FA = async () => {
    if (!totpCode || totpCode.length !== 6) {
      toast.error('Insira o código de 6 dígitos para desativar')
      return
    }
    setIs2FALoading(true)
    try {
      await authApi.disable2fa(totpCode)
      toast.success('2FA desativado')
      updateUser({ totp_enabled: false })
      setTotpCode('')
    } catch {
      toast.error('Código inválido')
    } finally {
      setIs2FALoading(false)
    }
  }

  const copySecret = () => {
    if (setup2FAData?.secret) {
      navigator.clipboard.writeText(setup2FAData.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const tabs = [
    { id: 'profile' as const, label: 'Perfil', icon: User },
    { id: 'security' as const, label: 'Segurança', icon: Key },
    { id: '2fa' as const, label: 'Autenticação 2FA', icon: Smartphone },
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="text-dark-400 text-sm mt-1">Gerencie seu perfil e segurança</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700">
        <nav className="flex gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-dark-400 hover:text-dark-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="card p-6 space-y-6">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <User className="w-4 h-4 text-brand-400" />
            Informações do Perfil
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Nome de Usuário', value: user?.username },
              { label: 'Nome Completo', value: user?.full_name },
              { label: 'E-mail', value: user?.email },
              { label: 'Função', value: user?.role === 'admin' ? 'Administrador' : user?.role === 'technician' ? 'Técnico' : 'Visualizador' },
              { label: 'Status 2FA', value: user?.totp_enabled ? 'Ativado' : 'Desativado' },
              { label: 'Último Login', value: user?.last_login ? new Date(user.last_login).toLocaleString('pt-BR') : '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-dark-500 uppercase tracking-wide">{label}</p>
                <p className="text-sm text-dark-200 font-medium mt-0.5">{value || '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="card p-6">
          <h3 className="font-semibold text-white flex items-center gap-2 mb-6">
            <Key className="w-4 h-4 text-brand-400" />
            Alterar Senha
          </h3>
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-4">
            <div>
              <label className="label">Senha Atual</label>
              <div className="relative">
                <input
                  {...register('current_password')}
                  type={showCurrentPwd ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500"
                >
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.current_password && (
                <p className="text-red-400 text-xs mt-1">{errors.current_password.message}</p>
              )}
            </div>

            <div>
              <label className="label">Nova Senha</label>
              <div className="relative">
                <input
                  {...register('new_password')}
                  type={showNewPwd ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Mínimo 8 chars, maiúscula, número, especial"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500"
                >
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.new_password && (
                <p className="text-red-400 text-xs mt-1">{errors.new_password.message}</p>
              )}
            </div>

            <div>
              <label className="label">Confirmar Nova Senha</label>
              <input
                {...register('confirm_password')}
                type="password"
                className="input"
                placeholder="••••••••"
              />
              {errors.confirm_password && (
                <p className="text-red-400 text-xs mt-1">{errors.confirm_password.message}</p>
              )}
            </div>

            <button type="submit" disabled={isChangingPwd} className="btn btn-primary w-full">
              {isChangingPwd ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Alterar Senha'}
            </button>
          </form>
        </div>
      )}

      {/* 2FA Tab */}
      {activeTab === '2fa' && (
        <div className="card p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-brand-400" />
              Autenticação em Dois Fatores (TOTP)
            </h3>
            {user?.totp_enabled && (
              <span className="badge badge-success flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Ativado
              </span>
            )}
          </div>

          <div className="bg-dark-700/50 rounded-lg p-4 text-sm text-dark-300">
            <p className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" />
              O 2FA adiciona uma camada extra de segurança. Use aplicativos como Google Authenticator,
              Authy ou Microsoft Authenticator para gerar os códigos TOTP.
            </p>
          </div>

          {!user?.totp_enabled ? (
            <div className="space-y-4">
              {!setup2FAData ? (
                <button
                  onClick={handleSetup2FA}
                  disabled={is2FALoading}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {is2FALoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                  Configurar 2FA
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="text-sm text-dark-300 mb-4">
                      Escaneie o QR Code com seu aplicativo autenticador:
                    </p>
                    <div className="inline-block bg-white p-4 rounded-xl">
                      <img src={setup2FAData.qr_code} alt="QR Code 2FA" className="w-48 h-48" />
                    </div>
                  </div>

                  <div className="bg-dark-700 rounded-lg p-3">
                    <p className="text-xs text-dark-400 mb-1">Ou insira a chave manualmente:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-brand-400 flex-1 break-all">
                        {setup2FAData.secret}
                      </code>
                      <button onClick={copySecret} className="p-1.5 hover:bg-dark-600 rounded">
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-dark-400" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="label">Código de Verificação</label>
                    <input
                      type="text"
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      className="input text-center text-2xl tracking-widest font-mono"
                    />
                  </div>

                  <button
                    onClick={handleVerify2FA}
                    disabled={is2FALoading || totpCode.length !== 6}
                    className="btn btn-primary w-full"
                  >
                    {is2FALoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar e Ativar 2FA'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p className="text-sm text-green-400 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  2FA está ativo. Seu acesso está protegido com autenticação em dois fatores.
                </p>
              </div>

              <div className="border-t border-dark-700 pt-4">
                <p className="text-sm text-dark-400 mb-3">Para desativar o 2FA, insira um código válido:</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    className="input text-center font-mono tracking-widest flex-1"
                  />
                  <button
                    onClick={handleDisable2FA}
                    disabled={is2FALoading || totpCode.length !== 6}
                    className="btn btn-danger"
                  >
                    {is2FALoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Desativar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
