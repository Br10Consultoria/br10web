import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HardDrive, Download, RefreshCw, Plus, Trash2, CheckCircle, Clock, Database } from 'lucide-react'
import toast from 'react-hot-toast'
import { backupApi } from '../utils/api'
import { useAuthStore } from '../store/authStore'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export default function BackupPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'

  const { data: backups = [], isLoading, refetch } = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupApi.list().then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => backupApi.create(),
    onSuccess: () => {
      toast.success('Backup criado com sucesso!')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: () => toast.error('Erro ao criar backup'),
  })

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => backupApi.delete(filename),
    onSuccess: () => {
      toast.success('Backup removido')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: () => toast.error('Erro ao remover backup'),
  })

  const restoreMutation = useMutation({
    mutationFn: (filename: string) => backupApi.restore(filename),
    onSuccess: () => toast.success('Backup restaurado com sucesso!'),
    onError: () => toast.error('Erro ao restaurar backup'),
  })

  const handleDelete = (filename: string) => {
    if (confirm(`Remover backup "${filename}"?`)) {
      deleteMutation.mutate(filename)
    }
  }

  const handleRestore = (filename: string) => {
    if (confirm(`ATENÇÃO: Restaurar o backup "${filename}" irá sobrescrever todos os dados atuais. Deseja continuar?`)) {
      restoreMutation.mutate(filename)
    }
  }

  const totalSize = backups.reduce((acc: number, b: any) => acc + (b.size || 0), 0)

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Backup e Restauração</h1>
          <p className="text-dark-400 text-sm">Backups automáticos diários às 02:00</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-secondary">
            <RefreshCw className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="btn-primary">
              {createMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Backup Manual
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        {[
          { icon: HardDrive, label: 'Total de Backups', value: String(backups.length), color: 'bg-brand-600/20 text-brand-400' },
          { icon: CheckCircle, label: 'Último Backup', value: backups[0] ? new Date(backups[0].created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Nunca', color: 'bg-green-500/20 text-green-400' },
          { icon: Clock, label: 'Retenção', value: '30 dias', color: 'bg-yellow-500/20 text-yellow-400' },
          { icon: Database, label: 'Espaço Total', value: formatBytes(totalSize), color: 'bg-purple-500/20 text-purple-400' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="card">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-sm text-dark-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="font-semibold text-white mb-4">Histórico de Backups</h3>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-dark-700 rounded animate-pulse" />)}
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-10 text-dark-500">
            <Database className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">Nenhum backup disponível</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Tamanho</th>
                  <th>Data</th>
                  <th>Status</th>
                  {isAdmin && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {backups.map((b: any) => (
                  <tr key={b.filename}>
                    <td className="font-mono text-sm text-dark-300">{b.filename}</td>
                    <td className="text-dark-400">{formatBytes(b.size)}</td>
                    <td className="text-dark-400">{new Date(b.created_at).toLocaleString('pt-BR')}</td>
                    <td><span className="badge-online"><CheckCircle className="w-3 h-3" />OK</span></td>
                    {isAdmin && (
                      <td>
                        <div className="flex gap-1">
                          <a
                            href={`/api/v1/backup/download/${b.filename}`}
                            download
                            className="btn-secondary btn-sm"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button
                            onClick={() => handleRestore(b.filename)}
                            disabled={restoreMutation.isPending}
                            className="btn-secondary btn-sm text-yellow-400 hover:bg-yellow-500/10"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(b.filename)}
                            disabled={deleteMutation.isPending}
                            className="btn-ghost btn-sm text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
