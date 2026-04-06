import { NavLink, useNavigate } from 'react-router-dom'
import {
  Network, LayoutDashboard, Server, Shield,
  Users, ClipboardList, Settings, LogOut, X,
  HardDrive, Building2, Cpu, Terminal, BookOpen, Brain, Map, Wrench, Eye
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import toast from 'react-hot-toast'

interface SidebarProps {
  onClose?: () => void
}

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clients', icon: Building2, label: 'Clientes' },
  { to: '/client-network', icon: Map, label: 'Rede por Cliente' },
  { to: '/network-tools', icon: Wrench, label: 'Ferramentas' },
  { to: '/device-inspector', icon: Eye, label: 'Inspeção' },
  { to: '/devices', icon: Server, label: 'Dispositivos' },
  { to: '/vendors', icon: Cpu, label: 'Vendors' },
  { to: '/vpn', icon: Shield, label: 'VPN & Rotas' },
  { to: '/backup', icon: HardDrive, label: 'Backup' },
  { to: '/automation', icon: Terminal, label: 'Automações' },
  { to: '/playbooks', icon: BookOpen, label: 'Playbooks' },
  { to: '/ai-analysis', icon: Brain, label: 'Análise de IA' },
]

const adminItems = [
  { to: '/users', icon: Users, label: 'Usuários' },
  { to: '/audit', icon: ClipboardList, label: 'Auditoria' },
]

export default function Sidebar({ onClose }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    toast.success('Sessão encerrada')
    navigate('/login')
  }

  return (
    <div className="w-64 h-full bg-dark-900 border-r border-dark-700 flex flex-col">
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-dark-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600/20 border border-brand-500/30 rounded-xl flex items-center justify-center">
            <Network className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <p className="font-bold text-white text-sm leading-tight">BR10</p>
            <p className="text-dark-500 text-xs">NetManager</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg lg:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-medium text-dark-600 uppercase tracking-wider px-3 mb-2">
          Principal
        </p>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              isActive ? 'nav-item-active' : 'nav-item'
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}

        {user?.role === 'admin' && (
          <>
            <p className="text-xs font-medium text-dark-600 uppercase tracking-wider px-3 mb-2 mt-4">
              Administração
            </p>
            {adminItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  isActive ? 'nav-item-active' : 'nav-item'
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </>
        )}

        <p className="text-xs font-medium text-dark-600 uppercase tracking-wider px-3 mb-2 mt-4">
          Sistema
        </p>
        <NavLink
          to="/settings"
          onClick={onClose}
          className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          <span>Configurações</span>
        </NavLink>
      </nav>

      {/* User Profile */}
      <div className="border-t border-dark-700 p-3">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg mb-2">
          <div className="w-8 h-8 bg-brand-600/30 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-brand-300 text-sm font-semibold">
              {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-dark-500 capitalize">{user?.role}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="nav-item w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
        >
          <LogOut className="w-4 h-4" />
          <span>Sair</span>
        </button>
      </div>
    </div>
  )
}
