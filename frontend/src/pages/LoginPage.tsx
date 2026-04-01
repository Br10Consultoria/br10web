import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, Eye, EyeOff, Loader2, Network, Lock, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '../utils/api'
import { useAuthStore } from '../store/authStore'

const loginSchema = z.object({
  username: z.string().min(3, 'Usuário obrigatório'),
  password: z.string().min(8, 'Senha obrigatória'),
  totp_code: z.string().optional(),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [requires2FA, setRequires2FA] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true)
    try {
      const response = await authApi.login(data)
      const result = response.data

      if (result.requires_2fa && !data.totp_code) {
        setRequires2FA(true)
        setIsLoading(false)
        return
      }

      // Buscar dados do usuário
      const meResponse = await authApi.me()
      setAuth(meResponse.data, result.access_token, result.refresh_token)
      toast.success(`Bem-vindo, ${meResponse.data.full_name}!`)
      navigate('/dashboard')
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Erro ao fazer login'
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      {/* Background gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-brand-800/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600/20 border border-brand-500/30 rounded-2xl mb-4">
            <Network className="w-8 h-8 text-brand-400" />
          </div>
          <h1 className="text-3xl font-bold text-white">BR10 NetManager</h1>
          <p className="text-dark-400 mt-2 text-sm">Sistema de Gerenciamento de Rede</p>
        </div>

        {/* Card */}
        <div className="card border-dark-700/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-6">
            <Shield className="w-5 h-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-white">
              {requires2FA ? 'Verificação em Dois Fatores' : 'Acesso Seguro'}
            </h2>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <AnimatePresence mode="wait">
              {!requires2FA ? (
                <motion.div
                  key="credentials"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4"
                >
                  {/* Username */}
                  <div>
                    <label className="label">Usuário</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                      <input
                        {...register('username')}
                        type="text"
                        placeholder="seu.usuario"
                        className={`input pl-10 ${errors.username ? 'input-error' : ''}`}
                        autoComplete="username"
                      />
                    </div>
                    {errors.username && (
                      <p className="text-red-400 text-xs mt-1">{errors.username.message}</p>
                    )}
                  </div>

                  {/* Password */}
                  <div>
                    <label className="label">Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                      <input
                        {...register('password')}
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••••••"
                        className={`input pl-10 pr-10 ${errors.password ? 'input-error' : ''}`}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="2fa"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="bg-brand-600/10 border border-brand-500/30 rounded-lg p-4 text-center">
                    <Shield className="w-8 h-8 text-brand-400 mx-auto mb-2" />
                    <p className="text-sm text-dark-300">
                      Insira o código de 6 dígitos do seu aplicativo autenticador
                    </p>
                  </div>
                  <div>
                    <label className="label">Código 2FA</label>
                    <input
                      {...register('totp_code')}
                      type="text"
                      placeholder="000000"
                      maxLength={6}
                      className="input text-center text-2xl tracking-widest font-mono"
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setRequires2FA(false)}
                    className="text-sm text-dark-400 hover:text-dark-200 w-full text-center"
                  >
                    Voltar ao login
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full btn-lg"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : requires2FA ? (
                <>
                  <Shield className="w-5 h-5" />
                  Verificar Código
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5" />
                  Entrar
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-dark-600 text-xs mt-6">
          BR10 Consultoria &copy; {new Date().getFullYear()} &mdash; Acesso Seguro com TLS + 2FA
        </p>
      </motion.div>
    </div>
  )
}
