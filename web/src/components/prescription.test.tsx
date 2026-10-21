import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RxItem, RxScan } from '../lib/types'

const scan = vi.fn(), apply = vi.fn(), prepare = vi.fn()
vi.mock('../lib/api', () => ({ api: { admin: { scanPrescription: (...a: unknown[]) => scan(...a), applyPrescription: (...a: unknown[]) => apply(...a) } } }))
vi.mock('../lib/image', () => ({ prepareUpload: (...a: unknown[]) => prepare(...a), UploadError: class UploadError extends Error {} }))

import { PrescriptionScanner } from './manage/PrescriptionScanner'

const item = (o: Partial<RxItem>): RxItem => ({
  key: 'rx0', name: 'Glimepiride', dose: '1 mg', times: '08:00', frequency_text: '1-0-0', with_food: false, duration: 'x 30 days', instructions: 'before breakfast', confidence: 0.96,
  source_text: 'Tab Glimepiride 1 mg 1-0-0', status: 'new', existing_id: null, current: null, allergy_conflict: false, needs_times: false, as_needed: false, warnings: [], ...o,
})
const SCAN: RxScan = {
  document: { legible: true, prescriber: 'Dr. A. Sen', date: '20/10/2026', patient_name: 'Asha Deshmukh' },
  items: [
    item({}),
    item({ key: 'rx1', name: 'Metformin', dose: '850 mg', times: '08:00,20:00', status: 'update', existing_id: 11, current: { dose: '500 mg', times: '08:00,20:00' }, with_food: true }),
    item({ key: 'rx2', name: 'Amlodipine', dose: '5 mg', times: '08:00', status: 'duplicate', existing_id: 12, current: { dose: '5 mg', times: '08:00' } }),
    item({ key: 'rx3', name: 'Sulfamethoxazole', dose: '400 mg', times: '08:00,20:00', allergy_conflict: true, warnings: ["Matches this patient's allergy (sulfa). Check with the doctor before adding."] }),
    item({ key: 'rx4', name: 'Paracetamol', dose: '650 mg', times: null, as_needed: true, warnings: ["Written as 'only when needed', so it is not scheduled."] }),
    item({ key: 'rx5', name: 'Smudged', dose: '', times: '21:00', confidence: 0.4, warnings: ['Low confidence: compare with the original document.'] }),
  ],
  follow_up: { when: 'after 2 weeks', notes: 'with fasting sugar report' }, warnings: [], meta: { format: 'png', bytes: 1000 },
}

const upload = async (file = new File(['x'], 'rx.png', { type: 'image/png' })) => {
  const reload = vi.fn().mockResolvedValue(undefined)
  render(<PrescriptionScanner pid="asha" patientName="Asha Deshmukh" reload={reload} />)
  await userEvent.upload(screen.getByLabelText('Prescription photo or PDF'), file)
  return reload
}

beforeEach(() => {
  vi.clearAllMocks()
  prepare.mockResolvedValue({ data: 'QUJD', media_type: 'image/jpeg', filename: 'rx.png', bytes: 3, resized: true })
  scan.mockResolvedValue(SCAN)
  apply.mockResolvedValue({ added: ['Glimepiride'], updated: ['Metformin'], skipped: 4, errors: [] })
})

describe('prescription scanner', () => {
  it('tells the admin up front that nothing is added without review and that the file is not saved', () => {
    render(<PrescriptionScanner pid="asha" patientName="Asha Deshmukh" reload={vi.fn()} />)
    expect(screen.getByText(/nothing is added until you review and confirm it/i)).toBeInTheDocument()
    expect(screen.getByText(/the file is not saved/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Prescription photo or PDF')).toHaveAttribute('accept', 'image/*,application/pdf')
  })

  it('prepares the file, sends it for the right patient, and shows what was found', async () => {
    await upload()
    expect(prepare).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(scan).toHaveBeenCalledWith('asha', { filename: 'rx.png', media_type: 'image/jpeg', data: 'QUJD' }))
    const review = await screen.findByTestId('rx-review')
    expect(review).toHaveTextContent('6 medicines found')
    expect(review).toHaveTextContent('Prescriber: Dr. A. Sen')
    expect(review).toHaveTextContent('Dated 20/10/2026')
  })

  it('only ticks rows that are safe to add: not duplicates, allergy conflicts, unscheduled, unreadable or low-confidence ones', async () => {
    await upload()
    await screen.findByTestId('rx-review')
    const checked = (n: string) => (screen.getByLabelText(`Include ${n}`) as HTMLInputElement).checked
    expect(checked('Glimepiride')).toBe(true)
    expect(checked('Metformin')).toBe(true)                       // changes an existing dose: ticked, clearly labelled
    expect(checked('Amlodipine')).toBe(false)                     // already on the list
    expect(checked('Sulfamethoxazole')).toBe(false)               // allergy
    expect(checked('Paracetamol')).toBe(false)                    // "only when needed": no times
    expect(checked('Smudged')).toBe(false)                        // no dose read and only 40% sure
    expect(screen.getByRole('button', { name: 'Add 2 selected' })).toBeInTheDocument()
  })

  it('labels every kind of row and shows the allergy and low-confidence warnings', async () => {
    await upload()
    expect(await screen.findByTestId('rx-row-rx1')).toHaveTextContent('Changes 500 mg → 850 mg')
    expect(screen.getByTestId('rx-row-rx2')).toHaveTextContent('Already on the list')
    expect(screen.getByTestId('rx-row-rx0')).toHaveTextContent('New')
    const allergy = screen.getByTestId('rx-row-rx3')
    expect(allergy).toHaveTextContent('Allergy'); expect(allergy).toHaveTextContent(/matches this patient's allergy \(sulfa\)/i)
    expect(screen.getByTestId('rx-row-rx5')).toHaveTextContent(/low confidence/i)
    expect(screen.getByTestId('rx-row-rx0')).toHaveTextContent('As written: “Tab Glimepiride 1 mg 1-0-0”')
    expect(screen.getByTestId('rx-row-rx5')).toHaveTextContent('40% sure')
  })

  it('shows document-level warnings (e.g. a prescription written for someone else) as alerts', async () => {
    scan.mockResolvedValue({ ...SCAN, warnings: ["This prescription is written for 'Kamla Gupta', not Asha Deshmukh. Make sure it is the right person's."] })
    await upload()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Kamla Gupta/)
  })

  it('blocks "Add" while a selected row is invalid and explains why', async () => {
    await upload()
    const row = await screen.findByTestId('rx-row-rx0')
    const times = within(row).getByLabelText('Times for Glimepiride')
    await userEvent.clear(times); await userEvent.type(times, '8am')
    expect(within(row).getByRole('alert')).toHaveTextContent(/times must look like 08:00,20:00/i)
    expect(screen.getByRole('button', { name: /add 2 selected/i })).toBeDisabled()
    await userEvent.clear(times); await userEvent.type(times, '07:30,19:30')
    expect(screen.getByRole('button', { name: /add 2 selected/i })).toBeEnabled()
    await userEvent.click(screen.getByLabelText('Include Smudged'))                      // ticking an unreadable row blocks until it is fixed
    expect(within(screen.getByTestId('rx-row-rx5')).getByRole('alert')).toHaveTextContent(/dose is required/i)
    expect(screen.getByRole('button', { name: /add 3 selected/i })).toBeDisabled()
    await userEvent.type(within(screen.getByTestId('rx-row-rx5')).getByLabelText('Dose for Smudged'), '10 mg')
    expect(screen.getByRole('button', { name: /add 3 selected/i })).toBeEnabled()
  })

  it('applies exactly what was reviewed: edited values, adds vs updates, skips for the rest', async () => {
    await upload()
    const row = await screen.findByTestId('rx-row-rx0')
    const dose = within(row).getByLabelText('Dose for Glimepiride')
    await userEvent.clear(dose); await userEvent.type(dose, '2 mg')
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 selected' }))
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    const [pid, body] = apply.mock.calls[0]
    expect(pid).toBe('asha')
    expect(body.prescriber).toBe('Dr. A. Sen')
    expect(body.appointment).toBeUndefined()
    const byName = Object.fromEntries(body.items.map((i: any) => [i.name, i]))
    expect(byName.Glimepiride).toMatchObject({ action: 'add', dose: '2 mg', times: '08:00', existing_id: null, instructions: 'before breakfast', duration: 'x 30 days' })
    expect(byName.Metformin).toMatchObject({ action: 'update', existing_id: 11, dose: '850 mg', with_food: true })
    for (const n of ['Amlodipine', 'Sulfamethoxazole', 'Paracetamol', 'Smudged']) expect(byName[n]).toEqual({ action: 'skip', name: n })
  })

  it('lets the admin knowingly include a row that was left unticked, but still validates it', async () => {
    await upload()
    await screen.findByTestId('rx-review')
    await userEvent.click(screen.getByLabelText('Include Paracetamol'))                  // no times were read
    expect(within(screen.getByTestId('rx-row-rx4')).getByRole('alert')).toHaveTextContent(/times must look like/i)
    await userEvent.type(within(screen.getByTestId('rx-row-rx4')).getByLabelText('Times for Paracetamol'), '08:00,20:00')
    expect(screen.getByRole('button', { name: /add 3 selected/i })).toBeEnabled()
  })

  it('books the follow-up only when ticked and a date is chosen', async () => {
    await upload()
    await screen.findByTestId('rx-review')
    expect(screen.getByText(/after 2 weeks/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/also book the follow-up/i))
    expect(screen.getByRole('button', { name: /add 2 selected/i })).toBeDisabled()       // a date is required
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2099-11-04T10:30' } })
    await userEvent.click(screen.getByRole('button', { name: /add 2 selected/i }))
    await waitFor(() => expect(apply).toHaveBeenCalled())
    expect(apply.mock.calls[0][1].appointment).toMatchObject({ starts_at: '2099-11-04T10:30:00', doctor: 'Dr. A. Sen' })
  })

  it('reports the result, reloads the care plan, and can start over', async () => {
    const reload = await upload()
    await userEvent.click(await screen.findByRole('button', { name: 'Add 2 selected' }))
    const done = await screen.findByTestId('rx-done')
    expect(done).toHaveTextContent(/Added Glimepiride/); expect(done).toHaveTextContent(/Updated Metformin/); expect(done).toHaveTextContent(/4 skipped/)
    expect(reload).toHaveBeenCalledTimes(1)
    await userEvent.click(within(done).getByRole('button', { name: 'Scan another' }))
    expect(screen.getByRole('button', { name: /choose a photo or pdf/i })).toBeInTheDocument()
  })

  it('shows per-row errors from the server without hiding what succeeded', async () => {
    apply.mockResolvedValue({ added: ['Glimepiride'], updated: [], skipped: 0, errors: [{ index: 1, name: 'Metformin', message: 'Metformin is already on the list; edit it instead' }] })
    await upload()
    await userEvent.click(await screen.findByRole('button', { name: 'Add 2 selected' }))
    const done = await screen.findByTestId('rx-done')
    expect(done).toHaveTextContent(/Added Glimepiride/); expect(done).toHaveTextContent(/Metformin: Metformin is already on the list/)
  })

  it('keeps the review open if applying fails, so nothing typed is lost', async () => {
    apply.mockRejectedValueOnce(new Error('A family member account is not allowed to do this (meds:manage)'))
    await upload()
    await userEvent.click(await screen.findByRole('button', { name: 'Add 2 selected' }))
    expect(await screen.findByText(/not allowed to do this/i)).toBeInTheDocument()
    expect(screen.getByTestId('rx-review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 2 selected' })).toBeEnabled()
  })

  it('discarding returns to the start and adds nothing', async () => {
    await upload()
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('button', { name: /choose a photo or pdf/i })).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
  })

  it.each([
    ['server refusal', () => scan.mockRejectedValue(new Error('That does not look like a readable prescription or medication list.')), /does not look like a readable prescription/],
    ['model outage', () => scan.mockRejectedValue(new Error('Could not read the document right now (RuntimeError). Please try again.')), /could not read the document right now/i],
    ['unsupported file', () => prepare.mockRejectedValue(new Error('Use a photo (JPEG, PNG, WebP, GIF) or a PDF.')), /use a photo/i],
  ])('shows a clear message after a %s and lets the admin try again', async (_n, arrange, message) => {
    arrange()
    await upload()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: /choose a photo or pdf/i })).toBeInTheDocument()
  })

  it('accepts a file dropped onto the drop zone', async () => {
    render(<PrescriptionScanner pid="asha" patientName="Asha Deshmukh" reload={vi.fn()} />)
    const zone = screen.getByText(/or drag a file here/i).parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'rx.png', { type: 'image/png' })] } })
    await waitFor(() => expect(scan).toHaveBeenCalled())
  })

  it('shows progress while reading', async () => {
    let release!: (v: RxScan) => void
    scan.mockReturnValue(new Promise<RxScan>((r) => { release = r }))
    await upload()
    expect(await screen.findByRole('status')).toHaveTextContent(/reading the prescription/i)
    release(SCAN)
    expect(await screen.findByTestId('rx-review')).toBeInTheDocument()
  })
})
