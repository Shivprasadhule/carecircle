/** Preparing a prescription photo/PDF for upload. Phone photos are 5-12 MB; the server limit is 3.5 MB, so images are shrunk in the browser first. */
export const MAX_BYTES = 3_400_000          // a little under the server's 3.5 MB so base64 overhead and rounding never trip it
const MAX_EDGE = 1800
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export class UploadError extends Error {}

export interface Prepared { data: string; media_type: string; filename: string; bytes: number; resized: boolean }

/** Scale (w, h) so the longer edge is at most `max`, never enlarging. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** Decoded size of a base64 string without decoding it. */
export const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)

const toBase64 = (buf: ArrayBuffer) => {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function shrink(file: File): Promise<{ data: string; resized: boolean }> {
  const bmp = await createImageBitmap(file).catch(() => { throw new UploadError("This photo could not be opened. If it is an iPhone HEIC photo, take it as JPEG or share a screenshot.") })
  const { w, h } = fitWithin(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new UploadError('This browser cannot prepare photos.')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)                      // flatten transparency so PNGs do not turn black as JPEG
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const url = canvas.toDataURL('image/jpeg', q)
    const b64 = url.slice(url.indexOf(',') + 1)
    if (base64Bytes(b64) <= MAX_BYTES) return { data: b64, resized: w !== bmp.width || h !== bmp.height || q < 0.88 || file.size > MAX_BYTES }
  }
  throw new UploadError('That photo is too detailed to send. Try a closer, cropped photo of just the prescription.')
}

export async function prepareUpload(file: File): Promise<Prepared> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
    if (file.size > MAX_BYTES) throw new UploadError(`This PDF is ${(file.size / 1e6).toFixed(1)} MB. The limit is ${(MAX_BYTES / 1e6).toFixed(1)} MB: export just the prescription page, or send a photo.`)
    return { data: toBase64(await file.arrayBuffer()), media_type: 'application/pdf', filename: file.name, bytes: file.size, resized: false }
  }
  if (!IMAGE_TYPES.includes(file.type)) throw new UploadError('Use a photo (JPEG, PNG, WebP, GIF) or a PDF.')
  const { data, resized } = await shrink(file)
  return { data, media_type: 'image/jpeg', filename: file.name, bytes: base64Bytes(data), resized }
}
