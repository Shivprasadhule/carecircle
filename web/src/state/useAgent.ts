import { useCallback, useEffect, useRef, useState } from 'react'
import { streamPost } from '../lib/api'
import { MUTATING_TOOLS, type StreamEvent, type ToolCall } from '../lib/types'
import { useCare } from './care'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolCall[]
  streaming?: boolean
  error?: string
}

const uid = () => Math.random().toString(36).slice(2, 10)

/**
 * Drives one streaming conversation (or one-shot agent run) against the backend.
 * Tool calls are attached to the assistant message as they start and finish.
 */
export function useAgent({ role, path = '/api/chat/stream', onDone }: { role: 'person' | 'family'; path?: string; onDone?: (reply: string) => void }) {
  const { refresh, logMcp, pushToast, scenarioEpoch, lang, patientId, personPatientId, refreshPatients } = useCare()
  // Alexa talks about the signed-in patient herself; the family app talks about whichever patient is on screen.
  const pid = role === 'person' ? personPatientId : patientId
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const session = useRef<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const reset = useCallback(() => { abort.current?.abort(); session.current = null; setMessages([]); setBusy(false) }, [])
  useEffect(() => { reset() }, [scenarioEpoch, pid, reset])
  useEffect(() => () => abort.current?.abort(), [])

  const run = useCallback(async (text: string | null, body: Record<string, unknown> = {}) => {
    if (busy || !pid) return
    const aid = uid()
    setMessages((m) => [
      ...m,
      ...(text ? [{ id: uid(), role: 'user' as const, text, tools: [] }] : []),
      { id: aid, role: 'assistant', text: '', tools: [], streaming: true },
    ])
    setBusy(true)
    abort.current = new AbortController()
    const calls = new Map<string, ToolCall>()   // per-run bookkeeping, so no side effects run inside state updaters
    const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.id === aid ? fn(m) : m)))

    const onEvent = (e: StreamEvent) => {
      switch (e.type) {
        case 'session': session.current = e.session_id; break
        case 'tool_start': {
          const call: ToolCall = { id: e.id, tool: e.tool, status: 'running', startedAt: performance.now() }
          calls.set(e.id, call)
          patch((m) => ({ ...m, tools: [...m.tools, call] })); logMcp(call); break
        }
        case 'tool_result': {
          const started = calls.get(e.id) ?? { id: e.id, tool: e.tool, status: 'running' as const, startedAt: performance.now() }
          const done: ToolCall = { ...started, tool: e.tool || started.tool, input: e.input, result: e.result, status: e.status === 'error' ? 'error' : 'success', ms: Math.round(performance.now() - started.startedAt) }
          calls.set(e.id, done)
          patch((m) => ({ ...m, tools: m.tools.some((t) => t.id === e.id) ? m.tools.map((t) => (t.id === e.id ? done : t)) : [...m.tools, done] }))
          logMcp(done)
          if (MUTATING_TOOLS.has(e.tool)) { refresh(); refreshPatients() }
          if (e.tool === 'raise_family_alert' && e.result?.alert) pushToast(e.result.alert)
          break
        }
        case 'text': patch((m) => ({ ...m, text: m.text + e.delta })); break
        case 'done': patch((m) => ({ ...m, streaming: false, text: e.reply || m.text })); onDone?.(e.reply); break
        case 'error': patch((m) => ({ ...m, streaming: false, error: e.message })); break
      }
    }

    try {
      await streamPost(`${path}?patient_id=${encodeURIComponent(pid)}`, { message: text, session_id: session.current, language: role === 'person' ? lang : 'en-IN', ...body }, onEvent, abort.current.signal, role === 'person' ? 'person' : 'viewer')
    } catch (err) {
      if ((err as Error).name !== 'AbortError') patch((m) => ({ ...m, streaming: false, error: (err as Error).message }))
    } finally {
      patch((m) => ({ ...m, streaming: false }))
      setBusy(false)
      refresh()
    }
  }, [busy, pid, path, role, lang, refresh, refreshPatients, logMcp, pushToast, onDone])

  return { messages, busy, send: (t: string) => run(t.trim()), run, reset }
}
