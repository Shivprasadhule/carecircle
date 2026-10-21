import type { Snapshot } from '../lib/types'

export const mkSnap = (over: Partial<Snapshot> = {}): Snapshot => ({
  now: '2026-10-21T12:00:00',
  person: { id: 'asha', family_id: 'deshmukh', name: 'Asha Deshmukh', age: 78, sex: 'F', conditions: 'Type 2 diabetes', allergies: 'Sulfa drugs', language: 'en-IN', instructions: 'Check fasting sugar before breakfast.', facility_name: 'Sen Clinic, Kothrud', facility_kind: 'clinic' },
  caregivers: [
    { id: 'rohan', name: 'Rohan Deshmukh', role: 'admin', phone: '', notify_level: 'all' },
    { id: 'meera', name: 'Meera Kulkarni', role: 'family', phone: '', notify_level: 'urgent' },
  ],
  clinicians: [{ id: 'drsen', name: 'Dr. Sen', blurb: 'GP' }],
  vitals: { spo2: [93, 92, 91].map((v, i) => ({ ts: `2026-10-${18 + i}T08:30:00`, value: v, value2: null, unit: '%' })), bp: [{ ts: '2026-10-20T08:30:00', value: 132, value2: 84, unit: 'mmHg' }] },
  medications: [{ id: 1, name: 'Metformin', dose: '500 mg', purpose: 'Blood sugar', times: '08:00,20:00', with_food: 1, notes: null, prescriber: 'Dr. Sen', active: 1 }],
  doses_today: [
    { med_id: 1, medication: 'Metformin', dose: '500 mg', purpose: 'Blood sugar', slot: '08:00', status: 'overdue', with_food: true, notes: null },
    { med_id: 2, medication: 'Amlodipine', dose: '5 mg', purpose: 'Blood pressure', slot: '08:00', status: 'taken', with_food: false, notes: null },
    { med_id: 1, medication: 'Metformin', dose: '500 mg', purpose: 'Blood sugar', slot: '20:00', status: 'upcoming', with_food: true, notes: null },
  ],
  next_appointments: [{ id: 1, title: 'Diabetes review', doctor: 'Dr. Sen', starts_at: '2026-10-23T10:30:00', location: 'Sen Clinic', needs_ride: 1, notes: null }],
  open_alerts: [{ id: 7, ts: '2026-10-21T11:50:00', severity: 'high', title: 'Mood and sleep decline', detail: 'Mood fell from 4 to 1.', status: 'open', notified: 'Rohan, Meera' }],
  latest_checkin: null,
  checkins_7d: [4, 4, 3, 1].map((mood, i) => ({ id: i, ts: `2026-10-${17 + i}T09:00:00`, mood, pain: 3 + i, sleep_hours: 7 - i, note: '' })),
  adherence: { overall_pct: 91.4, by_day: { '2026-10-17': 100, '2026-10-18': 100, '2026-10-19': 75, '2026-10-20': 75 }, by_medication: {}, missed_doses: [{ day: '2026-10-19', medication: 'Metformin', slot: '20:00' }] },
  signals: { level: 'high', adherence_pct: 91.4, signals: [{ signal: 'compound_decline', severity: 'high', detail: 'Mood, sleep and routine are slipping together.' }] },
  memories: [{ kind: 'preference', content: "Prefers 'Asha tai'", ts: '2026-10-21T09:00:00' }],
  ...over,
})

import type { Role, Session } from '../lib/types'

// Mirrors the server's permission matrix (carecircle/auth.py PERMS). The server remains the authority.
const FAMILY = ['snapshot:read', 'dose:log', 'checkin:write', 'vital:write', 'appointment:write', 'memory:read', 'memory:write', 'alert:raise', 'alert:read', 'alert:resolve', 'agent:run', 'chat:family', 'conversation:read', 'family:read']
export const PERMS: Record<Role, string[]> = {
  person: ['snapshot:read', 'dose:log', 'checkin:write', 'vital:write', 'appointment:write', 'memory:read', 'memory:write', 'alert:raise', 'chat:person', 'conversation:read_own', 'conversation:delete_own'],
  family: FAMILY,
  admin: [...FAMILY, 'audit:read', 'members:manage', 'patients:manage', 'meds:manage', 'facilities:manage', 'appointments:manage', 'instructions:write', 'demo:reset'],
  clinician: ['snapshot:read', 'alert:read', 'memory:read', 'chat:family'],
}

export const sess = (id: string, name: string, role: Role, patients: string[] = ['asha', 'madhav'], patient_id: string | null = null): Session => ({
  token: `tok-${id}`, user: { id, name, role, family_id: role === 'clinician' ? null : 'deshmukh', patient_id, permissions: [...PERMS[role]], patients },
})
export const ASHA = sess('asha', 'Asha Deshmukh', 'person', ['asha'], 'asha')
export const ROHAN = sess('rohan', 'Rohan Deshmukh', 'admin')
export const MEERA = sess('meera', 'Meera Kulkarni', 'family')
export const DRSEN = sess('drsen', 'Dr. Sen', 'clinician', ['asha', 'kamla'])
export const BOTH = { person: ASHA, viewer: ROHAN }

import type { AdminOverview, PatientSummary } from '../lib/types'

export const PATIENTS: PatientSummary[] = [
  { id: 'asha', name: 'Asha Deshmukh', age: 78, conditions: 'Type 2 diabetes, hypertension', language: 'en-IN', level: 'high', open_alerts: 1 },
  { id: 'madhav', name: 'Madhav Deshmukh', age: 81, conditions: 'Stroke (2024), atrial fibrillation', language: 'en-IN', level: 'ok', open_alerts: 0 },
]

export const mkOverview = (): AdminOverview => ({
  family: { id: 'deshmukh', name: 'Deshmukh family', city: 'Pune', notes: '' },
  members: [
    { id: 'asha', name: 'Asha Deshmukh', role: 'person', patient_id: 'asha', phone: null, notify_level: 'urgent', active: 1, blurb: 'Patient' },
    { id: 'rohan', name: 'Rohan Deshmukh', role: 'admin', patient_id: null, phone: '+91 98220 10101', notify_level: 'all', active: 1, blurb: 'Son' },
    { id: 'meera', name: 'Meera Kulkarni', role: 'family', patient_id: null, phone: null, notify_level: 'urgent', active: 1, blurb: 'Daughter' },
  ],
  patients: [
    {
      id: 'asha', family_id: 'deshmukh', name: 'Asha Deshmukh', age: 78, sex: 'F', conditions: 'Type 2 diabetes', allergies: 'Sulfa drugs', language: 'en-IN', facility_id: 1,
      instructions: 'Check fasting sugar before breakfast.', active: 1, clinicians: [{ id: 'drsen', name: 'Dr. Sen', blurb: 'GP' }],
      medications: [{ id: 11, name: 'Metformin', dose: '500 mg', purpose: 'Blood sugar', times: '08:00,20:00', with_food: 1, notes: 'Take with food', prescriber: 'Dr. Sen', active: 1 }],
      appointments: [{ id: 21, patient_id: 'asha', title: 'Diabetes review', doctor: 'Dr. Sen', starts_at: '2099-10-23T10:30:00', facility_id: 1, location: 'Sen Clinic', needs_ride: 1, notes: null }],
    },
    { id: 'madhav', family_id: 'deshmukh', name: 'Madhav Deshmukh', age: 81, sex: 'M', conditions: 'Stroke (2024)', allergies: '', language: 'en-IN', facility_id: null, instructions: '', active: 1, clinicians: [], medications: [], appointments: [] },
  ],
  facilities: [{ id: 1, family_id: 'deshmukh', name: 'Sen Clinic, Kothrud', kind: 'clinic', address: '14 Karve Road', phone: '+91 20 2545 0101' }],
})
