import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Snapshot } from '../../lib/types'
import { Card, SectionTitle } from '../ui/primitives'

const SERIES = [
  { key: 'mood', label: 'Mood', color: '#0b8fb8', axis: 'a' },
  { key: 'sleep', label: 'Sleep (h)', color: '#8b6cf0', axis: 'a' },
  { key: 'pain', label: 'Pain', color: '#ff8a5b', axis: 'a' },
] as const

export function buildChartData(snap: Snapshot) {
  const missed: Record<string, number> = {}
  snap.adherence.missed_doses.forEach((m) => { missed[m.day] = (missed[m.day] ?? 0) + 1 })
  return snap.checkins_7d.map((c) => {
    const day = c.ts.slice(0, 10)
    return { day, label: new Date(c.ts).toLocaleDateString([], { weekday: 'short' }), mood: c.mood, sleep: c.sleep_hours, pain: c.pain, missed: missed[day] ?? 0, note: c.note }
  })
}

export function WellbeingChart({ snap }: { snap: Snapshot | null }) {
  const [on, setOn] = useState<Record<string, boolean>>({ mood: true, sleep: true, pain: true, missed: true })
  const data = useMemo(() => (snap ? buildChartData(snap) : []), [snap])
  return (
    <Card data-testid="wellbeing-chart">
      <SectionTitle right={
        <div className="flex flex-wrap gap-1.5">
          {[...SERIES, { key: 'missed', label: 'Missed doses', color: '#e0592f' }].map((s) => (
            <button key={s.key} onClick={() => setOn((o) => ({ ...o, [s.key]: !o[s.key] }))} aria-pressed={on[s.key]}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${on[s.key] ? 'border-transparent bg-bg2 text-ink' : 'border-line text-muted opacity-60'}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
            </button>
          ))}
        </div>
      }>Wellbeing, last 7 days</SectionTitle>
      <div className="h-[230px]">
        {data.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted">No check-ins yet. Ask Alexa "How am I doing?" to start the record.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
              <YAxis yAxisId="a" domain={[0, 10]} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
              <YAxis yAxisId="b" orientation="right" hide domain={[0, 8]} />
              <Tooltip cursor={{ stroke: 'var(--line)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow)', fontSize: 12 }}
                labelStyle={{ color: 'var(--ink)', fontWeight: 600 }} />
              {on.missed && <Bar yAxisId="b" dataKey="missed" name="Missed doses" fill="#e0592f" fillOpacity={0.22} radius={[6, 6, 0, 0]} barSize={26} isAnimationActive={false} />}
              {SERIES.map((s) => on[s.key] && (
                <Line key={s.key} yAxisId="a" type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.6} dot={{ r: 3.5, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
