import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, FileText, Loader2, Radar, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toolLabel } from '../alexa/toolMeta'
import { useAgent } from '../../state/useAgent'
import { useCare } from '../../state/care'
import { Button, Card, SectionTitle } from '../ui/primitives'

function Steps({ tools }: { tools: ReturnType<typeof useAgent>['messages'][number]['tools'] }) {
  return (
    <ol className="space-y-2" data-testid="agent-trace">
      <AnimatePresence initial={false}>
        {tools.map((t) => (
          <motion.li key={t.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5">{t.status === 'running' ? <Loader2 size={16} className="animate-spin text-brand" /> : t.status === 'error' ? <XCircle size={16} className="text-urgent" /> : <CheckCircle2 size={16} className="text-ok" />}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{toolLabel(t.tool)}</span>
              {t.tool === 'raise_family_alert' && t.result?.alert && <span className="block truncate text-xs text-high">Alert: {t.result.alert.title}</span>}
            </span>
            {t.ms != null && <span className="font-mono text-[11px] text-muted">{t.ms} ms</span>}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}

export function CareWatch() {
  const { can } = useCare()
  const watch = useAgent({ role: 'family', path: '/api/care-watch/stream' })
  const digest = useAgent({ role: 'family', path: '/api/digest/stream' })
  const [active, setActive] = useState<'watch' | 'digest' | null>(null)
  const cur = active === 'digest' ? digest : watch
  const last = cur.messages[cur.messages.length - 1]
  const busy = watch.busy || digest.busy
  if (!can('agent:run')) {
    return (
      <Card data-testid="care-watch">
        <SectionTitle>Autonomous care watch</SectionTitle>
        <p className="text-sm leading-relaxed text-muted">This is a read-only account. Only family members can start the care watch or the weekly digest. You can still ask questions about the record.</p>
      </Card>
    )
  }

  return (
    <Card data-testid="care-watch">
      <SectionTitle>Autonomous care watch</SectionTitle>
      <p className="mb-4 text-sm leading-relaxed text-muted">CareCircle reviews the whole record on its own, decides whether the family needs to know, and raises the alert, with no one asking.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => { setActive('watch'); watch.reset(); watch.run(null) }}><Radar size={16} />{watch.busy ? 'Reviewing…' : 'Run care watch'}</Button>
        <Button disabled={busy} onClick={() => { setActive('digest'); digest.reset(); digest.run(null) }}><FileText size={16} />{digest.busy ? 'Writing…' : 'Weekly digest'}</Button>
      </div>
      <AnimatePresence>
        {last && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
            <div className="mt-4 space-y-4 rounded-2xl bg-bg2 p-4">
              {last.tools.length > 0 && <Steps tools={last.tools} />}
              {last.error ? <p role="alert" className="text-sm text-urgent">{last.error}</p> : (
                (last.text || last.streaming) && (
                  <div data-testid="agent-report" className={`whitespace-pre-wrap text-[13.5px] leading-relaxed ${last.streaming ? 'caret' : ''}`}>{last.text}</div>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
