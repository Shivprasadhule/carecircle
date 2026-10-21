import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { can as canDo, clearSessions, getSessions, setSessions, setUnauthorizedHandler, slotFor, type Sessions } from '../lib/auth'
import { DEFAULT_LANG, LANGUAGES } from '../lib/languages'
import type { Alert, Dose, PatientSummary, Snapshot, ToolCall } from '../lib/types'

export type Mode = 'split' | 'echo' | 'family' | 'manage'
export interface Toast { id: string; alert: Pick<Alert, 'severity' | 'title' | 'detail' | 'notified'> }
export interface Credentials { username: string; password: string }

interface Care {
  sessions: Sessions
  signIn: (creds: Credentials[]) => Promise<void>
  signOut: () => void
  signedIn: boolean
  /** Does the signed-in family/clinician account hold this permission? Mirrors the server's matrix; the server still enforces it. */
  can: (perm: string) => boolean
  canPerson: (perm: string) => boolean
  isAdmin: boolean
  /** The patients the family/clinician account may see, and the one currently on screen. */
  patients: PatientSummary[]
  patientId: string | null
  setPatientId: (id: string) => void
  refreshPatients: () => Promise<void>
  /** The patient whose own Echo this is (the signed-in person account). */
  personPatientId: string | null
  snap: Snapshot | null
  error: string | null
  refresh: () => Promise<void>
  markTaken: (d: Dose) => Promise<void>
  resolveAlert: (id: number) => Promise<void>
  setScenario: (n: 'decline' | 'stable' | 'fresh') => Promise<void>
  mode: Mode
  setMode: (m: Mode) => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  voice: boolean
  setVoice: (v: boolean) => void
  lang: string
  setLang: (l: string) => void
  voiceName: string | null
  setVoiceName: (n: string | null) => void
  rate: number
  setRate: (r: number) => void
  toasts: Toast[]
  pushToast: (t: Toast['alert']) => void
  dismissToast: (id: string) => void
  mcpLog: ToolCall[]
  logMcp: (c: ToolCall) => void
  scenarioEpoch: number
  /** Hidden Developer view: MCP traffic, architecture, system details. Off by default; the product UI never mentions its implementation. */
  dev: boolean
  setDev: (v: boolean) => void
}

const Ctx = createContext<Care | null>(null)
export const useCare = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCare must be used inside <CareProvider>')
  return c
}

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

export function CareProvider({ children, pollMs = 8000, initialSessions }: { children: ReactNode; pollMs?: number; initialSessions?: Sessions }) {
  const [sessions, setSessionsState] = useState<Sessions>(() => { if (initialSessions) setSessions(initialSessions); return getSessions() })
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [patientId, setPatientState] = useState<string | null>(() => store.get('cc.patient'))
  const [error, setError] = useState<string | null>(null)
  const [mode, setModeState] = useState<Mode>(() => (store.get('cc.mode') as Mode) || (window.innerWidth >= 1500 ? 'split' : 'echo'))
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (store.get('cc.theme') as 'light' | 'dark') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [voice, setVoiceState] = useState(() => store.get('cc.voice') !== 'off')
  const [lang, setLangState] = useState(() => { const l = store.get('cc.lang'); return LANGUAGES.some((x) => x.code === l) ? l! : DEFAULT_LANG })
  const [voiceName, setVoiceNameState] = useState<string | null>(() => store.get('cc.voiceName'))
  const [rate, setRateState] = useState(() => Number(store.get('cc.rate')) || 0.95)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [mcpLog, setMcpLog] = useState<ToolCall[]>([])
  const [scenarioEpoch, setEpoch] = useState(0)
  const [dev, setDevState] = useState(() => store.get('cc.dev') === 'on')
  const alive = useRef(true)
  const lastSig = useRef('')

  const signedIn = !!(sessions.person || sessions.viewer)
  const personPatientId = sessions.person?.user.patient_id ?? null
  const viewerSlot = sessions.viewer ? 'viewer' : 'person'
  // The patient on screen: the viewer's selection, or (for a patient-only sign-in) the patient herself.
  const activePatient = sessions.viewer ? patientId : personPatientId

  const refreshPatients = useCallback(async () => {
    const s = getSessions()
    if (!s.viewer && !s.person) return
    try {
      const list = s.viewer ? await api.patients('viewer') : []
      if (!alive.current) return
      setPatients(list)
      setPatientState((cur) => (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null))
    } catch { /* surfaced by the snapshot poll */ }
  }, [])

  const refresh = useCallback(async () => {
    const s = getSessions()
    const pid = s.viewer ? (patientIdRef.current ?? null) : s.person?.user.patient_id ?? null
    if (!pid || (!s.viewer && !s.person)) return
    try {
      const snapshot = await api.snapshot(pid, s.viewer ? 'viewer' : 'person')
      if (!alive.current) return
      // `now` changes every poll; skip the re-render when nothing else did.
      const { now: _now, ...rest } = snapshot
      const sig = pid + JSON.stringify(rest)
      if (sig !== lastSig.current) { lastSig.current = sig; setSnap(snapshot) }
      setError(null)
    } catch (e) { if (alive.current) setError((e as Error).message) }
  }, [])
  const patientIdRef = useRef<string | null>(patientId)
  patientIdRef.current = patientId

  useEffect(() => {
    alive.current = true
    refreshPatients().then(refresh)
    const t = setInterval(() => { refreshPatients(); refresh() }, pollMs)
    return () => { alive.current = false; clearInterval(t) }
  }, [refresh, refreshPatients, pollMs, signedIn])

  // switching patient: drop the old record immediately so no one ever sees the wrong person's data
  useEffect(() => { lastSig.current = ''; setSnap(null); refresh() }, [patientId, refresh])

  useEffect(() => { document.documentElement.dataset.theme = theme; store.set('cc.theme', theme) }, [theme])

  const signOut = useCallback(() => {
    clearSessions(); lastSig.current = ''
    setSessionsState({}); setSnap(null); setPatients([]); setToasts([]); setMcpLog([])
  }, [])
  useEffect(() => { setUnauthorizedHandler(signOut); return () => setUnauthorizedHandler(null) }, [signOut])

  const signIn = useCallback(async (creds: Credentials[]) => {
    const next: Sessions = {}
    for (const c of creds) { const s = await api.login(c.username, c.password); next[slotFor(s.user.role)] = s }
    setSessions(next); setSessionsState(next)
    // a viewer-only login lands on the family app; a person-only login on the Echo; both: side by side
    const m: Mode = next.person && next.viewer ? (window.innerWidth >= 1100 ? 'split' : 'echo') : next.viewer ? 'family' : 'echo'
    setModeState(m); store.set('cc.mode', m)
    if (next.viewer) setPatientState(next.viewer.user.patients.includes(store.get('cc.patient') ?? '') ? store.get('cc.patient') : next.viewer.user.patients[0] ?? null)
  }, [])

  const markTaken = useCallback(async (d: Dose) => {
    const pid = patientIdRef.current
    if (!pid) return
    // optimistic: flip the dose immediately, reconcile with server after
    setSnap((s) => s && { ...s, doses_today: s.doses_today.map((x) => (x.med_id === d.med_id && x.slot === d.slot ? { ...x, status: 'taken' } : x)) })
    try { await api.logDose(pid, d.medication, d.slot) } catch (e) { setError((e as Error).message) }
    await refresh()
  }, [refresh])

  const resolveAlert = useCallback(async (id: number) => {
    setSnap((s) => s && { ...s, open_alerts: s.open_alerts.filter((a) => a.id !== id) })
    await api.resolveAlert(id); await refresh(); await refreshPatients()
  }, [refresh, refreshPatients])

  const setScenario = useCallback(async (n: 'decline' | 'stable' | 'fresh') => {
    await api.scenario(n); setMcpLog([]); setToasts([]); setEpoch((e) => e + 1); await refresh(); await refreshPatients()
  }, [refresh, refreshPatients])

  const value = useMemo<Care>(() => ({
    sessions, signIn, signOut, signedIn,
    can: (perm: string) => canDo(sessions.viewer, perm),
    canPerson: (perm: string) => canDo(sessions.person, perm),
    isAdmin: sessions.viewer?.user.role === 'admin',
    patients, patientId: activePatient,
    setPatientId: (id: string) => { setPatientState(id); store.set('cc.patient', id) },
    refreshPatients, personPatientId,
    snap, error, refresh, markTaken, resolveAlert, setScenario, mode,
    setMode: (m) => { setModeState(m); store.set('cc.mode', m) },
    theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    voice, setVoice: (v) => { setVoiceState(v); store.set('cc.voice', v ? 'on' : 'off') },
    lang, setLang: (l) => { setLangState(l); setVoiceNameState(null); store.set('cc.lang', l); store.set('cc.voiceName', '') },
    voiceName: voiceName || null, setVoiceName: (n) => { setVoiceNameState(n); store.set('cc.voiceName', n ?? '') },
    rate, setRate: (r) => { setRateState(r); store.set('cc.rate', String(r)) },
    toasts,
    pushToast: (alert) => setToasts((t) => [...t.slice(-2), { id: Math.random().toString(36).slice(2), alert }]),
    dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    mcpLog, logMcp: (c) => setMcpLog((l) => [...l.filter((x) => x.id !== c.id), c].slice(-40)),
    scenarioEpoch, dev, setDev: (v: boolean) => { setDevState(v); store.set('cc.dev', v ? 'on' : 'off') },
  }), [sessions, signIn, signOut, signedIn, patients, activePatient, refreshPatients, personPatientId, snap, error, refresh, markTaken, resolveAlert, setScenario, mode, theme, voice, lang, voiceName, rate, toasts, mcpLog, scenarioEpoch, dev])

  void viewerSlot
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
