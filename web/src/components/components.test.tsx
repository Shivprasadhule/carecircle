import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASHA, BOTH, DRSEN, MEERA, mkOverview, mkSnap, PATIENTS, ROHAN } from '../test/fixtures'
import type { ToolCall } from '../lib/types'

const m = {
  snapshot: vi.fn(), patients: vi.fn(), logDose: vi.fn(), resolveAlert: vi.fn(), streamPost: vi.fn(), audit: vi.fn(), conversations: vi.fn(), conversation: vi.fn(),
  deleteMyHistory: vi.fn(), login: vi.fn(), demoAccounts: vi.fn(), addVital: vi.fn(), addAppointment: vi.fn(),
  admin: { overview: vi.fn(), addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(), addPatient: vi.fn(), updatePatient: vi.fn(), archivePatient: vi.fn(),
    addMedication: vi.fn(), updateMedication: vi.fn(), stopMedication: vi.fn(), updateAppointment: vi.fn(), cancelAppointment: vi.fn(), addFacility: vi.fn(), updateFacility: vi.fn(), removeFacility: vi.fn() },
}
vi.mock('../lib/api', () => ({
  api: {
    snapshot: (...a: unknown[]) => m.snapshot(...a), patients: (...a: unknown[]) => m.patients(...a), logDose: (...a: unknown[]) => m.logDose(...a),
    resolveAlert: (...a: unknown[]) => m.resolveAlert(...a), audit: (...a: unknown[]) => m.audit(...a), conversations: (...a: unknown[]) => m.conversations(...a),
    conversation: (...a: unknown[]) => m.conversation(...a), deleteMyHistory: (...a: unknown[]) => m.deleteMyHistory(...a), login: (...a: unknown[]) => m.login(...a),
    demoAccounts: (...a: unknown[]) => m.demoAccounts(...a), addVital: (...a: unknown[]) => m.addVital(...a), addAppointment: (...a: unknown[]) => m.addAppointment(...a),
    health: vi.fn().mockResolvedValue({ ok: true, demo_auth: true }), scenario: vi.fn(),
    system: vi.fn().mockResolvedValue({ assistant_model: 'test-model', region: 'test-region', assistant_ready: true, mcp_protocol: '2025-11-25', voice: 'device voices' }),
    voices: vi.fn().mockResolvedValue({ server_languages: [], preferred: [], engines: {}, engine: 'x' }),
    admin: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (m.admin as any)[k](...a) }),
  },
  streamPost: (...a: unknown[]) => m.streamPost(...a),
  fetchSpeech: vi.fn().mockResolvedValue(null),
  ApiError: class extends Error { constructor(msg: string, public status: number) { super(msg) } },
}))

import { CareProvider } from '../state/care'
import { cardsFor } from './alexa/ToolCards'
import { AlexaScreen } from './alexa/AlexaScreen'
import { AlertsFeed } from './family/AlertsFeed'
import { CarePlan } from './family/CarePlan'
import { MedTimeline } from './family/MedTimeline'
import { StatTiles, tilesFrom } from './family/StatTiles'
import { Overview } from './family/Overview'
import { PatientSwitcher } from './family/PatientSwitcher'
import { VitalsPanel } from './family/VitalsPanel'
import { PushToasts, ScenarioPanel } from './family/Misc'
import { CareWatch } from './family/CareWatch'
import { ActivityPanel, ConversationsPanel } from './family/Governance'
import { ManageConsole } from './manage/ManageConsole'
import { SignIn } from './SignIn'
import App from '../App'
import { notifyUnauthorized } from '../lib/auth'

const wrap = (ui: React.ReactNode, sessions: any = BOTH) => render(<CareProvider pollMs={60_000} initialSessions={sessions}>{ui}</CareProvider>)
const snapshot = m.snapshot, logDose = m.logDose, resolveAlert = m.resolveAlert, streamPost = m.streamPost, audit = m.audit
const conversations = m.conversations, conversation = m.conversation, deleteMyHistory = m.deleteMyHistory, login = m.login

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear(); sessionStorage.clear()
  snapshot.mockResolvedValue(mkSnap())
  m.patients.mockResolvedValue(PATIENTS)
  logDose.mockResolvedValue({ ok: true })
  resolveAlert.mockResolvedValue({ ok: true })
  audit.mockResolvedValue([])
  conversations.mockResolvedValue([])
  conversation.mockResolvedValue([])
  deleteMyHistory.mockResolvedValue({ deleted: 2 })
  m.demoAccounts.mockResolvedValue([])
  m.admin.overview.mockResolvedValue(mkOverview())
  for (const k of Object.keys(m.admin)) if (k !== 'overview') (m.admin as any)[k].mockResolvedValue({ id: 'x' })
})

describe('stat tiles', () => {
  it('derive latest values and direction of change from the snapshot', () => {
    const t = Object.fromEntries(tilesFrom(mkSnap()).map((x) => [x.key, x]))
    expect(t.mood.value).toBe('1')
    expect(t.mood.delta).toBeLessThan(0)       // mood falling
    expect(t.pain.delta).toBeGreaterThan(0)    // pain rising
    expect(t.adherence.value).toBe('91')
  })
  it('renders skeletons before data, tiles after', () => {
    const { rerender } = render(<StatTiles snap={null} />)
    expect(screen.queryByTestId('stat-tiles')).toBeNull()
    rerender(<StatTiles snap={mkSnap()} />)
    expect(screen.getByTestId('tile-mood')).toBeInTheDocument()
  })
})

describe('overview', () => {
  it('surfaces the most important signal as the AI insight', () => {
    render(<Overview snap={mkSnap()} />)
    expect(screen.getByTestId('insight')).toHaveTextContent(/compound decline/i)
    expect(screen.getByRole('img', { name: /risk: needs attention/i })).toBeInTheDocument()
  })
  it('shows a calm message when nothing is wrong', () => {
    render(<Overview snap={mkSnap({ signals: { level: 'ok', signals: [], adherence_pct: 100 } })} />)
    expect(screen.getByTestId('insight')).toHaveTextContent(/steady week/i)
  })
})

describe('medicine timeline', () => {
  it('marks a dose taken optimistically and tells the server', async () => {
    wrap(<MedTimeline />)
    const btn = await screen.findByRole('button', { name: /mark metformin 8:00 am as taken/i })
    await userEvent.click(btn)
    await waitFor(() => expect(logDose).toHaveBeenCalledWith('asha', 'Metformin', '08:00'))        // always names the patient
    expect(await screen.findByRole('button', { name: /metformin taken/i })).toBeInTheDocument()
  })
  it('does not offer an action for doses already taken', async () => {
    wrap(<MedTimeline />)
    const taken = await screen.findByRole('button', { name: /amlodipine taken/i })
    expect(taken).toBeDisabled()
  })
})

describe('alerts feed', () => {
  it('lists open alerts and resolves one', async () => {
    wrap(<AlertsFeed />)
    expect(await screen.findByText('Mood and sleep decline')).toBeInTheDocument()
    snapshot.mockResolvedValue(mkSnap({ open_alerts: [] }))
    await userEvent.click(screen.getByRole('button', { name: /resolve/i }))
    await waitFor(() => expect(resolveAlert).toHaveBeenCalledWith(7))
    expect(await screen.findByText(/all quiet/i)).toBeInTheDocument()
  })
})

describe('alexa tool cards', () => {
  const call = (tool: string, result: unknown, over: Partial<ToolCall> = {}): ToolCall => ({ id: tool + Math.random(), tool, result, status: 'success', startedAt: 0, ...over })

  it('renders a card per finished call and nothing for running or failed calls', () => {
    const cards = cardsFor([
      call('log_dose', { ok: true, medication: 'Metformin', dose: '500 mg', slot: '08:00', status: 'taken' }),
      call('record_checkin', { ok: true, mood: 2, pain: 6, sleep_hours: 4.5 }, { status: 'error' }),
      call('analyze_wellbeing_trends', { signals: { level: 'high', signals: [] } }, { status: 'running' }),
    ])
    expect(cards).toHaveLength(1)
  })

  it('de-duplicates the doses card when both snapshot and dose list ran', () => {
    const doses = mkSnap().doses_today
    const cards = cardsFor([call('get_care_snapshot', { doses_today: doses, next_appointments: [] }), call('list_todays_doses', { doses })])
    expect(cards).toHaveLength(1)
  })

  it('does not draw a "logged" card when logging was refused', () => {
    expect(cardsFor([call('log_dose', { ok: false, error: 'not due yet' })])).toHaveLength(0)
  })
})

describe('Alexa screen language', () => {
  beforeEach(() => localStorage.clear())

  it('switches the whole screen to Hindi and sends the language with every message', async () => {
    streamPost.mockImplementation(async (_p: string, _b: unknown, onEvent: (e: any) => void) => { onEvent({ type: 'done', reply: 'ठीक है।' }) })
    wrap(<AlexaScreen />)
    await userEvent.click(screen.getByRole('button', { name: /language and voice/i }))
    await userEvent.click(screen.getByRole('button', { name: /हिन्दी/ }))
    expect(await screen.findByPlaceholderText('अलेक्सा से कुछ कहें या लिखें…')).toBeInTheDocument()
    expect(screen.getAllByText(/आशा जी/).length).toBeGreaterThanOrEqual(1)
    await userEvent.click(screen.getByRole('button', { name: 'मैंने अपनी Metformin ले ली' }))
    await waitFor(() => expect(streamPost).toHaveBeenCalled())
    expect(streamPost.mock.calls[0][1]).toMatchObject({ message: 'मैंने अपनी Metformin ले ली', language: 'hi-IN' })
    expect(streamPost.mock.calls[0][1]).not.toHaveProperty('role')          // the server derives the role from the signed-in account
    expect(streamPost.mock.calls[0][4]).toBe('person')                        // and the request carries Asha's token, not the family's
  })

  it('remembers the chosen language across reloads', async () => {
    const { unmount } = wrap(<AlexaScreen />)
    await userEvent.click(screen.getByRole('button', { name: /language and voice/i }))
    await userEvent.click(screen.getByRole('button', { name: /தமிழ்/ }))
    unmount()
    wrap(<AlexaScreen />)
    expect(await screen.findByPlaceholderText(/அலெக்ஸாவிடம்/)).toBeInTheDocument()
  })

  it('warns that Alexa will answer in text when the device has no voice for the language', async () => {
    wrap(<AlexaScreen />)
    await userEvent.click(screen.getByRole('button', { name: /language and voice/i }))
    await userEvent.click(screen.getByRole('button', { name: /தமிழ்/ }))
    expect(await screen.findByRole('status')).toHaveTextContent(/no tamil voice/i)   // jsdom has no speech voices at all
  })
})

describe('Alexa screen conversation', () => {
  it('streams a reply, shows tool cards, and refreshes care data after a mutating tool', async () => {
    streamPost.mockImplementation(async (_p: string, _b: unknown, onEvent: (e: any) => void) => {
      onEvent({ type: 'session', session_id: 's1' })
      onEvent({ type: 'tool_start', id: 't1', tool: 'log_dose' })
      onEvent({ type: 'tool_result', id: 't1', tool: 'log_dose', input: { medication: 'metformin' }, status: 'success', result: { ok: true, medication: 'Metformin', dose: '500 mg', slot: '08:00', status: 'taken' } })
      onEvent({ type: 'text', delta: 'Lovely, ' })
      onEvent({ type: 'text', delta: 'that is logged.' })
      onEvent({ type: 'done', reply: 'Lovely, that is logged.' })
    })
    wrap(<AlexaScreen />)
    await waitFor(() => expect(snapshot).toHaveBeenCalled())
    const before = snapshot.mock.calls.length
    await userEvent.type(screen.getByLabelText('Message Alexa'), 'I took my metformin')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await within(screen.getByTestId('feed')).findByText('I took my metformin')).toBeInTheDocument()
    const reply = await screen.findByTestId('assistant-message')
    await waitFor(() => expect(within(reply).getByText('Lovely, that is logged.')).toBeInTheDocument())
    expect(within(reply).getByTestId('card-dose-logged')).toBeInTheDocument()
    await waitFor(() => expect(snapshot.mock.calls.length).toBeGreaterThan(before))
    expect(streamPost).toHaveBeenCalledWith('/api/chat/stream?patient_id=asha', expect.objectContaining({ message: 'I took my metformin' }), expect.any(Function), expect.anything(), 'person')
  })

  it('shows a friendly error when the stream fails, and lets the user continue', async () => {
    streamPost.mockRejectedValueOnce(new Error('Request failed (502)'))
    wrap(<AlexaScreen />)
    await userEvent.type(screen.getByLabelText('Message Alexa'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't finish/i)
    expect(screen.getByLabelText('Message Alexa')).not.toBeDisabled()
  })

  it('raises a push notification on the family app when Alexa alerts the family', async () => {
    streamPost.mockImplementation(async (_p: string, _b: unknown, onEvent: (e: any) => void) => {
      onEvent({ type: 'tool_result', id: 'a1', tool: 'raise_family_alert', input: {}, status: 'success', result: { alert: { severity: 'urgent', title: 'Possible fall', detail: 'Asha said she fell.', notified: 'Rohan, Meera' } } })
      onEvent({ type: 'done', reply: 'I have told your family.' })
    })
    wrap(<><AlexaScreen /><PushToasts /></>)
    await userEvent.type(screen.getByLabelText('Message Alexa'), 'I fell')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByTestId('push-toast')).toHaveTextContent(/possible fall/i)
  })
})



describe('role-based UI (the server enforces the same rules)', () => {
  it('lets family tick off doses and resolve alerts', async () => {
    wrap(<><MedTimeline /><AlertsFeed /></>, { viewer: MEERA })
    expect(await screen.findByRole('button', { name: /mark metformin 8:00 am as taken/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument()
  })

  it('makes the clinician account read-only: no logging, no resolving, no care watch, no demo controls', async () => {
    wrap(<><MedTimeline /><AlertsFeed /><CareWatch /><ScenarioPanel /></>, { viewer: DRSEN })
    expect(await screen.findByText('Mood and sleep decline')).toBeInTheDocument()          // may read alerts
    expect(screen.queryByRole('button', { name: /mark metformin/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /resolve/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /run care watch/i })).toBeNull()
    expect(screen.getByText(/read-only account/i)).toBeInTheDocument()
    expect(screen.queryByTestId('scenarios')).toBeNull()
  })

  it('shows the care watch controls to family and the demo controls only to admins', async () => {
    const { unmount } = wrap(<><CareWatch /><ScenarioPanel /></>, { viewer: MEERA })
    expect(screen.getByRole('button', { name: /run care watch/i })).toBeInTheDocument()
    expect(screen.queryByTestId('scenarios')).toBeNull()
    unmount()
    wrap(<ScenarioPanel />, { viewer: ROHAN })
    expect(screen.getByTestId('scenarios')).toBeInTheDocument()
  })
})

describe('patient switcher and the record on screen', () => {
  it('lists every patient the account may see with risk and alert counts, and hides itself for one', async () => {
    const { unmount } = wrap(<PatientSwitcher />, { viewer: ROHAN })
    expect(await screen.findByRole('tab', { name: /asha/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /madhav/i })).toBeInTheDocument()
    expect(screen.getByLabelText('1 open alerts')).toBeInTheDocument()
    unmount()
    m.patients.mockResolvedValue([PATIENTS[0]])
    wrap(<PatientSwitcher />, { viewer: ROHAN })
    await waitFor(() => expect(m.patients).toHaveBeenCalled())
    expect(screen.queryByTestId('patient-switcher')).toBeNull()
  })

  it('switching patient loads THAT patient and never keeps showing the previous one', async () => {
    snapshot.mockImplementation(async (pid: string) => (pid === 'madhav'
      ? mkSnap({ person: { id: 'madhav', name: 'Madhav Deshmukh', age: 81, conditions: 'Stroke (2024)', instructions: 'No NSAIDs.' }, open_alerts: [] })
      : mkSnap()))
    wrap(<><PatientSwitcher /><Overview snap={null} /><CarePlan /></>, { viewer: ROHAN })
    expect(await screen.findByText(/check fasting sugar/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /madhav/i }))
    expect(await screen.findByText(/no nsaids/i)).toBeInTheDocument()
    expect(screen.queryByText(/check fasting sugar/i)).toBeNull()
    expect(snapshot.mock.calls.some((c) => c[0] === 'madhav')).toBe(true)
    expect(localStorage.getItem('cc.patient')).toBe('madhav')
  })
})

describe('care plan', () => {
  it('shows instructions, allergies, facility, clinicians and medicines', async () => {
    wrap(<CarePlan />, { viewer: ROHAN })
    expect(await screen.findByTestId('care-instructions')).toHaveTextContent(/check fasting sugar/i)
    const plan = screen.getByTestId('care-plan')
    expect(plan).toHaveTextContent('Sulfa drugs')
    expect(plan).toHaveTextContent('Sen Clinic, Kothrud')
    expect(plan).toHaveTextContent('Dr. Sen')
    expect(within(screen.getByTestId('medicine-list')).getByText('Metformin')).toBeInTheDocument()
  })
  it('tells admins where to add instructions when there are none', async () => {
    snapshot.mockResolvedValue(mkSnap({ person: { ...mkSnap().person, instructions: '' } }))
    wrap(<CarePlan />, { viewer: ROHAN })
    expect(await screen.findByText(/add them under manage/i)).toBeInTheDocument()
  })
})

describe('vital signs', () => {
  it('tints and labels a reading that the signal engine flagged', async () => {
    snapshot.mockResolvedValue(mkSnap({ signals: { level: 'high', adherence_pct: 90, signals: [{ signal: 'low_oxygen', severity: 'high', detail: 'Oxygen fell from 93% to 91%.' }] } }))
    wrap(<VitalsPanel />, { viewer: ROHAN })
    const spo2 = await screen.findByTestId('vital-spo2')
    expect(spo2).toHaveTextContent('91')
    expect(spo2).toHaveTextContent(/high/i)
    expect(screen.getByTestId('vital-bp')).toHaveTextContent('132/84')
    expect(screen.getByTestId('vital-bp')).not.toHaveTextContent(/high|watch/i)
  })

  it('lets family add a reading and shows the server\'s refusal for an implausible one', async () => {
    wrap(<VitalsPanel />, { viewer: ROHAN })
    await userEvent.click(await screen.findByRole('button', { name: /add reading/i }))
    await userEvent.selectOptions(screen.getByLabelText('Reading'), 'spo2')
    await userEvent.type(screen.getByLabelText('Value'), '9')
    m.addVital.mockRejectedValueOnce(new Error('spo2 of 9 looks wrong (expected 50-100).'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/looks wrong/i)
    m.addVital.mockResolvedValueOnce({ ok: true })
    await userEvent.clear(screen.getByLabelText('Value')); await userEvent.type(screen.getByLabelText('Value'), '95')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(m.addVital).toHaveBeenLastCalledWith('asha', 'spo2', 95, undefined))
  })

  it('does not offer to add readings to a read-only account', async () => {
    wrap(<VitalsPanel />, { viewer: DRSEN })
    await screen.findByTestId('vitals-panel')
    expect(screen.queryByRole('button', { name: /add reading/i })).toBeNull()
  })
})

describe('activity log', () => {
  const rows = [
    { id: 3, ts: new Date().toISOString(), actor_id: 'drsen', actor_role: 'clinician', action: 'tool:log_dose', target: '', outcome: 'denied', detail: '' },
    { id: 2, ts: new Date().toISOString(), actor_id: 'asha', actor_role: 'person', action: 'tool:record_checkin', target: '', outcome: 'allowed', detail: '{"note":"<redacted>"}' },
  ]
  it('lists who did what and can filter to refused attempts', async () => {
    audit.mockResolvedValue(rows)
    wrap(<ActivityPanel />, { viewer: ROHAN })
    expect(await screen.findAllByTestId('audit-row')).toHaveLength(2)
    expect(screen.getByText(/drsen \(clinician\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /refused only \(1\)/i }))
    expect(screen.getAllByTestId('audit-row')).toHaveLength(1)
    expect(screen.getByText(/MCP tool/)).toBeInTheDocument()
  })
  it('shows an error instead of crashing when the account may not read the log', async () => {
    audit.mockRejectedValue(new Error('A clinician account is not allowed to do this (audit:read)'))
    wrap(<ActivityPanel />, { viewer: DRSEN })
    expect(await screen.findByRole('alert')).toHaveTextContent(/not allowed/i)
  })
})

describe('conversation history', () => {
  it('lists stored chats (not background agent runs) and opens a thread, scoped to the patient on screen', async () => {
    conversations.mockResolvedValue([
      { id: 'asha:asha:s1', user_id: 'asha', user_name: 'Asha Deshmukh', patient_id: 'asha', role: 'person', language: 'hi-IN', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: 2 },
      { id: 'rohan:asha:watch-ab12', user_id: 'rohan', user_name: 'Rohan Deshmukh', patient_id: 'asha', role: 'family', language: 'en-IN', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: 2 },
    ])
    conversation.mockResolvedValue([{ ts: '', who: 'user', text: 'I took my metformin', tools: '[]' }, { ts: '', who: 'assistant', text: 'Logged.', tools: '["log_dose"]' }])
    wrap(<ConversationsPanel />, { viewer: ROHAN })
    const row = await screen.findByRole('button', { name: /asha deshmukh/i })
    expect(screen.queryByText(/rohan deshmukh/i)).toBeNull()
    await userEvent.click(row)
    expect(await screen.findByText('I took my metformin')).toBeInTheDocument()
    expect(screen.getByText('log_dose')).toBeInTheDocument()
    await waitFor(() => expect(conversations).toHaveBeenCalledWith('asha', 'viewer'))
  })
})

describe('patient privacy control', () => {
  it('needs two taps to erase her own history, then confirms', async () => {
    wrap(<AlexaScreen />)
    await userEvent.click(screen.getByRole('button', { name: /language and voice/i }))
    await userEvent.click(screen.getByRole('button', { name: /delete my conversation history/i }))
    expect(deleteMyHistory).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /tap again to confirm/i }))
    await waitFor(() => expect(deleteMyHistory).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/deleted 2 conversations/i)).toBeInTheDocument()
  })
})

const ACCOUNTS = [
  { id: 'rohan', name: 'Rohan Deshmukh', role: 'admin', blurb: 'Son. Family admin', family_id: 'deshmukh', family_name: 'Deshmukh family', password: 'Rohan_2026' },
  { id: 'asha', name: 'Asha Deshmukh', role: 'person', blurb: 'The person in care', family_id: 'deshmukh', family_name: 'Deshmukh family', password: 'Asha_2026' },
  { id: 'suresh', name: 'Suresh Iyer', role: 'admin', blurb: 'Son', family_id: 'iyer', family_name: 'Iyer family', password: 'Suresh_2026' },
  { id: 'drsen', name: 'Dr. Sen', role: 'clinician', blurb: 'GP', family_id: null, family_name: 'Clinicians', password: 'Sen_2026' },
  { id: 'meera', name: 'Meera Kulkarni', role: 'family', blurb: 'Daughter', family_id: 'deshmukh', family_name: 'Deshmukh family', password: null },
]

describe('sign-in', () => {
  it('shows a username and password form and the demo directory grouped by family, with each demo password', async () => {
    m.demoAccounts.mockResolvedValue(ACCOUNTS)
    render(<CareProvider pollMs={60_000}><SignIn /></CareProvider>)
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(await screen.findByTestId('family-Deshmukh family')).toBeInTheDocument()
    expect(screen.getByTestId('family-Iyer family')).toBeInTheDocument()
    expect(screen.getByTestId('family-Clinicians')).toBeInTheDocument()
    expect(screen.getByTestId('account-asha')).toHaveTextContent('Asha_2026')
    expect(screen.getByTestId('account-drsen')).toHaveTextContent('Sen_2026')
    expect(screen.getByTestId('account-meera')).toHaveTextContent('(changed)')           // a changed password is never displayed
  })

  it('"Use" fills the form, and submitting signs in with those credentials', async () => {
    m.demoAccounts.mockResolvedValue(ACCOUNTS)
    login.mockResolvedValue(ROHAN)
    render(<CareProvider pollMs={60_000}><SignIn /></CareProvider>)
    await userEvent.click(await screen.findByRole('button', { name: /fill sign-in for rohan/i }))
    expect(screen.getByLabelText('Username')).toHaveValue('rohan')
    expect(screen.getByLabelText('Password')).toHaveValue('Rohan_2026')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(login).toHaveBeenCalledWith('rohan', 'Rohan_2026'))
    expect(JSON.parse(sessionStorage.getItem('cc.sessions')!)).toMatchObject({ viewer: { user: { id: 'rohan', role: 'admin' } } })
  })

  it('shows the server\'s message for a wrong password and for a locked account, and stays signed out', async () => {
    login.mockRejectedValueOnce(new Error('Wrong username or password'))
    render(<CareProvider pollMs={60_000}><SignIn /></CareProvider>)
    await userEvent.type(screen.getByLabelText('Username'), 'rohan')
    await userEvent.type(screen.getByLabelText('Password'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password')
    login.mockRejectedValueOnce(new Error('Too many failed attempts. Try again in 30 seconds.'))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/too many failed attempts/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('cc.sessions')).toBeNull()
  })

  it('requires both fields and can reveal the password', async () => {
    render(<CareProvider pollMs={60_000}><SignIn /></CareProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your username and password/i)
    expect(login).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
  })

  it('"Start the demo" signs in Asha and Rohan with their demo passwords', async () => {
    m.demoAccounts.mockResolvedValue(ACCOUNTS)
    login.mockImplementation(async (u: string) => (u === 'asha' ? ASHA : ROHAN))
    render(<CareProvider pollMs={60_000}><SignIn /></CareProvider>)
    await userEvent.click(await screen.findByRole('button', { name: /start the demo/i }))
    await waitFor(() => expect(login.mock.calls).toEqual([['asha', 'Asha_2026'], ['rohan', 'Rohan_2026']]))
    expect(JSON.parse(sessionStorage.getItem('cc.sessions')!)).toMatchObject({ person: { user: { id: 'asha' } }, viewer: { user: { id: 'rohan' } } })
  })
})

describe('app shell, sessions and views per role', () => {
  it('shows only the sign-in screen, and requests no data, before sign-in', async () => {
    m.demoAccounts.mockResolvedValue(ACCOUNTS)
    render(<App />)
    expect(await screen.findByRole('heading', { name: /sign in to carecircle/i })).toBeInTheDocument()
    expect(snapshot).not.toHaveBeenCalled()
  })

  it.each([
    ['admin', { viewer: ROHAN }, ['Family app', 'Manage'], ["Asha's Echo", 'Side by side']],
    ['family member', { viewer: MEERA }, ['Family app'], ['Manage', "Asha's Echo"]],
    ['clinician', { viewer: DRSEN }, ['Family app'], ['Manage', "Asha's Echo", 'Side by side']],
    ['patient', { person: ASHA }, ["Asha's Echo"], ['Family app', 'Manage']],
    ['patient + admin', BOTH, ["Asha's Echo", 'Family app', 'Manage'], []],
  ])('a %s sees only the views they may use', async (_n, sessions, present, absent) => {
    sessionStorage.setItem('cc.sessions', JSON.stringify(sessions))
    render(<App />)
    for (const label of present as string[]) expect(await screen.findByRole('button', { name: label })).toBeInTheDocument()
    for (const label of absent as string[]) expect(screen.queryByRole('button', { name: label })).toBeNull()
  })

  it("names the Echo tab for whoever owns it, never for someone else", async () => {
    sessionStorage.setItem('cc.sessions', JSON.stringify({ person: { ...ASHA, user: { ...ASHA.user, id: 'thomas', name: 'Thomas Nair', patient_id: 'thomas', patients: ['thomas'] } } }))
    render(<App />)
    expect(await screen.findByRole('button', { name: "Thomas's Echo" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Asha's Echo/ })).toBeNull()
    await waitFor(() => expect(snapshot).toHaveBeenCalledWith('thomas', 'person'))       // and it asks for HIS record only
  })

  it('labels the family admin and the read-only clinician in the header', async () => {
    sessionStorage.setItem('cc.sessions', JSON.stringify({ viewer: ROHAN }))
    const { unmount } = render(<App />)
    expect(await screen.findByTestId('session-chips')).toHaveTextContent(/family admin/i)
    unmount()
    sessionStorage.setItem('cc.sessions', JSON.stringify({ viewer: DRSEN }))
    render(<App />)
    expect(await screen.findByTestId('session-chips')).toHaveTextContent(/read-only/i)
  })

  it('drops back to sign-in when the server rejects the session, clearing stored tokens', async () => {
    sessionStorage.setItem('cc.sessions', JSON.stringify(BOTH))
    m.demoAccounts.mockResolvedValue(ACCOUNTS)
    render(<App />)
    await screen.findByTestId('session-chips')
    notifyUnauthorized()
    expect(await screen.findByRole('heading', { name: /sign in to carecircle/i })).toBeInTheDocument()
    expect(sessionStorage.getItem('cc.sessions')).toBe('{}')
  })

  it('signing out clears the stored tokens', async () => {
    sessionStorage.setItem('cc.sessions', JSON.stringify(BOTH))
    m.demoAccounts.mockResolvedValue(ACCOUNTS)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(await screen.findByRole('heading', { name: /sign in to carecircle/i })).toBeInTheDocument()
    expect(sessionStorage.getItem('cc.sessions')).toBe('{}')
  })
})

describe('family admin console', () => {
  const openTab = async (name: RegExp) => { wrap(<ManageConsole />, { viewer: ROHAN }); await screen.findByTestId('manage-console'); await userEvent.click(screen.getByRole('tab', { name })) }

  it('adds a person with a temporary password and reports success', async () => {
    wrap(<ManageConsole />, { viewer: ROHAN })
    const form = await screen.findByRole('form', { name: 'Add a person' })
    await userEvent.type(within(form).getByLabelText('Full name'), 'Kiran Deshmukh')
    await userEvent.type(within(form).getByLabelText(/^Username/), 'kiran')
    await userEvent.type(within(form).getByLabelText(/^Temporary password/), 'Kiran_2026')
    await userEvent.click(within(form).getByRole('button', { name: 'Add person' }))
    await waitFor(() => expect(m.admin.addMember).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kiran Deshmukh', username: 'kiran', role: 'family', password: 'Kiran_2026' })))
    expect(await screen.findByText(/kiran deshmukh was added/i)).toBeInTheDocument()
  })

  it('shows the server\'s refusal (username taken) without losing what was typed', async () => {
    m.admin.addMember.mockRejectedValueOnce(new Error('That username is taken'))
    wrap(<ManageConsole />, { viewer: ROHAN })
    const form = await screen.findByRole('form', { name: 'Add a person' })
    await userEvent.type(within(form).getByLabelText('Full name'), 'Someone')
    await userEvent.type(within(form).getByLabelText(/^Username/), 'asha')
    await userEvent.type(within(form).getByLabelText(/^Temporary password/), 'Passw0rd!x')
    await userEvent.click(within(form).getByRole('button', { name: 'Add person' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('That username is taken')
    expect(within(form).getByLabelText(/^Username/)).toHaveValue('asha')
  })

  it('changes a role and alert preference, and removes a person only after a second tap', async () => {
    wrap(<ManageConsole />, { viewer: ROHAN })
    const row = await screen.findByTestId('member-meera')
    await userEvent.selectOptions(within(row).getByLabelText('Role of Meera Kulkarni'), 'admin')
    await waitFor(() => expect(m.admin.updateMember).toHaveBeenCalledWith('meera', { role: 'admin' }))
    await userEvent.selectOptions(within(row).getByLabelText('Alerts for Meera Kulkarni'), 'all')
    await waitFor(() => expect(m.admin.updateMember).toHaveBeenCalledWith('meera', { notify_level: 'all' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(m.admin.removeMember).not.toHaveBeenCalled()
    await userEvent.click(within(row).getByRole('button', { name: /tap again to confirm/i }))
    await waitFor(() => expect(m.admin.removeMember).toHaveBeenCalledWith('meera'))
  })

  it('surfaces the last-admin safeguard from the server', async () => {
    m.admin.updateMember.mockRejectedValueOnce(new Error('A family must keep at least one admin'))
    wrap(<ManageConsole />, { viewer: ROHAN })
    const row = await screen.findByTestId('member-rohan')
    await userEvent.selectOptions(within(row).getByLabelText('Role of Rohan Deshmukh'), 'family')
    expect(await within(row).findByRole('alert')).toHaveTextContent(/at least one admin/i)
  })

  it('resets a password only with 8+ characters', async () => {
    wrap(<ManageConsole />, { viewer: ROHAN })
    const row = await screen.findByTestId('member-meera')
    await userEvent.click(within(row).getByRole('button', { name: /password/i }))
    const set = within(row).getByRole('button', { name: 'Set password' })
    expect(set).toBeDisabled()
    await userEvent.type(within(row).getByLabelText(/new password for meera/i), 'Fresh-Start-77')
    await userEvent.click(set)
    await waitFor(() => expect(m.admin.updateMember).toHaveBeenCalledWith('meera', { new_password: 'Fresh-Start-77' }))
  })

  it('edits care instructions and saves them (button disabled until something changes)', async () => {
    await openTab(/care plan/i)
    const form = await screen.findByRole('form', { name: 'Care instructions' })
    const save = within(form).getByRole('button', { name: 'Save instructions' })
    expect(save).toBeDisabled()
    const box = within(form).getByLabelText(/^Care instructions/)
    await userEvent.clear(box)
    await userEvent.type(box, 'No sweets. Walk after dinner.')
    expect(within(form).getByText(/29\/2000/)).toBeInTheDocument()
    await userEvent.click(save)
    await waitFor(() => expect(m.admin.updatePatient).toHaveBeenCalledWith('asha', { instructions: 'No sweets. Walk after dinner.' }))
    expect(await within(form).findByRole('status')).toHaveTextContent(/alexa follows them/i)
  })

  it('adds a medicine, edits a dose and times, and stops a medicine after a second tap', async () => {
    await openTab(/care plan/i)
    const add = await screen.findByRole('form', { name: 'Add a medicine' })
    await userEvent.type(within(add).getByLabelText('Medicine'), 'Glimepiride')
    await userEvent.type(within(add).getByLabelText('Dose'), '1 mg')
    await userEvent.clear(within(add).getByLabelText(/^Times/)); await userEvent.type(within(add).getByLabelText(/^Times/), '07:30,19:30')
    await userEvent.click(within(add).getByRole('button', { name: /add medicine/i }))
    await waitFor(() => expect(m.admin.addMedication).toHaveBeenCalledWith('asha', expect.objectContaining({ name: 'Glimepiride', dose: '1 mg', times: '07:30,19:30' })))

    const row = screen.getByTestId('med-11')
    await userEvent.click(within(row).getByRole('button', { name: /edit metformin/i }))
    const edit = within(row).getByRole('form', { name: /edit metformin/i })
    await userEvent.clear(within(edit).getByLabelText('Dose')); await userEvent.type(within(edit).getByLabelText('Dose'), '850 mg')
    await userEvent.click(within(edit).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.admin.updateMedication).toHaveBeenCalledWith(11, expect.objectContaining({ dose: '850 mg', times: '08:00,20:00' })))

    await userEvent.click(within(row).getByRole('button', { name: 'Stop' }))
    expect(m.admin.stopMedication).not.toHaveBeenCalled()
    await userEvent.click(within(row).getByRole('button', { name: /confirm stop/i }))
    await waitFor(() => expect(m.admin.stopMedication).toHaveBeenCalledWith(11))
  })

  it('shows the server\'s validation error for bad medicine times', async () => {
    m.admin.addMedication.mockRejectedValueOnce(new Error('times must be 1-6 distinct HH:MM times, e.g. 08:00,20:00'))
    await openTab(/care plan/i)
    const add = await screen.findByRole('form', { name: 'Add a medicine' })
    await userEvent.type(within(add).getByLabelText('Medicine'), 'X'); await userEvent.type(within(add).getByLabelText('Dose'), '1')
    await userEvent.clear(within(add).getByLabelText(/^Times/)); await userEvent.type(within(add).getByLabelText(/^Times/), '8am')
    await userEvent.click(within(add).getByRole('button', { name: /add medicine/i }))
    expect(await within(add).findByRole('alert')).toHaveTextContent(/HH:MM/)
  })

  it('switches between patients and assigns a facility', async () => {
    await openTab(/care plan/i)
    await userEvent.click(await screen.findByRole('tab', { name: 'Madhav Deshmukh' }))
    const form = await screen.findByRole('form', { name: 'Patient details' })
    expect(within(form).getByLabelText('Name')).toHaveValue('Madhav Deshmukh')
    await userEvent.selectOptions(within(form).getByLabelText(/^Facility/), '1')
    await userEvent.click(within(form).getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(m.admin.updatePatient).toHaveBeenCalledWith('madhav', expect.objectContaining({ facility_id: 1, age: 81 })))
  })

  it('adds a patient and archives one only after a second tap', async () => {
    await openTab(/care plan/i)
    const add = await screen.findByRole('form', { name: 'Add a patient' })
    await userEvent.type(within(add).getByLabelText('Name'), 'Kaveri Deshmukh')
    await userEvent.type(within(add).getByLabelText('Age'), '88')
    await userEvent.click(within(add).getByRole('button', { name: 'Add patient' }))
    await waitFor(() => expect(m.admin.addPatient).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kaveri Deshmukh', age: 88 })))
    await userEvent.click(screen.getByRole('button', { name: /archive asha/i }))
    expect(m.admin.archivePatient).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /confirm archive/i }))
    await waitFor(() => expect(m.admin.archivePatient).toHaveBeenCalledWith('asha'))
  })

  it('books, reschedules and cancels appointments', async () => {
    await openTab(/appointments/i)
    const add = await screen.findByRole('form', { name: 'Add an appointment' })
    await userEvent.type(within(add).getByLabelText('Title'), 'Dentist')
    await userEvent.type(within(add).getByLabelText('When'), '2099-11-02T10:00')
    await userEvent.click(within(add).getByRole('button', { name: /book appointment/i }))
    await waitFor(() => expect(m.addAppointment).toHaveBeenCalledWith('asha', expect.objectContaining({ title: 'Dentist', starts_at: '2099-11-02T10:00:00' })))
    const row = screen.getByTestId('appt-21')
    await userEvent.click(within(row).getByRole('button', { name: /edit diabetes review/i }))
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(m.admin.updateAppointment).toHaveBeenCalledWith(21, expect.objectContaining({ title: 'Diabetes review' })))
    await userEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(row).getByRole('button', { name: /confirm cancel/i }))
    await waitFor(() => expect(m.admin.cancelAppointment).toHaveBeenCalledWith(21))
  })

  it('adds, edits and removes facilities, showing who uses each', async () => {
    await openTab(/facilities/i)
    expect(await screen.findByTestId('facility-1')).toHaveTextContent(/used by Asha/)
    const add = screen.getByRole('form', { name: 'Add a facility' })
    await userEvent.type(within(add).getByLabelText('Name'), 'Test Care Home')
    await userEvent.selectOptions(within(add).getByLabelText('Type'), 'care home')
    await userEvent.click(within(add).getByRole('button', { name: 'Add facility' }))
    await waitFor(() => expect(m.admin.addFacility).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Care Home', kind: 'care home' })))
    const row = screen.getByTestId('facility-1')
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(row).getByRole('button', { name: /tap again to confirm/i }))
    await waitFor(() => expect(m.admin.removeFacility).toHaveBeenCalledWith(1))
  })

  it('shows a clear error if the console cannot load', async () => {
    m.admin.overview.mockRejectedValue(new Error('A family account is not allowed to do this (members:manage)'))
    wrap(<ManageConsole />, { viewer: MEERA })
    expect(await screen.findByRole('alert')).toHaveTextContent(/not allowed/i)
  })
})


/* ------------------------------------------------------------------ the product must not reveal how it is built */
const BANNED = /claude|anthropic|bedrock|haiku|sonnet|strands|\bllm\b|ap-southeast|\bAWS\b|amazon polly|us-east|arn:aws/i

describe('no implementation details in the normal product UI', () => {
  it('sign-in page', async () => {
    m.demoAccounts.mockResolvedValue(ACCOUNTS)
    render(<App />)
    await screen.findByTestId('directory')
    expect(document.body.textContent).not.toMatch(BANNED)
  })

  it.each([
    ['Echo', { person: ASHA }, "Asha's Echo"],
    ['Family app', { viewer: ROHAN }, 'Family app'],
    ['Manage', { viewer: ROHAN }, 'Manage'],
    ['clinician view', { viewer: DRSEN }, 'Family app'],
  ])('%s shows no model, cloud, region or provider names', async (_n, sessions, tab) => {
    sessionStorage.setItem('cc.sessions', JSON.stringify(sessions))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: tab as string }))
    await screen.findByTestId('session-chips')
    await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(200))
    expect(document.body.textContent).not.toMatch(BANNED)
    expect(screen.queryByTestId('system-info')).toBeNull()
    expect(screen.queryByTestId('mcp-log')).toBeNull()
    expect(screen.queryByText(/live mcp traffic/i)).toBeNull()
  })

  it('the Echo settings and the prescription scanner say nothing about providers either', async () => {
    sessionStorage.setItem('cc.sessions', JSON.stringify(BOTH))
    m.admin.overview.mockResolvedValue(mkOverview())
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: "Asha's Echo" }))
    await userEvent.click(await screen.findByRole('button', { name: /language and voice/i }))
    expect(document.body.textContent).not.toMatch(BANNED)
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Manage' }))
    await userEvent.click(await screen.findByRole('tab', { name: /care plan/i }))
    expect(await screen.findByTestId('rx-scanner')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(BANNED)
  })

  it('shows the technical panels only when the developer view is switched on, and remembers the choice', async () => {
    sessionStorage.setItem('cc.sessions', JSON.stringify(BOTH))
    const { unmount } = render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: "Asha's Echo" }))
    expect(screen.queryByText(/live mcp traffic/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /show developer view/i }))
    expect(await screen.findByText(/live mcp traffic/i)).toBeInTheDocument()
    expect(await screen.findByTestId('system-info')).toHaveTextContent('test-model')
    expect(localStorage.getItem('cc.dev')).toBe('on')
    unmount()
    sessionStorage.setItem('cc.sessions', JSON.stringify(BOTH))
    render(<App />)
    expect(await screen.findByText(/live mcp traffic/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /hide developer view/i }))
    await waitFor(() => expect(screen.queryByText(/live mcp traffic/i)).toBeNull())
  })

  it('does not show system details in the developer view to a non-admin (the server would refuse them too)', async () => {
    localStorage.setItem('cc.dev', 'on')
    sessionStorage.setItem('cc.sessions', JSON.stringify({ viewer: MEERA }))
    render(<App />)
    await screen.findByTestId('session-chips')
    expect(screen.queryByTestId('system-info')).toBeNull()
  })
})
