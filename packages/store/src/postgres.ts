import type {
  Agent,
  ApiToken,
  CostSummary,
  Event,
  Finding,
  Notification,
  PackManifest,
  Profile,
  RiskMap,
  Run,
  SavedView,
  Scenario,
  Tenancy,
} from '@aqa/schemas';
import type { StoreProvider, StoreUserDirectoryEntry } from './types.js';

/**
 * Postgres adapter scaffold — concrete implementation lands with the
 * server extraction using drizzle-orm. Every method currently throws
 * `not implemented` so a misconfigured production deployment fails
 * loudly at boot instead of silently dropping data.
 */
export class PostgresStore implements StoreProvider {
  constructor(private readonly dsn: string) {
    if (!dsn || !dsn.trim()) {
      throw new Error('[store/postgres] DSN is empty — refusing to construct.');
    }
  }

  private notImpl(method: string): never {
    throw new Error(
      `[store/postgres] ${method} not implemented yet; ships with the server extraction. dsn=${this.dsn}`,
    );
  }

  async saveRun(_run: Run.Run): Promise<void> {
    this.notImpl('saveRun');
  }
  async loadRun(_id: string): Promise<Run.Run | null> {
    this.notImpl('loadRun');
  }
  async listRuns(): Promise<Run.Run[]> {
    this.notImpl('listRuns');
  }

  async appendEvent(_e: Event.Event): Promise<void> {
    this.notImpl('appendEvent');
  }
  async listEvents(): Promise<Event.Event[]> {
    this.notImpl('listEvents');
  }
  async listAuditEvents(): Promise<Event.Event[]> {
    this.notImpl('listAuditEvents');
  }

  async appendFinding(_f: Finding.Finding): Promise<void> {
    this.notImpl('appendFinding');
  }
  async loadFinding(_id: string): Promise<Finding.Finding | null> {
    this.notImpl('loadFinding');
  }
  async updateFindingStatus(): Promise<Finding.Finding | null> {
    this.notImpl('updateFindingStatus');
  }
  async listFindings(): Promise<Finding.Finding[]> {
    this.notImpl('listFindings');
  }

  async listPacks(): Promise<PackManifest.PackManifest[]> {
    this.notImpl('listPacks');
  }
  async loadPack(_slug: string): Promise<PackManifest.PackManifest | null> {
    this.notImpl('loadPack');
  }
  async installPack(_m: PackManifest.PackManifest): Promise<void> {
    this.notImpl('installPack');
  }
  async uninstallPack(_slug: string): Promise<void> {
    this.notImpl('uninstallPack');
  }

  async listProfiles(): Promise<Profile.Profile[]> {
    this.notImpl('listProfiles');
  }
  async loadProfile(_name: string): Promise<Profile.Profile | null> {
    this.notImpl('loadProfile');
  }
  async saveProfile(_p: Profile.Profile): Promise<void> {
    this.notImpl('saveProfile');
  }
  async createProfile(_p: Profile.Profile): Promise<{ created: boolean }> {
    this.notImpl('createProfile');
  }
  async deleteProfile(_name: string): Promise<void> {
    this.notImpl('deleteProfile');
  }

  async listRisks(): Promise<RiskMap.Risk[]> {
    this.notImpl('listRisks');
  }
  async loadRisk(_id: string): Promise<RiskMap.Risk | null> {
    this.notImpl('loadRisk');
  }
  async saveRisk(_r: RiskMap.Risk): Promise<void> {
    this.notImpl('saveRisk');
  }
  async deleteRisk(_id: string): Promise<void> {
    this.notImpl('deleteRisk');
  }

  async listScenarios(): Promise<Scenario.Scenario[]> {
    this.notImpl('listScenarios');
  }
  async loadScenario(_id: string): Promise<Scenario.Scenario | null> {
    this.notImpl('loadScenario');
  }
  async saveScenario(_s: Scenario.Scenario): Promise<void> {
    this.notImpl('saveScenario');
  }
  async createScenario(_s: Scenario.Scenario): Promise<{ created: boolean }> {
    this.notImpl('createScenario');
  }
  async deleteScenario(_id: string): Promise<void> {
    this.notImpl('deleteScenario');
  }

  // ----- Agents (v1.7 slice 4d) -----
  async listAgents(): Promise<Agent.Agent[]> {
    this.notImpl('listAgents');
  }
  async loadAgent(_id: string): Promise<Agent.Agent | null> {
    this.notImpl('loadAgent');
  }
  async installAgent(_id: string): Promise<Agent.Agent | null> {
    this.notImpl('installAgent');
  }
  async uninstallAgent(_id: string): Promise<Agent.Agent | null> {
    this.notImpl('uninstallAgent');
  }

  async listUsers(): Promise<StoreUserDirectoryEntry[]> {
    this.notImpl('listUsers');
  }

  async listNotifications(): Promise<Notification.Notification[]> {
    this.notImpl('listNotifications');
  }
  async appendNotification(_n: Notification.Notification): Promise<void> {
    this.notImpl('appendNotification');
  }
  async markNotificationRead(): Promise<void> {
    this.notImpl('markNotificationRead');
  }

  async listSavedViews(): Promise<SavedView.SavedView[]> {
    this.notImpl('listSavedViews');
  }
  async saveSavedView(_v: SavedView.SavedView): Promise<void> {
    this.notImpl('saveSavedView');
  }
  async deleteSavedView(_id: string): Promise<void> {
    this.notImpl('deleteSavedView');
  }

  async listTokens(): Promise<ApiToken.ApiToken[]> {
    this.notImpl('listTokens');
  }
  async createToken(_t: ApiToken.ApiToken): Promise<void> {
    this.notImpl('createToken');
  }
  async revokeToken(): Promise<void> {
    this.notImpl('revokeToken');
  }

  async listOrgs(): Promise<Tenancy.Org[]> {
    this.notImpl('listOrgs');
  }
  async loadOrg(_slug: string): Promise<Tenancy.Org | null> {
    this.notImpl('loadOrg');
  }
  async saveOrg(_o: Tenancy.Org): Promise<void> {
    this.notImpl('saveOrg');
  }
  async listProjects(): Promise<Tenancy.ProjectRef[]> {
    this.notImpl('listProjects');
  }
  async saveProject(_p: Tenancy.ProjectRef): Promise<void> {
    this.notImpl('saveProject');
  }

  async costSummary(): Promise<CostSummary.CostSummary> {
    this.notImpl('costSummary');
  }

  async close(): Promise<void> {
    // no-op for the scaffold; real connection pool closes here later.
  }
}
