import { AnimatePresence, motion } from 'framer-motion'
import { BellOff, CheckCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ago } from '../../lib/format'
import { useCare } from '../../state/care'
import { Badge, Button, Card, SectionTitle } from '../ui/primitives'

export function AlertsFeed() {
  const { snap, resolveAlert, can } = useCare()
  const alerts = snap?.open_alerts ?? []
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t) }, [])
  return (
    <Card data-testid="alerts-feed">
      <SectionTitle right={alerts.length > 0 && <Badge kind={alerts.some((a) => a.severity === 'high' || a.severity === 'urgent') ? 'high' : 'watch'}>{alerts.length} open</Badge>}>Family alerts</SectionTitle>
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted"><BellOff size={22} />All quiet. Alerts raised by Alexa or the care watch show up here.</div>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {alerts.map((a) => (
              <motion.li key={a.id} layout initial={{ opacity: 0, scale: 0.96, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, x: 60, height: 0, marginBottom: 0 }}
                className="rounded-2xl border border-line bg-surface2 p-3.5" data-testid="alert-item">
                <div className="mb-1.5 flex items-start gap-2">
                  <Badge kind={a.severity} />
                  <span className="flex-1 text-sm font-semibold leading-snug">{a.title}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted">{a.detail}</p>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted">{ago(a.ts)} · notified {a.notified || 'family'}</span>
                  {can('alert:resolve') && <Button size="sm" onClick={() => resolveAlert(a.id)}><CheckCheck size={14} />Resolve</Button>}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  )
}
