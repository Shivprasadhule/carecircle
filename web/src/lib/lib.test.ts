import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamPost } from './api'
import { ago, fmtSlot, initials, titleCase } from './format'
import type { StreamEvent } from './types'

function sseResponse(chunks: string[], status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close() } })
  return new Response(body, { status })
}

describe('streamPost (SSE parser)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('parses frames even when they are split across network chunks', async () => {
    const frames = ['data: {"type":"session","session_id":"a1"}\n\n', 'data: {"type":"text","delta":"He', 'llo"}\n\ndata: {"type":"done","reply":"Hello"}\n\n']
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(frames)))
    const got: StreamEvent[] = []
    await streamPost('/api/chat/stream', { message: 'hi' }, (e) => got.push(e))
    expect(got.map((e) => e.type)).toEqual(['session', 'text', 'done'])
    expect((got[1] as any).delta).toBe('Hello')
  })

  it('ignores malformed frames instead of crashing the stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['data: {not json}\n\n', 'data: {"type":"done","reply":"ok"}\n\n'])))
    const got: StreamEvent[] = []
    await streamPost('/x', {}, (e) => got.push(e))
    expect(got).toHaveLength(1)
  })

  it('rejects on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 502 })))
    await expect(streamPost('/x', {}, () => {})).rejects.toThrow(/502/)
  })
})

describe('format helpers', () => {
  it('ago buckets', () => {
    const now = Date.parse('2026-10-21T12:00:00')
    expect(ago('2026-10-21T11:59:40', now)).toBe('just now')
    expect(ago('2026-10-21T11:30:00', now)).toBe('30 min ago')
    expect(ago('2026-10-21T09:00:00', now)).toBe('3 h ago')
    expect(ago('2026-10-19T12:00:00', now)).toBe('2 d ago')
  })
  it('fmtSlot renders a clock time', () => { expect(fmtSlot('20:00')).toMatch(/8:00/) })
  it('titleCase and initials', () => {
    expect(titleCase('compound_decline')).toBe('Compound decline')
    expect(initials('Meera Kulkarni')).toBe('MK')
  })
})
