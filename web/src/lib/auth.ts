import type { Role, Session, Slot } from './types'

/** Tokens live in sessionStorage (cleared when the tab closes). They are the only credential the UI holds. */
const KEY = 'cc.sessions'
export type Sessions = Partial<Record<Slot, Session>>

let memory: Sessions = {}                     // fallback when sessionStorage is unavailable (private mode)
let onUnauthorized: (() => void) | null = null

function read(): Sessions {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '{}') } catch { return memory }
}

export const slotFor = (role: Role): Slot => (role === 'person' ? 'person' : 'viewer')
export const isAdmin = (s: Session | undefined) => s?.user.role === 'admin'
export const getSessions = (): Sessions => read()
export function setSessions(s: Sessions) { memory = s; try { sessionStorage.setItem(KEY, JSON.stringify(s)) } catch { /* memory fallback */ } }
export function clearSessions() { setSessions({}) }
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn }
export function notifyUnauthorized() { onUnauthorized?.() }

/** The Authorization header for a surface. The viewer surface falls back to the patient's own token (she may read her record). */
export function authHeader(slot: Slot = 'viewer'): Record<string, string> {
  const cur = read()
  const t = (slot === 'viewer' ? cur.viewer ?? cur.person : cur.person)?.token
  return t ? { Authorization: `Bearer ${t}` } : {}
}
export const can = (s: Session | undefined, perm: string) => !!s?.user.permissions.includes(perm)
