import clsx from 'clsx'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import type { Level } from '../../lib/types'
import { initials } from '../../lib/format'

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow)]', className)} {...p} />
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{children}</h3>
      {right}
    </div>
  )
}

const LEVEL_STYLE: Record<string, string> = {
  ok: 'bg-ok-soft text-ok', info: 'bg-info-soft text-info', watch: 'bg-watch-soft text-watch',
  high: 'bg-high-soft text-high', urgent: 'bg-urgent-soft text-urgent',
  taken: 'bg-ok-soft text-ok', missed: 'bg-high-soft text-high', overdue: 'bg-high-soft text-high',
  due: 'bg-watch-soft text-watch', upcoming: 'bg-bg2 text-muted', skipped: 'bg-bg2 text-muted',
}
export function Badge({ kind, children, className }: { kind: Level | string; children?: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize', LEVEL_STYLE[kind] ?? LEVEL_STYLE.upcoming, className)}>
      {children ?? kind}
    </span>
  )
}

export function Button({ variant = 'ghost', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'soft'; size?: 'sm' | 'md' }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.97] disabled:cursor-wait disabled:opacity-60',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
        variant === 'primary' && 'bg-brand text-[var(--brand-ink)] shadow-sm hover:brightness-110',
        variant === 'ghost' && 'border border-line bg-surface text-ink hover:bg-surface2',
        variant === 'soft' && 'bg-bg2 text-ink hover:brightness-95',
        className,
      )}
      {...p}
    />
  )
}

const AV = ['#0b6e8f', '#e0592f', '#7a5af8', '#23996a', '#d29214']
export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const c = AV[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV.length]
  return (
    <span className={clsx('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', className)} style={{ width: size, height: size, background: c, fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
    </span>
  )
}

export const Skeleton = ({ className }: { className?: string }) => <div className={clsx('skeleton', className)} />
