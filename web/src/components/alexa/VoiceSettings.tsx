import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, Globe, Play, Server, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useEffect, useRef, useState } from 'react'
import { LANGUAGES, langByCode } from '../../lib/languages'
import { chooseSource, engineLabel, rankVoices, SERVER_VOICE } from '../../lib/speech'
import { useCare } from '../../state/care'
import type { useSpeaker } from '../../lib/speech'

type Speaker = ReturnType<typeof useSpeaker>

const quality = (name: string) => (/natural|neural|online|premium/i.test(name) ? 'Natural' : /enhanced|siri/i.test(name) ? 'Enhanced' : /google/i.test(name) ? 'Google' : 'Standard')

function StatusDot({ kind }: { kind: ReturnType<typeof chooseSource> }) {
  const [color, label] = kind.kind === 'none' ? ['bg-white/25', 'text only'] : kind.kind === 'server' ? ['bg-emerald-400', 'server voice'] : kind.exact ? ['bg-emerald-400', 'voice available'] : ['bg-amber-400', 'approximate voice']
  return <span title={label} aria-label={label} className={`h-2 w-2 rounded-full ${color}`} />
}

export function VoiceSettings({ speaker }: { speaker: Speaker }) {
  const { lang, setLang, voiceName, setVoiceName, rate, setRate, canPerson } = useCare()
  const [wipe, setWipe] = useState<'idle' | 'confirm' | 'done'>('idle')
  const [wiped, setWiped] = useState(0)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const L = langByCode(lang)
  const ranked = rankVoices(speaker.voices, L.speech)
  const serverOk = speaker.server.langs.includes(L.speech)
  const engine = speaker.server.engines[L.speech]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Language and voice: ${L.name}`}
        className="flex h-9 items-center gap-1.5 rounded-full bg-white/[.07] px-3 text-xs font-medium text-white/80 transition hover:bg-white/15">
        <Globe size={14} />{L.native}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="dialog" aria-label="Language and voice settings" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 top-11 z-30 w-[330px] max-w-[calc(100vw-3rem)] rounded-2xl border border-white/10 bg-[#0e1730]/95 p-4 text-white shadow-2xl backdrop-blur">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200/70">Language</div>
            <div className="mb-4 grid grid-cols-2 gap-1.5">
              {LANGUAGES.map((l) => (
                <button key={l.code} onClick={() => setLang(l.code)} aria-pressed={l.code === lang}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] transition ${l.code === lang ? 'bg-[#29c4ff] text-[#00212e]' : 'bg-white/[.06] hover:bg-white/15'}`}>
                  <span><span className="block font-semibold">{l.native}</span><span className={`block text-[10px] ${l.code === lang ? 'text-[#00212e]/70' : 'text-white/45'}`}>{l.name}{l.alexaPlus ? ' · Alexa+' : ''}</span></span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot kind={chooseSource(speaker.voices, speaker.server, l.speech, null)} />
                    {l.code === lang && <Check size={14} />}
                  </span>
                </button>
              ))}
            </div>

            <p className="mb-3 rounded-lg bg-white/[.05] px-2.5 py-2 text-[11px] leading-snug text-white/60">
              {L.alexaPlus ? <>Alexa+ supports <b className="text-white/85">{L.name}</b> in India today. CareCircle works unchanged.</>
                : <>Alexa+ in India launched with English, Hindi and Hinglish. <b className="text-white/85">{L.name}</b> is simulated here: CareCircle already works in it, and is ready the day Alexa+ adds it.</>}
            </p>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200/70">Voice</div>
            {(ranked.length > 0 || serverOk) && (
              <select value={voiceName ?? ''} onChange={(e) => setVoiceName(e.target.value || null)} aria-label="Voice"
                className="mb-3 w-full rounded-xl border border-white/15 bg-[#0a1226] px-3 py-2 text-sm text-white outline-none focus:border-[#29c4ff]">
                <option value="">Best available ({speaker.source.kind === 'server' ? engineLabel(speaker.source.engine) : speaker.voice?.name ?? '–'})</option>
                {ranked.map((v) => <option key={v.name + v.lang} value={v.name}>{v.name} · {v.lang} · {quality(v.name)}</option>)}
                {serverOk && engine && <option value={SERVER_VOICE}>{engineLabel(engine)} · server voice</option>}
              </select>
            )}

            {speaker.source.kind === 'server' && (
              <div role="status" className="mb-3 flex gap-2 rounded-xl bg-emerald-400/10 p-3 text-[12px] leading-snug text-emerald-100">
                <Server size={15} className="mt-0.5 shrink-0" />
                <span>{L.name} is spoken with a natural-sounding server voice.</span>
              </div>
            )}

            {speaker.source.kind === 'none' && (
              <div role="status" className="mb-3 flex gap-2 rounded-xl bg-amber-400/10 p-3 text-[12px] leading-snug text-amber-100">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>No {L.name} voice is installed on this device, so Alexa will answer in text. On a Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices. Microsoft Edge ships natural Indian voices too.</span>
              </div>
            )}

            <label className="mb-3 block text-[12px] text-white/70">Speed
              <input type="range" min={0.7} max={1.2} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Speech speed" className="mt-1 w-full accent-[#29c4ff]" />
            </label>
            <button onClick={() => { speaker.cancel(); speaker.enqueue(L.strings.helpSub) }} disabled={speaker.source.kind === 'none'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-2 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-40"><Play size={14} />Test voice</button>

            {canPerson('conversation:delete_own') && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200/70">Privacy</div>
                <p className="mb-2 text-[11px] leading-snug text-white/55">Chats are stored for 30 days so your family can follow how you are. You can erase yours at any time.</p>
                {wipe === 'done' ? (
                  <p role="status" className="text-[12px] text-emerald-300">Deleted {wiped} conversation{wiped === 1 ? '' : 's'}.</p>
                ) : (
                  <button onClick={async () => {
                    if (wipe === 'idle') { setWipe('confirm'); return }
                    const r = await api.deleteMyHistory(); setWiped(r.deleted); setWipe('done')
                  }} className={`flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition ${wipe === 'confirm' ? 'bg-rose-500 text-white' : 'bg-white/10 hover:bg-white/20'}`}>
                    <Trash2 size={14} />{wipe === 'confirm' ? 'Tap again to confirm' : 'Delete my conversation history'}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
