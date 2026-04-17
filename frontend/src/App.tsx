import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Layout from './components/layout/Layout'
import ErrorBoundary from './components/common/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import DevicesPage from './pages/DevicesPage'
import DeviceDetailPage from './pages/DeviceDetailPage'
import TerminalPage from './pages/TerminalPage'
import VpnPage from './pages/VpnPage'
import SettingsPage from './pages/SettingsPage'
import UsersPage from './pages/UsersPage'
import AuditPage from './pages/AuditPage'
import BackupPage from './pages/BackupPage'
import ClientsPage from './pages/ClientsPage'
import VendorsPage from './pages/VendorsPage'
import AutomationPage from './pages/AutomationPage'
import PlaybooksPage from './pages/PlaybooksPage'
import AIAnalysisPage from './pages/AIAnalysisPage'
import ClientNetworkPage from './pages/ClientNetworkPage'
import NetworkToolsPage from './pages/NetworkToolsPage'
import DeviceInspectorPage from './pages/DeviceInspectorPage'
import InspectorCommandsPage from './pages/InspectorCommandsPage'
import DeviceBackupPage from './pages/DeviceBackupPage'
import RpkiMonitorPage from './pages/RpkiMonitorPage'
import CgnatPage from './pages/CgnatPage'
import BlacklistMonitorPage from './pages/BlacklistMonitorPage'
import SnmpMonitorPage from './pages/SnmpMonitorPage'
import VulnScannerPage from './pages/VulnScannerPage'

// ─── Hydration Guard ──────────────────────────────────────────────────────────
//
// PROBLEMA: O Zustand/persist lê o localStorage de forma ASSÍNCRONA.
// Antes da hidratação completar, isAuthenticated=false mesmo que o token
// esteja salvo no localStorage. Isso causava um redirecionamento instantâneo
// para /login ao reabrir o navegador, antes mesmo do token ser lido.
//
// SOLUÇÃO: Aguardar _hydrated=true antes de renderizar qualquer rota protegida.
// Durante a hidratação, exibe um spinner mínimo para evitar flash de conteúdo.
//
// ─────────────────────────────────────────────────────────────────────────────

function HydrationLoader() {
  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-dark-500 text-sm">Carregando...</p>
      </div>
    </div>
  )
}

function PrivateRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, user, _hydrated } = useAuthStore()

  // Aguardar hidratação do Zustand antes de decidir redirecionar
  if (!_hydrated) {
    return <HydrationLoader />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, _hydrated } = useAuthStore()

  // Aguardar hidratação antes de redirecionar usuário já autenticado
  if (!_hydrated) {
    return <HydrationLoader />
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
        {/* Public Routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />

        {/* Protected Routes */}
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="client-network" element={<ClientNetworkPage />} />
          <Route path="network-tools" element={<NetworkToolsPage />} />
          <Route path="device-inspector" element={<DeviceInspectorPage />} />
          <Route path="inspector-commands" element={<InspectorCommandsPage />} />
          <Route path="vendors" element={<VendorsPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="devices/:id" element={<DeviceDetailPage />} />
          <Route path="devices/:id/terminal" element={<TerminalPage />} />
          <Route path="vpn" element={<VpnPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="device-backup" element={<DeviceBackupPage />} />
          <Route path="rpki-monitor" element={<RpkiMonitorPage />} />
          <Route path="cgnat" element={<CgnatPage />} />
          <Route path="blacklist-monitor" element={<BlacklistMonitorPage />} />
          <Route path="snmp-monitor" element={<SnmpMonitorPage />} />
          <Route path="vuln-scanner" element={<VulnScannerPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="playbooks" element={<PlaybooksPage />} />
          <Route path="ai-analysis" element={<AIAnalysisPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route
            path="users"
            element={
              <PrivateRoute roles={['admin']}>
                <UsersPage />
              </PrivateRoute>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
