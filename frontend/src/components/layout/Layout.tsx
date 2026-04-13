import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Encerra a sessão automaticamente após 5 minutos de inatividade
  useInactivityTimeout()

  return (
    <div className="flex h-screen bg-dark-950 overflow-hidden">
      {/* Sidebar Desktop */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar />
      </div>

      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Mobile */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 lg:hidden transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
