import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Server } from 'lucide-react'
import { useState } from 'react'
import { useCare } from '../../state/care'
import { Card, SectionTitle } from '../ui/primitives'

export function McpPanel({ className = '' }: { className?: string }) {
  const { mcpLog } = useCare()
  const [open, setOpen] = useState<string | null>(null)
  const calls = [...mcpLog].reverse()
  return (
    <Card className={className}>
      <SectionTitle right={<span className="flex items-center gap-1.5 text-[11px] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-ok" />Streamable HTTP · MCP 2025-11-25</span>}>Live MCP traffic</SectionTitle>
      {calls.length === 0 ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted"><Server size={15} />Talk to Alexa and every tool call appears here.</p>
      ) : (
        <ul className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto font-mono text-[12px]" data-testid="mcp-log">
          <AnimatePresence initial={false}>
            {calls.map((c) => (
              <motion.li key={c.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="rounded-xl bg-bg2 px-3 py-2">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === 'running' ? 'animate-pulse bg-watch' : c.status === 'error' ? 'bg-urgent' : 'bg-ok'}`} />
                  <span className="text-muted">tools/call</span>
                  <span className="font-semibold text-ink">{c.tool}</span>
                  <span className="ml-auto text-muted">{c.status === 'running' ? '…' : `${c.ms} ms`}</span>
                  <ChevronDown size={13} className={`text-muted transition ${open === c.id ? 'rotate-180' : ''}`} />
                </button>
                {open === c.id && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted">{JSON.stringify({ arguments: c.input, result: c.result }, null, 2).slice(0, 1400)}</pre>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  )
}

export function Architecture() {
  const { mcpLog } = useCare()
  const running = mcpLog.some((c) => c.status === 'running')
  const nodes = ['Alexa+ screen', 'Agent runtime', 'CareCircle MCP server', 'Care record']
  return (
    <Card>
      <SectionTitle>Developer view · how it works</SectionTitle>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[12px] font-medium">
        {nodes.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            <span className="rounded-lg border border-line bg-surface2 px-2.5 py-1.5">{n}</span>
            {i < nodes.length - 1 && <motion.span animate={{ opacity: running ? [0.3, 1, 0.3] : 0.5 }} transition={{ duration: 0.8, repeat: Infinity }} className="text-brand">→</motion.span>}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">The assistant discovers the tools from the MCP server and decides which to call; every call is permission-checked and bound to one patient. State persists across sessions, so CareCircle remembers.</p>
    </Card>
  )
}
