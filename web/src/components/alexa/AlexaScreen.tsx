import { AnimatePresence, motion } from 'framer-motion'
import { Mic, MicOff, Send, Volume2, VolumeX, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { addressName, greetingFor, langByCode, suggestionsFor } from '../../lib/languages'
import { takeSentences, useListen, useSpeaker } from '../../lib/speech'
import { useCare } from '../../state/care'
import { useAgent, type ChatMessage } from '../../state/useAgent'
import { Orb, Waveform, type Phase } from './Orb'
import { cardsFor, ToolStatus } from './ToolCards'
import { VoiceSettings } from './VoiceSettings'

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} className="ml-auto max-w-[85%] rounded-3xl rounded-br-lg bg-gradient-to-br from-[#2b6df6] to-[#1c4fd6] px-4 py-2.5 text-[15px] text-white shadow-lg">
        {m.text}
      </motion.div>
    )
  }
  const cards = cardsFor(m.tools)
  return (
    <div className="max-w-full" data-testid="assistant-message">
      <ToolStatus calls={m.tools} />
      {cards.length > 0 && <div className="no-scrollbar -mx-1 mb-2 flex snap-x gap-3 overflow-x-auto px-1 pb-1">{cards}</div>}
      {(m.text || m.streaming) && !m.error && (
        <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`font-display text-[21px] leading-snug text-white/95 ${m.streaming ? 'caret' : ''}`}>
          {m.text || ' '}
        </motion.p>
      )}
      {m.error && <p role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">Sorry, I couldn't finish that. {m.error}</p>}
    </div>
  )
}

export function AlexaScreen({ compact = false }: { compact?: boolean }) {
  const { sessions, voice, setVoice, lang: langCode, voiceName, rate, personPatientId, scenarioEpoch } = useCare()
  // the chips use the patient's own first medicine (earliest dose), so Thomas is not offered Asha's metformin
  const [medicine, setMedicine] = useState<string | null>(null)
  useEffect(() => {
    if (!personPatientId) return
    api.snapshot(personPatientId, 'person').then((s) => {
      const first = [...s.medications].sort((a, b) => a.times.localeCompare(b.times) || a.name.localeCompare(b.name))[0]
      setMedicine(first ? first.name.split(/[ /]/)[0] : null)
    }).catch(() => setMedicine(null))
  }, [personPatientId, scenarioEpoch])
  const L = langByCode(langCode)
  const speech = useSpeaker({ enabled: voice, lang: L.speech, voiceName, rate })
  const agent = useAgent({ role: 'person' })
  const [text, setText] = useState('')
  const feed = useRef<HTMLDivElement>(null)
  const listen = useListen(L.recog, (t) => { setText(''); speech.cancel(); agent.send(t) })

  const phase: Phase = listen.listening ? 'listening' : agent.busy ? 'thinking' : speech.speaking ? 'speaking' : 'idle'
  const first = sessions.person?.user.name.split(' ')[0] ?? 'there'
  const address = addressName(first, L)
  const last = agent.messages[agent.messages.length - 1]
  const streamingText = last?.role === 'assistant' ? last.text.length : 0

  // Speak sentence by sentence while the reply is still being written, so Alexa answers almost immediately.
  const spoken = useRef({ id: '', len: 0 })
  useEffect(() => {
    if (!last || last.role !== 'assistant') return
    if (spoken.current.id !== last.id) spoken.current = { id: last.id, len: 0 }
    const pending = last.text.slice(spoken.current.len)
    const { sentences, rest } = takeSentences(pending)
    sentences.forEach(speech.enqueue)
    spoken.current.len += pending.length - rest.length
    if (!last.streaming && rest.trim()) { speech.enqueue(rest); spoken.current.len = last.text.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, last?.text, last?.streaming])

  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }) }, [agent.messages.length, streamingText, last?.tools.length])

  const submit = (e: FormEvent) => { e.preventDefault(); if (!text.trim() || agent.busy) return; speech.cancel(); agent.send(text); setText('') }
  const status = useMemo(() => ({ idle: L.strings.idle, listening: L.strings.listening, thinking: L.strings.thinking, speaking: L.strings.speaking })[phase], [phase, L])

  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[480px]' : 'max-w-[560px]'}`}>
      <div className="rounded-[2.6rem] bg-gradient-to-b from-[#2a3550] to-[#0c1222] p-3 shadow-[var(--shadow-lg)] ring-1 ring-white/10">
        <div className={`relative flex ${compact ? 'h-[640px]' : 'h-[700px]'} flex-col overflow-hidden rounded-[2rem] bg-[#070d1c] text-white`}
          style={{ backgroundImage: 'radial-gradient(900px 420px at 15% -10%, rgba(41,110,255,.28), transparent 60%), radial-gradient(700px 380px at 100% 100%, rgba(255,138,91,.14), transparent 60%)' }}>
          <div className="flex items-center gap-4 px-6 pb-2 pt-5">
            <Orb phase={phase} size={46} />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-sky-200/60">{status}</div>
              <div className="truncate font-display text-xl">{greetingFor(L)}, <span className="text-[#ffb08f]">{address}</span></div>
            </div>
            <VoiceSettings speaker={speech} />
            <button onClick={() => setVoice(!voice)} aria-label={voice ? 'Mute spoken replies' : 'Speak replies aloud'} aria-pressed={voice} className="grid h-9 w-9 place-items-center rounded-full bg-white/[.07] text-white/70 transition hover:bg-white/15">
              {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            {agent.messages.length > 0 && (
              <button onClick={() => { speech.cancel(); agent.reset() }} aria-label="Start over" className="grid h-9 w-9 place-items-center rounded-full bg-white/[.07] text-white/70 transition hover:bg-white/15"><RotateCcw size={15} /></button>
            )}
          </div>

          <div ref={feed} data-testid="feed" className="scroll-thin flex-1 space-y-4 overflow-y-auto px-6 py-3" aria-live="polite">
            {agent.messages.length === 0 ? (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="pt-6">
                <p className="font-display text-[34px] leading-[1.15] text-white">{L.strings.helpTitle}<br /><span className="text-[#7fdcff]">{address}?</span></p>
                <p className="mt-3 max-w-sm text-sm text-white/55">{L.strings.helpSub}</p>
              </motion.div>
            ) : (
              agent.messages.map((m) => <Bubble key={m.id} m={m} />)
            )}
          </div>

          <div className="border-t border-white/10 bg-black/20 px-5 pb-5 pt-3 backdrop-blur">
            <AnimatePresence mode="wait" initial={false}>
              {listen.listening ? (
                <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-3 flex items-center gap-3 rounded-2xl bg-white/[.06] px-4 py-2">
                  <Waveform active /><span className="truncate text-sm text-white/80">{listen.interim || L.strings.listening}</span>
                </motion.div>
              ) : (
                <motion.div key="s" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
                  {suggestionsFor(L, medicine).map((s) => (
                    <button key={s} disabled={agent.busy} onClick={() => { speech.cancel(); agent.send(s) }} className="shrink-0 rounded-full border border-white/15 bg-white/[.06] px-3.5 py-1.5 text-[13px] text-sky-100 transition hover:bg-white/15 disabled:opacity-40">{s}</button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <form onSubmit={submit} className="flex items-center gap-2.5">
              <button type="button" onClick={listen.listening ? listen.stop : listen.start} disabled={!listen.supported}
                title={listen.supported ? `Speak (${L.name})` : 'Voice input needs Chrome or Edge'} aria-label={listen.listening ? 'Stop listening' : 'Speak'}
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition active:scale-95 ${listen.listening ? 'bg-rose-500 text-white shadow-[0_0_24px_rgba(244,63,94,.6)]' : 'bg-[#29c4ff] text-[#00212e]'} disabled:bg-white/10 disabled:text-white/30`}>
                {listen.supported ? <Mic size={21} /> : <MicOff size={21} />}
              </button>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder={L.strings.placeholder} aria-label="Message Alexa" autoComplete="off"
                className="h-12 min-w-0 flex-1 rounded-full border border-white/15 bg-white/[.07] px-5 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[#29c4ff]" />
              <button aria-label="Send" disabled={!text.trim() || agent.busy} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#2b6df6] text-white transition active:scale-95 disabled:opacity-40"><Send size={19} /></button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
