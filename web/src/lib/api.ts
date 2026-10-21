import { authHeader, notifyUnauthorized } from './auth'
import type {
  AdminOverview, AuditRow, RxApplyResult, RxScan, ConversationMessage, ConversationSummary, DemoAccount, PatientSummary, Session, Slot, Snapshot, StreamEvent,
} from './types'

export interface ServerVoices { server_languages: string[]; preferred: string[]; engines: Record<string, 'server'>; engine: string }

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function json<T>(path: string, body?: unknown, slot: Slot = 'viewer', method?: string): Promise<T> {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeader(slot) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 && !path.startsWith('/api/auth/login')) notifyUnauthorized()
  if (!r.ok) throw new ApiError(typeof j.detail === 'string' ? j.detail : j.error || r.statusText, r.status)
  return j as T
}

const q = (pid: string) => `?patient_id=${encodeURIComponent(pid)}`

export const api = {
  health: () => json<{ ok: boolean; demo_auth: boolean }>('/api/health'),
  /** Hidden Developer view only (family admins). */
  system: () => json<{ assistant_model: string; region: string; assistant_ready: boolean; mcp_protocol: string; voice: string }>('/api/system'),
  demoAccounts: () => json<DemoAccount[]>('/api/auth/demo-accounts'),
  login: (username: string, password: string) => json<Session>('/api/auth/login', { username, password }),
  me: (slot: Slot = 'viewer') => json<Session['user'] & { patients_overview: PatientSummary[] }>('/api/auth/me', undefined, slot),
  changePassword: (current_password: string, new_password: string, slot: Slot = 'viewer') => json('/api/auth/password', { current_password, new_password }, slot),
  patients: (slot: Slot = 'viewer') => json<PatientSummary[]>('/api/patients', undefined, slot),
  snapshot: (pid: string, slot: Slot = 'viewer') => json<Snapshot>(`/api/snapshot${q(pid)}`, undefined, slot),
  voices: () => json<ServerVoices>('/api/voices'),
  logDose: (pid: string, medication: string, slot: string, status = 'taken') => json(`/api/dose${q(pid)}`, { medication, slot, status }, 'viewer'),
  addVital: (pid: string, kind: string, value: number, value2?: number) => json(`/api/vitals${q(pid)}`, { kind, value, value2: value2 ?? null }, 'viewer'),
  addAppointment: (pid: string, body: Record<string, unknown>) => json(`/api/appointments${q(pid)}`, body, 'viewer'),
  resolveAlert: (id: number) => json(`/api/alerts/${id}/resolve`, {}),
  audit: (limit = 60) => json<AuditRow[]>(`/api/audit?limit=${limit}`),
  conversations: (pid?: string, slot: Slot = 'viewer') => json<ConversationSummary[]>(`/api/conversations${pid ? q(pid) : ''}`, undefined, slot),
  conversation: (id: string, slot: Slot = 'viewer') => json<ConversationMessage[]>(`/api/conversations/${encodeURIComponent(id)}`, undefined, slot),
  deleteMyHistory: () => json<{ deleted: number }>('/api/conversations', undefined, 'person', 'DELETE'),
  scenario: (name: 'decline' | 'stable' | 'fresh') => json('/api/demo/reset', { name }),

  admin: {
    overview: () => json<AdminOverview>('/api/admin/overview'),
    addMember: (b: Record<string, unknown>) => json('/api/admin/members', b),
    updateMember: (id: string, b: Record<string, unknown>) => json(`/api/admin/members/${id}`, b, 'viewer', 'PATCH'),
    removeMember: (id: string) => json(`/api/admin/members/${id}`, undefined, 'viewer', 'DELETE'),
    addPatient: (b: Record<string, unknown>) => json<{ id: string }>('/api/admin/patients', b),
    updatePatient: (id: string, b: Record<string, unknown>) => json(`/api/admin/patients/${id}`, b, 'viewer', 'PATCH'),
    archivePatient: (id: string) => json(`/api/admin/patients/${id}`, undefined, 'viewer', 'DELETE'),
    addMedication: (pid: string, b: Record<string, unknown>) => json(`/api/admin/patients/${pid}/medications`, b),
    updateMedication: (id: number, b: Record<string, unknown>) => json(`/api/admin/medications/${id}`, b, 'viewer', 'PATCH'),
    scanPrescription: (pid: string, b: { filename: string; media_type: string; data: string }) => json<RxScan>(`/api/admin/patients/${pid}/prescription/scan`, b),
    applyPrescription: (pid: string, b: Record<string, unknown>) => json<RxApplyResult>(`/api/admin/patients/${pid}/prescription/apply`, b),
    stopMedication: (id: number) => json(`/api/admin/medications/${id}`, undefined, 'viewer', 'DELETE'),
    updateAppointment: (id: number, b: Record<string, unknown>) => json(`/api/admin/appointments/${id}`, b, 'viewer', 'PATCH'),
    cancelAppointment: (id: number) => json(`/api/admin/appointments/${id}`, undefined, 'viewer', 'DELETE'),
    addFacility: (b: Record<string, unknown>) => json('/api/admin/facilities', b),
    updateFacility: (id: number, b: Record<string, unknown>) => json(`/api/admin/facilities/${id}`, b, 'viewer', 'PATCH'),
    removeFacility: (id: number) => json(`/api/admin/facilities/${id}`, undefined, 'viewer', 'DELETE'),
  },
}

/** POST + read an SSE stream, calling onEvent for every `data:` frame. */
export async function streamPost(
  path: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal, slot: Slot = 'viewer',
): Promise<void> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(slot) }, body: JSON.stringify(body ?? {}), signal })
  if (r.status === 401) notifyUnauthorized()
  if (r.status === 403) throw new Error('Your account is not allowed to do this.')
  if (r.status === 404) throw new Error('That patient is not available to your account.')
  if (!r.ok || !r.body) throw new Error(`Request failed (${r.status})`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2)
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) {
          try { onEvent(JSON.parse(line.slice(5).trim())) } catch { /* ignore malformed frame */ }
        }
      }
    }
  }
}

/** Fetch one sentence of server-side speech as a playable object URL, or null if the server could not make it. */
export async function fetchSpeech(text: string, language: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('person') }, body: JSON.stringify({ text, language }), signal })
    if (!r.ok) return null
    return URL.createObjectURL(await r.blob())
  } catch { return null }
}
