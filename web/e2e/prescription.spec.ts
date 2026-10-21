import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { API, authed, pw, resetFamily, signInOk, tokenFor } from './helpers'

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../evals/samples/rx_photo.png')

const row = (o: object) => ({
  confidence: 0.96, with_food: false, duration: '', instructions: '', frequency_text: '', source_text: '', status: 'new', existing_id: null, current: null,
  allergy_conflict: false, needs_times: false, as_needed: false, warnings: [], ...o,
})
const SCAN = (existingMetformin: number) => ({
  document: { legible: true, prescriber: 'Dr. A. Sen', date: '20/10/2026', patient_name: 'Asha Deshmukh' },
  items: [
    row({ key: 'rx0', name: 'Glimepiride', dose: '1 mg', times: '08:00', source_text: 'Tab Glimepiride 1 mg 1-0-0', instructions: 'before breakfast', duration: 'x 30 days' }),
    row({ key: 'rx1', name: 'Metformin', dose: '500 mg', times: '08:00,20:00', status: 'duplicate', existing_id: existingMetformin, current: { dose: '500 mg', times: '08:00,20:00' } }),
    row({ key: 'rx2', name: 'Sulfamethoxazole', dose: '400 mg', times: '08:00,20:00', allergy_conflict: true, warnings: ["Matches this patient's allergy (sulfa). Check with the doctor before adding."] }),
    row({ key: 'rx3', name: 'Atorvastatin', dose: '20 mg', times: '21:00', status: 'update', existing_id: 0, current: { dose: '10 mg', times: '21:00' } }),
    row({ key: 'rx4', name: 'Paracetamol', dose: '650 mg', times: null, as_needed: true, warnings: ["Written as 'only when needed', so it is not scheduled."] }),
  ],
  follow_up: { when: 'after 2 weeks', notes: '' }, warnings: [], meta: { format: 'jpeg', bytes: 1000 },
})

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.setItem('cc.voice', 'off') } catch { /* ignore */ } }) })
test.afterEach(async ({ request }) => { await resetFamily(request, 'rohan', 'Rohan') })

async function openCarePlan(page: any) {
  await signInOk(page, 'rohan', pw('Rohan'))
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('tab', { name: /care plan/i }).click()
}

test('photo -> model reads it (stubbed) -> review -> confirm adds exactly the chosen medicines to the schedule', async ({ page, request }) => {
  const t = await tokenFor(request, 'rohan', pw('Rohan'))
  const meds = await (await request.get(`${API}/api/snapshot?patient_id=asha`, authed(t))).json()
  const id = (n: string) => meds.medications.find((m: any) => m.name === n).id
  const scan = SCAN(id('Metformin')); scan.items[3].existing_id = id('Atorvastatin')

  let sent: any = null
  await page.route('**/prescription/scan', async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ json: scan }) })
  await openCarePlan(page)
  await page.getByLabel('Prescription photo or PDF').setInputFiles(SAMPLE)

  const review = page.getByTestId('rx-review')
  await expect(review).toContainText('5 medicines found')
  // the real browser code shrank the photo to a JPEG that fits the server limit
  expect(sent.media_type).toBe('image/jpeg')
  expect(sent.data.startsWith('/9j/')).toBeTruthy()
  expect(Buffer.from(sent.data, 'base64').length).toBeLessThan(3_500_000)

  // safe defaults
  const on = async (n: string) => await page.getByLabel(`Include ${n}`).isChecked()
  expect([await on('Glimepiride'), await on('Atorvastatin'), await on('Metformin'), await on('Sulfamethoxazole'), await on('Paracetamol')]).toEqual([true, true, false, false, false])
  await expect(page.getByTestId('rx-row-rx2')).toContainText(/allergy/i)
  await expect(page.getByTestId('rx-row-rx1')).toContainText('Already on the list')
  await expect(page.getByTestId('rx-row-rx3')).toContainText('Changes 10 mg → 20 mg')

  // the admin corrects a dose before confirming
  await page.getByLabel('Dose for Glimepiride').fill('2 mg')
  await page.getByRole('button', { name: 'Add 2 selected' }).click()
  const done = page.getByTestId('rx-done')
  await expect(done).toContainText('Added Glimepiride'); await expect(done).toContainText('Updated Atorvastatin'); await expect(done).toContainText('3 skipped')

  // the real record changed: the medicine list, the dose, and today's schedule
  await expect(page.getByTestId(/^med-/).filter({ hasText: 'Glimepiride' })).toContainText('2 mg')
  await expect(page.getByTestId(/^med-/).filter({ hasText: 'Atorvastatin' })).toContainText('20 mg')
  await expect(page.getByTestId(/^med-/).filter({ hasText: 'Sulfamethoxazole' })).toHaveCount(0)       // the allergy row was never added
  await page.getByRole('button', { name: 'Family app' }).click()
  await expect(page.getByTestId('med-timeline')).toContainText('Glimepiride')
  await expect(page.getByTestId('med-timeline')).not.toContainText('Sulfamethoxazole')
  await expect(page.getByTestId('activity-panel')).toContainText(/apply prescription/i)
})

test('a follow-up on the document can be booked with the medicines', async ({ page }) => {
  await page.route('**/prescription/scan', (r) => r.fulfill({ json: SCAN(0) }))
  await openCarePlan(page)
  await page.getByLabel('Prescription photo or PDF').setInputFiles(SAMPLE)
  await expect(page.getByTestId('rx-review')).toBeVisible()
  await page.getByLabel(/also book the follow-up/i).check()
  await expect(page.getByRole('button', { name: /add \d selected/i })).toBeDisabled()                 // needs a date
  await page.getByTestId('rx-review').getByLabel('When', { exact: true }).fill('2099-11-20T10:00')
  await page.getByLabel('Include Glimepiride').check()
  await page.getByRole('button', { name: /add \d selected/i }).click()
  await expect(page.getByTestId('rx-done')).toContainText(/follow-up booked for friday 20 november/i)
  await page.getByRole('tab', { name: 'Appointments' }).click()
  await expect(page.getByTestId(/^appt-/).filter({ hasText: 'Follow-up' })).toBeVisible()
})

test('discarding a scan changes nothing', async ({ page, request }) => {
  await page.route('**/prescription/scan', (r) => r.fulfill({ json: SCAN(0) }))
  const t = await tokenFor(request, 'rohan', pw('Rohan'))
  const before = (await (await request.get(`${API}/api/snapshot?patient_id=asha`, authed(t))).json()).medications.length
  await openCarePlan(page)
  await page.getByLabel('Prescription photo or PDF').setInputFiles(SAMPLE)
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByRole('button', { name: /choose a photo or pdf/i })).toBeVisible()
  expect((await (await request.get(`${API}/api/snapshot?patient_id=asha`, authed(t))).json()).medications.length).toBe(before)
})

test('a server refusal (not a prescription) is shown clearly', async ({ page }) => {
  await page.route('**/prescription/scan', (r) => r.fulfill({ status: 422, json: { detail: 'That does not look like a readable prescription or medication list. Try a clearer, well-lit photo.' } }))
  await openCarePlan(page)
  await page.getByLabel('Prescription photo or PDF').setInputFiles(SAMPLE)
  await expect(page.getByRole('alert')).toContainText(/does not look like a readable prescription/i)
})

test('an unsupported file is refused in the browser before anything is uploaded', async ({ page }) => {
  let called = false
  await page.route('**/prescription/scan', (r) => { called = true; return r.fulfill({ json: SCAN(0) }) })
  await openCarePlan(page)
  await page.getByLabel('Prescription photo or PDF').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByRole('alert')).toContainText(/use a photo/i)
  expect(called).toBe(false)
})

test('the real server refuses bad uploads, non-admins and other families before any model is called', async ({ request }) => {
  const rohan = await tokenFor(request, 'rohan', pw('Rohan'))
  const meera = await tokenFor(request, 'meera', pw('Meera'))
  const asha = await tokenFor(request, 'asha', pw('Asha'))
  const url = (pid: string) => `${API}/api/admin/patients/${pid}/prescription/scan`
  const text = Buffer.from('this is not an image').toString('base64')
  expect((await request.post(url('asha'), { ...authed(rohan), data: { data: text } })).status()).toBe(415)               // content is checked, not the name
  expect((await request.post(url('asha'), { ...authed(rohan), data: { data: '' } })).status()).toBe(400)
  expect((await request.post(url('asha'), { ...authed(rohan), data: { data: 'A'.repeat(6_000_000) } })).status()).toBe(413)
  expect((await request.post(url('asha'), { ...authed(meera), data: { data: text } })).status()).toBe(403)               // family member, not admin
  expect((await request.post(url('asha'), { ...authed(asha), data: { data: text } })).status()).toBe(403)                // the patient herself
  expect((await request.post(url('lakshmi'), { ...authed(rohan), data: { data: text } })).status()).toBe(404)            // another family's patient
  expect((await request.post(url('asha'), { data: { data: text } })).status()).toBe(401)
  const apply = (pid: string, token: string) => request.post(`${API}/api/admin/patients/${pid}/prescription/apply`, { ...authed(token), data: { items: [{ action: 'add', name: 'X', dose: '1', times: '08:00' }] } })
  expect((await apply('asha', meera)).status()).toBe(403)
  expect((await apply('lakshmi', rohan)).status()).toBe(404)
})

test('family members and patients do not see the scanner at all', async ({ page }) => {
  await signInOk(page, 'meera', pw('Meera'))
  await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0)
  await expect(page.getByTestId('rx-scanner')).toHaveCount(0)
})
