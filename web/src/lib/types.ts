export type Severity = 'info' | 'watch' | 'high' | 'urgent'
export type Level = 'ok' | Severity
export type DoseStatus = 'taken' | 'missed' | 'skipped' | 'due' | 'overdue' | 'upcoming'

export interface Person {
  id: string; family_id?: string; name: string; age: number; sex?: string; conditions: string; allergies?: string; language?: string; instructions?: string
  facility_id?: number | null; facility_name?: string | null; facility_kind?: string | null; facility_address?: string | null; facility_phone?: string | null
}
export interface Caregiver { id: string; name: string; role: string; phone?: string; notify_level?: 'all' | 'urgent' }
export interface Clinician { id: string; name: string; blurb: string }
export interface Medication { id: number; name: string; dose: string; purpose: string | null; times: string; with_food: number; notes: string | null; prescriber: string | null; active: number }
export interface VitalReading { ts: string; value: number; value2: number | null; unit: string }
export interface Dose {
  med_id: number; medication: string; dose: string; purpose: string; slot: string
  status: DoseStatus; with_food: boolean; notes: string | null
}
export interface Appointment {
  id: number; title: string; doctor: string | null; starts_at: string
  location: string | null; needs_ride: number | boolean; notes: string | null
}
export interface Alert { id: number; patient_id?: string; ts: string; severity: Severity; title: string; detail: string; status: string; notified: string }
export interface Checkin { id: number; ts: string; mood: number; pain: number; sleep_hours: number | null; note: string }
export interface Signal { signal: string; severity: Severity; detail: string }
export interface Signals { level: Level; signals: Signal[]; adherence_pct: number | null }
export interface Adherence {
  overall_pct: number | null
  by_day: Record<string, number>
  by_medication: Record<string, number>
  missed_doses: { day: string; medication: string; slot: string }[]
}
export interface Memory { kind: string; content: string; ts: string }

export interface Snapshot {
  now: string
  person: Person
  caregivers: Caregiver[]
  clinicians: Clinician[]
  vitals: Record<string, VitalReading[]>
  medications: Medication[]
  doses_today: Dose[]
  next_appointments: Appointment[]
  open_alerts: Alert[]
  latest_checkin: Checkin | null
  checkins_7d: Checkin[]
  adherence: Adherence
  signals: Signals
  memories: Memory[]
}

/** Events streamed from the POST /api/.../stream endpoints (Server-Sent Events). */
export type StreamEvent =
  | { type: 'session'; session_id: string }
  | { type: 'tool_start'; id: string; tool: string }
  | { type: 'tool_result'; id: string; tool: string; input: Record<string, unknown>; status: string; result: any }
  | { type: 'text'; delta: string }
  | { type: 'done'; reply: string }
  | { type: 'error'; message: string }

export interface ToolCall {
  id: string
  tool: string
  input?: Record<string, unknown>
  result?: any
  status: 'running' | 'success' | 'error'
  startedAt: number
  ms?: number
}

/** Tools that change the care record, so the UI refreshes after them. */
export const MUTATING_TOOLS = new Set(['log_dose', 'record_checkin', 'record_vital', 'schedule_appointment', 'raise_family_alert', 'resolve_alert', 'remember'])

/* ---------------- identity, audit, history ---------------- */
export type Role = 'person' | 'family' | 'admin' | 'clinician'
export interface User { id: string; name: string; role: Role; family_id: string | null; patient_id: string | null; permissions: string[]; patients: string[] }
export interface PatientSummary { id: string; name: string; age: number; conditions: string; language: string; level: Level; open_alerts: number }
export interface DemoAccount { id: string; name: string; role: Role; blurb: string; family_id: string | null; family_name: string; password: string | null }
export interface Session { token: string; user: User }
/** The two surfaces: Asha's Echo uses the `person` session; the family/clinician app uses the `viewer` session. */
export type Slot = 'person' | 'viewer'
export interface AuditRow { id: number; ts: string; actor_id: string; actor_role: string; family_id?: string | null; patient_id?: string | null; action: string; target: string; outcome: 'allowed' | 'denied' | 'rejected' | 'error'; detail: string }
export interface ConversationSummary { id: string; user_id: string; user_name: string; patient_id?: string | null; role: string; language: string; started_at: string; updated_at: string; messages: number }
export interface ConversationMessage { ts: string; who: 'user' | 'assistant'; text: string; tools: string }

/* ---------------- family administration ---------------- */
export interface Member { id: string; name: string; role: Role; patient_id: string | null; phone: string | null; notify_level: 'all' | 'urgent'; active: number; blurb: string }
export interface Facility { id: number; family_id: string; name: string; kind: string; address: string | null; phone: string | null }
export interface AdminAppointment { id: number; patient_id: string; title: string; doctor: string | null; starts_at: string; facility_id: number | null; location: string | null; needs_ride: number; notes: string | null }
export interface AdminPatient extends Omit<Person, 'facility_name' | 'facility_kind' | 'facility_address' | 'facility_phone'> {
  active: number; medications: Medication[]; appointments: AdminAppointment[]; clinicians: Clinician[]
}
export interface AdminOverview { family: { id: string; name: string; city: string; notes: string }; members: Member[]; patients: AdminPatient[]; facilities: Facility[] }

/* ---------------- prescription scanning ---------------- */
export interface RxItem {
  key: string; name: string; dose: string; times: string | null; frequency_text: string; with_food: boolean; duration: string; instructions: string
  confidence: number; source_text: string; status: 'new' | 'update' | 'duplicate'; existing_id: number | null; current: { dose: string; times: string } | null
  allergy_conflict: boolean; needs_times: boolean; as_needed: boolean; warnings: string[]
}
export interface RxScan {
  document: { legible: boolean; prescriber: string; date: string; patient_name: string }
  items: RxItem[]; follow_up: { when: string; notes: string } | null; warnings: string[]; meta: { format: string; bytes: number }
}
export interface RxApplyResult { added: string[]; updated: string[]; skipped: number; errors: { index: number | null; name: string | null; message: string }[]; appointment?: string }
