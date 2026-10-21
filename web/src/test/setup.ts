import '@testing-library/jest-dom/vitest'

// jsdom lacks these; components use them.
class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as any).ResizeObserver ??= RO
Element.prototype.scrollTo ??= () => {}
Element.prototype.scrollIntoView ??= () => {}
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any

// jsdom's File lacks arrayBuffer() in some versions
if (!(File.prototype as any).arrayBuffer) {
  ;(File.prototype as any).arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(this) })
  }
}
if (!(URL as any).createObjectURL) { (URL as any).createObjectURL = () => 'blob:test'; (URL as any).revokeObjectURL = () => {} }
