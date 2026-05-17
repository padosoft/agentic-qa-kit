import { Outlet, createRootRoute, createRoute } from '@tanstack/react-router';
import { AppShell } from './layout/AppShell.tsx';
import { AgentsScreen } from './screens/Agents.tsx';
import { AuditScreen } from './screens/Audit.tsx';
import { CostScreen } from './screens/Cost.tsx';
import { DashboardScreen } from './screens/Dashboard.tsx';
import { FindingsScreen } from './screens/Findings.tsx';
import { PacksScreen } from './screens/Packs.tsx';
import { ProfilesScreen } from './screens/Profiles.tsx';
import { ReplayScreen } from './screens/Replay.tsx';
import { RiskMapScreen } from './screens/RiskMap.tsx';
import { RunsScreen } from './screens/Runs.tsx';
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
const findingsRoute = make('/findings', FindingsScreen);
const riskMapRoute = make('/risk-map', RiskMapScreen);
const profilesRoute = make('/profiles', ProfilesScreen);
const packsRoute = make('/packs', PacksScreen);
const scenariosRoute = make('/scenarios', ScenariosScreen);
const agentsRoute = make('/agents', AgentsScreen);
const replayRoute = make('/replay', ReplayScreen);
const auditRoute = make('/audit', AuditScreen);
const costRoute = make('/cost', CostScreen);
const settingsRoute = make('/settings', SettingsScreen);

export const routeTree = rootRoute.addChildren([
  indexRoute,
  runsRoute,
  findingsRoute,
  riskMapRoute,
  profilesRoute,
  packsRoute,
  scenariosRoute,
  agentsRoute,
  replayRoute,
  auditRoute,
  costRoute,
  settingsRoute,
]);
