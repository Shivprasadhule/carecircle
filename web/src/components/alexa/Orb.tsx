import { motion } from 'framer-motion'

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'

const SPIN: Record<Phase, number> = { idle: 16, listening: 5, thinking: 1.3, speaking: 3.5 }

/** Alexa-style orb. The ring spins faster while thinking; the core pulses while listening/speaking. */
export function Orb({ phase, size = 64 }: { phase: Phase; size?: number }) {
  const active = phase !== 'idle'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Alexa is ${phase}`} data-phase={phase}>
      <motion.div
        className="absolute rounded-full blur-xl"
        style={{ inset: -size * 0.3, background: 'radial-gradient(circle, #00b6f0 0%, #6a5cff 55%, transparent 72%)' }}
        animate={{ opacity: active ? [0.55, 0.95, 0.55] : 0.4, scale: active ? [1, 1.12, 1] : 1 }}
        transition={{ duration: phase === 'thinking' ? 0.9 : 1.8, repeat: Infinity }}
      />
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'conic-gradient(from 0deg, #00b6f0, #6a5cff, #ff8a5b, #00b6f0)',
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: SPIN[phase], repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{ inset: size * 0.3, background: 'radial-gradient(circle at 35% 30%, #9eeaff, #00a5d9 60%, #0a4d78)' }}
        animate={{ scale: phase === 'listening' || phase === 'speaking' ? [1, 1.25, 0.95, 1.15, 1] : 1 }}
        transition={{ duration: phase === 'listening' ? 1.1 : 0.8, repeat: Infinity }}
      />
    </div>
  )
}

export function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: 22 }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-[#29c4ff]"
          animate={{ height: active ? [6, 8 + ((i * 7) % 20), 5, 6 + ((i * 11) % 22), 6] : 4 }}
          transition={{ duration: 0.9 + (i % 5) * 0.12, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}
