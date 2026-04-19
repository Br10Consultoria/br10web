/**
 * PlaybookTerminal — Modal de execução de playbook com terminal ao vivo (SSE).
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Header: nome do playbook + dispositivo + status             │
 *   ├──────────────────────┬──────────────────────────────────────┤
 *   │ Painel de Passos     │ Terminal de Output                   │
 *   │ (lista com ícones)   │ (saída ao vivo do passo atual)       │
 *   ├──────────────────────┴──────────────────────────────────────┤
 *   │ Barra de progresso + botão Fechar/Executar Novamente        │
 *   └─────────────────────────────────────────────────────────────┘
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CheckCircle, XCircle, Loader2, Clock, Terminal,
  Play, X, RefreshCw, Download, FileText, AlertTriangle,
  Wifi, ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StepInfo {
  index: number;   // 1-based
  label: string;
  type: string;
}

interface StepEvent {
  step: number;    // 1-based
  type: string;
  label: string;
  status: 'running' | 'success' | 'error' | 'pending';
  output: string;
  error: string;
  duration_ms: number;
  timestamp: string;
}

interface MetaEvent {
  __meta__: true;
  execution_id: string;
  playbook_name: string;
  device_name: string;
  device_ip: string;
  total_steps: number;
  steps_info: StepInfo[];
}

interface FinalEvent {
  __final__: true;
  execution_id: string;
  status: 'success' | 'error';
  error_message: string;
  duration_ms: number;
  output_files: string[];
}

type SSEEvent = MetaEvent | FinalEvent | StepEvent;

interface PlaybookTerminalProps {
  playbookId: string;
  playbookName: string;
  deviceId: string;
  deviceName: string;
  variablesOverride: Record<string, string>;
  onClose: () => void;
  onDone?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending:  <Clock className="w-4 h-4 text-gray-500" />,
  running:  <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />,
  success:  <CheckCircle className="w-4 h-4 text-green-400" />,
  error:    <XCircle className="w-4 h-4 text-red-400" />,
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-gray-500',
  running: 'text-yellow-300',
  success: 'text-green-300',
  error:   'text-red-300',
};

const STEP_TYPE_COLOR: Record<string, string> = {
  telnet_connect: 'text-blue-400',
  ssh_connect:    'text-blue-400',
  send_command:   'text-green-400',
  send_string:    'text-green-300',
  wait_for:       'text-yellow-400',
  ftp_download:   'text-purple-400',
  scp_download:   'text-purple-400',
  telegram_send_file: 'text-sky-400',
  sleep:          'text-gray-400',
  disconnect:     'text-orange-400',
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export function PlaybookTerminal({
  playbookId,
  playbookName,
  deviceId,
  deviceName,
  variablesOverride,
  onClose,
  onDone,
}: PlaybookTerminalProps) {
  const { accessToken } = useAuthStore();
  const token = accessToken || localStorage.getItem('access_token') || '';

  // Estado da execução
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [stepsInfo, setStepsInfo] = useState<StepInfo[]>([]);
  const [stepStatuses, setStepStatuses] = useState<Record<number, StepEvent>>({});
  const [activeStep, setActiveStep] = useState<number>(0);
  const [finalResult, setFinalResult] = useState<FinalEvent | null>(null);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [stepOutputs, setStepOutputs] = useState<Record<number, string>>({});

  const terminalRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll do terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines]);

  const appendLine = useCallback((line: string) => {
    setTerminalLines(prev => [...prev, line]);
  }, []);

  const startExecution = useCallback(async () => {
    // Reset state
    setPhase('running');
    setStepsInfo([]);
    setStepStatuses({});
    setActiveStep(0);
    setFinalResult(null);
    setTerminalLines([]);
    setSelectedStep(null);
    setStepOutputs({});

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    appendLine(`\x1b[36m[${new Date().toLocaleTimeString()}] Iniciando execução do playbook: ${playbookName}\x1b[0m`);
    appendLine(`\x1b[36m[${new Date().toLocaleTimeString()}] Dispositivo: ${deviceName}\x1b[0m`);
    appendLine('─'.repeat(60));

    try {
      const response = await fetch(`/api/v1/playbooks/${playbookId}/execute/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          device_id: deviceId,
          variables_override: variablesOverride,
        }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Erro desconhecido' }));
        appendLine(`\x1b[31m[ERRO] ${err.detail || 'Falha ao iniciar execução'}\x1b[0m`);
        setPhase('done');
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: SSEEvent;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          // Evento de metadados (início)
          if ('__meta__' in event) {
            setStepsInfo(event.steps_info);
            appendLine(`\x1b[33m[INFO] ${event.total_steps} passo(s) a executar\x1b[0m`);
            continue;
          }

          // Evento final
          if ('__final__' in event) {
            setFinalResult(event);
            setPhase('done');
            appendLine('─'.repeat(60));
            if (event.status === 'success') {
              appendLine(`\x1b[32m[✓] Playbook concluído com sucesso! (${formatDuration(event.duration_ms)})\x1b[0m`);
            } else {
              appendLine(`\x1b[31m[✗] Playbook falhou: ${event.error_message || 'Erro desconhecido'}\x1b[0m`);
            }
            if (event.output_files?.length) {
              appendLine(`\x1b[36m[FILES] ${event.output_files.length} arquivo(s) gerado(s)\x1b[0m`);
            }
            onDone?.();
            continue;
          }

          // Evento de passo
          const stepEvt = event as StepEvent;
          setStepStatuses(prev => ({ ...prev, [stepEvt.step]: stepEvt }));

          if (stepEvt.status === 'running') {
            setActiveStep(stepEvt.step);
            setSelectedStep(stepEvt.step);
            appendLine(`\x1b[33m[→] Passo ${stepEvt.step}: ${stepEvt.label}\x1b[0m`);
          } else if (stepEvt.status === 'success') {
            const dur = stepEvt.duration_ms ? ` (${formatDuration(stepEvt.duration_ms)})` : '';
            appendLine(`\x1b[32m[✓] Passo ${stepEvt.step}: ${stepEvt.label}${dur}\x1b[0m`);
            if (stepEvt.output) {
              setStepOutputs(prev => ({ ...prev, [stepEvt.step]: stepEvt.output }));
              // Mostrar primeiras linhas do output no terminal
              const outLines = stepEvt.output.split('\n').slice(0, 8);
              for (const ol of outLines) {
                if (ol.trim()) appendLine(`    \x1b[90m${ol}\x1b[0m`);
              }
              if (stepEvt.output.split('\n').length > 8) {
                appendLine(`    \x1b[90m... (clique no passo para ver tudo)\x1b[0m`);
              }
            }
          } else if (stepEvt.status === 'error') {
            appendLine(`\x1b[31m[✗] Passo ${stepEvt.step}: ${stepEvt.label}\x1b[0m`);
            if (stepEvt.error) {
              appendLine(`    \x1b[31m${stepEvt.error}\x1b[0m`);
            }
            setStepOutputs(prev => ({ ...prev, [stepEvt.step]: stepEvt.output || stepEvt.error }));
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        appendLine(`\x1b[31m[ERRO] Conexão interrompida: ${err.message}\x1b[0m`);
        setPhase('done');
      }
    }
  }, [playbookId, playbookName, deviceId, deviceName, variablesOverride, token, appendLine, onDone]);

  // Iniciar automaticamente ao montar
  useEffect(() => {
    startExecution();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Calcular progresso
  const totalSteps = stepsInfo.length;
  const doneSteps = Object.values(stepStatuses).filter(
    s => s.status === 'success' || s.status === 'error'
  ).length;
  const progress = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  // Renderizar linha do terminal com cores ANSI básicas
  function renderTerminalLine(line: string, idx: number) {
    // Converter escape codes ANSI simples para spans coloridos
    const parts = line.split(/\x1b\[(\d+)m/);
    const spans: React.ReactNode[] = [];
    let currentColor = '';
    const colorMap: Record<string, string> = {
      '0': '', '30': 'text-gray-500', '31': 'text-red-400', '32': 'text-green-400',
      '33': 'text-yellow-400', '36': 'text-cyan-400', '90': 'text-gray-500',
    };
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) {
          spans.push(
            <span key={i} className={currentColor}>{parts[i]}</span>
          );
        }
      } else {
        currentColor = colorMap[parts[i]] || '';
      }
    }
    return (
      <div key={idx} className="leading-5 min-h-[1.25rem]">
        {spans.length > 0 ? spans : <span className="text-gray-300">{line}</span>}
      </div>
    );
  }

  const selectedOutput = selectedStep !== null ? (stepOutputs[selectedStep] || '') : '';
  const selectedStepInfo = selectedStep !== null ? stepStatuses[selectedStep] : null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-[#0a0f1e] border border-[#1e3a5f] rounded-xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e3a5f] bg-[#0d1b35] rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-white">{playbookName}</span>
            <span className="text-xs text-gray-500">→</span>
            <span className="text-xs text-blue-400">{deviceName}</span>
          </div>
          <div className="flex items-center gap-3">
            {phase === 'running' && (
              <div className="flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-green-400 animate-pulse" />
                <span className="text-xs text-green-400">Executando...</span>
              </div>
            )}
            {phase === 'done' && finalResult && (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${finalResult.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                {finalResult.status === 'success'
                  ? <CheckCircle className="w-3.5 h-3.5" />
                  : <XCircle className="w-3.5 h-3.5" />}
                {finalResult.status === 'success' ? 'Concluído' : 'Falhou'}
                {finalResult.duration_ms > 0 && (
                  <span className="text-gray-500 font-normal ml-1">({formatDuration(finalResult.duration_ms)})</span>
                )}
              </div>
            )}
            <button
              onClick={() => { abortRef.current?.abort(); onClose(); }}
              className="p-1 text-gray-500 hover:text-white rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Barra de progresso ── */}
        {totalSteps > 0 && (
          <div className="h-1 bg-[#1a2a4a] w-full">
            <div
              className={`h-full transition-all duration-500 ${
                finalResult?.status === 'error' ? 'bg-red-500' : 'bg-green-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* ── Corpo principal: passos + terminal ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Painel de Passos */}
          <div className="w-64 shrink-0 border-r border-[#1e3a5f] flex flex-col bg-[#0d1420]">
            <div className="px-3 py-2 border-b border-[#1e3a5f]">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Passos {totalSteps > 0 ? `(${doneSteps}/${totalSteps})` : ''}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {stepsInfo.length === 0 && phase === 'running' && (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando...
                </div>
              )}
              {stepsInfo.map((info) => {
                const evt = stepStatuses[info.index];
                const status = evt?.status || 'pending';
                const isActive = info.index === activeStep && status === 'running';
                const isSelected = info.index === selectedStep;

                return (
                  <button
                    key={info.index}
                    onClick={() => setSelectedStep(isSelected ? null : info.index)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? 'bg-[#1a2a4a] border-l-2 border-blue-500'
                        : isActive
                        ? 'bg-[#1a2a3a] border-l-2 border-yellow-500'
                        : 'hover:bg-[#141e30] border-l-2 border-transparent'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {STATUS_ICON[status]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium truncate ${STATUS_COLOR[status]}`}>
                        {info.label}
                      </div>
                      <div className={`text-[10px] mt-0.5 ${STEP_TYPE_COLOR[info.type] || 'text-gray-600'}`}>
                        {info.type}
                      </div>
                      {evt?.duration_ms > 0 && (
                        <div className="text-[10px] text-gray-600 mt-0.5">
                          {formatDuration(evt.duration_ms)}
                        </div>
                      )}
                    </div>
                    {(stepOutputs[info.index]) && (
                      <ChevronRight className="w-3 h-3 text-gray-600 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Terminal + Output do passo selecionado */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Output do passo selecionado (quando clicado) */}
            {selectedStep !== null && selectedOutput && (
              <div className="border-b border-[#1e3a5f] bg-[#0a1020]">
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d1b35]">
                  <span className="text-xs text-gray-400 font-medium">
                    Output — Passo {selectedStep}: {selectedStepInfo?.label || ''}
                  </span>
                  <button
                    onClick={() => setSelectedStep(null)}
                    className="text-gray-600 hover:text-gray-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <pre className="px-3 py-2 text-xs text-gray-300 font-mono overflow-auto max-h-40 whitespace-pre-wrap">
                  {selectedOutput}
                </pre>
              </div>
            )}

            {/* Terminal principal */}
            <div
              ref={terminalRef}
              className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs bg-[#050d1a] text-gray-300"
              style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace" }}
            >
              {terminalLines.map((line, idx) => renderTerminalLine(line, idx))}
              {phase === 'running' && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-green-400 animate-pulse">█</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e3a5f] bg-[#0d1b35] rounded-b-xl">
          <div className="flex items-center gap-3">
            {finalResult?.output_files && finalResult.output_files.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <Download className="w-3.5 h-3.5" />
                <span>{finalResult.output_files.length} arquivo(s) gerado(s)</span>
              </div>
            )}
            {totalSteps > 0 && (
              <span className="text-xs text-gray-600">
                {doneSteps}/{totalSteps} passos
                {totalSteps > 0 && ` · ${progress}%`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {phase === 'done' && (
              <button
                onClick={() => startExecution()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-[#2a3a5c] hover:border-[#4a5a7c] rounded-lg"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Executar Novamente
              </button>
            )}
            <button
              onClick={() => { abortRef.current?.abort(); onClose(); }}
              className={`px-4 py-1.5 text-xs rounded-lg ${
                phase === 'running'
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : 'bg-[#1a2a4a] hover:bg-[#2a3a5c] text-white'
              }`}
            >
              {phase === 'running' ? 'Cancelar' : 'Fechar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
