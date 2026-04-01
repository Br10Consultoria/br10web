import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, ArrowLeft, Wifi, WifiOff, Loader2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { devicesApi } from '../utils/api'
import { useAuthStore } from '../store/authStore'

export default function TerminalPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { accessToken } = useAuthStore()

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<any>(null)

  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [protocol, setProtocol] = useState(searchParams.get('protocol') || 'ssh')
  const [isFullscreen, setIsFullscreen] = useState(false)

  const { data: device } = useQuery({
    queryKey: ['device', id],
    queryFn: () => devicesApi.get(id!).then(r => r.data),
    enabled: !!id,
  })

  const initTerminal = useCallback(async () => {
    if (!terminalRef.current) return

    // Importar xterm dinamicamente
    const { Terminal } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    const { WebLinksAddon } = await import('@xterm/addon-web-links')

    // Importar CSS do xterm
    await import('@xterm/xterm/css/xterm.css')

    if (xtermRef.current) {
      xtermRef.current.dispose()
    }

    const term = new Terminal({
      theme: {
        background: '#000000',
        foreground: '#f8f8f2',
        cursor: '#f8f8f2',
        cursorAccent: '#000000',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#6272a4',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#bfbfbf',
        brightBlack: '#4d4d4d',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit() } catch {}
    })
    resizeObserver.observe(terminalRef.current)

    return () => resizeObserver.disconnect()
  }, [])

  const connect = useCallback(async () => {
    if (!id || !accessToken) return
    setConnecting(true)

    try {
      await initTerminal()

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${wsProtocol}//${window.location.host}/api/v1/terminal/ws/${id}?token=${accessToken}&protocol=${protocol}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnecting(false)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const term = xtermRef.current

          switch (msg.type) {
            case 'connected':
              setConnected(true)
              term?.writeln(`\r\n\x1b[32m✓ Conectado a ${msg.device} via ${msg.protocol}\x1b[0m\r\n`)
              break
            case 'output':
              term?.write(msg.data)
              break
            case 'error':
              term?.writeln(`\r\n\x1b[31m✗ Erro: ${msg.message}\x1b[0m\r\n`)
              setConnected(false)
              setConnecting(false)
              break
            case 'disconnected':
              term?.writeln(`\r\n\x1b[33m⚡ Sessão encerrada\x1b[0m\r\n`)
              setConnected(false)
              break
            case 'info':
              term?.writeln(`\r\n\x1b[34mℹ ${msg.message}\x1b[0m`)
              break
          }
        } catch {
          xtermRef.current?.write(event.data)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        setConnecting(false)
        xtermRef.current?.writeln('\r\n\x1b[33m⚡ Conexão encerrada\x1b[0m\r\n')
      }

      ws.onerror = () => {
        setConnecting(false)
        toast.error('Erro na conexão WebSocket')
      }

      // Enviar input do terminal
      xtermRef.current?.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })

      // Enviar resize
      xtermRef.current?.onResize(({ cols, rows }: any) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      })

    } catch (err) {
      setConnecting(false)
      toast.error('Erro ao inicializar terminal')
    }
  }, [id, accessToken, protocol, initTerminal])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    setConnected(false)
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      xtermRef.current?.dispose()
    }
  }, [])

  return (
    <div className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-dark-950' : 'h-[calc(100vh-8rem)]'}`}>
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-dark-900 border border-dark-700 rounded-t-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/devices/${id}`)}
            className="btn-ghost p-1.5 rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-green-400" />
            <span className="font-medium text-white text-sm">
              {device?.name || 'Terminal'}
            </span>
            <span className="text-dark-500 text-xs font-mono">
              {device?.management_ip}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status */}
          <div className="flex items-center gap-1.5">
            {connecting ? (
              <><Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" /><span className="text-xs text-yellow-400">Conectando...</span></>
            ) : connected ? (
              <><Wifi className="w-3.5 h-3.5 text-green-400" /><span className="text-xs text-green-400">Conectado</span></>
            ) : (
              <><WifiOff className="w-3.5 h-3.5 text-red-400" /><span className="text-xs text-red-400">Desconectado</span></>
            )}
          </div>

          {/* Protocol selector */}
          <select
            value={protocol}
            onChange={e => setProtocol(e.target.value)}
            className="input py-1 text-xs w-24"
            disabled={connected || connecting}
          >
            <option value="ssh">SSH</option>
            <option value="telnet">Telnet</option>
          </select>

          {/* Reconnect */}
          {!connected && !connecting && (
            <button onClick={connect} className="btn-success btn-sm">
              <RefreshCw className="w-3.5 h-3.5" />
              Reconectar
            </button>
          )}

          {connected && (
            <button onClick={disconnect} className="btn-danger btn-sm">
              <X className="w-3.5 h-3.5" />
              Desconectar
            </button>
          )}

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="btn-ghost p-1.5 rounded-lg"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div className="flex-1 bg-black border border-t-0 border-dark-700 rounded-b-xl overflow-hidden">
        <div ref={terminalRef} className="h-full w-full" />
      </div>

      {/* Footer info */}
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-dark-600">
        <span>
          {device?.device_type?.replace(/_/g, ' ').toUpperCase()} &mdash; {protocol.toUpperCase()} Port {protocol === 'ssh' ? device?.ssh_port : device?.telnet_port}
        </span>
        <span>Ctrl+C para cancelar &bull; Ctrl+D para sair</span>
      </div>
    </div>
  )
}
