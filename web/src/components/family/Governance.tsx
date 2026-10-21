import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, MessageSquare, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { ago, titleCase } from '../../lib/format'
import type { AuditRow, ConversationMessage, ConversationSummary } from '../../lib/types'
import { useCare } from '../../state/care'
import { Badge, Card, SectionTitle } from '../ui/primitives'

const OUTCOME: Record<string, string> = { allowed: 'ok', rejected: 'watch', denied: 'high', error: 'urgent' }
export const describeAction = (a: string) => a.replace(/^(tool|api|mcp|auth|conversation|resource|demo|admin):/, (_, k) => ({ tool: 'MCP tool · ', api: 'API · ', mcp: 'MCP · ', auth: 'Auth · ', conversation: 'History · ', resource: 'Resource · ', demo: 'Demo · ', admin: 'Admin · ' } as Record<string, string>)[k]).replace(/_/g, ' ')

/** Who did what, newest first, including refused attempts. Content of chats and health notes is never shown here (it is not stored here). */
export function ActivityPanel() {
  const { mcpLog, snap } = useCare()
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [deniedOnly, setDeniedOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => api.audit(60).then((r) => alive && (setRows(r), setError(null))).catch((e) => alive && setError(e.message))
    load()
    const t = setInterval(load, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [mcpLog.length, snap?.open_alerts.length])

  const shown = (rows ?? []).filter((r) => !deniedOnly || r.outcome === 'denied')
  const denied = (rows ?? []).filter((r) => r.outcome === 'denied').length
  return (
    <Card data-testid="activity-panel">
      <SectionTitle right={<ShieldCheck size={14} className="text-muted" />}>Activity log</SectionTitle>
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>Append-only · {rows?.length ?? 0} recent events</span>
        <button onClick={() => setDeniedOnly((d) => !d)} aria-pressed={deniedOnly} className={`rounded-full border px-2.5 py-1 font-medium transition ${deniedOnly ? 'border-transparent bg-high-soft text-high' : 'border-line hover:bg-surface2'}`}>Refused only ({denied})</button>
      </div>
      {error && <p role="alert" className="text-sm text-urgent">{error}</p>}
      <ul className="scroll-thin max-h-72 space-y-1.5 overflow-y-auto text-[12.5px]">
        <AnimatePresence initial={false}>
          {shown.map((r) => (
            <motion.li key={r.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-2 rounded-xl bg-bg2 px-2.5 py-2" data-testid="audit-row">
              <Badge kind={OUTCOME[r.outcome] ?? 'upcoming'} className="mt-0.5 shrink-0">{r.outcome}</Badge>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{titleCase(describeAction(r.action))}</span>
                {r.target && <span className="text-muted"> · {r.target}</span>}
                <span className="block text-[11px] text-muted">{r.actor_id} ({r.actor_role}) · {ago(r.ts)}</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {rows && shown.length === 0 && <p className="py-4 text-sm text-muted">Nothing to show.</p>}
    </Card>
  )
}

function Thread({ id }: { id: string }) {
  const [msgs, setMsgs] = useState<ConversationMessage[] | null>(null)
  useEffect(() => { api.conversation(id).then(setMsgs).catch(() => setMsgs([])) }, [id])
  if (!msgs) return <p className="py-2 text-xs text-muted">Loading…</p>
  return (
    <ul className="mt-2 space-y-1.5">
      {msgs.map((m, i) => {
        const tools: string[] = (() => { try { return JSON.parse(m.tools) } catch { return [] } })()
        return (
          <li key={i} className={`rounded-xl px-3 py-2 text-[13px] leading-snug ${m.who === 'user' ? 'bg-brand/10' : 'bg-bg2'}`}>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">{m.who === 'user' ? 'Said' : 'Alexa'}</span>
            {m.text}
            {tools.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{tools.map((t, j) => <span key={j} className="rounded-full bg-bg2 px-2 py-0.5 font-mono text-[10px] text-muted">{t}</span>)}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/** Stored chat history (text + tool names), visible to family. The patient can erase her own from the Echo's privacy settings. */
export function ConversationsPanel() {
  const { snap, mcpLog, patientId } = useCare()
  const [list, setList] = useState<ConversationSummary[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => api.conversations(patientId ?? undefined, 'viewer').then((r) => alive && setList(r)).catch(() => alive && setList([]))
    load()
    const t = setInterval(load, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [mcpLog.length, snap?.person.id, patientId])
  const items = (list ?? []).filter((c) => !c.id.includes(':watch-') && !c.id.includes(':digest-'))
  return (
    <Card data-testid="conversations-panel">
      <SectionTitle right={<MessageSquare size={14} className="text-muted" />}>Conversation history</SectionTitle>
      {items.length === 0 ? <p className="py-3 text-sm text-muted">No conversations stored yet. Chats are kept for 30 days, then deleted automatically.</p> : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="rounded-2xl border border-line">
              <button onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.user_name}</span><span className="text-[11px] text-muted">{c.messages} messages · {c.language} · {ago(c.updated_at)}</span></span>
                <ChevronDown size={15} className={`text-muted transition ${open === c.id ? 'rotate-180' : ''}`} />
              </button>
              {open === c.id && <div className="px-3 pb-3"><Thread id={c.id} /></div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
