import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Play, Pause, Trash2, Plus, RefreshCw, CheckCircle,
  XCircle, Clock, AlertTriangle, ChevronDown, ChevronUp, Send,
  Settings, Database, Activity, Bell, Eye, Edit2, ToggleLeft, ToggleRight,
  Server, Zap, Info,
} from 'lucide-react';
import axios from 'axios';

const API = '/api/v1/device-backup';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Schedule {
  id: number;
  name: string;
  description?: string;
  playbook_id?: number;
  playbook_name?: string;
  device_ids: number[];
  device_names: string[];
  cron_expression: string;
  timezone: string;
  status: 'active' | 'paused' | 'disabled';
  telegram_enabled: boolean;
  telegram_token?: string;
  telegram_chat_id?: string;
  telegram_on_error: boolean;
  telegram_on_success: boolean;
  retention_days: number;
  last_run_at?: string;
  next_run_at?: string;
  last_status?: string;
  created_at: string;
}

interface StepLog {
  step: number;
  type: string;
  label: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  duration_ms?: number;
  timestamp?: string;
}

interface DeviceResult {
  device_id: number;
  device_name: string;
  status: 'success' | 'failure' | 'pending';
  error?: string;
  duration_ms?: number;
  playbook_execution_id?: number;
  step_logs?: StepLog[];
  output_files?: string[];
}

interface Execution {
  id: number;
  schedule_id: number;
  schedule_name?: string;
  triggered_by_name?: string;
  trigger_type: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  device_results: DeviceResult[];
  total_devices: number;
  success_count: number;
  failure_count: number;
  error_message?: string;
  telegram_sent: boolean;
}

interface Summary {
  total_schedules: number;
  active_schedules: number;
  paused_schedules: number;
  success_24h: number;
  failure_24h: number;
  last_success_at?: string;
  recent_executions: Execution[];
}

interface Playbook { id: number; name: string; category?: string; }
interface Device   { id: number; name: string; ip_address?: string; management_ip?: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
  success:   'text-green-400',
  partial:   'text-yellow-400',
  failure:   'text-red-400',
  running:   'text-blue-400',
  pending:   'text-gray-400',
  cancelled: 'text-gray-500',
};

const statusBg: Record<string, string> = {
  success:   'bg-green-500/10 border-green-500/30',
  partial:   'bg-yellow-500/10 border-yellow-500/30',
  failure:   'bg-red-500/10 border-red-500/30',
  running:   'bg-blue-500/10 border-blue-500/30',
  pending:   'bg-gray-500/10 border-gray-500/30',
};

const StatusIcon = ({ status, size = 16 }: { status: string; size?: number }) => {
  if (status === 'success')   return <CheckCircle size={size} className="text-green-400" />;
  if (status === 'partial')   return <AlertTriangle size={size} className="text-yellow-400" />;
  if (status === 'failure')   return <XCircle size={size} className="text-red-400" />;
  if (status === 'running')   return <RefreshCw size={size} className="text-blue-400 animate-spin" />;
  return <Clock size={size} className="text-gray-400" />;
};

const fmtDuration = (ms?: number) => {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const CRON_PRESETS = [
  { label: 'Todo dia às 22h',        value: '0 22 * * *' },
  { label: 'Todo dia às 02h',        value: '0 2 * * *' },
  { label: 'Toda segunda às 03h',    value: '0 3 * * 1' },
  { label: 'Todo domingo às 01h',    value: '0 1 * * 0' },
  { label: 'A cada 6 horas',         value: '0 */6 * * *' },
  { label: 'A cada hora',            value: '0 * * * *' },
  { label: 'Personalizado',          value: 'custom' },
];

// ─── Modal de Agendamento ─────────────────────────────────────────────────────

interface ScheduleModalProps {
  schedule?: Schedule | null;
  playbooks: Playbook[];
  devices: Device[];
  onClose: () => void;
  onSave: () => void;
}

const ScheduleModal: React.FC<ScheduleModalProps> = ({ schedule, playbooks, devices, onClose, onSave }) => {
  const isEdit = !!schedule;
  const [form, setForm] = useState({
    name: schedule?.name || '',
    description: schedule?.description || '',
    playbook_id: schedule?.playbook_id?.toString() || '',
    device_ids: schedule?.device_ids || [] as number[],
    cron_expression: schedule?.cron_expression || '0 22 * * *',
    timezone: schedule?.timezone || 'America/Bahia',
    telegram_enabled: schedule?.telegram_enabled || false,
    telegram_token: schedule?.telegram_token || '',
    telegram_chat_id: schedule?.telegram_chat_id || '',
    telegram_on_error: schedule?.telegram_on_error ?? true,
    telegram_on_success: schedule?.telegram_on_success ?? true,
    retention_days: schedule?.retention_days?.toString() || '30',
  });
  const [cronPreset, setCronPreset] = useState('custom');
  const [saving, setSaving] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'devices' | 'telegram'>('basic');

  useEffect(() => {
    const preset = CRON_PRESETS.find(p => p.value === form.cron_expression && p.value !== 'custom');
    setCronPreset(preset ? preset.value : 'custom');
  }, []);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const toggleDevice = (id: number) => {
    set('device_ids', form.device_ids.includes(id)
      ? form.device_ids.filter(d => d !== id)
      : [...form.device_ids, id]
    );
  };

  const handleCronPreset = (val: string) => {
    setCronPreset(val);
    if (val !== 'custom') set('cron_expression', val);
  };

  const handleTestTelegram = async () => {
    if (!form.telegram_token || !form.telegram_chat_id) {
      setTelegramTestResult('Preencha o token e o Chat ID antes de testar.');
      return;
    }
    setTestingTelegram(true);
    setTelegramTestResult(null);
    try {
      await axios.post(`${API}/test-telegram`, {
        token: form.telegram_token,
        chat_id: form.telegram_chat_id,
      });
      setTelegramTestResult('✅ Mensagem enviada com sucesso!');
    } catch (e: any) {
      setTelegramTestResult(`❌ ${e.response?.data?.detail || 'Erro ao enviar'}`);
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('Informe o nome do agendamento.');
    if (!form.playbook_id) return alert('Selecione um playbook.');
    if (form.device_ids.length === 0) return alert('Selecione ao menos um dispositivo.');
    setSaving(true);
    try {
      const payload = {
        ...form,
        playbook_id: parseInt(form.playbook_id),
        retention_days: parseInt(form.retention_days),
      };
      if (isEdit) {
        await axios.put(`${API}/schedules/${schedule!.id}`, payload);
      } else {
        await axios.post(`${API}/schedules`, payload);
      }
      onSave();
      onClose();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Erro ao salvar agendamento');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Calendar size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white">{isEdit ? 'Editar Agendamento' : 'Novo Agendamento de Backup'}</h2>
              <p className="text-xs text-gray-400">Configure o playbook, dispositivos e horário</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-5">
          {(['basic', 'devices', 'telegram'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab === 'basic' ? '⚙️ Configuração' : tab === 'devices' ? `🖥️ Dispositivos (${form.device_ids.length})` : '📱 Telegram'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'basic' && (
            <>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Nome do Agendamento *</label>
                <input
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="Ex: Backup OLTs Huawei — Noturno"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Playbook de Backup *</label>
                <select
                  value={form.playbook_id}
                  onChange={e => set('playbook_id', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
                >
                  <option value="">Selecione um playbook...</option>
                  {playbooks.map(p => (
                    <option key={p.id} value={p.id}>{p.name} {p.category ? `(${p.category})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Horário de Execução</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {CRON_PRESETS.map(p => (
                    <button
                      key={p.value}
                      onClick={() => handleCronPreset(p.value)}
                      className={`px-3 py-2 rounded-lg text-xs border transition-colors text-left ${
                        cronPreset === p.value
                          ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                          : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Expressão Cron (5 campos: min h dom mon dow)</label>
                  <input
                    value={form.cron_expression}
                    onChange={e => { set('cron_expression', e.target.value); setCronPreset('custom'); }}
                    placeholder="0 22 * * *"
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Fuso Horário</label>
                  <select
                    value={form.timezone}
                    onChange={e => set('timezone', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
                  >
                    <option value="America/Bahia">America/Bahia (BRT)</option>
                    <option value="America/Sao_Paulo">America/Sao_Paulo (BRT)</option>
                    <option value="America/Manaus">America/Manaus (AMT)</option>
                    <option value="America/Belem">America/Belem (BRT)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Retenção (dias)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={form.retention_days}
                    onChange={e => set('retention_days', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'devices' && (
            <div>
              <p className="text-sm text-gray-400 mb-3">
                Selecione os dispositivos que receberão o backup. O playbook será executado em cada um.
              </p>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {devices.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-8">Nenhum dispositivo cadastrado.</p>
                )}
                {devices.map(d => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      form.device_ids.includes(d.id)
                        ? 'bg-blue-500/10 border-blue-500/50'
                        : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.device_ids.includes(d.id)}
                      onChange={() => toggleDevice(d.id)}
                      className="accent-blue-500"
                    />
                    <Server size={14} className="text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{d.name}</p>
                      <p className="text-xs text-gray-400">{d.management_ip || d.ip_address || '—'}</p>
                    </div>
                  </label>
                ))}
              </div>
              {form.device_ids.length > 0 && (
                <p className="text-xs text-blue-400 mt-2">{form.device_ids.length} dispositivo(s) selecionado(s)</p>
              )}
            </div>
          )}

          {activeTab === 'telegram' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700">
                <div>
                  <p className="text-sm text-white font-medium">Notificações Telegram</p>
                  <p className="text-xs text-gray-400">Receba alertas ao final de cada backup</p>
                </div>
                <button
                  onClick={() => set('telegram_enabled', !form.telegram_enabled)}
                  className={`transition-colors ${form.telegram_enabled ? 'text-green-400' : 'text-gray-500'}`}
                >
                  {form.telegram_enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                </button>
              </div>

              {form.telegram_enabled && (
                <>
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-300">
                    <p className="font-medium mb-1">Como configurar:</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-300">
                      <li>Crie um bot com o <strong>@BotFather</strong> no Telegram</li>
                      <li>Copie o token gerado</li>
                      <li>Envie uma mensagem para o bot e acesse:<br/>
                        <code className="bg-gray-800 px-1 rounded">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>
                      </li>
                      <li>Copie o <strong>chat.id</strong> da resposta</li>
                    </ol>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Token do Bot</label>
                    <input
                      value={form.telegram_token}
                      onChange={e => set('telegram_token', e.target.value)}
                      placeholder="1234567890:AAF..."
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Chat ID</label>
                    <input
                      value={form.telegram_chat_id}
                      onChange={e => set('telegram_chat_id', e.target.value)}
                      placeholder="-1001234567890 ou 123456789"
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.telegram_on_success} onChange={e => set('telegram_on_success', e.target.checked)} className="accent-green-500" />
                      <span className="text-sm text-gray-300">Notificar em sucesso</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.telegram_on_error} onChange={e => set('telegram_on_error', e.target.checked)} className="accent-red-500" />
                      <span className="text-sm text-gray-300">Notificar em falha</span>
                    </label>
                  </div>
                  <button
                    onClick={handleTestTelegram}
                    disabled={testingTelegram}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                  >
                    <Send size={14} />
                    {testingTelegram ? 'Enviando...' : 'Enviar mensagem de teste'}
                  </button>
                  {telegramTestResult && (
                    <p className="text-sm text-gray-300 bg-gray-800 rounded-lg p-2">{telegramTestResult}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white text-sm transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {saving ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Criar Agendamento'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Modal de Detalhes de Execução ────────────────────────────────────────────

const DeviceResultRow: React.FC<{ dr: DeviceResult }> = ({ dr }) => {
  const [expanded, setExpanded] = React.useState(false);
  const hasLogs = (dr.step_logs || []).length > 0;
  const hasFiles = (dr.output_files || []).length > 0;

  return (
    <div className={`rounded-lg border ${dr.status === 'success' ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
      <div
        className="flex items-center justify-between p-3 cursor-pointer"
        onClick={() => (hasLogs || hasFiles) && setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <StatusIcon status={dr.status} size={14} />
          <span className="text-sm text-white font-medium">{dr.device_name}</span>
          {hasFiles && (
            <span className="text-xs bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">
              {dr.output_files!.length} arquivo(s)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{fmtDuration(dr.duration_ms)}</span>
          {(hasLogs || hasFiles) && (
            expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />
          )}
        </div>
      </div>
      {dr.error && <p className="text-xs text-red-300 px-3 pb-2 ml-5">{dr.error}</p>}
      {expanded && (
        <div className="border-t border-gray-700/50 p-3 space-y-2">
          {/* Arquivos gerados */}
          {hasFiles && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Arquivos de Backup</p>
              {dr.output_files!.map((f, fi) => (
                <div key={fi} className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 rounded px-2 py-1">
                  <Database size={10} />
                  <span className="font-mono">{f.split('/').pop()}</span>
                </div>
              ))}
            </div>
          )}
          {/* Logs por passo */}
          {hasLogs && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Log de Passos</p>
              {dr.step_logs!.map((s, si) => (
                <div key={si} className={`rounded px-2 py-1.5 text-xs font-mono ${
                  s.status === 'success' ? 'bg-gray-800 text-gray-300' : 'bg-red-500/10 text-red-300'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={s.status === 'success' ? 'text-green-400' : 'text-red-400'}>
                      {s.status === 'success' ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-400">#{s.step}</span>
                    <span className="text-white">{s.label}</span>
                    <span className="ml-auto text-gray-500">{s.duration_ms ? `${s.duration_ms}ms` : ''}</span>
                  </div>
                  {s.error && <p className="mt-1 text-red-300 pl-6">{s.error}</p>}
                  {s.output && s.status === 'success' && (
                    <p className="mt-1 text-gray-400 pl-6 truncate">{s.output.slice(0, 200)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ExecutionDetailModal: React.FC<{ execution: Execution; onClose: () => void }> = ({ execution, onClose }) => (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
    <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between p-5 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <StatusIcon status={execution.status} size={20} />
          <div>
            <h2 className="font-semibold text-white">{execution.schedule_name || `Execução #${execution.id}`}</h2>
            <p className="text-xs text-gray-400">
              {fmtDate(execution.started_at)} — {fmtDuration(execution.duration_ms)}
              {execution.trigger_type === 'manual' ? ' · Manual' : ' · Agendado'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Cards de resumo */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-white">{execution.total_devices}</p>
            <p className="text-xs text-gray-400">Total</p>
          </div>
          <div className="bg-green-500/10 rounded-lg p-3 text-center border border-green-500/20">
            <p className="text-2xl font-bold text-green-400">{execution.success_count}</p>
            <p className="text-xs text-gray-400">Sucesso</p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3 text-center border border-red-500/20">
            <p className="text-2xl font-bold text-red-400">{execution.failure_count}</p>
            <p className="text-xs text-gray-400">Falha</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-white">{fmtDuration(execution.duration_ms)}</p>
            <p className="text-xs text-gray-400">Duração</p>
          </div>
        </div>

        {/* Erro geral */}
        {execution.error_message && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-xs font-medium text-red-400 mb-1">Erro na execução</p>
            <p className="text-xs text-red-300 font-mono">{execution.error_message}</p>
          </div>
        )}

        {/* Resultado por dispositivo — expansível com logs */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-300">Resultado por dispositivo</p>
          {(execution.device_results || []).length === 0 ? (
            <p className="text-xs text-gray-500 italic">Nenhum dispositivo processado.</p>
          ) : (
            (execution.device_results || []).map((dr, i) => (
              <DeviceResultRow key={i} dr={dr} />
            ))
          )}
        </div>

        {/* Status Telegram */}
        <div className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
          execution.telegram_sent ? 'text-green-400 bg-green-500/10' : 'text-gray-400 bg-gray-800'
        }`}>
          <Send size={12} />
          {execution.telegram_sent
            ? 'Notificação Telegram enviada com sucesso'
            : 'Notificação Telegram não enviada'}
          {(execution as any).telegram_error && (
            <span className="text-red-400">— {(execution as any).telegram_error}</span>
          )}
        </div>
      </div>
    </div>
  </div>
);

// ─── Página Principal ─────────────────────────────────────────────────────────

const DeviceBackupPage: React.FC = () => {
  const [tab, setTab] = useState<'schedules' | 'history'>('schedules');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, eRes, sumRes, pbRes, devRes] = await Promise.all([
        axios.get(`${API}/schedules`),
        axios.get(`${API}/executions?limit=30`),
        axios.get(`${API}/summary`),
        axios.get('/api/v1/playbooks'),
        axios.get('/api/v1/devices'),
      ]);
      setSchedules(sRes.data);
      setExecutions(eRes.data);
      setSummary(sumRes.data);
      setPlaybooks(pbRes.data?.items || pbRes.data || []);
      setDevices(devRes.data?.items || devRes.data || []);
    } catch (e) {
      console.error('Erro ao carregar dados de backup:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh a cada 30s
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRunNow = async (scheduleId: number) => {
    setRunningIds(prev => new Set(prev).add(scheduleId));
    try {
      await axios.post(`${API}/schedules/${scheduleId}/run`);
      setTimeout(load, 2000);
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Erro ao iniciar backup');
    } finally {
      setTimeout(() => setRunningIds(prev => { const s = new Set(prev); s.delete(scheduleId); return s; }), 5000);
    }
  };

  const handleToggle = async (scheduleId: number) => {
    try {
      await axios.post(`${API}/schedules/${scheduleId}/toggle`);
      load();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Erro ao alterar status');
    }
  };

  const handleDelete = async (s: Schedule) => {
    if (!confirm(`Remover o agendamento "${s.name}"? O histórico de execuções também será removido.`)) return;
    try {
      await axios.delete(`${API}/schedules/${s.id}`);
      load();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Erro ao remover');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Database size={24} className="text-blue-400" />
            Backup de Dispositivos
          </h1>
          <p className="text-gray-400 text-sm mt-1">Agendamentos automáticos de backup via playbooks com notificação Telegram</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-400 hover:text-white transition-colors" title="Atualizar">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setEditSchedule(null); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Novo Agendamento
          </button>
        </div>
      </div>

      {/* Cards de resumo */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Agendamentos', value: summary.total_schedules, icon: Calendar, color: 'text-blue-400', bg: 'bg-blue-500/10' },
            { label: 'Ativos', value: summary.active_schedules, icon: Activity, color: 'text-green-400', bg: 'bg-green-500/10' },
            { label: 'Pausados', value: summary.paused_schedules, icon: Pause, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
            { label: 'Sucesso 24h', value: summary.success_24h, icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10' },
            { label: 'Falhas 24h', value: summary.failure_24h, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
          ].map((c, i) => (
            <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center flex-shrink-0`}>
                <c.icon size={18} className={c.color} />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{c.value}</p>
                <p className="text-xs text-gray-400">{c.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {(['schedules', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t === 'schedules' ? `📅 Agendamentos (${schedules.length})` : `📋 Histórico (${executions.length})`}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={24} className="animate-spin text-blue-400" />
        </div>
      )}

      {!loading && tab === 'schedules' && (
        <div className="space-y-3">
          {schedules.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <Calendar size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-lg">Nenhum agendamento configurado</p>
              <p className="text-sm mt-1">Clique em "Novo Agendamento" para começar</p>
            </div>
          )}
          {schedules.map(s => (
            <div key={s.id} className="bg-gray-900 border border-gray-700 rounded-xl p-4 hover:border-gray-600 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${s.status === 'active' ? 'bg-green-400' : 'bg-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-white">{s.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        s.status === 'active' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                        s.status === 'paused' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
                        'bg-gray-500/10 border-gray-500/30 text-gray-400'
                      }`}>
                        {s.status === 'active' ? 'Ativo' : s.status === 'paused' ? 'Pausado' : 'Desativado'}
                      </span>
                      {s.telegram_enabled && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center gap-1">
                          <Bell size={10} /> Telegram
                        </span>
                      )}
                    </div>
                    {s.description && <p className="text-xs text-gray-400 mt-0.5">{s.description}</p>}
                    <div className="flex items-center gap-4 mt-2 flex-wrap text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Zap size={11} />{s.playbook_name || 'Playbook não definido'}</span>
                      <span className="flex items-center gap-1"><Server size={11} />{s.device_names?.length || 0} dispositivo(s)</span>
                      <span className="flex items-center gap-1 font-mono"><Clock size={11} />{s.cron_expression}</span>
                      {s.last_run_at && (
                        <span className="flex items-center gap-1">
                          {s.last_status && <StatusIcon status={s.last_status} size={11} />}
                          Último: {fmtDate(s.last_run_at)}
                        </span>
                      )}
                    </div>
                    {s.device_names && s.device_names.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {s.device_names.slice(0, 5).map((n, i) => (
                          <span key={i} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">{n}</span>
                        ))}
                        {s.device_names.length > 5 && (
                          <span className="text-xs text-gray-500">+{s.device_names.length - 5} mais</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleRunNow(s.id)}
                    disabled={runningIds.has(s.id)}
                    title="Executar agora"
                    className="p-2 text-green-400 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {runningIds.has(s.id) ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                  </button>
                  <button
                    onClick={() => handleToggle(s.id)}
                    title={s.status === 'active' ? 'Pausar' : 'Ativar'}
                    className="p-2 text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                  >
                    {s.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button
                    onClick={() => { setEditSchedule(s); setShowModal(true); }}
                    title="Editar"
                    className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    title="Remover"
                    className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'history' && (
        <div className="space-y-2">
          {executions.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <Activity size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-lg">Nenhuma execução registrada</p>
            </div>
          )}
          {executions.map(e => (
            <div
              key={e.id}
              className={`bg-gray-900 border rounded-xl p-4 cursor-pointer hover:border-gray-600 transition-colors ${statusBg[e.status] || 'border-gray-700'}`}
              onClick={() => setSelectedExecution(e)}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <StatusIcon status={e.status} size={18} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{e.schedule_name || `Schedule #${e.schedule_id}`}</p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(e.started_at)} • {e.trigger_type === 'manual' ? '▶ Manual' : '⏰ Agendado'} • {fmtDuration(e.duration_ms)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                  <span className="text-green-400">{e.success_count}✓</span>
                  {e.failure_count > 0 && <span className="text-red-400">{e.failure_count}✗</span>}
                  {e.telegram_sent && <Send size={12} className="text-blue-400" title="Telegram enviado" />}
                  <Eye size={14} className="text-gray-500" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modais */}
      {showModal && (
        <ScheduleModal
          schedule={editSchedule}
          playbooks={playbooks}
          devices={devices}
          onClose={() => { setShowModal(false); setEditSchedule(null); }}
          onSave={load}
        />
      )}
      {selectedExecution && (
        <ExecutionDetailModal
          execution={selectedExecution}
          onClose={() => setSelectedExecution(null)}
        />
      )}
    </div>
  );
};

export default DeviceBackupPage;
