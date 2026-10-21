import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useCare } from '../../state/care'
import { useAgent } from '../../state/useAgent'
import { Card, SectionTitle } from '../ui/primitives'

const ASKS = ['How have they been this week?', 'Is the routine slipping?', 'What should I do before the next appointment?']

export function AskPanel() {
  const { snap } = useCare()
  const agent = useAgent({ role: 'family' })
  const first = snap?.person.name.split(' ')[0] ?? 'them'
  const [text, setText] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const len = agent.messages.reduce((n, m) => n + m.text.length, 0)
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [agent.messages.length, len])
  const submit = (e: FormEvent) => { e.preventDefault(); if (!text.trim() || agent.busy) return; agent.send(text); setText('') }
  return (
    <Card data-testid="ask-panel">
      <SectionTitle>Ask about {first}</SectionTitle>
      <div ref={log} className="scroll-thin mb-3 max-h-72 space-y-2.5 overflow-y-auto">
        {agent.messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {ASKS.map((a) => <button key={a} onClick={() => agent.send(a)} className="rounded-full border border-line bg-surface2 px-3 py-1.5 text-xs font-medium transition hover:bg-bg2">{a}</button>)}
          </div>
        )}
        {agent.messages.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${m.role === 'user' ? 'ml-auto bg-brand text-[var(--brand-ink)]' : 'bg-bg2'} ${m.streaming ? 'caret' : ''}`}>
            {m.error ? <span className="text-urgent">{m.error}</span> : m.text || (m.streaming ? 'Looking at the record…' : '')}
          </motion.div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask anything about ${first}'s week…`} aria-label={`Ask about ${first}`}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand" />
        <button aria-label="Send question" disabled={!text.trim() || agent.busy} className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-[var(--brand-ink)] transition active:scale-95 disabled:opacity-40"><Send size={16} /></button>
      </form>
    </Card>
  )
}
