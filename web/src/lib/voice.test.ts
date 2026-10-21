import { describe, expect, it } from 'vitest'
import { addressName, greetingFor, LANGUAGES, langByCode, suggestionsFor } from './languages'
import { chooseSource, cleanForSpeech, pickVoice, rankVoices, scoreVoice, SERVER_VOICE, takeSentences } from './speech'

const V = (name: string, lang: string) => ({ name, lang })

describe('voice ranking', () => {
  const voices = [
    V('Samantha', 'en-US'), V('Rishi', 'en-IN'), V('Microsoft Neerja Online (Natural) - English (India)', 'en-IN'),
    V('Lekha', 'hi-IN'), V('Google हिन्दी', 'hi-IN'), V('Microsoft Swara Online (Natural) - Hindi (India)', 'hi-IN'),
    V('Zarvox', 'en-US'), V('Daniel', 'en-GB'), V('Soumya', 'kn-IN'),
  ]

  it('prefers natural/neural voices over standard ones for the same language', () => {
    expect(pickVoice(voices, 'hi-IN').voice?.name).toContain('Swara')
    expect(pickVoice(voices, 'en-IN').voice?.name).toContain('Neerja')
  })
  it('ranks Google above a plain system voice', () => {
    const r = rankVoices([V('Lekha', 'hi-IN'), V('Google हिन्दी', 'hi-IN')], 'hi-IN')
    expect(r[0].name).toBe('Google हिन्दी')
  })
  it('never offers a voice for the wrong language', () => {
    expect(rankVoices(voices, 'ta-IN')).toEqual([])
    expect(pickVoice(voices, 'ta-IN')).toEqual({ voice: undefined, exact: false })
  })
  it('only ever offers voices for the right language: a Hindi voice is never used for Tamil', () => {
    expect(pickVoice(voices, 'ta-IN').voice).toBeUndefined()
    expect(pickVoice(voices, 'kn-IN')).toMatchObject({ exact: true, voice: { name: 'Soumya' } })
  })
  it('falls back to any English voice for English, but marks regional-exact when available', () => {
    expect(pickVoice([V('Daniel', 'en-GB')], 'en-IN').voice?.name).toBe('Daniel')
    expect(scoreVoice(V('Rishi', 'en-IN'), 'en-IN')).toBeGreaterThan(scoreVoice(V('Daniel', 'en-GB'), 'en-IN'))
  })
  it('never picks novelty voices', () => {
    expect(pickVoice([V('Zarvox', 'en-US')], 'en-IN').voice?.name).toBeUndefined() // heavily penalised -> filtered by score < 0
  })
  it('honours a saved voice choice if it is still valid, otherwise auto', () => {
    expect(pickVoice(voices, 'hi-IN', 'Lekha').voice?.name).toBe('Lekha')
    expect(pickVoice(voices, 'hi-IN', 'Gone').voice?.name).toContain('Swara')
    expect(pickVoice(voices, 'hi-IN', 'Rishi').voice?.name).toContain('Swara')    // saved voice from another language is ignored
  })
  it('understands Android-style underscore language tags', () => {
    expect(pickVoice([V('x', 'hi_IN')], 'hi-IN').exact).toBe(true)
  })
})

describe('sentence streaming for speech', () => {
  it('releases only completed sentences and keeps the tail', () => {
    expect(takeSentences('Good morning. Your metformin is logged. And')).toEqual({ sentences: ['Good morning.', 'Your metformin is logged.'], rest: 'And' })
  })
  it('does not split decimals mid-stream', () => {
    expect(takeSentences('You slept 4.')).toEqual({ sentences: [], rest: 'You slept 4.' })
    expect(takeSentences('You slept 4.5 hours.')).toEqual({ sentences: [], rest: 'You slept 4.5 hours.' })   // trailing period waits for more text
  })
  it('splits Hindi sentences on the danda', () => {
    const r = takeSentences('नमस्कार आशा जी। आपकी दवा दर्ज हो गई। और')
    expect(r.sentences).toEqual(['नमस्कार आशा जी।', 'आपकी दवा दर्ज हो गई।'])
    expect(r.rest).toBe('और')
  })
  it('splits on question and exclamation marks and newlines', () => {
    expect(takeSentences('Did you eat? Great!\nNext').sentences).toEqual(['Did you eat?', 'Great!'])
  })
  it('streams token by token without losing or duplicating text', () => {
    const full = 'Lovely. I logged it! How is your knee? Fine.'
    let buf = '', said: string[] = []
    for (const ch of full) { buf += ch; const t = takeSentences(buf); said.push(...t.sentences); buf = t.rest }
    if (buf.trim()) said.push(buf.trim())
    expect(said.join(' ')).toBe(full)
  })
  it('cleans markdown and emoji before speaking', () => {
    expect(cleanForSpeech('**Great** job 🎉 — keep going')).toBe('Great job, keep going')
  })
})

describe('language catalogue', () => {
  it('offers only languages that real voices exist for (English, Hindi, Hinglish, Tamil, Telugu, Bengali, Kannada)', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en-IN', 'hi-IN', 'hi-Latn', 'ta-IN', 'te-IN', 'bn-IN', 'kn-IN'])
  })
  it('has every UI string and 6 suggestions for every language', () => {
    for (const l of LANGUAGES) {
      expect(l.strings.suggestions, l.code).toHaveLength(6)
      for (const [k, v] of Object.entries(l.strings)) expect(v, `${l.code}.${k}`).toBeTruthy()
    }
  })
  it('is actually translated, written in the right script, not English copy-paste', () => {
    const script: Record<string, RegExp> = {
      'hi-IN': /[ऀ-ॿ]/, 'ta-IN': /[஀-௿]/, 'te-IN': /[ఀ-౿]/, 'bn-IN': /[ঀ-৿]/,
      'gu-IN': /[઀-૿]/, 'kn-IN': /[ಀ-೿]/, 'ml-IN': /[ഀ-ൿ]/, 'pa-IN': /[਀-੿]/,
    }
    const en = langByCode('en-IN').strings
    for (const l of LANGUAGES.filter((x) => x.code !== 'en-IN' && x.code !== 'hi-Latn')) {
      for (const [k, v] of Object.entries(l.strings)) {
        const vals = Array.isArray(v) ? v : [v]
        vals.forEach((x) => { expect(x, `${l.code}.${k}`).toMatch(script[l.code]); expect(x).not.toBe((en as any)[k]) })
      }
    }
    // Hinglish is Hindi in Roman letters: never Devanagari, and not a copy of the English strings
    const hing = langByCode('hi-Latn')
    for (const x of [hing.strings.placeholder, hing.strings.helpSub, ...hing.strings.suggestions]) { expect(x).not.toMatch(/[\u0900-\u097F]/); expect(en.suggestions).not.toContain(x) }
  })
  it('greets by time of day and addresses by name in the right script', () => {
    const hi = langByCode('hi-IN')
    expect(greetingFor(hi, new Date('2026-10-21T08:00:00'))).toBe('सुप्रभात')
    expect(greetingFor(hi, new Date('2026-10-21T19:00:00'))).toBe('शुभ संध्या')
    expect(addressName('Asha', hi)).toBe('आशा जी')
    expect(addressName('Asha', langByCode('en-IN'))).toBe('Asha ji')
    expect(addressName('Priya', hi)).toBe('Priya जी')       // unknown names stay readable
  })
  it('falls back to English for unknown codes', () => { expect(langByCode('xx-YY').code).toBe('en-IN') })
})

describe('choosing how a language is spoken', () => {
  const mac = [V('Rishi', 'en-IN'), V('Lekha', 'hi-IN'), V('Vani', 'ta-IN')]
  const withPolly = { langs: ['en-IN', 'hi-IN', 'hi-Latn'], preferred: ['en-IN', 'hi-IN', 'hi-Latn'], engines: { 'en-IN': 'server', 'hi-IN': 'server', 'hi-Latn': 'server' } as const }
  const none = { langs: [], preferred: [], engines: {} }

  it('uses a real device voice when the server has no voice', () => {
    expect(chooseSource(mac, none, 'hi-IN')).toMatchObject({ kind: 'browser', exact: true, voice: { name: 'Lekha' } })
    expect(chooseSource(mac, none, 'ta-IN')).toMatchObject({ kind: 'browser' })
  })
  it('prefers the server voice for English, Hindi and Hinglish over the built-in device voices', () => {
    for (const l of ['en-IN', 'hi-IN', 'hi-Latn']) expect(chooseSource(mac, withPolly as any, l)).toEqual({ kind: 'server', engine: 'server' })
  })
  it('still uses device voices for languages the server voice does not cover (Tamil)', () => {
    expect(chooseSource(mac, withPolly as any, 'ta-IN')).toMatchObject({ kind: 'browser', voice: { name: 'Vani' } })
  })
  it('is text-only when nothing can speak the language', () => {
    expect(chooseSource(mac, none, 'bn-IN')).toEqual({ kind: 'none' })
    expect(chooseSource([], none, 'hi-IN')).toEqual({ kind: 'none' })
  })
  it('respects an explicit user choice: a named device voice beats the server voice', () => {
    expect(chooseSource(mac, withPolly as any, 'hi-IN', 'Lekha')).toMatchObject({ kind: 'browser', voice: { name: 'Lekha' } })
  })
  it('lets the user force the server voice, but only where it exists', () => {
    expect(chooseSource(mac, withPolly as any, 'hi-IN', SERVER_VOICE)).toEqual({ kind: 'server', engine: 'server' })
    expect(chooseSource(mac, none, 'hi-IN', SERVER_VOICE)).toMatchObject({ kind: 'browser' })
  })
})

describe('Alexa+ India language support is represented honestly', () => {
  it('marks exactly English, Hindi and Hinglish as live on Alexa+ today', () => {
    expect(LANGUAGES.filter((l) => l.alexaPlus).map((l) => l.code)).toEqual(['en-IN', 'hi-IN', 'hi-Latn'])
  })
  it('speaks Hinglish with an Indian-English voice but listens with the Hindi recogniser', () => {
    const h = langByCode('hi-Latn')
    expect(h.speech).toBe('en-IN')
    expect(h.recog).toBe('hi-IN')
  })
})

describe('suggestion chips adapt to the patient using the Echo', () => {
  it("fills in the patient's own medicine in every language", () => {
    expect(suggestionsFor(langByCode('en-IN'), 'Levodopa')).toContain('I took my Levodopa')
    expect(suggestionsFor(langByCode('hi-IN'), 'Warfarin')).toContain('मैंने अपनी Warfarin ले ली')
    expect(suggestionsFor(langByCode('hi-Latn'), 'Tiotropium')).toContain('Maine apni Tiotropium le li')
    for (const l of LANGUAGES) expect(suggestionsFor(l, 'X').some((x) => x.includes('X')), l.code).toBe(true)
  })
  it('drops the medicine chip when the patient has none and never leaves a raw placeholder', () => {
    for (const l of LANGUAGES) {
      const chips = suggestionsFor(l, null)
      expect(chips).toHaveLength(5)
      expect(chips.join(' ')).not.toContain('{med}')
    }
  })
  it('does not mention any specific person, medicine, or condition in the fixed chips', () => {
    for (const l of LANGUAGES) {
      const text = suggestionsFor(l, null).join(' ')
      expect(text, l.code).not.toMatch(/Rohan|Asha|Meera|metformin|knee|ghutn|घुटन/i)
    }
  })
})
