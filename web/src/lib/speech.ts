import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fetchSpeech, type ServerVoices } from './api'

/* ------------------------------------------------------------------ voice ranking (pure, unit-tested) */

export interface VoiceLike { name: string; lang: string; localService?: boolean; voiceURI?: string }

const norm = (l: string) => l.replace('_', '-').toLowerCase()
const primary = (l: string) => norm(l).split('-')[0]

export const voiceUsable = (voiceLang: string, lang: string) => primary(voiceLang) === primary(lang)

/** Higher is better; < 0 means "wrong language, never use". */
export function scoreVoice(v: VoiceLike, lang: string): number {
  const vl = norm(v.lang), want = norm(lang)
  let s: number
  // Language fit dominates (tiers 1000 apart); voice quality (< 150) only breaks ties inside a tier.
  if (vl === want) s = 4000
  else if (primary(vl) === primary(want)) s = 3000
  else if (primary(want) === 'en' && primary(vl) === 'en') s = 1000          // English fallback: any English beats nothing
  else return -1
  if (/natural|neural|online|premium/i.test(v.name)) s += 60                // Edge "Natural" / Apple "Premium": far less robotic
  else if (/enhanced|siri/i.test(v.name)) s += 45
  else if (/google/i.test(v.name)) s += 30
  if (/swara|neerja|neelam|kajal|heera|veena|lekha|aditi|raveena|shruti|samantha|karen|priya|female/i.test(v.name)) s += 8   // warm female voices suit the persona
  if (/novelty|bad news|bahh|bells|boing|cellos|good news|jester|organ|whisper|zarvox|trinoids|albert|fred|superstar|wobble/i.test(v.name)) return -1                                                    // novelty voices are never acceptable
  return s
}

export function rankVoices<T extends VoiceLike>(voices: T[], lang: string): T[] {
  return voices.map((v) => ({ v, s: scoreVoice(v, lang) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.v)
}

/** Best voice for a language, or the user's saved choice if it still exists and matches the language. */
export function pickVoice<T extends VoiceLike>(voices: T[], lang: string, preferredName?: string | null): { voice?: T; exact: boolean } {
  const ranked = rankVoices(voices, lang)
  const chosen = (preferredName && ranked.find((v) => v.name === preferredName)) || ranked[0]
  return { voice: chosen, exact: !!chosen && primary(chosen.lang) === primary(lang) }
}

export const SERVER_VOICE = 'server:tts'
export type VoiceSource =
  | { kind: 'browser'; voice: VoiceLike; exact: boolean }
  | { kind: 'server'; engine: 'server' }
  | { kind: 'none' }

export interface ServerInfo { langs: string[]; preferred: string[]; engines: Record<string, 'server'> }
export const NO_SERVER: ServerInfo = { langs: [], preferred: [], engines: {} }

export const engineLabel = (_e: 'server') => 'Natural voice (server)'

/**
 * Decide how a language will be spoken:
 *   1. the user's saved choice (the server voice, or a named device voice),
 *   2. the server voice when it is configured (a much better voice than the built-in ones),
 *   3. a real device voice for the language,
 *   4. nothing: text only.
 */
export function chooseSource<T extends VoiceLike>(voices: T[], server: ServerInfo, lang: string, saved?: string | null): VoiceSource {
  const has = server.langs.includes(lang)
  const srv: VoiceSource = { kind: 'server', engine: 'server' }
  if (saved === SERVER_VOICE && has) return srv
  const { voice, exact } = pickVoice(voices, lang, saved)
  if (saved && saved !== SERVER_VOICE && voice?.name === saved) return { kind: 'browser', voice, exact }
  if (has && server.preferred.includes(lang)) return srv
  if (voice && exact) return { kind: 'browser', voice, exact: true }
  return { kind: 'none' }
}

/* ------------------------------------------------------------------ text prep (pure, unit-tested) */

const SENTENCE_END = /([.!?।॥]+["')\]]*)(\s+|$)|\n+/

/** Split completed sentences off the front of a streaming buffer. `rest` is the unfinished tail. */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let rest = buffer
  for (;;) {
    const m = SENTENCE_END.exec(rest)
    if (!m || m.index === undefined) break
    const end = m.index + m[0].length
    // a trailing "." with no following whitespace may be mid-stream ("3.5"), wait for more text
    if (m[2] === '' && end === rest.length && !/[।॥!?]/.test(m[1] ?? '')) break
    const s = rest.slice(0, end).trim()
    if (s) sentences.push(s)
    rest = rest.slice(end)
  }
  return { sentences, rest }
}

export const cleanForSpeech = (t: string) =>
  t.replace(/[*_`#>]+/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim()

/* ------------------------------------------------------------------ hooks */

export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [])
  return voices
}

let serverVoicesPromise: Promise<ServerInfo> | null = null
/** What the backend can speak itself (cached; empty unless Amazon Polly is configured). */
export function useServerInfo(): ServerInfo {
  const [info, setInfo] = useState<ServerInfo>(NO_SERVER)
  useEffect(() => {
    let alive = true
    serverVoicesPromise ??= api.voices().then((v: ServerVoices): ServerInfo => ({ langs: v.server_languages, preferred: v.preferred, engines: v.engines ?? {} })).catch(() => NO_SERVER)
    serverVoicesPromise.then((i) => alive && setInfo(i))
    return () => { alive = false }
  }, [])
  return info
}
export const resetServerInfoCache = () => { serverVoicesPromise = null }

interface SpeakerOpts { enabled: boolean; lang: string; voiceName?: string | null; rate?: number }

/** Sentence-queued speech so Alexa can start talking while the reply is still being written. */
export function useSpeaker({ enabled, lang, voiceName, rate = 0.95 }: SpeakerOpts) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const voices = useVoices()
  const server = useServerInfo()
  const source = useMemo(() => chooseSource(voices, server, lang, voiceName), [voices, server, lang, voiceName])
  const [speaking, setSpeaking] = useState(false)
  const queue = useRef<string[]>([])
  const live = useRef(false)
  const cfg = useRef({ enabled, source, lang, rate }); cfg.current = { enabled, source, lang, rate }
  // server-voice playback state
  const audioQueue = useRef<Promise<string | null>[]>([])
  const playing = useRef(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const abort = useRef<AbortController | null>(null)

  const pump = useCallback(() => {
    if (!supported) return
    const text = queue.current.shift()
    if (!text) { live.current = false; setSpeaking(false); return }
    const u = new SpeechSynthesisUtterance(text)
    const src = cfg.current.source
    if (src.kind === 'browser') { u.voice = src.voice as SpeechSynthesisVoice; u.lang = src.voice.lang } else u.lang = cfg.current.lang
    u.rate = cfg.current.rate
    u.onend = u.onerror = () => pump()
    live.current = true; setSpeaking(true)
    window.speechSynthesis.speak(u)
  }, [supported])

  const pumpServer = useCallback(async () => {
    const next = audioQueue.current.shift()
    if (!next) { playing.current = false; setSpeaking(false); return }
    playing.current = true; setSpeaking(true)
    const url = await next
    if (!url || !playing.current) return pumpServer()
    const a = new Audio(url)
    audio.current = a
    const done = () => { URL.revokeObjectURL(url); pumpServer() }
    a.onended = a.onerror = done
    a.play().catch(done)
  }, [])

  const cancel = useCallback(() => {
    queue.current = []; live.current = false
    audioQueue.current = []; playing.current = false
    abort.current?.abort(); abort.current = null
    audio.current?.pause(); audio.current = null
    if (supported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  const enqueue = useCallback((text: string) => {
    const t = cleanForSpeech(text)
    const { enabled: on, source: src, lang: l } = cfg.current
    if (!on || !t || src.kind === 'none') return
    if (src.kind === 'server') {
      abort.current ??= new AbortController()
      audioQueue.current.push(fetchSpeech(t, l, abort.current.signal))   // fetch ahead; playback stays in order
      if (!playing.current) pumpServer()
      return
    }
    if (!supported) return
    queue.current.push(t)
    if (!live.current) pump()
  }, [supported, pump, pumpServer])

  useEffect(() => { if (!enabled) cancel() }, [enabled, cancel])
  useEffect(() => { cancel() }, [lang, cancel])
  useEffect(() => () => { cancel() }, [cancel])

  const voice = source.kind === 'browser' ? (source.voice as SpeechSynthesisVoice) : undefined
  const exact = source.kind === 'server' || (source.kind === 'browser' && source.exact)
  return { enqueue, cancel, speaking, supported, voices, server, source, voice, exact }
}

type Recognizer = { start(): void; stop(): void; lang: string; interimResults: boolean; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null }

export function useListen(lang: string, onFinal: (text: string) => void) {
  const Ctor = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognizer | null>(null)
  const cb = useRef(onFinal); cb.current = onFinal

  const stop = useCallback(() => rec.current?.stop(), [])
  const start = useCallback(() => {
    if (!Ctor || rec.current) return
    const r: Recognizer = new Ctor()
    r.lang = lang; r.interimResults = true
    r.onresult = (e) => {
      const t = [...e.results].map((x: any) => x[0].transcript).join(' ')
      setInterim(t)
      if (e.results[e.results.length - 1].isFinal) { cb.current(t); setInterim('') }
    }
    r.onerror = (e) => { setError(e?.error ?? 'error') }
    r.onend = () => { rec.current = null; setListening(false); setInterim('') }
    rec.current = r; setError(null); setListening(true); r.start()
  }, [Ctor, lang])

  useEffect(() => { rec.current?.stop() }, [lang])
  return { supported: !!Ctor, listening, interim, error, start, stop }
}
