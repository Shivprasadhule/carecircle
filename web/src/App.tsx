import { LayoutGroup, motion } from 'framer-motion'
import { LogOut, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './lib/api'
import { Architecture, McpPanel } from './components/alexa/McpPanel'
import { AlexaScreen } from './components/alexa/AlexaScreen'
import { Dashboard } from './components/family/Dashboard'
import { ManageConsole } from './components/manage/ManageConsole'
import { PushToasts } from './components/family/Misc'
import { SignIn } from './components/SignIn'
import { Avatar, Badge } from './components/ui/primitives'
import { CareProvider, useCare, type Mode } from './state/care'

const modesFor = (echoOwner: string): { id: Mode; label: string }[] => [
  { id: 'split', label: 'Side by side' },
  { id: 'echo', label: `${echoOwner}'s Echo` },
  { id: 'family', label: 'Family app' },
  { id: 'manage', label: 'Manage' },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5 font-display text-2xl">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden><circle cx="16" cy="16" r="13" fill="none" stroke="var(--alexa)" strokeWidth="4" /><circle cx="16" cy="16" r="5" fill="var(--warm)" /></svg>
      CareCircle
    </div>
  )
}

/** Developer view only: what the assistant runs on. Never shown in the normal product UI. */
function SystemInfo() {
  const [h, setH] = useState<Awaited<ReturnType<typeof api.system>> | null>(null)
  useEffect(() => { api.system().then(setH).catch(() => setH(null)) }, [])
  if (!h) return null
  return (
    <span className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted sm:flex" data-testid="system-info">
      <span className={`h-2 w-2 rounded-full ${h.assistant_ready ? 'bg-ok' : 'bg-urgent'}`} />{h.assistant_model} · {h.region}
    </span>
  )
}

function Shell() {
  const { mode: savedMode, setMode, theme, toggleTheme, sessions, signedIn, signOut, isAdmin, dev, setDev, can } = useCare()
  // Which surfaces this sign-in can use: the Echo needs the patient's account, the family app a family/clinician account.
  const has = { echo: !!sessions.person, family: !!sessions.viewer }
  const modes = modesFor(sessions.person?.user.name.split(' ')[0] ?? 'Alexa').filter((m) => (m.id === 'split' ? has.echo && has.family : m.id === 'echo' ? has.echo : m.id === 'manage' ? isAdmin : has.family))
  const mode: Mode = modes.some((m) => m.id === savedMode) ? savedMode : modes[0]?.id ?? 'echo'
  if (!signedIn) return <div className="mx-auto max-w-[1680px] px-4 sm:px-6"><header className="py-5"><Logo /></header><SignIn /></div>
  return (
    <div className="mx-auto max-w-[1680px] px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <Logo />
        {dev && can('audit:read') && <SystemInfo />}
        <LayoutGroup>
          <nav className="ml-auto flex rounded-full border border-line bg-surface p-1 shadow-[var(--shadow)]" aria-label="View">
            {modes.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id} className={`relative rounded-full px-4 py-2 text-sm font-semibold transition ${mode === m.id ? 'text-[var(--brand-ink)]' : 'text-muted hover:text-ink'} ${m.id === 'split' ? 'max-lg:hidden' : ''}`}>
                {mode === m.id && <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-full bg-brand" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                <span className="relative">{m.label}</span>
              </button>
            ))}
          </nav>
        </LayoutGroup>
        <div className="flex items-center gap-2" data-testid="session-chips">
          {([sessions.person, sessions.viewer].filter(Boolean) as NonNullable<typeof sessions.person>[]).map((x) => (
            <span key={x.user.id} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-xs" title={`${x.user.name} (${x.user.role})`}>
              <Avatar name={x.user.name} size={26} /><span className="hidden font-semibold sm:inline">{x.user.name.split(' ')[0]}</span>
              <Badge kind={x.user.role === 'clinician' ? 'upcoming' : x.user.role === 'admin' ? 'watch' : x.user.role === 'family' ? 'info' : 'ok'}>{x.user.role === 'clinician' ? 'read-only' : x.user.role === 'admin' ? 'family admin' : x.user.role}</Badge>
            </span>
          ))}
          <button onClick={signOut} aria-label="Sign out" title="Sign out" className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-muted transition hover:text-ink"><LogOut size={16} /></button>
        </div>
        <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-muted transition hover:text-ink">
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      {mode === 'echo' && has.echo && (
        <div className={`grid grid-cols-[minmax(0,1fr)] items-start gap-6 ${dev ? 'xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]' : ''}`}>
          <AlexaScreen />
          {dev && <div className="space-y-4"><Architecture /><McpPanel /></div>}
        </div>
      )}
      {mode === 'family' && has.family && <Dashboard />}
      {mode === 'manage' && isAdmin && <ManageConsole />}
      {mode === 'split' && has.echo && has.family && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[480px_minmax(0,1fr)]">
          <div className="space-y-4 lg:sticky lg:top-4"><AlexaScreen compact />{dev && <McpPanel />}</div>
          <Dashboard compact />
        </div>
      )}
      <PushToasts />
      <footer className="mt-12 text-center text-xs text-muted">
        All data is synthetic. CareCircle does not give medical advice.
        <button onClick={() => setDev(!dev)} aria-pressed={dev} className="ml-3 underline-offset-2 hover:underline">{dev ? 'Hide' : 'Show'} developer view</button>
      </footer>
    </div>
  )
}

export default function App() {
  return <CareProvider><Shell /></CareProvider>
}
