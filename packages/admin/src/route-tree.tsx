import { Outlet, createRootRoute, createRoute } from '@tanstack/react-router';
import { AppShell } from './layout/AppShell.tsx';
import { AgentsScreen } from './screens/Agents.tsx';
import { AuditScreen } from './screens/Audit.tsx';
import { CostScreen } from './screens/Cost.tsx';
import { DashboardScreen } from './screens/Dashboard.tsx';
import { FindingDetailScreen } from './screens/FindingDetail.tsx';
import { FindingsScreen } from './screens/Findings.tsx';
import { PackDetailScreen } from './screens/PackDetail.tsx';
import { PacksScreen } from './screens/Packs.tsx';
import { ProfileDetailScreen } from './screens/ProfileDetail.tsx';
import { ProfilesScreen } from './screens/Profiles.tsx';
import { ReplayScreen } from './screens/Replay.tsx';
import { RiskDetailScreen } from './screens/RiskDetail.tsx';
import { RiskMapScreen } from './screens/RiskMap.tsx';
import { RunDetailScreen } from './screens/RunDetail.tsx';
import { RunsScreen } from './screens/Runs.tsx';
import { ScenarioDetailScreen } from './screens/ScenarioDetail.tsx';
import { ScenariosScreen } from './screens/Scenarios.tsx';
import { SettingsScreen } from './screens/Settings.tsx';

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

function make<P extends string>(path: P, component: () => React.JSX.Element) {
  return createRoute({ getParentRoute: () => rootRoute, path, component });
}

const indexRoute = make('/', DashboardScreen);
const runsRoute = make('/runs', RunsScreen);
const runDetailRoute = make('/runs/$runId', RunDetailScreen);
const findingsRoute = make('/findings', FindingsScreen);
const findingDetailRoute = make('/findings/$findingId', FindingDetailScreen);
const riskMapRoute = make('/risk-map', RiskMapScreen);
const riskDetailRoute = make('/risk-map/$riskId', RiskDetailScreen);
const profilesRoute = make('/profiles', ProfilesScreen);
const profileDetailRoute = make('/profiles/$profileName', ProfileDetailScreen);
const packsRoute = make('/packs', PacksScreen);
const packDetailRoute = make('/packs/$packSlug', PackDetailScreen);
const scenariosRoute = make('/scenarios', ScenariosScreen);
const scenarioDetailRoute = make('/scenarios/$scenarioId', ScenarioDetailScreen);
const agentsRoute = make('/agents', AgentsScreen);
const replayRoute = make('/replay', ReplayScreen);
const auditRoute = make('/audit', AuditScreen);
const costRoute = make('/cost', CostScreen);
const settingsRoute = make('/settings', SettingsScreen);

export const routeTree = rootRoute.addChildren([
  indexRoute,
  runsRoute,
  runDetailRoute,
  findingsRoute,
  findingDetailRoute,
  riskMapRoute,
  riskDetailRoute,
  profilesRoute,
  profileDetailRoute,
  packsRoute,
  packDetailRoute,
  scenariosRoute,
  scenarioDetailRoute,
  agentsRoute,
  replayRoute,
  auditRoute,
  costRoute,
  settingsRoute,
]);
