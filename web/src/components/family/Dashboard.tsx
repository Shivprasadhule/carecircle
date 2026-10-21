import { useCare } from '../../state/care'
import { AlertsFeed } from './AlertsFeed'
import { AskPanel } from './AskPanel'
import { CareWatch } from './CareWatch'
import { MedTimeline } from './MedTimeline'
import { Appointments, Circle, ScenarioPanel } from './Misc'
import { Overview } from './Overview'
import { CarePlan } from './CarePlan'
import { PatientSwitcher } from './PatientSwitcher'
import { VitalsPanel } from './VitalsPanel'
import { StatTiles } from './StatTiles'
import { WellbeingChart } from './WellbeingChart'
import { ActivityPanel, ConversationsPanel } from './Governance'

export function Dashboard({ compact = false }: { compact?: boolean }) {
  const { snap, error, can } = useCare()
  return (
    <div className="space-y-4">
      {error && !snap && <p role="alert" className="rounded-2xl bg-urgent-soft px-4 py-3 text-sm text-urgent">Can't reach the CareCircle server: {error}</p>}
      <PatientSwitcher />
      <Overview snap={snap} />
      <StatTiles snap={snap} />
      <div className={`grid gap-4 ${compact ? 'grid-cols-1 2xl:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'}`}>
        <div className={`space-y-4 ${compact ? '' : 'xl:col-span-2'}`}>
          <WellbeingChart snap={snap} />
          <VitalsPanel />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MedTimeline />
            <AlertsFeed />
          </div>
          <AskPanel />
        </div>
        <div className="space-y-4">
          <CareWatch />
          <CarePlan />
          <Appointments />
          <Circle />
          {can('conversation:read') && <ConversationsPanel />}
          {can('audit:read') && <ActivityPanel />}
          <ScenarioPanel />
        </div>
      </div>
    </div>
  )
}
