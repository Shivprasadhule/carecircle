import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64Bytes, fitWithin, MAX_BYTES, prepareUpload, UploadError } from './image'

describe('fitWithin', () => {
  it('shrinks the longer edge and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 1800)).toEqual({ w: 1800, h: 1350 })
    expect(fitWithin(3000, 4000, 1800)).toEqual({ w: 1350, h: 1800 })
  })
  it('never enlarges and never returns a zero size', () => {
    expect(fitWithin(800, 600, 1800)).toEqual({ w: 800, h: 600 })
    expect(fitWithin(5000, 1, 1800).h).toBeGreaterThanOrEqual(1)
  })
})

describe('base64Bytes', () => {
  it.each([[0], [1], [2], [3], [10], [1000], [4097]])('matches the real decoded length for %i bytes', (n) => {
    const raw = 'x'.repeat(n)
    expect(base64Bytes(btoa(raw))).toBe(n)
  })
})

describe('prepareUpload', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const file = (bytes: number, name: string, type: string) => new File([new Uint8Array(bytes).fill(65)], name, { type })

  it('passes a small PDF through unchanged as base64', async () => {
    const out = await prepareUpload(file(2000, 'rx.pdf', 'application/pdf'))
    expect(out).toMatchObject({ media_type: 'application/pdf', filename: 'rx.pdf', resized: false, bytes: 2000 })
    expect(base64Bytes(out.data)).toBe(2000)
  })
  it('refuses a PDF over the limit with a helpful message and does not read it', async () => {
    await expect(prepareUpload(file(MAX_BYTES + 1, 'big.pdf', 'application/pdf'))).rejects.toThrow(/limit is 3\.4 MB/)
  })
  it('recognises a PDF by its name even when the browser gives no type', async () => {
    expect((await prepareUpload(file(100, 'scan.PDF', ''))).media_type).toBe('application/pdf')
  })
  it.each([['notes.txt', 'text/plain'], ['rx.heic', 'image/heic'], ['virus.exe', 'application/octet-stream'], ['x.svg', 'image/svg+xml']])('rejects %s', async (name, type) => {
    await expect(prepareUpload(file(100, name, type))).rejects.toBeInstanceOf(UploadError)
  })

  const stubCanvas = (sizes: number[]) => {
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn() }
    sizes.forEach((n) => canvas.toDataURL.mockReturnValueOnce(`data:image/jpeg;base64,${btoa('y'.repeat(n))}`))
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as any)
    return { canvas, ctx }
  }

  it('shrinks a big phone photo to JPEG within the size and dimension limits', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4032, height: 3024, close: vi.fn() }))
    const { canvas, ctx } = stubCanvas([200_000])
    const out = await prepareUpload(file(9_000_000, 'IMG_0001.jpg', 'image/jpeg'))
    expect(canvas.width).toBe(1800); expect(canvas.height).toBe(1350)
    expect(ctx.fillStyle).toBe('#fff')                                    // transparency flattened to white, not black
    expect(out).toMatchObject({ media_type: 'image/jpeg', resized: true }); expect(out.bytes).toBe(200_000)
  })
  it('lowers the JPEG quality until it fits, and gives up with advice if it never does', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1000, height: 800, close: vi.fn() }))
    const a = stubCanvas([MAX_BYTES + 10, MAX_BYTES + 10, 100_000])
    expect((await prepareUpload(file(100, 'a.png', 'image/png'))).bytes).toBe(100_000)
    expect(a.canvas.toDataURL.mock.calls.map((c) => c[1])).toEqual([0.88, 0.8, 0.7])
    vi.restoreAllMocks(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1000, height: 800, close: vi.fn() }))
    stubCanvas([MAX_BYTES + 1, MAX_BYTES + 1, MAX_BYTES + 1, MAX_BYTES + 1])
    await expect(prepareUpload(file(100, 'b.png', 'image/png'))).rejects.toThrow(/too detailed/)
  })
  it('explains HEIC and other photos the browser cannot open', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')))
    await expect(prepareUpload(file(100, 'x.jpg', 'image/jpeg'))).rejects.toThrow(/HEIC/)
  })
})
