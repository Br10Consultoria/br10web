import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Settings, Shield, Key, User, Smartphone, CheckCircle,
  Loader2, Eye, EyeOff, Copy, Check, Bell, Send,
  ToggleLeft, ToggleRight, AlertTriangle, Server
} from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi, api } from '../utils/api'
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

// ─── Telegram / System Config ─────────────────────────────────────────────────

interface SysConfig {
  key: string
  value: string | null
  description: string | null
}

const TELEGRAM_KEYS = [
  'telegram_bot_token',
  'telegram_chat_id',
  'telegram_enabled',
  'telegram_alert_device_down',
  'telegram_alert_device_up',
  'telegram_alert_backup_ok',
  'telegram_alert_backup_fail',
  'telegram_alert_playbook_ok',
  'telegram_alert_playbook_fail',
]

const ALERT_LABELS: Record<string, string> = {
  telegram_alert_device_down:    'Dispositivo ficou offline',
  telegram_alert_device_up:      'Dispositivo voltou online',
  telegram_alert_backup_ok:      'Backup concluído com sucesso',
  telegram_alert_backup_fail:    'Falha no backup',
  telegram_alert_playbook_ok:    'Playbook executado com sucesso',
  telegram_alert_playbook_fail:  'Falha na execução de playbook',
}

function SystemTab() {
  const [configs, setConfigs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')

  useEffect(() => {
    loadConfigs()
  }, [])

  const loadConfigs = async () => {
    setLoading(true)
    try {
      const res = await api.get('/system-config/raw')
      const map: Record<string, string> = {}
      res.data.forEach((c: SysConfig) => { map[c.key] = c.value ?? '' })
      setConfigs(map)
      setToken(map['telegram_bot_token'] ?? '')
      setChatId(map['telegram_chat_id'] ?? '')
    } catch {
      toast.error('Erro ao carregar configurações do sistema')
    } finally {
      setLoading(false)
    }
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      const updated = { ...configs, telegram_bot_token: token, telegram_chat_id: chatId }
      const payload = Object.entries(updated).map(([key, value]) => ({ key, value }))
      await api.put('/system-config', { configs: payload })
      toast.success('Configurações salvas com sucesso!')
      setConfigs(updated)
    } catch {
      toast.error('Erro ao salvar configurações')
    } finally {
      setSaving(false)
    }
  }

  const toggleBool = (key: string) => {
    const current = configs[key] === 'true'
    setConfigs(prev => ({ ...prev, [key]: current ? 'false' : 'true' }))
  }

  const testTelegram = async () => {
    setTesting(true)
    try {
      // Salva primeiro para garantir que os valores mais recentes estão no banco
      const updated = { ...configs, telegram_bot_token: token, telegram_chat_id: chatId }
      const payload = Object.entries(updated).map(([key, value]) => ({ key, value }))
      await api.put('/system-config', { configs: payload })
      const res = await api.post('/system-config/telegram/test')
      if (res.data.success) {
        toast.success('Mensagem de teste enviada! Verifique seu Telegram.')
      } else {
        toast.error(res.data.message)
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Erro ao testar Telegram')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    )
  }

  const isEnabled = configs['telegram_enabled'] === 'true'

  return (
    <div className="space-y-6">
      {/* Telegram Integration */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Send className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="font-semibold text-dark-100">Integração Telegram</h2>
            <p className="text-xs text-dark-400">Alertas automáticos via Bot Telegram</p>
          </div>
          <button
            onClick={() => toggleBool('telegram_enabled')}
            className="ml-auto flex items-center gap-2 text-sm"
          >
            {isEnabled
              ? <><ToggleRight className="w-6 h-6 text-green-400" /><span className="text-green-400">Ativo</span></>
              : <><ToggleLeft className="w-6 h-6 text-dark-400" /><span className="text-dark-400">Inativo</span></>
            }
          </button>
        </div>

        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 text-sm text-dark-300 space-y-1">
          <p className="font-medium text-blue-400">Como configurar:</p>
          <p>1. Crie um bot no Telegram via <strong>@BotFather</strong> e copie o token.</p>
          <p>2. Inicie uma conversa com o bot e use <strong>@userinfobot</strong> para obter seu Chat ID.</p>
          <p>3. Cole os valores abaixo, salve e clique em "Testar".</p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label">Token do Bot</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"
                className="input pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Chat ID</label>
            <input
              type="text"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="-1001234567890 ou 123456789"
              className="input font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={saveAll}
            disabled={saving}
            className="btn btn-primary flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvar Configurações
          </button>
          <button
            onClick={testTelegram}
            disabled={testing || !token || !chatId}
            className="btn btn-secondary flex items-center gap-2"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Testar Telegram
          </button>
        </div>
      </div>

      {/* Alert Toggles */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-yellow-500/10 rounded-lg">
            <Bell className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h2 className="font-semibold text-dark-100">Alertas Configurados</h2>
            <p className="text-xs text-dark-400">Escolha quais eventos geram notificação</p>
          </div>
        </div>

        <div className="divide-y divide-dark-700">
          {Object.entries(ALERT_LABELS).map(([key, label]) => {
            const isOn = configs[key] === 'true'
            return (
              <div key={key} className="flex items-center justify-between py-3">
                <span className="text-sm text-dark-200">{label}</span>
                <button
                  onClick={() => toggleBool(key)}
                  className="flex items-center gap-1.5 text-sm"
                >
                  {isOn
                    ? <><ToggleRight className="w-5 h-5 text-green-400" /><span className="text-green-400 text-xs">Sim</span></>
                    : <><ToggleLeft className="w-5 h-5 text-dark-500" /><span className="text-dark-500 text-xs">Não</span></>
                  }
                </button>
              </div>
            )
          })}
        </div>

        <button
          onClick={saveAll}
          disabled={saving}
          className="btn btn-primary flex items-center gap-2 w-full justify-center"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salvar Alertas
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, updateUser } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | '2fa' | 'system'>('profile')
  const [showCurrentPwd, setShowCurrentPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [isChangingPwd, setIsChangingPwd] = useState(false)
  const [setup2FAData, setSetup2FAData] = useState<{ qr_code_base64: string; secret: string; provisioning_uri: string } | null>(null)
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
    { id: 'profile'  as const, label: 'Perfil',           icon: User },
    { id: 'security' as const, label: 'Segurança',         icon: Key },
    { id: '2fa'      as const, label: 'Autenticação 2FA',  icon: Smartphone },
    { id: 'system'   as const, label: 'Sistema',           icon: Server },
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="text-dark-400 text-sm mt-1">Gerencie seu perfil, segurança e integrações do sistema</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-700">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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

      {/* System Tab */}
      {activeTab === 'system' && <SystemTab />}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="card p-6 space-y-6">
          <h2 className="font-semibold text-dark-100">Informações do Perfil</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Nome de usuário</label>
              <input value={user?.username || ''} disabled className="input opacity-60" />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input value={user?.email || ''} disabled className="input opacity-60" />
            </div>
          </div>
          <div>
            <label className="label">Função</label>
            <input value={user?.role || ''} disabled className="input opacity-60 capitalize" />
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="card p-6 space-y-6">
          <h2 className="font-semibold text-dark-100">Alterar Senha</h2>
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-4">
            <div>
              <label className="label">Senha Atual</label>
              <div className="relative">
                <input
                  type={showCurrentPwd ? 'text' : 'password'}
                  {...register('current_password')}
                  className="input pr-10"
                />
                <button type="button" onClick={() => setShowCurrentPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400">
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.current_password && <p className="text-xs text-red-400 mt-1">{errors.current_password.message}</p>}
            </div>
            <div>
              <label className="label">Nova Senha</label>
              <div className="relative">
                <input
                  type={showNewPwd ? 'text' : 'password'}
                  {...register('new_password')}
                  className="input pr-10"
                />
                <button type="button" onClick={() => setShowNewPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.new_password && <p className="text-xs text-red-400 mt-1">{errors.new_password.message}</p>}
            </div>
            <div>
              <label className="label">Confirmar Nova Senha</label>
              <input type="password" {...register('confirm_password')} className="input" />
              {errors.confirm_password && <p className="text-xs text-red-400 mt-1">{errors.confirm_password.message}</p>}
            </div>
            <button type="submit" disabled={isChangingPwd} className="btn btn-primary flex items-center gap-2">
              {isChangingPwd ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Alterar Senha
            </button>
          </form>
        </div>
      )}

      {/* 2FA Tab */}
      {activeTab === '2fa' && (
        <div className="card p-6 space-y-6">
          <h2 className="font-semibold text-dark-100">Autenticação em Dois Fatores (2FA)</h2>
          {!user?.totp_enabled ? (
            <div className="space-y-4">
              {!setup2FAData ? (
                <div className="space-y-4">
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                    <p className="text-sm text-yellow-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      2FA não está ativo. Recomendamos ativar para maior segurança.
                    </p>
                  </div>
                  <button onClick={handleSetup2FA} disabled={is2FALoading} className="btn btn-primary flex items-center gap-2">
                    {is2FALoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                    Configurar 2FA
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="text-sm text-dark-300 mb-4">Escaneie o QR Code com seu aplicativo autenticador:</p>
                    <div className="inline-block bg-white p-4 rounded-xl">
                      <img src={setup2FAData.qr_code_base64} alt="QR Code 2FA" className="w-48 h-48" />
                    </div>
                  </div>
                  <div className="bg-dark-700 rounded-lg p-3">
                    <p className="text-xs text-dark-400 mb-1">Ou insira a chave manualmente:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-brand-400 flex-1 break-all">{setup2FAData.secret}</code>
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
                  <button onClick={handleVerify2FA} disabled={is2FALoading || totpCode.length !== 6} className="btn btn-primary w-full">
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
                  <button onClick={handleDisable2FA} disabled={is2FALoading || totpCode.length !== 6} className="btn btn-danger">
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
