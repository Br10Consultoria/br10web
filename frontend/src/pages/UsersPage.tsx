import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Edit2, Trash2, Shield, ShieldCheck,
  Eye, EyeOff, Key, RefreshCw, Building2, CheckSquare, Square,
  X, Save, UserCheck, UserX, Settings, Filter, AlertTriangle
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Permission {
  module: string;
  access_level: 'view' | 'execute' | 'edit' | 'manage';
}

interface UserDetail {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  phone?: string;
  is_active: boolean;
  is_verified: boolean;
  totp_enabled: boolean;
  last_login?: string;
  last_login_ip?: string;
  created_at: string;
  is_full_access: boolean;
  permissions: Permission[];
  client_scope_ids: string[];
  client_scope_names: string[];
}

interface Client {
  id: string;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_GROUPS: Record<string, string[]> = {
  'Infraestrutura': ['clients', 'devices', 'device_backup', 'terminal'],
  'Ferramentas': ['rpki_monitor', 'cgnat', 'vpn', 'playbooks', 'ai_analysis'],
  'Sistema': ['backup', 'audit', 'users'],
};

const LEVEL_COLORS: Record<string, string> = {
  view:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  execute: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  edit:    'bg-green-500/20 text-green-300 border-green-500/30',
  manage:  'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

const LEVEL_LABELS: Record<string, string> = {
  view:    'Visualizar',
  execute: 'Executar',
  edit:    'Editar',
  manage:  'Gerenciar',
};

const MODULE_LABELS: Record<string, string> = {
  clients:       'Clientes / Fornecedores',
  devices:       'Dispositivos',
  device_backup: 'Backup de Dispositivos',
  terminal:      'Terminal SSH/Telnet',
  rpki_monitor:  'Monitor RPKI',
  cgnat:         'Gerador CGNAT',
  vpn:           'VPN L2TP',
  playbooks:     'Automação / Playbooks',
  ai_analysis:   'Análise com IA',
  backup:        'Backup do Sistema',
  audit:         'Log de Auditoria',
  users:         'Gerenciamento de Usuários',
};

// ─── API ──────────────────────────────────────────────────────────────────────

const API = '/api/v1';

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = (useAuthStore.getState() as any).accessToken;
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Erro na requisição');
  }
  return res.json();
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    green:  'bg-green-500/20 text-green-300 border border-green-500/30',
    red:    'bg-red-500/20 text-red-300 border border-red-500/30',
    blue:   'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
    purple: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
    gray:   'bg-gray-500/20 text-gray-300 border border-gray-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
}

// ─── Permission Matrix ────────────────────────────────────────────────────────

function PermissionMatrix({ permissions, onChange }: {
  permissions: Permission[];
  onChange: (perms: Permission[]) => void;
}) {
  const levels = ['view', 'execute', 'edit', 'manage'];

  const getLevel = (module: string) =>
    permissions.find(p => p.module === module)?.access_level || null;

  const setLevel = (module: string, level: string | null) => {
    if (level === null) {
      onChange(permissions.filter(p => p.module !== module));
    } else {
      const exists = permissions.find(p => p.module === module);
      if (exists) {
        onChange(permissions.map(p =>
          p.module === module ? { ...p, access_level: level as Permission['access_level'] } : p
        ));
      } else {
        onChange([...permissions, { module, access_level: level as Permission['access_level'] }]);
      }
    }
  };

  return (
    <div className="space-y-3">
      {Object.entries(MODULE_GROUPS).map(([group, modules]) => (
        <div key={group} className="bg-[#0d1117] rounded-lg border border-[#30363d] overflow-hidden">
          <div className="px-3 py-2 bg-[#161b22] border-b border-[#30363d]">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{group}</span>
          </div>
          <div className="divide-y divide-[#21262d]">
            {modules.map(module => {
              const currentLevel = getLevel(module);
              const isEnabled = currentLevel !== null;
              return (
                <div key={module} className={`flex items-center gap-3 px-3 py-2.5 ${isEnabled ? '' : 'opacity-50'}`}>
                  <button
                    type="button"
                    onClick={() => setLevel(module, isEnabled ? null : 'view')}
                    className={`flex-shrink-0 w-7 h-7 rounded flex items-center justify-center transition-colors ${
                      isEnabled ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-600'
                    }`}
                  >
                    {isEnabled ? <CheckSquare size={13} /> : <Square size={13} />}
                  </button>
                  <span className="flex-1 text-sm text-gray-300">{MODULE_LABELS[module] || module}</span>
                  {isEnabled && (
                    <div className="flex gap-1">
                      {levels.map(level => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setLevel(module, level)}
                          title={LEVEL_LABELS[level]}
                          className={`px-2 py-0.5 rounded text-xs font-medium border transition-all ${
                            currentLevel === level
                              ? LEVEL_COLORS[level]
                              : 'bg-transparent text-gray-600 border-gray-700 hover:border-gray-500 hover:text-gray-400'
                          }`}
                        >
                          {LEVEL_LABELS[level]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── User Form Modal ──────────────────────────────────────────────────────────

function UserFormModal({ user, clients, onSave, onClose }: {
  user?: UserDetail | null;
  clients: Client[];
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    full_name: user?.full_name || '',
    password: '',
    phone: user?.phone || '',
    is_active: user?.is_active ?? true,
    is_full_access: user?.is_full_access ?? false,
  });
  const [permissions, setPermissions] = useState<Permission[]>(user?.permissions || []);
  const [selectedClients, setSelectedClients] = useState<string[]>(user?.client_scope_ids || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit && !form.password) { setError('Senha é obrigatória para novos usuários'); return; }
    setLoading(true); setError('');
    try {
      await onSave({ ...form, permissions: form.is_full_access ? [] : permissions, client_scope_ids: selectedClients });
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const toggleClient = (id: string) =>
    setSelectedClients(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-3xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Users size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">
                {isEdit ? `Editar: ${user!.username}` : 'Novo Usuário'}
              </h2>
              <p className="text-xs text-gray-500">Defina dados, permissões e escopos de acesso</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertTriangle size={16} />{error}
            </div>
          )}

          {/* Dados básicos */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <Settings size={14} className="text-blue-400" />Dados do Usuário
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username *</label>
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  disabled={isEdit} required
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  placeholder="ex: joao.silva" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Nome Completo *</label>
                <input type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  required className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder="João Silva" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">E-mail *</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder="joao@empresa.com" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Telefone</label>
                <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder="(11) 99999-9999" />
              </div>
              {!isEdit && (
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Senha *</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required={!isEdit}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 pr-10 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                      placeholder="Mínimo 8 caracteres" />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">O usuário configurará o 2FA (TOTP) no primeiro login.</p>
                </div>
              )}
            </div>

            <div className="flex gap-4 mt-3">
              {isEdit && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-sm text-gray-300">Usuário ativo</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_full_access} onChange={e => setForm(f => ({ ...f, is_full_access: e.target.checked }))} className="w-4 h-4 rounded" />
                <span className="text-sm text-gray-300">
                  Acesso total (Admin) <span className="text-xs text-yellow-400">— ignora permissões abaixo</span>
                </span>
              </label>
            </div>
          </div>

          {/* Permissões */}
          {!form.is_full_access ? (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
                <Shield size={14} className="text-green-400" />Permissões por Módulo
                <span className="text-xs text-gray-500 font-normal">— selecione módulos e nível de acesso</span>
              </h3>
              <div className="flex gap-2 mb-3 flex-wrap">
                {Object.entries(LEVEL_LABELS).map(([level, label]) => (
                  <span key={level} className={`text-xs px-2 py-0.5 rounded border ${LEVEL_COLORS[level]}`}>{label}</span>
                ))}
              </div>
              <PermissionMatrix permissions={permissions} onChange={setPermissions} />
              <p className="text-xs text-gray-500 mt-2">Módulos não selecionados ficam completamente ocultos.</p>
            </div>
          ) : (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium mb-1">
                <ShieldCheck size={16} />Acesso Administrativo Total
              </div>
              <p className="text-xs text-gray-400">Acesso completo a todos os módulos e clientes.</p>
            </div>
          )}

          {/* Escopo de clientes */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-1 flex items-center gap-2">
              <Building2 size={14} className="text-purple-400" />Escopo de Clientes
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Sem seleção = acesso a <strong className="text-gray-400">todos os clientes</strong>. Selecione para restringir.
            </p>
            {clients.length === 0 ? (
              <p className="text-xs text-gray-500 italic">Nenhum cliente cadastrado.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                {clients.map(client => (
                  <label key={client.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                    selectedClients.includes(client.id)
                      ? 'bg-purple-500/10 border-purple-500/40 text-purple-300'
                      : 'bg-[#0d1117] border-[#30363d] text-gray-400 hover:border-gray-500'
                  }`}>
                    <input type="checkbox" checked={selectedClients.includes(client.id)} onChange={() => toggleClient(client.id)} className="w-3.5 h-3.5" />
                    <span className="text-xs truncate">{client.name}</span>
                  </label>
                ))}
              </div>
            )}
            {selectedClients.length > 0 && (
              <p className="text-xs text-purple-400 mt-2">{selectedClients.length} cliente(s) selecionado(s).</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-[#30363d]">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">Cancelar</button>
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {isEdit ? 'Salvar Alterações' : 'Criar Usuário'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── User Detail Modal ────────────────────────────────────────────────────────

function UserDetailModal({ user, onClose, onEdit, onResetTwoFA, onToggleActive }: {
  user: UserDetail; onClose: () => void; onEdit: () => void; onResetTwoFA: () => void; onToggleActive: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] sticky top-0 bg-[#161b22]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              {user.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">{user.full_name}</h2>
              <p className="text-xs text-gray-500">@{user.username} · {user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge color={user.is_active ? 'green' : 'red'}>{user.is_active ? '● Ativo' : '● Inativo'}</Badge>
            <Badge color={user.is_full_access ? 'yellow' : 'blue'}>{user.is_full_access ? '★ Admin Total' : user.role}</Badge>
            <Badge color={user.totp_enabled ? 'green' : 'red'}>{user.totp_enabled ? '🔐 2FA Ativo' : '⚠ 2FA Pendente'}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {user.phone && <div><p className="text-xs text-gray-500">Telefone</p><p className="text-gray-200">{user.phone}</p></div>}
            <div>
              <p className="text-xs text-gray-500">Último login</p>
              <p className="text-gray-200">{user.last_login ? new Date(user.last_login).toLocaleString('pt-BR') : 'Nunca'}</p>
            </div>
            {user.last_login_ip && <div><p className="text-xs text-gray-500">IP do último login</p><p className="text-gray-200">{user.last_login_ip}</p></div>}
          </div>

          {!user.is_full_access && (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
                <Shield size={14} className="text-green-400" />Permissões ({user.permissions.length} módulo(s))
              </h3>
              {user.permissions.length === 0 ? (
                <p className="text-xs text-gray-500 italic">Nenhuma permissão — acesso negado a todos os módulos.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {user.permissions.map(p => (
                    <div key={p.module} className="flex items-center gap-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg px-2.5 py-1.5">
                      <span className="text-xs text-gray-300">{MODULE_LABELS[p.module] || p.module}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${LEVEL_COLORS[p.access_level]}`}>{LEVEL_LABELS[p.access_level]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {user.is_full_access && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-xs text-yellow-400 flex items-center gap-2"><ShieldCheck size={14} />Acesso administrativo total — todos os módulos e clientes.</p>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <Building2 size={14} className="text-purple-400" />Escopo de Clientes
            </h3>
            {user.client_scope_ids.length === 0 ? (
              <p className="text-xs text-green-400">✓ Acesso a todos os clientes</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {user.client_scope_names.map((name, i) => <Badge key={i} color="purple">{name}</Badge>)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-[#30363d]">
            <button onClick={onEdit} className="flex items-center gap-2 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-sm transition-colors">
              <Edit2 size={14} />Editar
            </button>
            <button onClick={onToggleActive} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              user.is_active ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'
            }`}>
              {user.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
              {user.is_active ? 'Desativar' : 'Ativar'}
            </button>
            {user.totp_enabled && (
              <button onClick={onResetTwoFA} className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-sm transition-colors">
                <Key size={14} />Resetar 2FA
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [users, setUsers] = useState<UserDetail[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterTwoFA, setFilterTwoFA] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDetail | null>(null);
  const [detailUser, setDetailUser] = useState<UserDetail | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<UserDetail | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [usersData, clientsData] = await Promise.all([
        apiFetch('/users'),
        apiFetch('/clients'),
      ]);
      setUsers(usersData);
      setClients(clientsData.items || clientsData);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const showSuccess = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3500); };

  const handleSaveUser = async (data: any) => {
    if (editingUser) {
      await apiFetch(`/users/${editingUser.id}`, { method: 'PUT', body: JSON.stringify(data) });
      showSuccess(`Usuário ${editingUser.username} atualizado.`);
    } else {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(data) });
      showSuccess(`Usuário ${data.username} criado com sucesso.`);
    }
    setShowForm(false); setEditingUser(null); await loadData();
  };

  const handleDelete = async (user: UserDetail) => {
    setActionLoading(user.id);
    try {
      await apiFetch(`/users/${user.id}`, { method: 'DELETE' });
      showSuccess(`Usuário ${user.username} removido.`);
      setDeleteConfirm(null); await loadData();
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  };

  const handleToggleActive = async (user: UserDetail) => {
    setActionLoading(user.id);
    try {
      await apiFetch(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !user.is_active }) });
      showSuccess(`Usuário ${user.username} ${user.is_active ? 'desativado' : 'ativado'}.`);
      setDetailUser(null); await loadData();
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  };

  const handleResetTwoFA = async (user: UserDetail) => {
    setActionLoading(user.id);
    try {
      await apiFetch(`/users/${user.id}/reset-2fa`, { method: 'POST' });
      showSuccess(`2FA de ${user.username} resetado. O usuário deverá configurar novamente.`);
      setDetailUser(null); await loadData();
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(null); }
  };

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || (filterStatus === 'active' && u.is_active) || (filterStatus === 'inactive' && !u.is_active);
    const matchTwoFA = filterTwoFA === 'all' || (filterTwoFA === 'enabled' && u.totp_enabled) || (filterTwoFA === 'disabled' && !u.totp_enabled);
    return matchSearch && matchStatus && matchTwoFA;
  });

  const stats = {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    twofa: users.filter(u => u.totp_enabled).length,
    admins: users.filter(u => u.is_full_access).length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-3">
            <Users size={24} className="text-blue-400" />Gerenciamento de Usuários
          </h1>
          <p className="text-sm text-gray-500 mt-1">Controle de acesso granular por módulo com 2FA TOTP obrigatório</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-200 hover:bg-[#21262d] rounded-lg transition-colors" title="Atualizar">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setEditingUser(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
            <Plus size={16} />Novo Usuário
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-gray-300', Icon: Users },
          { label: 'Ativos', value: stats.active, color: 'text-green-400', Icon: UserCheck },
          { label: '2FA Ativo', value: stats.twofa, color: 'text-blue-400', Icon: Shield },
          { label: 'Admins', value: stats.admins, color: 'text-yellow-400', Icon: ShieldCheck },
        ].map(({ label, value, color, Icon }) => (
          <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold ${color}`}>{value}</p></div>
              <Icon size={20} className={`${color} opacity-60`} />
            </div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
          <ShieldCheck size={16} />{successMsg}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertTriangle size={16} />{error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, username ou e-mail..."
            className="w-full bg-[#161b22] border border-[#30363d] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
          className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
        <select value={filterTwoFA} onChange={e => setFilterTwoFA(e.target.value as any)}
          className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
          <option value="all">Todos (2FA)</option>
          <option value="enabled">2FA Ativo</option>
          <option value="disabled">2FA Pendente</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={24} className="text-blue-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Users size={40} className="mb-3 opacity-40" />
            <p className="text-sm">Nenhum usuário encontrado</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#30363d] bg-[#0d1117]">
                {['Usuário', 'Acesso', 'Módulos', 'Clientes', '2FA', 'Status', 'Ações'].map(h => (
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider ${h === 'Ações' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262d]">
              {filtered.map(user => (
                <tr key={user.id} className="hover:bg-[#1c2128] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {user.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-200">{user.full_name}</p>
                        <p className="text-xs text-gray-500">@{user.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {user.is_full_access ? <Badge color="yellow">Admin Total</Badge> : <Badge color="blue">{user.role}</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    {user.is_full_access ? <span className="text-xs text-yellow-400">Todos</span>
                      : user.permissions.length === 0 ? <span className="text-xs text-red-400">Nenhum</span>
                      : <span className="text-xs text-gray-400">{user.permissions.length} módulo(s)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {user.client_scope_ids.length === 0
                      ? <span className="text-xs text-green-400">Todos</span>
                      : <span className="text-xs text-purple-400">{user.client_scope_ids.length} cliente(s)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {user.totp_enabled ? <Badge color="green">Ativo</Badge> : <Badge color="red">Pendente</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={user.is_active ? 'green' : 'red'}>{user.is_active ? 'Ativo' : 'Inativo'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setDetailUser(user)} className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors" title="Detalhes">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => { setEditingUser(user); setShowForm(true); }} className="p-1.5 text-gray-500 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors" title="Editar">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setDeleteConfirm(user)} disabled={actionLoading === user.id}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50" title="Remover">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showForm && (
        <UserFormModal user={editingUser} clients={clients} onSave={handleSaveUser}
          onClose={() => { setShowForm(false); setEditingUser(null); }} />
      )}
      {detailUser && (
        <UserDetailModal user={detailUser} onClose={() => setDetailUser(null)}
          onEdit={() => { setEditingUser(detailUser); setDetailUser(null); setShowForm(true); }}
          onResetTwoFA={() => handleResetTwoFA(detailUser)}
          onToggleActive={() => handleToggleActive(detailUser)} />
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#161b22] border border-red-500/30 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-100">Remover Usuário</h3>
                <p className="text-xs text-gray-500">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            <p className="text-sm text-gray-300 mb-5">
              Tem certeza que deseja remover <strong className="text-red-400">@{deleteConfirm.username}</strong>?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-[#30363d] rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} disabled={actionLoading === deleteConfirm.id}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {actionLoading === deleteConfirm.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
