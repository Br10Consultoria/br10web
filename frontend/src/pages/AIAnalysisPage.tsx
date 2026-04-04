import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Brain, Upload, Settings, History, CheckCircle, XCircle,
  Loader2, X, ChevronDown, ChevronUp, Copy, Trash2,
  Sparkles, FileText, AlertTriangle, Info, Eye, EyeOff,
  Save, RefreshCw, Zap, Server, User as UserIcon,
} from 'lucide-react';
import api from '../utils/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AIProvider {
  id?: string;
  provider: string;
  display_name: string;
  default_model: string;
  available_models: string[];
  is_active: boolean;
  max_tokens: number;
  temperature: number;
  system_prompt?: string;
  has_api_key: boolean;
  updated_at?: string;
}

interface AIAnalysis {
  id: string;
  source_type: string;
  source_id?: string;
  device_name?: string;
  client_name?: string;
  analysis_type: string;
  provider: string;
  model_used: string;
  input_preview?: string;
  result?: string;
  tokens_used?: number;
  status: string;
  error_message?: string;
  duration_ms?: number;
  created_at: string;
  finished_at?: string;
}

interface AnalysisType {
  type: string;
  label: string;
  description: string;
}

// ─── Dados estáticos de fallback ────────────────────────────────────────────────────────────────────

const FALLBACK_ANALYSIS_TYPES: AnalysisType[] = [
  { type: 'alarms',     label: 'Alarmes de Rede',       description: 'Análise de alarmes e eventos críticos' },
  { type: 'bgp',        label: 'BGP / Roteamento',      description: 'Análise de sessões BGP e tabela de rotas' },
  { type: 'olt',        label: 'OLT / PON',             description: 'Análise de ONUs, sinal óptico e alarmes PON' },
  { type: 'system_log', label: 'Log de Sistema',        description: 'Análise de logs gerais do equipamento' },
  { type: 'interfaces', label: 'Interfaces',            description: 'Análise de erros e status de interfaces' },
  { type: 'routing',    label: 'Tabela de Rotas',       description: 'Análise da tabela de roteamento IP' },
  { type: 'backup',     label: 'Arquivo de Backup',     description: 'Análise de arquivo de configuração' },
  { type: 'custom',     label: 'Análise Personalizada', description: 'Análise com prompt personalizado' },
];

const FALLBACK_PROVIDERS: AIProvider[] = [
  {
    provider: 'openai', display_name: 'OpenAI', default_model: 'gpt-4o',
    available_models: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    is_active: false, max_tokens: 4096, temperature: 0.3, has_api_key: false,
  },
  {
    provider: 'gemini', display_name: 'Google Gemini', default_model: 'gemini-2.5-flash',
    available_models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    is_active: false, max_tokens: 4096, temperature: 0.3, has_api_key: false,
  },
  {
    provider: 'anthropic', display_name: 'Anthropic Claude', default_model: 'claude-3-5-sonnet-20241022',
    available_models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    is_active: false, max_tokens: 4096, temperature: 0.3, has_api_key: false,
  },
];

// ─── API ──────────────────────────────────────────────────────────────────────

const aiApi = {
  providers: () => api.get('/ai/providers').then(r => r.data),
  configureProvider: (provider: string, data: any) =>
    api.put(`/ai/providers/${provider}`, data).then(r => r.data),
  removeProvider: (provider: string) => api.delete(`/ai/providers/${provider}`),
  analyze: (data: any) => api.post('/ai/analyze', data).then(r => r.data),
  analyzeFile: (formData: FormData) =>
    api.post('/ai/analyze/file', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  analyses: (type?: string) =>
    api.get('/ai/analyses', { params: type ? { analysis_type: type } : {} }).then(r => r.data),
  deleteAnalysis: (id: string) => api.delete(`/ai/analyses/${id}`),
  analysisTypes: () => api.get('/ai/meta/analysis-types').then(r => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  openai: '🤖',
  gemini: '✨',
  anthropic: '🧠',
};

const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-400',
  error: 'text-red-400',
  running: 'text-yellow-400',
  pending: 'text-gray-400',
};

function formatDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}

function formatDuration(ms?: number) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Provider Config Card ─────────────────────────────────────────────────────

function ProviderCard({
  provider,
  onSave,
  onRemove,
}: {
  provider: AIProvider;
  onSave: (p: string, data: any) => Promise<void>;
  onRemove: (p: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(provider.default_model);
  const [maxTokens, setMaxTokens] = useState(provider.max_tokens);
  const [temperature, setTemperature] = useState(provider.temperature);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(provider.provider, {
        api_key: apiKey || '___keep___',
        default_model: model,
        max_tokens: maxTokens,
        temperature,
      });
      setEditing(false);
      setApiKey('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`bg-[#0d1b35] border rounded-xl p-4 ${provider.is_active ? 'border-blue-700' : 'border-[#2a3a5c]'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{PROVIDER_ICONS[provider.provider] || '🤖'}</span>
          <div>
            <h3 className="font-semibold text-white">{provider.display_name}</h3>
            <p className="text-xs text-gray-500">{provider.provider}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {provider.is_active && provider.has_api_key && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle className="w-3.5 h-3.5" /> Configurado
            </span>
          )}
          {!provider.has_api_key && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <AlertTriangle className="w-3.5 h-3.5" /> Sem chave
            </span>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-[#1a2a4a] rounded"
          >
            <Settings className="w-4 h-4" />
          </button>
          {provider.has_api_key && (
            <button
              onClick={() => { if (confirm('Remover configuração?')) onRemove(provider.provider); }}
              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-[#1a2a4a] rounded"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {provider.has_api_key && !editing && (
        <div className="text-xs text-gray-400 space-y-1">
          <p>Modelo: <span className="text-white">{provider.default_model}</span></p>
          <p>Max tokens: <span className="text-white">{provider.max_tokens}</span> · Temperatura: <span className="text-white">{provider.temperature}</span></p>
        </div>
      )}

      {editing && (
        <div className="space-y-3 mt-3 pt-3 border-t border-[#2a3a5c]">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Chave de API {provider.has_api_key && '(deixe em branco para manter a atual)'}</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={provider.has_api_key ? '••••••••••••••••' : 'sk-...'}
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-3 py-2 text-sm text-white placeholder-gray-600 pr-10"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Modelo padrão</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-sm text-white"
              >
                {provider.available_models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max tokens</label>
              <input
                type="number"
                value={maxTokens}
                onChange={e => setMaxTokens(Number(e.target.value))}
                min={256}
                max={32768}
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded px-2 py-1.5 text-sm text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Temperatura: {temperature}</label>
            <input
              type="range"
              value={temperature}
              onChange={e => setTemperature(Number(e.target.value))}
              min={0}
              max={1}
              step={0.1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-600">
              <span>Preciso (0)</span>
              <span>Criativo (1)</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!apiKey && !provider.has_api_key)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Analysis Result ──────────────────────────────────────────────────────────

function AnalysisResult({ analysis }: { analysis: AIAnalysis }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const copyResult = () => {
    if (analysis.result) {
      navigator.clipboard.writeText(analysis.result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${analysis.status === 'success' ? 'border-green-700/50' : 'border-red-700/50'}`}>
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${analysis.status === 'success' ? 'bg-green-900/20' : 'bg-red-900/20'}`}
        onClick={() => setExpanded(!expanded)}
      >
        {analysis.status === 'success' ? (
          <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">
              {PROVIDER_ICONS[analysis.provider] || '🤖'} {analysis.model_used}
            </span>
            <span className="text-xs text-gray-400">{analysis.analysis_type}</span>
            {analysis.device_name && (
              <span className="text-xs text-gray-500">· {analysis.device_name}</span>
            )}
            {analysis.tokens_used && (
              <span className="text-xs text-gray-600">· {analysis.tokens_used} tokens</span>
            )}
            <span className="text-xs text-gray-600">· {formatDuration(analysis.duration_ms)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{formatDate(analysis.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          {analysis.status === 'success' && (
            <button
              onClick={e => { e.stopPropagation(); copyResult(); }}
              className="p-1.5 text-gray-400 hover:text-white"
              title="Copiar resultado"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 bg-[#0a1628]">
          {analysis.status === 'success' && analysis.result ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans leading-relaxed">
                {analysis.result}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-red-400">{analysis.error_message || 'Erro desconhecido'}</p>
          )}
          {copied && (
            <p className="text-xs text-green-400 mt-2">✓ Copiado!</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AIAnalysisPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'analyze' | 'history' | 'settings'>('analyze');
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [textContent, setTextContent] = useState('');
  const [analysisType, setAnalysisType] = useState('custom');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [context, setContext] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [clientName, setClientName] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchParams] = useSearchParams();
  const [currentAnalysis, setCurrentAnalysis] = useState<AIAnalysis | null>(null);

  // Pré-popular quando aberto via botão "Analisar com IA" na página de Automações
  useEffect(() => {
    const content = searchParams.get('content');
    const device = searchParams.get('device');
    if (content) {
      setTextContent(content);
      setInputMode('text');
      setActiveTab('analyze');
      if (device) setDeviceName(device);
    }
  }, []);
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: rawProviders } = useQuery<AIProvider[]>({
    queryKey: ['ai-providers'],
    queryFn: aiApi.providers,
    retry: 1,
  });
  // Mescla providers do backend com fallback: usa dados do backend se disponível,
  // mas garante que os 3 providers sempre aparecem
  const providers: AIProvider[] = React.useMemo(() => {
    if (!rawProviders || rawProviders.length === 0) return FALLBACK_PROVIDERS;
    // Garante que todos os 3 providers aparecem (mesmo que o backend retorne menos)
    return FALLBACK_PROVIDERS.map(fp => {
      const fromBackend = rawProviders.find(p => p.provider === fp.provider);
      return fromBackend || fp;
    });
  }, [rawProviders]);

  const { data: rawAnalysisTypes } = useQuery<AnalysisType[]>({
    queryKey: ['ai-analysis-types'],
    queryFn: aiApi.analysisTypes,
    retry: 1,
  });
  const analysisTypes = rawAnalysisTypes && rawAnalysisTypes.length > 0
    ? rawAnalysisTypes
    : FALLBACK_ANALYSIS_TYPES;

  const { data: analyses = [], refetch: refetchAnalyses } = useQuery<AIAnalysis[]>({
    queryKey: ['ai-analyses', filterType],
    queryFn: () => aiApi.analyses(filterType || undefined),
    enabled: activeTab === 'history',
  });

  const configMutation = useMutation({
    mutationFn: ({ provider, data }: { provider: string; data: any }) =>
      aiApi.configureProvider(provider, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  const removeMutation = useMutation({
    mutationFn: aiApi.removeProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  const deleteAnalysisMutation = useMutation({
    mutationFn: aiApi.deleteAnalysis,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-analyses'] }),
  });

  const activeProviders = providers.filter(p => p.has_api_key);

  const handleAnalyze = async () => {
    if (inputMode === 'text' && !textContent.trim()) return;
    if (inputMode === 'file' && !selectedFile) return;

    setAnalyzing(true);
    setCurrentAnalysis(null);

    try {
      let result: AIAnalysis;

      if (inputMode === 'file' && selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('analysis_type', analysisType);
        if (selectedProvider) formData.append('provider', selectedProvider);
        if (selectedModel) formData.append('model', selectedModel);
        if (customPrompt) formData.append('custom_prompt', customPrompt);
        if (context) formData.append('context', context);
        if (deviceName) formData.append('device_name', deviceName);
        if (clientName) formData.append('client_name', clientName);
        result = await aiApi.analyzeFile(formData);
      } else {
        result = await aiApi.analyze({
          content: textContent,
          analysis_type: analysisType,
          provider: selectedProvider || undefined,
          model: selectedModel || undefined,
          custom_prompt: customPrompt || undefined,
          context: context || undefined,
          device_name: deviceName || undefined,
          client_name: clientName || undefined,
          source_type: 'manual',
        });
      }

      setCurrentAnalysis(result);
      queryClient.invalidateQueries({ queryKey: ['ai-analyses'] });
    } catch (err: any) {
      setCurrentAnalysis({
        id: '',
        source_type: 'manual',
        analysis_type: analysisType,
        provider: selectedProvider || 'unknown',
        model_used: selectedModel || 'unknown',
        status: 'error',
        error_message: err?.response?.data?.detail || 'Erro ao analisar conteúdo.',
        created_at: new Date().toISOString(),
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const hasActiveProvider = activeProviders.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Brain className="w-7 h-7 text-purple-400" />
            Análise de IA
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Analise logs, alarmes e outputs de rede com inteligência artificial
          </p>
        </div>
      </div>

      {/* Alert se sem provider */}
      {!hasActiveProvider && (
        <div className="flex items-start gap-3 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-300">Nenhum provider de IA configurado</p>
            <p className="text-xs text-yellow-500 mt-1">
              Configure uma chave de API na aba <strong>Configurações</strong> para começar a usar a análise de IA.
              Suportamos OpenAI (GPT-4o), Google Gemini e Anthropic Claude.
            </p>
            <button
              onClick={() => setActiveTab('settings')}
              className="mt-2 text-xs text-yellow-400 hover:text-yellow-300 underline"
            >
              Ir para Configurações →
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#2a3a5c]">
        {[
          { key: 'analyze', label: 'Analisar', icon: <Sparkles className="w-4 h-4" /> },
          { key: 'history', label: 'Histórico', icon: <History className="w-4 h-4" /> },
          { key: 'settings', label: 'Configurações', icon: <Settings className="w-4 h-4" /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Analyze Tab ── */}
      {activeTab === 'analyze' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Entrada</h2>

            {/* Tipo de análise */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tipo de Análise</label>
              <select
                value={analysisType}
                onChange={e => setAnalysisType(e.target.value)}
                className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white"
              >
                {analysisTypes.map((t: AnalysisType) => (
                  <option key={t.type} value={t.type}>{t.label} — {t.description}</option>
                ))}
              </select>
            </div>

            {/* Provider e modelo */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Provider</label>
                <select
                  value={selectedProvider}
                  onChange={e => { setSelectedProvider(e.target.value); setSelectedModel(''); }}
                  className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="">Auto (mais recente)</option>
                  {activeProviders.map(p => (
                    <option key={p.provider} value={p.provider}>
                      {PROVIDER_ICONS[p.provider]} {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Modelo</label>
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white"
                  disabled={!selectedProvider}
                >
                  <option value="">Padrão do provider</option>
                  {selectedProvider && providers
                    .find(p => p.provider === selectedProvider)
                    ?.available_models.map(m => <option key={m} value={m}>{m}</option>)
                  }
                </select>
              </div>
            </div>

            {/* Contexto */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  <Server className="w-3.5 h-3.5 inline mr-1" />Dispositivo (opcional)
                </label>
                <input
                  type="text"
                  value={deviceName}
                  onChange={e => setDeviceName(e.target.value)}
                  placeholder="Ex: OLT-ZTE-01"
                  className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  <UserIcon className="w-3.5 h-3.5 inline mr-1" />Cliente (opcional)
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  placeholder="Ex: Titan Telecom"
                  className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
                />
              </div>
            </div>

            {/* Modo de entrada */}
            <div className="flex gap-2">
              <button
                onClick={() => setInputMode('text')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg border transition-colors ${inputMode === 'text' ? 'border-purple-500 bg-purple-900/20 text-purple-300' : 'border-[#2a3a5c] text-gray-400 hover:text-white'}`}
              >
                <FileText className="w-4 h-4" /> Colar Texto
              </button>
              <button
                onClick={() => setInputMode('file')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg border transition-colors ${inputMode === 'file' ? 'border-purple-500 bg-purple-900/20 text-purple-300' : 'border-[#2a3a5c] text-gray-400 hover:text-white'}`}
              >
                <Upload className="w-4 h-4" /> Upload de Arquivo
              </button>
            </div>

            {/* Conteúdo */}
            {inputMode === 'text' ? (
              <textarea
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                placeholder="Cole aqui o log, output de comando, alarme ou qualquer texto para análise..."
                rows={10}
                className="w-full bg-[#0a1628] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 font-mono resize-none focus:border-purple-500 focus:outline-none"
              />
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#2a3a5c] rounded-lg p-8 text-center cursor-pointer hover:border-purple-500 transition-colors"
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-gray-500" />
                {selectedFile ? (
                  <div>
                    <p className="text-sm text-white font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500 mt-1">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    <button
                      onClick={e => { e.stopPropagation(); setSelectedFile(null); }}
                      className="mt-2 text-xs text-red-400 hover:text-red-300"
                    >
                      Remover
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-400">Clique para selecionar um arquivo</p>
                    <p className="text-xs text-gray-600 mt-1">.txt, .log, .cfg, .conf (máx. 5MB)</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.log,.cfg,.conf,.csv,.json"
                  className="hidden"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                />
              </div>
            )}

            {/* Prompt personalizado */}
            {analysisType === 'custom' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Prompt Personalizado</label>
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="Descreva o que você quer que a IA analise e retorne..."
                  rows={3}
                  className="w-full bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 resize-none"
                />
              </div>
            )}

            {/* Botão */}
            <button
              onClick={handleAnalyze}
              disabled={analyzing || !hasActiveProvider || (inputMode === 'text' && !textContent.trim()) || (inputMode === 'file' && !selectedFile)}
              className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
            >
              {analyzing ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Analisando...</>
              ) : (
                <><Sparkles className="w-5 h-5" /> Analisar com IA</>
              )}
            </button>
          </div>

          {/* Output */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Resultado</h2>
            {analyzing && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <Loader2 className="w-10 h-10 animate-spin text-purple-400 mb-3" />
                <p className="text-sm">Analisando com IA...</p>
                <p className="text-xs mt-1">Isso pode levar alguns segundos</p>
              </div>
            )}
            {!analyzing && !currentAnalysis && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <Brain className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">O resultado da análise aparecerá aqui</p>
              </div>
            )}
            {!analyzing && currentAnalysis && (
              <AnalysisResult analysis={currentAnalysis} />
            )}
          </div>
        </div>
      )}

      {/* ── History Tab ── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="bg-[#1a2a4a] border border-[#2a3a5c] rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Todos os tipos</option>
              {analysisTypes.map((t: AnalysisType) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </select>
            <button
              onClick={() => refetchAnalyses()}
              className="p-2 text-gray-400 hover:text-white hover:bg-[#1a2a4a] rounded-lg"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-500">{analyses.length} análises</span>
          </div>

          {analyses.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhuma análise registrada ainda</p>
            </div>
          ) : (
            <div className="space-y-3">
              {analyses.map((a: AIAnalysis) => (
                <div key={a.id} className="relative">
                  <AnalysisResult analysis={a} />
                  <button
                    onClick={() => { if (confirm('Excluir esta análise?')) deleteAnalysisMutation.mutate(a.id); }}
                    className="absolute top-3 right-12 p-1.5 text-gray-600 hover:text-red-400"
                    title="Excluir"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Settings Tab ── */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <div className="bg-[#0a1628] border border-[#1a2a4a] rounded-xl p-4 text-sm text-gray-400">
            <Info className="w-4 h-4 inline mr-2 text-blue-400" />
            Configure a chave de API de pelo menos um provider para usar a análise de IA.
            As chaves são armazenadas de forma criptografada no banco de dados.
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {providers.map((p: AIProvider) => (
              <ProviderCard
                key={p.provider}
                provider={p}
                onSave={async (provider, data) => {
                  await configMutation.mutateAsync({ provider, data });
                }}
                onRemove={async (provider) => {
                  await removeMutation.mutateAsync(provider);
                }}
              />
            ))}
          </div>

          <div className="bg-[#0d1b35] border border-[#2a3a5c] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Onde obter as chaves de API</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <p>
                <span className="text-white">🤖 OpenAI:</span>{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  platform.openai.com/api-keys
                </a>
                {' '}— Modelos: GPT-4o, GPT-4.1, GPT-4.1-mini
              </p>
              <p>
                <span className="text-white">✨ Google Gemini:</span>{' '}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  aistudio.google.com/app/apikey
                </a>
                {' '}— Modelos: Gemini 2.5 Flash, 2.0 Flash, 1.5 Pro (gratuito com limites)
              </p>
              <p>
                <span className="text-white">🧠 Anthropic Claude:</span>{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  console.anthropic.com/settings/keys
                </a>
                {' '}— Modelos: Claude 3.5 Sonnet, Haiku
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
