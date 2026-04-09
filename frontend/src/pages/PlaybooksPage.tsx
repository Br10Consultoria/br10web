import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play, Plus, Trash2, Edit2, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Clock, Loader2, Terminal,
  Download, AlertTriangle, Info, Copy, ArrowUp, ArrowDown,
  Zap, List, History, Settings2, X, Save, RefreshCw,
  FileText, Server, User as UserIcon, Upload, FileCode,
  CheckCheck, Eye, Wifi, WifiOff,
} from 'lucide-react';
import api from '../utils/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaybookStep {
  id?: string;
  order: number;
  step_type: string;
  params: Record<string, string>;
  label?: string;
  on_error: string;
}

interface Playbook {
  id: string;
  name: string;
  description?: string;
  category: string;
  variables: Record<string, string>;
  schedule_cron?: string;
  schedule_enabled: boolean;
  status: string;
  steps: PlaybookStep[];
  created_at: string;
}

interface StepTypeMeta {
  type: string;
  label: string;
  description: string;
  params: { key: string; label: string; default: string; required: boolean }[];
}

interface ExecutionLog {
  step: number;
  label: string;
  status: 'success' | 'error' | 'info';
  message: string;
  duration_ms?: number;
  output?: string;
}

interface PlaybookExecution {
  id: string;
  playbook_name: string;
  device_name: string;
  device_ip: string;
  client_name: string;
  status: string;
  step_logs: ExecutionLog[];
  output_files: string[];
  error_message?: string;
  duration_ms?: number;
  started_at: string;
  finished_at?: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

const playbooksApi = {
  list: () => api.get('/playbooks').then(r => r.data),
  get: (id: string) => api.get(`/playbooks/${id}`).then(r => r.data),
  create: (data: any) => api.post('/playbooks', data).then(r => r.data),
  update: (id: string, data: any) => api.put(`/playbooks/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/playbooks/${id}`),
  execute: (id: string, deviceId: string, vars: Record<string, string>) =>
    api.post(`/playbooks/${id}/execute`, { device_id: deviceId, variables_override: vars }).then(r => r.data),
  executions: (id: string) => api.get(`/playbooks/${id}/executions`).then(r => r.data),
  allExecutions: () => api.get('/playbooks/executions/all').then(r => r.data),
  stepTypes: () => api.get('/playbooks/meta/step-types').then(r => r.data),
  importScript: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/playbooks/import-script', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },
  saveImported: (data: any) => api.post('/playbooks/import-script/save', data).then(r => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-400',
  error: 'text-red-400',
  running: 'text-yellow-400',
  pending: 'text-gray-400',
  timeout: 'text-orange-400',
  cancelled: 'text-gray-500',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4 text-green-400" />,
  error: <XCircle className="w-4 h-4 text-red-400" />,
  running: <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />,
  pending: <Clock className="w-4 h-4 text-gray-400" />,
  timeout: <AlertTriangle className="w-4 h-4 text-orange-400" />,
};

const CATEGORIES = [
  { value: 'backup', label: 'Backup' },
  { value: 'configuration', label: 'Configuração' },
  { value: 'diagnostics', label: 'Diagnóstico' },
  { value: 'monitoring', label: 'Monitoramento' },
  { value: 'maintenance', label: 'Manutenção' },
  { value: 'other', label: 'Outro' },
];

function formatDuration(ms?: number) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}

// ─── Step Editor ──────────────────────────────────────────────────────────────

function StepEditor({
  step,
  index,
  stepTypes,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  step: PlaybookStep;
  index: number;
  stepTypes: StepTypeMeta[];
  onChange: (s: PlaybookStep) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const meta = stepTypes.find(t => t.type === step.step_type);
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-[#2a3a5c] rounded-lg bg-[#0d1b35] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#1a2a4a]">
        <span className="text-xs font-mono text-gray-500 w-5 text-center">{index + 1}</span>
        <button onClick={() => setExpanded(!expanded)} className="flex-1 flex items-center gap-2 text-left">
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-sm font-medium text-white">
            {step.label || meta?.label || step.step_type}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-500 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500 ml-auto" />}
        </button>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={isFirst} className="p-1 hover:text-white text-gray-500 disabled:opacity-30">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={onMoveDown} disabled={isLast} className="p-1 hover:text-white text-gray-500 disabled:opacity-30">
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 hover:text-red-400 text-gray-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* Tipo */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tipo de Passo</label>
              <select
                value={step.step_type}
                onChange={e => onChange({ ...step, step_type: e.target.value, params: {} })}
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-sm text-white"
              >
                {stepTypes.map(t => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
              </select>
            </div>
            {/* Label */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rótulo (opcional)</label>
              <input
                type="text"
                value={step.label || ''}
                onChange={e => onChange({ ...step, label: e.target.value })}
                placeholder={meta?.label || step.step_type}
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-sm text-white placeholder-gray-600"
              />
            </div>
          </div>

          {/* Parâmetros do tipo */}
          {meta && meta.params.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">{meta.description}</p>
              <div className="grid grid-cols-2 gap-2">
                {meta.params.map(param => (
                  <div key={param.key}>
                    <label className="block text-xs text-gray-400 mb-1">
                      {param.label} {param.required && <span className="text-red-400">*</span>}
                    </label>
                    <input
                      type="text"
                      value={step.params[param.key] ?? param.default}
                      onChange={e => onChange({ ...step, params: { ...step.params, [param.key]: e.target.value } })}
                      placeholder={param.default}
                      className="w-full bg-[#0a1628] border border-[#2a3a5c] rounded px-2 py-1.5 text-xs text-white placeholder-gray-600 font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Em caso de erro */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Em caso de erro</label>
            <select
              value={step.on_error}
              onChange={e => onChange({ ...step, on_error: e.target.value })}
              className="bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-xs text-white"
            >
              <option value="stop">Parar execução</option>
              <option value="continue">Continuar</option>
              <option value="skip">Pular passo</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Playbook Form Modal ───────────────────────────────────────────────────────

function PlaybookFormModal({
  playbook,
  stepTypes,
  onClose,
  onSave,
}: {
  playbook?: Playbook;
  stepTypes: StepTypeMeta[];
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState(playbook?.name || '');
  const [description, setDescription] = useState(playbook?.description || '');
  const [category, setCategory] = useState(playbook?.category || 'backup');
  const [variables, setVariables] = useState<{ key: string; value: string }[]>(
    Object.entries(playbook?.variables || {}).map(([k, v]) => ({ key: k, value: v }))
  );
  const [steps, setSteps] = useState<PlaybookStep[]>(
    (playbook?.steps || []).sort((a, b) => a.order - b.order)
  );
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'steps' | 'variables'>('steps');

  const addStep = () => {
    const newStep: PlaybookStep = {
      order: steps.length + 1,
      step_type: 'send_command',
      params: {},
      on_error: 'stop',
    };
    setSteps([...steps, newStep]);
  };

  const updateStep = (index: number, s: PlaybookStep) => {
    const updated = [...steps];
    updated[index] = s;
    setSteps(updated);
  };

  const deleteStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 }));
    setSteps(updated);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const updated = [...steps];
    const target = direction === 'up' ? index - 1 : index + 1;
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setSteps(updated.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const addVariable = () => setVariables([...variables, { key: '', value: '' }]);
  const updateVariable = (i: number, field: 'key' | 'value', val: string) => {
    const updated = [...variables];
    updated[i][field] = val;
    setVariables(updated);
  };
  const removeVariable = (i: number) => setVariables(variables.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const varsObj: Record<string, string> = {};
      variables.forEach(v => { if (v.key.trim()) varsObj[v.key.trim()] = v.value; });
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        variables: varsObj,
        steps: steps.map((s, i) => ({ ...s, order: i + 1 })),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d1b35] border border-[#2a3a5c] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#2a3a5c]">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            {playbook ? 'Editar Playbook' : 'Novo Playbook'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Info básica */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs text-gray-400 mb-1">Nome *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Backup OLT ZTE Titan"
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white placeholder-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Categoria</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white"
              >
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Descrição</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Descrição opcional do playbook"
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white placeholder-gray-600"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-[#2a3a5c]">
            <button
              onClick={() => setActiveTab('steps')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'steps' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}
            >
              Passos ({steps.length})
            </button>
            <button
              onClick={() => setActiveTab('variables')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'variables' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}
            >
              Variáveis ({variables.length})
            </button>
          </div>

          {/* Passos */}
          {activeTab === 'steps' && (
            <div className="space-y-2">
              <div className="bg-[#0a1628] border border-[#1a2a4a] rounded p-2 text-xs text-gray-400">
                <Info className="w-3.5 h-3.5 inline mr-1 text-blue-400" />
                Use <code className="text-yellow-300">{'{VARIAVEL}'}</code> nos parâmetros para referenciar variáveis configuradas. Ex: <code className="text-yellow-300">{'{FTP_HOST}'}</code>, <code className="text-yellow-300">{'{DEVICE_IP}'}</code>, <code className="text-yellow-300">{'{CLIENT_NAME}'}</code>
              </div>
              {steps.map((step, i) => (
                <StepEditor
                  key={i}
                  step={step}
                  index={i}
                  stepTypes={stepTypes}
                  onChange={s => updateStep(i, s)}
                  onDelete={() => deleteStep(i)}
                  onMoveUp={() => moveStep(i, 'up')}
                  onMoveDown={() => moveStep(i, 'down')}
                  isFirst={i === 0}
                  isLast={i === steps.length - 1}
                />
              ))}
              <button
                onClick={addStep}
                className="w-full border border-dashed border-[#2a3a5c] rounded-lg py-2 text-sm text-gray-400 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Adicionar Passo
              </button>
            </div>
          )}

          {/* Variáveis */}
          {activeTab === 'variables' && (
            <div className="space-y-2">
              <div className="bg-[#0a1628] border border-[#1a2a4a] rounded p-2 text-xs text-gray-400">
                <Info className="w-3.5 h-3.5 inline mr-1 text-blue-400" />
                Variáveis são substituídas nos parâmetros dos passos. Variáveis automáticas: <code className="text-yellow-300">DEVICE_IP</code>, <code className="text-yellow-300">DEVICE_NAME</code>, <code className="text-yellow-300">CLIENT_NAME</code>, <code className="text-yellow-300">DATE</code>, <code className="text-yellow-300">DATETIME</code>
              </div>
              {variables.map((v, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={v.key}
                    onChange={e => updateVariable(i, 'key', e.target.value)}
                    placeholder="NOME_VARIAVEL"
                    className="w-40 bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-xs text-yellow-300 font-mono placeholder-gray-600"
                  />
                  <span className="text-gray-500">=</span>
                  <input
                    type="text"
                    value={v.value}
                    onChange={e => updateVariable(i, 'value', e.target.value)}
                    placeholder="valor padrão"
                    className="flex-1 bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-xs text-white placeholder-gray-600"
                  />
                  <button onClick={() => removeVariable(i)} className="text-gray-500 hover:text-red-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={addVariable}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
              >
                <Plus className="w-4 h-4" /> Adicionar Variável
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-[#2a3a5c]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar Playbook
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Import Script Modal ──────────────────────────────────────────────────

const STEP_TYPE_ICONS: Record<string, React.ReactNode> = {
  telnet_connect: <WifiOff className="w-3.5 h-3.5 text-orange-400" />,
  ssh_connect: <Wifi className="w-3.5 h-3.5 text-blue-400" />,
  disconnect: <X className="w-3.5 h-3.5 text-gray-400" />,
  send_command: <Terminal className="w-3.5 h-3.5 text-green-400" />,
  wait_for: <Clock className="w-3.5 h-3.5 text-yellow-400" />,
  send_string: <FileText className="w-3.5 h-3.5 text-purple-400" />,
  ftp_download: <Download className="w-3.5 h-3.5 text-cyan-400" />,
  sleep: <Clock className="w-3.5 h-3.5 text-gray-400" />,
  log: <Info className="w-3.5 h-3.5 text-blue-300" />,
};

interface ImportPreview {
  name: string;
  description: string;
  category: string;
  variables: Record<string, string>;
  steps: PlaybookStep[];
  warnings: string[];
  protocol: string;
  total_steps: number;
}

function ImportScriptModal({
  stepTypes,
  onClose,
  onImported,
}: {
  stepTypes: StepTypeMeta[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<'upload' | 'preview' | 'saving'>('upload');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Campos editáveis do preview
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('backup');
  const [variables, setVariables] = useState<{ key: string; value: string }[]>([]);
  const [steps, setSteps] = useState<PlaybookStep[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      const data: ImportPreview = await playbooksApi.importScript(file);
      setPreview(data);
      setName(data.name);
      setDescription(data.description);
      setCategory(data.category);
      setVariables(Object.entries(data.variables).map(([k, v]) => ({ key: k, value: v })));
      setSteps(data.steps);
      setPhase('preview');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erro ao processar o script.');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSave = async () => {
    setPhase('saving');
    try {
      const varsObj: Record<string, string> = {};
      variables.forEach(v => { if (v.key.trim()) varsObj[v.key.trim()] = v.value; });
      await playbooksApi.saveImported({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        variables: varsObj,
        steps: steps.map((s, i) => ({ ...s, order: i })),
      });
      onImported();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erro ao salvar playbook.');
      setPhase('preview');
    }
  };

  const updateStep = (index: number, s: PlaybookStep) => {
    const updated = [...steps];
    updated[index] = s;
    setSteps(updated);
  };

  const deleteStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i })));
  };

  const moveStep = (index: number, dir: 'up' | 'down') => {
    const updated = [...steps];
    const target = dir === 'up' ? index - 1 : index + 1;
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setSteps(updated.map((s, i) => ({ ...s, order: i })));
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d1b35] border border-[#2a3a5c] rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#2a3a5c]">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-purple-400" />
            Importar Script como Playbook
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-0 px-4 py-2 border-b border-[#2a3a5c] bg-[#0a1628]">
          {[{id:'upload',label:'1. Upload'},{id:'preview',label:'2. Revisar'},{id:'saving',label:'3. Salvar'}].map((s, i) => (
            <React.Fragment key={s.id}>
              <div className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full ${
                phase === s.id ? 'bg-blue-600 text-white' :
                (phase === 'preview' && s.id === 'upload') || phase === 'saving' ? 'text-green-400' : 'text-gray-500'
              }`}>
                {((phase === 'preview' && s.id === 'upload') || phase === 'saving') && s.id !== 'saving'
                  ? <CheckCheck className="w-3 h-3" /> : null}
                {s.label}
              </div>
              {i < 2 && <div className="w-8 h-px bg-[#2a3a5c] mx-1" />}
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* FASE 1: Upload */}
          {phase === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  dragging ? 'border-purple-400 bg-purple-900/20' : 'border-[#2a3a5c] hover:border-purple-500 hover:bg-purple-900/10'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".py,.sh,.bash,.expect,.exp,.tcl,.txt"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                />
                {loading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
                    <p className="text-gray-300 text-sm">Analisando script...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <FileCode className="w-12 h-12 text-purple-400 opacity-70" />
                    <div>
                      <p className="text-white font-medium">Arraste o script aqui ou clique para selecionar</p>
                      <p className="text-gray-400 text-sm mt-1">Suportado: .py, .sh, .bash, .expect, .exp, .tcl, .txt</p>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-900/20 border border-red-700 rounded-lg p-3 text-sm text-red-400">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* Guia de formatos */}
              <div className="bg-[#0a1628] border border-[#1a2a4a] rounded-lg p-4 space-y-2">
                <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-400" /> O que o importador detecta automaticamente:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                  <div className="flex items-center gap-1.5"><Wifi className="w-3 h-3 text-blue-400" /> Conexão SSH / Telnet</div>
                  <div className="flex items-center gap-1.5"><Terminal className="w-3 h-3 text-green-400" /> Envio de comandos</div>
                  <div className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-yellow-400" /> Aguardar prompts / strings</div>
                  <div className="flex items-center gap-1.5"><Download className="w-3 h-3 text-cyan-400" /> Download FTP</div>
                  <div className="flex items-center gap-1.5"><FileText className="w-3 h-3 text-purple-400" /> Variáveis (HOST, USER, PASS...)</div>
                  <div className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-gray-400" /> Sleep / delays</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Compativel com: Python (telnetlib, paramiko, netmiko, pexpect), Shell/Bash, Expect/TCL
                </p>
              </div>
            </div>
          )}

          {/* FASE 2: Preview e edição */}
          {phase === 'preview' && preview && (
            <div className="space-y-4">
              {/* Avisos */}
              {preview.warnings.length > 0 && (
                <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-medium text-yellow-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Avisos de conversão
                  </p>
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-yellow-300/80 ml-5">• {w}</p>
                  ))}
                </div>
              )}

              {/* Resumo da detecção */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#1a2a4a] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-white">{preview.total_steps}</div>
                  <div className="text-xs text-gray-400">Passos detectados</div>
                </div>
                <div className="bg-[#1a2a4a] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-white">{Object.keys(preview.variables).length}</div>
                  <div className="text-xs text-gray-400">Variáveis</div>
                </div>
                <div className="bg-[#1a2a4a] rounded-lg p-3 text-center">
                  <div className={`text-lg font-bold ${preview.protocol === 'ssh' ? 'text-blue-400' : 'text-orange-400'}`}>
                    {preview.protocol.toUpperCase()}
                  </div>
                  <div className="text-xs text-gray-400">Protocolo</div>
                </div>
              </div>

              {/* Campos editáveis */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs text-gray-400 mb-1">Nome do Playbook *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Categoria</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white"
                  >
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Descrição</label>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              {/* Variáveis detectadas */}
              {variables.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-300 mb-2">Variáveis detectadas (edite os valores padrão):</p>
                  <div className="space-y-2">
                    {variables.map((v, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="w-32 text-xs font-mono text-yellow-300 shrink-0">{v.key}</span>
                        <span className="text-gray-500">=</span>
                        <input
                          type={v.key.toLowerCase().includes('pass') ? 'password' : 'text'}
                          value={v.value}
                          onChange={e => {
                            const updated = [...variables];
                            updated[i].value = e.target.value;
                            setVariables(updated);
                          }}
                          placeholder={v.key.toLowerCase().includes('pass') ? '(deixe vazio por segurança)' : 'valor padrão'}
                          className="flex-1 bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-xs text-white font-mono placeholder-gray-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Passos detectados */}
              <div>
                <p className="text-xs font-medium text-gray-300 mb-2 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                  Passos detectados — revise e ajuste antes de salvar:
                </p>
                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <StepEditor
                      key={i}
                      step={step}
                      index={i}
                      stepTypes={stepTypes}
                      onChange={s => updateStep(i, s)}
                      onDelete={() => deleteStep(i)}
                      onMoveUp={() => moveStep(i, 'up')}
                      onMoveDown={() => moveStep(i, 'down')}
                      isFirst={i === 0}
                      isLast={i === steps.length - 1}
                    />
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-900/20 border border-red-700 rounded-lg p-3 text-sm text-red-400">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* FASE 3: Salvando */}
          {phase === 'saving' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
              <p className="text-gray-300">Salvando playbook...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-[#2a3a5c]">
          <button
            onClick={() => { if (phase === 'preview') { setPhase('upload'); setPreview(null); setError(null); } else onClose(); }}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            {phase === 'preview' ? '← Voltar' : 'Cancelar'}
          </button>
          {phase === 'preview' && (
            <button
              onClick={handleSave}
              disabled={!name.trim() || steps.length === 0}
              className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> Salvar Playbook
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Execute Modal ─────────────────────────────────────────────────────────────

function ExecuteModal({
  playbook,
  onClose,
}: {
  playbook: Playbook;
  onClose: () => void;
}) {
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('');
  const [varOverrides, setVarOverrides] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<PlaybookExecution | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const { data: devices = [] } = useQuery({
    queryKey: ['devices', selectedClient],
    queryFn: () => api.get('/devices', { params: selectedClient ? { client_id: selectedClient } : {} }).then(r => r.data),
  });

  const handleExecute = async () => {
    if (!selectedDevice) return;
    setExecuting(true);
    setResult(null);
    try {
      const res = await playbooksApi.execute(playbook.id, selectedDevice, varOverrides);
      setResult(res);
    } catch (err: any) {
      setResult({
        id: '',
        playbook_name: playbook.name,
        device_name: '',
        device_ip: '',
        client_name: '',
        status: 'error',
        step_logs: [],
        output_files: [],
        error_message: err?.response?.data?.detail || 'Erro ao executar playbook.',
        started_at: new Date().toISOString(),
      });
    } finally {
      setExecuting(false);
    }
  };

  const varEntries = Object.entries(playbook.variables || {});

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d1b35] border border-[#2a3a5c] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#2a3a5c]">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Play className="w-5 h-5 text-green-400" />
            Executar: {playbook.name}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!result ? (
            <>
              {/* Seleção de dispositivo */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    <UserIcon className="w-3.5 h-3.5 inline mr-1" />Cliente
                  </label>
                  <select
                    value={selectedClient}
                    onChange={e => { setSelectedClient(e.target.value); setSelectedDevice(''); }}
                    className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="">Todos os clientes</option>
                    {clients.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    <Server className="w-3.5 h-3.5 inline mr-1" />Dispositivo *
                  </label>
                  <select
                    value={selectedDevice}
                    onChange={e => setSelectedDevice(e.target.value)}
                    className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="">Selecione...</option>
                    {devices.map((d: any) => (
                      <option key={d.id} value={d.id}>{d.name} ({d.management_ip})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Variáveis */}
              {varEntries.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2">Variáveis do Playbook</h3>
                  <div className="space-y-2">
                    {varEntries.map(([key, defaultVal]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-36 text-xs font-mono text-yellow-300 shrink-0">{key}</span>
                        <input
                          type={key.toLowerCase().includes('pass') || key.toLowerCase().includes('senha') ? 'password' : 'text'}
                          value={varOverrides[key] ?? defaultVal}
                          onChange={e => setVarOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                          className="flex-1 bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Passos resumo */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2">Passos ({playbook.steps.length})</h3>
                <div className="space-y-1">
                  {playbook.steps.sort((a, b) => a.order - b.order).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="w-5 h-5 rounded-full bg-[#1a2a4a] flex items-center justify-center text-gray-500 shrink-0">{i + 1}</span>
                      <span>{s.label || s.step_type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* Resultado */
            <div className="space-y-3">
              <div className={`flex items-center gap-2 p-3 rounded-lg border ${result.status === 'success' ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'}`}>
                {STATUS_ICONS[result.status] || <Info className="w-4 h-4" />}
                <span className={`font-medium text-sm ${STATUS_COLORS[result.status]}`}>
                  {result.status === 'success' ? 'Playbook executado com sucesso!' : `Erro: ${result.error_message || 'Falha na execução'}`}
                </span>
                {result.duration_ms && (
                  <span className="ml-auto text-xs text-gray-500">{formatDuration(result.duration_ms)}</span>
                )}
              </div>

              {/* Logs por passo */}
              {result.step_logs.length > 0 && (
                <div className="space-y-1">
                  {result.step_logs.map((log, i) => (
                    <div key={i} className="border border-[#2a3a5c] rounded overflow-hidden">
                      <button
                        onClick={() => setExpandedLog(expandedLog === i ? null : i)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#1a2a4a]"
                      >
                        {STATUS_ICONS[log.status] || <Info className="w-4 h-4 text-blue-400" />}
                        <span className="text-xs font-medium text-white flex-1">{log.label || `Passo ${log.step}`}</span>
                        <span className="text-xs text-gray-500">{formatDuration(log.duration_ms)}</span>
                        {expandedLog === i ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                      </button>
                      {expandedLog === i && log.output && (
                        <pre className="px-3 py-2 text-xs text-gray-300 bg-[#0a1628] overflow-x-auto whitespace-pre-wrap font-mono max-h-40">
                          {log.output}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Arquivos gerados */}
              {result.output_files.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Download className="w-4 h-4 text-green-400" /> Arquivos Gerados
                  </h3>
                  <div className="space-y-1">
                    {result.output_files.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-300 bg-[#1a2a4a] rounded px-3 py-2">
                        <FileText className="w-3.5 h-3.5 text-green-400" />
                        <span className="font-mono flex-1">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-[#2a3a5c]">
          {result ? (
            <>
              <button
                onClick={() => setResult(null)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                <RefreshCw className="w-4 h-4" /> Executar Novamente
              </button>
              <button onClick={onClose} className="px-4 py-2 bg-[#1a2a4a] hover:bg-[#2a3a5c] text-white text-sm rounded-lg">
                Fechar
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                Cancelar
              </button>
              <button
                onClick={handleExecute}
                disabled={executing || !selectedDevice}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg disabled:opacity-50"
              >
                {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {executing ? 'Executando...' : 'Executar Agora'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PlaybooksPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'playbooks' | 'history'>('playbooks');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | undefined>();
  const [executingPlaybook, setExecutingPlaybook] = useState<Playbook | undefined>();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks'],
    queryFn: playbooksApi.list,
  });

  const { data: stepTypes = [] } = useQuery({
    queryKey: ['playbook-step-types'],
    queryFn: playbooksApi.stepTypes,
  });

  const { data: allExecutions = [] } = useQuery({
    queryKey: ['playbook-executions-all'],
    queryFn: playbooksApi.allExecutions,
    enabled: activeTab === 'history',
  });

  const createMutation = useMutation({
    mutationFn: playbooksApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playbooks'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => playbooksApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playbooks'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: playbooksApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playbooks'] }),
  });

  const handleSave = async (data: any) => {
    if (editingPlaybook) {
      await updateMutation.mutateAsync({ id: editingPlaybook.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const filtered = playbooks.filter((pb: Playbook) => {
    const matchSearch = !searchTerm || pb.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = !filterCategory || pb.category === filterCategory;
    return matchSearch && matchCat;
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Zap className="w-7 h-7 text-yellow-400" />
            Playbooks
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Sequências automatizadas de comandos para backup, configuração e manutenção
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium"
          >
            <Upload className="w-4 h-4" /> Importar Script
          </button>
          <button
            onClick={() => { setEditingPlaybook(undefined); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Novo Playbook
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#2a3a5c]">
        <button
          onClick={() => setActiveTab('playbooks')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'playbooks' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <List className="w-4 h-4" /> Playbooks ({playbooks.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <History className="w-4 h-4" /> Histórico
        </button>
      </div>

      {/* Playbooks Tab */}
      {activeTab === 'playbooks' && (
        <>
          {/* Filtros */}
          <div className="flex gap-3">
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar playbook..."
              className="flex-1 bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
            />
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Todas as categorias</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Lista */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">Nenhum playbook encontrado</p>
              <p className="text-sm mt-1">Crie um playbook para automatizar tarefas repetitivas</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filtered.map((pb: Playbook) => (
                <div key={pb.id} className="bg-[#0d1b35] border border-[#2a3a5c] rounded-xl p-4 hover:border-blue-700 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white">{pb.name}</h3>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-[#1a2a4a] text-gray-300">
                          {CATEGORIES.find(c => c.value === pb.category)?.label || pb.category}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-[#1a2a4a] text-gray-400">
                          {pb.steps.length} passos
                        </span>
                        {Object.keys(pb.variables || {}).length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-900/30 text-yellow-400">
                            {Object.keys(pb.variables).length} variáveis
                          </span>
                        )}
                      </div>
                      {pb.description && (
                        <p className="text-sm text-gray-400 mt-1">{pb.description}</p>
                      )}
                      <p className="text-xs text-gray-600 mt-1">
                        Criado em {formatDate(pb.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setExecutingPlaybook(pb)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg"
                      >
                        <Play className="w-3.5 h-3.5" /> Executar
                      </button>
                      <button
                        onClick={() => { setEditingPlaybook(pb); setShowForm(true); }}
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-[#1a2a4a] rounded"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (confirm(`Excluir "${pb.name}"?`)) deleteMutation.mutate(pb.id); }}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-[#1a2a4a] rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-2">
          {allExecutions.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhuma execução registrada ainda</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-[#2a3a5c]">
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Playbook</th>
                    <th className="pb-2 pr-4">Dispositivo</th>
                    <th className="pb-2 pr-4">Cliente</th>
                    <th className="pb-2 pr-4">Duração</th>
                    <th className="pb-2">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a2a4a]">
                  {allExecutions.map((ex: PlaybookExecution) => (
                    <tr key={ex.id} className="hover:bg-[#1a2a4a]/30">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5">
                          {STATUS_ICONS[ex.status] || <Info className="w-4 h-4" />}
                          <span className={`text-xs ${STATUS_COLORS[ex.status]}`}>{ex.status}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-white font-medium">{ex.playbook_name}</td>
                      <td className="py-2 pr-4 text-gray-300">{ex.device_name} <span className="text-gray-500 text-xs">({ex.device_ip})</span></td>
                      <td className="py-2 pr-4 text-gray-400">{ex.client_name || '-'}</td>
                      <td className="py-2 pr-4 text-gray-400 font-mono text-xs">{formatDuration(ex.duration_ms)}</td>
                      <td className="py-2 text-gray-500 text-xs">{formatDate(ex.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <PlaybookFormModal
          playbook={editingPlaybook}
          stepTypes={stepTypes}
          onClose={() => { setShowForm(false); setEditingPlaybook(undefined); }}
          onSave={handleSave}
        />
      )}

      {showImport && (
        <ImportScriptModal
          stepTypes={stepTypes}
          onClose={() => setShowImport(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: ['playbooks'] })}
        />
      )}

      {executingPlaybook && (
        <ExecuteModal
          playbook={executingPlaybook}
          onClose={() => setExecutingPlaybook(undefined)}
        />
      )}
    </div>
  );
}
