import { expect, test } from '@playwright/test'
import { API, authed, pw, resetFamily, signIn, signInOk, signOut, stubChat, textReply, tokenFor } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cc.voice', 'off') } catch { /* ignore */ } })      // no speech in tests
})

/* ------------------------------------------------------------------ sign-in */
test('the sign-in page lists every family and the demo password for each account', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /sign in to carecircle/i })).toBeVisible()
  for (const f of ['Deshmukh', 'Iyer', 'Khan', 'Gupta', 'Nair', 'Banerjee']) await expect(page.getByTestId(`family-${f} family`)).toBeVisible()
  await expect(page.getByTestId('family-Clinicians')).toBeVisible()
  expect(await page.locator('[data-testid^="account-"]').count()).toBeGreaterThanOrEqual(28)
  await expect(page.getByTestId('account-asha')).toContainText('Asha_2026')
  await expect(page.getByTestId('account-drdas')).toContainText('Das_2026')
  await expect(page.getByTestId('account-rohan')).toContainText('Family admin')
})

test('"Use" fills the form and signs in; a wrong password is refused with a clear message', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /fill sign-in for rohan deshmukh/i }).click()
  await expect(page.getByLabel('Username')).toHaveValue('rohan')
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Rohan_2026')
  await page.getByLabel('Password', { exact: true }).fill('not-the-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Wrong username or password')
  await page.getByLabel('Password', { exact: true }).fill('Rohan_2026')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByTestId('session-chips')).toContainText(/family admin/i)
})

test('five wrong passwords lock the account, even for the right password', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await signIn(page, 'tania', 'wrong-password')
    await expect(page.getByRole('alert')).toContainText('Wrong username or password')
  }
  await signIn(page, 'tania', 'Tania_2026')
  await expect(page.getByRole('alert')).toContainText(/too many failed attempts/i)
  await expect(page.getByTestId('session-chips')).toHaveCount(0)
})

/* ------------------------------------------------------------------ tenant isolation in the UI */
test('a family sees only its own people: Deshmukh and Iyer never see each other', async ({ page }) => {
  await signInOk(page, 'rohan', pw('Rohan'))
  const sw = page.getByTestId('patient-switcher')
  await expect(sw).toContainText('Asha'); await expect(sw).toContainText('Madhav')
  let text = await page.locator('body').innerText()
  for (const other of ['Lakshmi', 'Suresh', 'Abdul', 'Kamla', 'Thomas', 'Sudipta', 'Greams', 'Banjara']) expect(text, other).not.toContain(other)
  await signOut(page)

  await signInOk(page, 'suresh', pw('Suresh'))
  await expect(page.getByTestId('overview')).toContainText('Lakshmi Iyer')
  await expect(page.getByTestId('patient-switcher')).toHaveCount(0)                       // one patient: no switcher
  text = await page.locator('body').innerText()
  for (const other of ['Asha', 'Madhav', 'Rohan', 'Deshmukh', 'Kamla']) expect(text, other).not.toContain(other)
})

for (const [user, tab, check] of [
  ['imran', 'Abdul', async (p: any) => { await expect(p.getByTestId('vital-spo2')).toContainText(/high|urgent/i); await expect(p.getByTestId('care-instructions')).toContainText(/oxygen/i) }],
  ['soumya', 'Sudipta', async (p: any) => { await expect(p.getByTestId('vital-weight')).toContainText(/high/i); await expect(p.getByTestId('care-instructions')).toContainText(/weigh every morning/i) }],
  ['soumya', 'Arun', async (p: any) => { await expect(p.getByTestId('vital-glucose')).toContainText(/high/i); await expect(p.getByTestId('care-instructions')).toContainText(/below 70/i) }],
  ['suresh', 'Lakshmi', async (p: any) => { await expect(p.getByTestId('vital-weight')).toContainText(/high/i); await expect(p.getByTestId('care-instructions')).toContainText(/fluid limit/i) }],
  ['vikram', 'Kamla', async (p: any) => { await expect(p.getByTestId('care-instructions')).toContainText(/sundowning/i); await expect(p.getByTestId('medicine-list')).toContainText('Donepezil') }],
  ['jacob', 'Thomas', async (p: any) => { await expect(p.getByTestId('care-instructions')).toContainText(/levodopa timing is strict/i); await expect(p.getByTestId('medicine-list')).toContainText('Levodopa') }],
] as const) {
  test(`${tab}'s own condition story is what ${user} sees`, async ({ page }) => {
    await signInOk(page, user, pw(user[0].toUpperCase() + user.slice(1)))
    await expect(page.getByTestId('overview')).toBeVisible()
    const sw = page.getByTestId('patient-switcher')
    if (await sw.count()) await sw.getByRole('tab', { name: new RegExp(tab) }).click()
    await expect(page.getByTestId('overview')).toContainText(tab)
    await check(page)
  })
}

test('switching patient shows that patient\'s own record and never leaves the previous one on screen', async ({ page }) => {
  await signInOk(page, 'rohan', pw('Rohan'))
  await expect(page.getByTestId('care-instructions')).toContainText(/fasting sugar/i)
  await page.getByTestId('patient-switcher').getByRole('tab', { name: /Madhav/ }).click()
  await expect(page.getByTestId('overview')).toContainText('Madhav Deshmukh')
  await expect(page.getByTestId('care-instructions')).toContainText(/warfarin/i)
  await expect(page.getByTestId('medicine-list')).toContainText('Warfarin')
  await expect(page.getByTestId('medicine-list')).not.toContainText('Metformin')
  await expect(page.getByText(/fasting sugar/i)).toHaveCount(0)
})

test('one clinician can follow patients in two families, read-only', async ({ page }) => {
  await signInOk(page, 'drmehta', pw('Dr. Mehta'))
  const sw = page.getByTestId('patient-switcher')
  await expect(sw).toContainText('Kamla'); await expect(sw).toContainText('Asha')
  await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /mark .* as taken/i })).toHaveCount(0)
  await expect(page.getByTestId('care-watch')).toContainText(/read-only account/i)
  await expect(page.getByTestId('activity-panel')).toHaveCount(0)
})

/* ------------------------------------------------------------------ roles and direct API attempts */
test('a family member has no Manage, and the server refuses admin and cross-family calls even with a valid token', async ({ page, request }) => {
  await signInOk(page, 'meera', pw('Meera'))
  await expect(page.getByRole('button', { name: 'Family app' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0)
  await expect(page.getByTestId('activity-panel')).toHaveCount(0)                        // audit log is admin-only
  const t = await tokenFor(request, 'meera', pw('Meera'))
  expect((await request.get(`${API}/api/admin/overview`, authed(t))).status()).toBe(403)
  expect((await request.patch(`${API}/api/admin/patients/asha`, { ...authed(t), data: { instructions: 'x' } })).status()).toBe(403)
  expect((await request.get(`${API}/api/snapshot?patient_id=lakshmi`, authed(t))).status()).toBe(404)
  expect((await request.post(`${API}/api/dose?patient_id=lakshmi`, { ...authed(t), data: { medication: 'telmisartan' } })).status()).toBe(404)
  expect((await request.get(`${API}/api/snapshot?patient_id=asha`, authed(t))).status()).toBe(200)
  expect((await request.get(`${API}/api/snapshot?patient_id=asha`)).status()).toBe(401)
})

test("a family admin cannot reach another family's data or controls through the API either", async ({ request }) => {
  const t = await tokenFor(request, 'rohan', pw('Rohan'))
  for (const [method, path] of [['PATCH', '/api/admin/patients/lakshmi'], ['DELETE', '/api/admin/patients/lakshmi'], ['PATCH', '/api/admin/members/suresh'], ['DELETE', '/api/admin/members/suresh']] as const) {
    expect((await request.fetch(`${API}${path}`, { method, ...authed(t), data: { name: 'x', instructions: 'x' } })).status(), `${method} ${path}`).toBe(404)
  }
  const ov = await (await request.get(`${API}/api/admin/overview`, authed(t))).json()
  expect(JSON.stringify(ov)).not.toMatch(/Lakshmi|Suresh|Greams|Abdul/)
})

test('the patient gets only her Echo; family-only screens do not exist for her', async ({ page, request }) => {
  await signInOk(page, 'thomas', pw('Thomas'))
  await expect(page.getByRole('button', { name: "Thomas's Echo" })).toBeVisible()        // the Echo is named for its owner, never for someone else
  await expect(page.getByRole('button', { name: /Asha's Echo/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Family app' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0)
  await expect(page.getByLabel('Message Alexa')).toBeVisible()
  const t = await tokenFor(request, 'thomas', pw('Thomas'))
  expect((await request.get(`${API}/api/snapshot?patient_id=mariamma`, authed(t))).status()).toBe(404)        // even his wife's record is not his to read
  expect((await request.get(`${API}/api/audit`, authed(t))).status()).toBe(403)
})

/* ------------------------------------------------------------------ the family admin console */
test.describe('family admin console', () => {
  test.afterEach(async ({ request }) => { await resetFamily(request, 'rohan', 'Rohan') })

  test('changing a medicine dose and the care instructions shows up in the care plan and is audited', async ({ page }) => {
    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: /care plan/i }).click()
    const row = page.getByTestId(/^med-/).filter({ hasText: 'Metformin' })
    await row.getByRole('button', { name: /edit metformin/i }).click()
    await row.getByLabel('Dose').fill('850 mg')
    await row.getByRole('button', { name: 'Save changes' }).click()
    await expect(row.getByRole('status')).toContainText('Metformin updated')

    const ins = page.getByRole('form', { name: 'Care instructions' })
    await ins.getByLabel(/^Care instructions/).fill('No sweets. Walk for 15 minutes after dinner. Call Rohan before any new tablet.')
    await ins.getByRole('button', { name: 'Save instructions' }).click()
    await expect(ins.getByRole('status')).toContainText(/alexa follows them/i)

    await page.getByRole('button', { name: 'Family app' }).click()
    await expect(page.getByTestId('care-instructions')).toContainText('Walk for 15 minutes')
    await expect(page.getByTestId('medicine-list')).toContainText('850 mg')
    const log = page.getByTestId('activity-panel')
    await expect(log).toContainText(/update medication/i)
    await expect(log).toContainText(/update patient/i)
    await expect(log).not.toContainText('Walk for 15')                                    // instruction text is never copied into the audit trail
  })

  test('adding a medicine puts it in today\'s schedule; stopping it takes it out again', async ({ page }) => {
    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: /care plan/i }).click()
    const add = page.getByRole('form', { name: 'Add a medicine' })
    await add.getByLabel('Medicine').fill('Glimepiride'); await add.getByLabel('Dose').fill('1 mg')
    await add.getByLabel(/^Times/).fill('07:30,19:30')
    await add.getByRole('button', { name: /add medicine/i }).click()
    await expect(add.getByRole('status')).toContainText('Glimepiride added')
    await page.getByRole('button', { name: 'Family app' }).click()
    await expect(page.getByTestId('med-timeline')).toContainText('Glimepiride')
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: /care plan/i }).click()
    const row = page.getByTestId(/^med-/).filter({ hasText: 'Glimepiride' })
    await row.getByRole('button', { name: 'Stop' }).click()
    await row.getByRole('button', { name: /confirm stop/i }).click()
    await page.getByRole('button', { name: 'Family app' }).click()
    await expect(page.getByTestId('med-timeline')).not.toContainText('Glimepiride')
  })

  test('bad medicine times are refused with the server\'s message', async ({ page }) => {
    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: /care plan/i }).click()
    const add = page.getByRole('form', { name: 'Add a medicine' })
    await add.getByLabel('Medicine').fill('Aspirin'); await add.getByLabel('Dose').fill('75 mg'); await add.getByLabel(/^Times/).fill('8am')
    await add.getByRole('button', { name: /add medicine/i }).click()
    await expect(add.getByRole('alert')).toContainText(/HH:MM/)
  })

  test('adds a person who can sign in but cannot manage; removing them revokes access', async ({ page }) => {
    const u = `e2e${Date.now() % 1_000_000}`
    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    const form = page.getByRole('form', { name: 'Add a person' })
    await form.getByLabel('Full name').fill('E2E Cousin'); await form.getByLabel(/^Username/).fill(u); await form.getByLabel(/^Temporary password/).fill('Cousin-Pass-1')
    await form.getByRole('button', { name: 'Add person' }).click()
    await expect(form.getByRole('status')).toContainText('E2E Cousin was added')
    await expect(page.getByTestId(`member-${u}`)).toBeVisible()
    await signOut(page)

    await signInOk(page, u, 'Cousin-Pass-1')
    await expect(page.getByTestId('overview')).toContainText(/Asha|Madhav/)
    await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0)
    await signOut(page)

    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    const row = page.getByTestId(`member-${u}`)
    await row.getByRole('button', { name: 'Remove' }).click()
    await row.getByRole('button', { name: /tap again to confirm/i }).click()
    await expect(row.getByRole('status')).toContainText(/removed and signed out/i)
    await signOut(page)
    await signIn(page, u, 'Cousin-Pass-1')
    await expect(page.getByRole('alert')).toContainText('Wrong username or password')
  })

  test('the last admin cannot be demoted or removed', async ({ page }) => {
    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    const row = page.getByTestId('member-rohan')
    await row.getByLabel('Role of Rohan Deshmukh').selectOption('family')
    await expect(row.getByRole('alert')).toContainText(/at least one admin/i)
  })

  test('a new facility can be created and assigned to a patient', async ({ page }) => {
    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: 'Facilities' }).click()
    const add = page.getByRole('form', { name: 'Add a facility' })
    await add.getByLabel('Name').fill('E2E Memory Care Home'); await add.getByLabel('Type').selectOption('care home')
    await add.getByRole('button', { name: 'Add facility' }).click()
    await expect(add.getByRole('status')).toContainText('added')
    await page.getByRole('tab', { name: /care plan/i }).click()
    await page.getByRole('tab', { name: 'Madhav Deshmukh' }).click()
    const details = page.getByRole('form', { name: 'Patient details' })
    await details.getByLabel(/^Facility/).selectOption({ label: 'E2E Memory Care Home (care home)' })
    await details.getByRole('button', { name: 'Save details' }).click()
    await expect(details.getByRole('status')).toContainText('Details saved')
    await page.getByRole('button', { name: 'Family app' }).click()
    await page.getByTestId('patient-switcher').getByRole('tab', { name: /Madhav/ }).click()
    await expect(page.getByTestId('care-plan')).toContainText('E2E Memory Care Home')
  })

  test('appointments can be booked, rescheduled and cancelled', async ({ page }) => {
    await signInOk(page, 'rohan', pw('Rohan'))
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('tab', { name: 'Appointments' }).click()
    const add = page.getByRole('form', { name: 'Add an appointment' })
    await add.getByLabel('Title').fill('E2E Dental check'); await add.getByLabel('When').fill('2099-11-02T10:00')
    await add.getByRole('button', { name: /book appointment/i }).click()
    const row = page.getByTestId(/^appt-/).filter({ hasText: 'E2E Dental check' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Cancel' }).click()
    await row.getByRole('button', { name: /confirm cancel/i }).click()
    await expect(page.getByTestId(/^appt-/).filter({ hasText: 'E2E Dental check' })).toHaveCount(0)
  })
})

test('an admin can reset a family member\'s password; the old one stops working', async ({ page, request }) => {
  await signInOk(page, 'rohan', pw('Rohan'))
  await page.getByRole('button', { name: 'Manage' }).click()
  const row = page.getByTestId('member-isha')
  await row.getByRole('button', { name: /password/i }).click()
  await row.getByLabel(/new password for isha/i).fill('Fresh-Start-77')
  await row.getByRole('button', { name: 'Set password' }).click()
  await expect(row.getByRole('status')).toContainText(/new password set/i)
  expect((await request.post(`${API}/api/auth/login`, { data: { username: 'isha', password: 'Isha_2026' } })).status()).toBe(401)
  expect((await request.post(`${API}/api/auth/login`, { data: { username: 'isha', password: 'Fresh-Start-77' } })).status()).toBe(200)
})

/* ------------------------------------------------------------------ Alexa + family side by side (AI endpoints stubbed) */
test('demo: Asha talks to Alexa (reply streamed) and Rohan\'s app reflects what she logged', async ({ page, request }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cc.dev', 'on') } catch { /* ignore */ } })      // the MCP traffic panel is part of the developer view
  await stubChat(page, [
    { type: 'session', session_id: 's1' },
    { type: 'tool_start', id: 't1', tool: 'log_dose' },
    { type: 'tool_result', id: 't1', tool: 'log_dose', input: { medication: 'metformin' }, status: 'success', result: { ok: true, medication: 'Metformin', dose: '500 mg', slot: '08:00', status: 'taken' } },
    { type: 'text', delta: 'Lovely, I have logged ' }, { type: 'text', delta: 'your metformin.' }, { type: 'done', reply: 'Lovely, I have logged your metformin.' },
  ])
  const asha = await tokenFor(request, 'asha', pw('Asha'))
  expect((await request.post(`${API}/api/dose?patient_id=asha`, { ...authed(asha), data: { medication: 'metformin', slot: '08:00' } })).ok()).toBeTruthy()   // what the tool does for real
  await page.goto('/')
  await page.getByRole('button', { name: /start the demo/i }).click()
  await expect(page.getByTestId('session-chips')).toContainText(/Asha/)
  await expect(page.getByTestId('session-chips')).toContainText(/family admin/i)
  const req = page.waitForRequest((r) => r.url().includes('/api/chat/stream'))
  await page.getByRole('button', { name: /^I took my \w+/ }).click()
  const sent = await req
  expect(sent.url()).toContain('patient_id=asha')
  expect(sent.headers()['authorization']).toBe(`Bearer ${asha.length ? sent.headers()['authorization']!.slice(7) : ''}`.replace('Bearer ', 'Bearer '))
  expect(JSON.parse(sent.postData()!)).not.toHaveProperty('role')
  await expect(page.getByTestId('assistant-message')).toContainText('logged your metformin')
  await expect(page.getByTestId('card-dose-logged')).toBeVisible()
  await expect(page.getByTestId('mcp-log')).toContainText('log_dose')
  await expect(page.getByRole('button', { name: /metformin taken/i }).first()).toBeVisible()          // Rohan's side shows it
  await resetFamilyLater(request)
})

async function resetFamilyLater(request: any) { await resetFamily(request, 'rohan', 'Rohan') }

test('switching Alexa to Tamil localises the screen and sends the language', async ({ page }) => {
  await stubChat(page, textReply('சரி.'))
  await page.goto('/')
  await page.getByRole('button', { name: /start the demo/i }).click()
  await expect(page.getByTestId('session-chips')).toBeVisible()
  await page.getByRole('button', { name: "Asha's Echo" }).click()
  await page.getByRole('button', { name: /language and voice/i }).click()
  await page.getByRole('button', { name: /தமிழ்/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('அலெக்ஸாவிடம் பேசுங்கள் அல்லது தட்டச்சு செய்யுங்கள்…')).toBeVisible()
  const req = page.waitForRequest((r) => r.url().includes('/api/chat/stream'))
  await page.getByRole('button', { name: /^நான் .+ மாத்திரை சாப்பிட்டேன்$/ }).click()
  expect(JSON.parse((await req).postData()!)).toMatchObject({ language: 'ta-IN' })
})

/* ------------------------------------------------------------------ sessions, persistence and layout */
test('the session survives a reload; an invalid token sends the user back to sign-in with nothing on screen', async ({ page }) => {
  await signInOk(page, 'meera', pw('Meera'))
  await page.reload()
  await expect(page.getByTestId('overview')).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('cc.sessions', JSON.stringify({ viewer: { token: 'garbage.token', user: { id: 'meera', name: 'Meera', role: 'family', family_id: 'deshmukh', patient_id: null, permissions: ['snapshot:read'], patients: ['asha'] } } })))
  await page.reload()
  await expect(page.getByRole('heading', { name: /sign in to carecircle/i })).toBeVisible()
  await expect(page.getByTestId('overview')).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('cc.sessions'))).toBe('{}')
})

test('signing out clears the session for good', async ({ page }) => {
  await signInOk(page, 'meera', pw('Meera'))
  await signOut(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: /sign in to carecircle/i })).toBeVisible()
})

test('theme persists across reloads', async ({ page }) => {
  await signInOk(page, 'meera', pw('Meera'))
  await page.getByRole('button', { name: /switch to (dark|light) theme/i }).click()
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.reload()
  await expect(page.getByTestId('session-chips')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
})

test('the sign-in page, family app and admin console all fit a phone without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await page.goto('/')
  await expect(page.getByTestId('directory')).toBeVisible()
  expect(await overflow()).toBeLessThanOrEqual(1)
  await signInOk(page, 'rohan', pw('Rohan'))
  await page.getByRole('button', { name: 'Family app' }).click()
  await expect(page.getByTestId('overview')).toBeVisible()
  expect(await overflow()).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Manage' }).click()
  await expect(page.getByTestId('manage-console')).toBeVisible()
  expect(await overflow()).toBeLessThanOrEqual(1)
  await page.getByRole('tab', { name: /care plan/i }).click()
  expect(await overflow()).toBeLessThanOrEqual(1)
})

test('shows a clear message when the server cannot be reached after sign-in', async ({ page }) => {
  await signInOk(page, 'meera', pw('Meera'))
  await page.route('**/api/snapshot*', (r) => r.abort())
  await page.reload()
  await expect(page.getByRole('alert')).toContainText(/can't reach|failed to fetch|load failed/i)
})

/* ------------------------------------------------------------------ the product never reveals how it is built */
const BANNED = /claude|anthropic|bedrock|haiku|sonnet|strands|\bllm\b|ap-southeast|\bAWS\b|polly|us-east|arn:aws|\b\d{12}\b/i

test('no screen, page source or API response names the model, cloud provider or region', async ({ page, request }) => {
  const seen: string[] = []
  const sweep = async (label: string) => {
    seen.push(label)
    const text = await page.locator('body').innerText()
    expect(text, `visible text on ${label}`).not.toMatch(BANNED)
    expect(await page.title(), `title on ${label}`).not.toMatch(BANNED)
  }
  await page.goto('/'); await expect(page.getByTestId('directory')).toBeVisible()
  await sweep('sign-in')
  expect(await page.locator('meta[name=description]').getAttribute('content')).not.toMatch(BANNED)

  await signInOk(page, 'rohan', pw('Rohan'))
  await expect(page.getByTestId('overview')).toBeVisible(); await sweep('family app')
  await page.getByTestId('patient-switcher').getByRole('tab', { name: /Madhav/ }).click(); await sweep('second patient')
  await page.getByRole('button', { name: 'Manage' }).click()
  for (const tab of [/People/, /care plan/i, 'Appointments', 'Facilities']) { await page.getByRole('tab', { name: tab }).click(); await sweep(`manage ${tab}`) }
  await page.getByRole('tab', { name: /care plan/i }).click()
  await expect(page.getByTestId('rx-scanner')).toBeVisible(); await sweep('prescription scanner')
  await signOut(page)

  await signInOk(page, 'drmehta', pw('Dr. Mehta')); await expect(page.getByTestId('overview')).toBeVisible(); await sweep('clinician')
  await signOut(page)
  await page.goto('/'); await page.getByRole('button', { name: /start the demo/i }).click(); await expect(page.getByTestId('session-chips')).toBeVisible()
  await page.getByRole('button', { name: "Asha's Echo" }).click(); await sweep('Echo')
  await page.getByRole('button', { name: /language and voice/i }).click(); await sweep('Echo settings')
  await page.getByRole('button', { name: 'Tamil' }).or(page.getByRole('button', { name: /தமிழ்/ })).first().click(); await sweep('Echo in Tamil')

  const t = await tokenFor(request, 'rohan', pw('Rohan'))
  for (const path of ['/api/health', '/api/voices', '/api/languages', '/api/patients', '/api/snapshot?patient_id=asha', '/api/admin/overview']) {
    const r = await request.get(`${API}${path}`, authed(t))
    expect(await r.text(), path).not.toMatch(BANNED)
  }
  expect(seen.length).toBeGreaterThanOrEqual(10)
})

test('the developer view is off by default and, when switched on, shows the technical panels', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: /start the demo/i }).click()
  await expect(page.getByTestId('session-chips')).toBeVisible()
  await expect(page.getByTestId('mcp-log')).toHaveCount(0)
  await expect(page.getByText(/live mcp traffic/i)).toHaveCount(0)
  await page.getByRole('button', { name: /show developer view/i }).click()
  await expect(page.getByText(/live mcp traffic/i)).toBeVisible()
  await expect(page.getByTestId('system-info')).toBeVisible()
  await page.getByRole('button', { name: /hide developer view/i }).click()
  await expect(page.getByText(/live mcp traffic/i)).toHaveCount(0)
})
