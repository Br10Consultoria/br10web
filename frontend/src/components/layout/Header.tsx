import { Menu, Search, Bell, User } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuthStore()

  return (
    <header className="h-16 bg-dark-900 border-b border-dark-700 flex items-center justify-between px-4 md:px-6 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="btn-ghost p-2 rounded-lg lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search */}
        <div className="hidden md:flex items-center gap-2 bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 w-80 focus-within:border-brand-500/50 transition-colors">
          <Search className="w-4 h-4 text-dark-500" />
          <input
            type="text"
            placeholder="Buscar dispositivos, IPs..."
            className="bg-transparent border-none outline-none text-sm text-dark-200 placeholder-dark-500 w-full"
          />
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button className="btn-ghost p-2 rounded-lg relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-dark-800 cursor-pointer">
          <div className="w-7 h-7 bg-brand-600/30 rounded-full flex items-center justify-center">
            <span className="text-brand-300 text-xs font-semibold">
              {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-white leading-tight">{user?.full_name}</p>
            <p className="text-xs text-dark-500 capitalize">{user?.role}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
