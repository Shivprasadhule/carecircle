import { motion } from 'framer-motion'
import { Eye, EyeOff, KeyRound, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import type { DemoAccount, Role } from '../lib/types'
import { useCare } from '../state/care'
import { Avatar, Badge, Button, Card } from './ui/primitives'

export const ROLE_LABEL: Record<Role, string> = { person: 'Patient', family: 'Family', admin: 'Family admin', clinician: 'Clinician' }
const ROLE_KIND: Record<Role, string> = { person: 'ok', family: 'info', admin: 'watch', clinician: 'upcoming' }
const ROLE_HELP: Record<Role, string> = {
  person: 'Talks to Alexa about her own day. Sees only her own record.',
  family: 'Sees and updates the care record, alerts and chat history for their family.',
  admin: 'Everything a family member can do, plus people, medicines, instructions, facilities and the audit log.',
  clinician: 'Read-only view of assigned patients.',
}

export function SignIn() {
  const { signIn } = useCare()
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.demoAccounts().then(setAccounts).catch(() => setAccounts([])) }, [])
  const byFamily = useMemo(() => {
    const m = new Map<string, DemoAccount[]>()
    for (const a of accounts ?? []) m.set(a.family_name, [...(m.get(a.family_name) ?? []), a])
    return [...m.entries()]
  }, [accounts])
  const pw = (id: string) => accounts?.find((a) => a.id === id)?.password ?? null

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!username.trim() || !password) { setError('Enter your username and password.'); return }
    setBusy(true); setError(null)
    try { await signIn([{ username: username.trim(), password }]) } catch (er) { setError((er as Error).message); setBusy(false) }
  }
  const demo = async () => {
    const a = pw('asha'), r = pw('rohan')
    if (!a || !r) { setError('The demo passwords have been changed; sign in with the form.'); return }
    setBusy(true); setError(null)
    try { await signIn([{ username: 'asha', password: a }, { username: 'rohan', password: r }]) } catch (er) { setError((er as Error).message); setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-[var(--brand-ink)]"><ShieldCheck size={28} /></div>
          <h1 className="font-display text-4xl">Sign in to CareCircle</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">Care data is private. Every request is authenticated, every action is checked against your role, each family only ever sees its own people, and everything is recorded in an audit log.</p>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4 lg:sticky lg:top-4">
            <Card>
              <form onSubmit={submit} className="space-y-3" aria-label="Sign in">
                <label className="block text-sm font-medium">Username
                  <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false}
                    className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 outline-none focus:border-brand" />
                </label>
                <label className="block text-sm font-medium">Password
                  <span className="relative mt-1 block">
                    <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                      className="w-full rounded-xl border border-line bg-surface py-2.5 pl-3.5 pr-11 outline-none focus:border-brand" />
                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-ink">
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>
                {error && <p role="alert" className="rounded-xl bg-urgent-soft px-3 py-2 text-sm text-urgent">{error}</p>}
                <Button variant="primary" className="w-full" disabled={busy}><KeyRound size={15} />{busy ? 'Signing in…' : 'Sign in'}</Button>
              </form>
            </Card>

            {accounts && accounts.length > 0 && (
              <Card className="border-brand/40 bg-gradient-to-br from-brand/10 to-transparent">
                <div className="mb-1 flex items-center gap-2 font-semibold"><Users size={16} />Quick demo</div>
                <p className="mb-3 text-sm text-muted">Signs in <b>Asha</b> on her Echo and <b>Rohan</b> (family admin) on his phone, so you can talk to Alexa and watch the family app react.</p>
                <Button className="w-full" disabled={busy} onClick={demo}>Start the demo</Button>
              </Card>
            )}
            <p className="text-center text-xs text-muted">Demo accounts use the password <code>FirstName_2026</code> (clinicians: <code>Surname_2026</code>). With Alexa+ the account is linked through OAuth 2.0 and these same roles apply.</p>
          </div>

          <div className="space-y-4" data-testid="directory">
            {!accounts && <p className="py-6 text-center text-sm text-muted">Loading demo accounts…</p>}
            {byFamily.map(([family, list]) => (
              <Card key={family} className="p-4" data-testid={`family-${family}`}>
                <h2 className="mb-2 font-display text-xl">{family}</h2>
                <ul className="divide-y divide-line">
                  {list.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid={`account-${a.id}`}>
                      <Avatar name={a.name} size={34} />
                      <div className="min-w-[150px] flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold">{a.name}<Badge kind={ROLE_KIND[a.role]}>{ROLE_LABEL[a.role]}</Badge></div>
                        <div className="text-xs text-muted" title={ROLE_HELP[a.role]}>{a.blurb}</div>
                      </div>
                      <div className="font-mono text-[12px] leading-tight text-muted">
                        <div>user <b className="text-ink">{a.id}</b></div>
                        <div>pass <b className="text-ink">{a.password ?? '(changed)'}</b></div>
                      </div>
                      <Button size="sm" onClick={() => { setUsername(a.id); setPassword(a.password ?? ''); setError(null) }} aria-label={`Fill sign-in for ${a.name}`}>Use</Button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
