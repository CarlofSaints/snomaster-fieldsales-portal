import { readJson, writeJson } from './blob';

/**
 * Roles and permissions.
 *
 * This portal hosts TWO separate businesses that must not mix:
 *
 *   • BA Measurement  — 3rd-party brand ambassadors, run by MARKETING
 *   • Call Cycles     — SnoMaster's own internal reps, run by SALES
 *
 * Both sets of people are in Perigee, but their data, their managers and their
 * departments are separate. So every permission key is namespaced by project
 * (`ba.*` / `cc.*`), which is what lets a whole project be switched off for a
 * role in one go.
 *
 * `shared.*` is genuinely common ground (a store is the same shop whoever
 * visits it). `system.*` is portal administration and stays with the owner.
 */

export interface RoleConfig {
  name: string;
  label: string;
  permissions: string[];
  /** Set on the built-ins so the UI can explain and protect them. */
  description?: string;
  /** Built-in roles cannot be deleted or renamed. */
  builtIn?: boolean;
}

const BLOB_KEY = 'config/roles.json';

export interface PermissionDef {
  key: string;
  label: string;
  category: string;
  /** Top-level grouping, so a whole project can be toggled at once. */
  section: PermissionSection;
}

export type PermissionSection = 'BA Measurement' | 'Call Cycles' | 'Shared' | 'System';

export const PERMISSION_SECTIONS: PermissionSection[] =
  ['BA Measurement', 'Call Cycles', 'Shared', 'System'];

export const ALL_PERMISSIONS: PermissionDef[] = [
  // ── BA Measurement (Marketing) ─────────────────────────────────────────
  { key: 'ba.leaderboard.view', label: 'View Leaderboard', category: 'Leaderboard', section: 'BA Measurement' },
  { key: 'ba.dashboard.view', label: 'View Visit Analytics', category: 'Leaderboard', section: 'BA Measurement' },

  { key: 'ba.kpi.training', label: 'View Training KPI', category: 'KPIs', section: 'BA Measurement' },
  { key: 'ba.kpi.sales', label: 'View Sales KPI', category: 'KPIs', section: 'BA Measurement' },
  { key: 'ba.kpi.display', label: 'View Display KPI', category: 'KPIs', section: 'BA Measurement' },
  { key: 'ba.kpi.red_flags', label: 'View Red Flags KPI', category: 'KPIs', section: 'BA Measurement' },

  { key: 'ba.scores.view', label: 'View Scores', category: 'Scoring', section: 'BA Measurement' },
  { key: 'ba.scores.manage', label: 'Enter / Edit Scores', category: 'Scoring', section: 'BA Measurement' },
  { key: 'ba.guide.view', label: 'View Scoring Guide', category: 'Scoring', section: 'BA Measurement' },
  { key: 'ba.reports.view', label: 'View / Build Reports', category: 'Scoring', section: 'BA Measurement' },

  { key: 'ba.upload.visits', label: 'Upload Visit Data', category: 'BA Data Load', section: 'BA Measurement' },
  { key: 'ba.upload.dispo', label: 'Upload DISPO / Sales Data', category: 'BA Data Load', section: 'BA Measurement' },
  { key: 'ba.upload.training', label: 'Upload Training Data', category: 'BA Data Load', section: 'BA Measurement' },
  { key: 'ba.upload.targets', label: 'Upload Target Data', category: 'BA Data Load', section: 'BA Measurement' },
  { key: 'ba.upload.display', label: 'Upload Display Data', category: 'BA Data Load', section: 'BA Measurement' },
  { key: 'ba.upload.red_flags', label: 'Upload Red Flag Data', category: 'BA Data Load', section: 'BA Measurement' },

  { key: 'ba.bas.view', label: 'View BA Management', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.bas.manage', label: 'Manage BAs', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.kpi_controls.view', label: 'View KPI Controls', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.kpi_controls.manage', label: 'Manage KPI Controls', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.week_mapping.manage', label: 'Manage Week Mapping', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.products.manage', label: 'Manage Products', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.reminders.view', label: 'View Reminders', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.reminders.manage', label: 'Manage Reminders', category: 'BA Admin', section: 'BA Measurement' },
  { key: 'ba.perigee.manage', label: 'Manage the BA Perigee connection', category: 'BA Admin', section: 'BA Measurement' },

  // ── Call Cycles (Sales) ────────────────────────────────────────────────
  { key: 'cc.schedule.view', label: 'View Call Cycle Schedule', category: 'Call Cycles', section: 'Call Cycles' },
  { key: 'cc.schedule.manage', label: 'Edit / Delete Schedule Rows', category: 'Call Cycles', section: 'Call Cycles' },
  { key: 'cc.planner.upload', label: 'Upload Rep Planners', category: 'Call Cycles', section: 'Call Cycles' },
  { key: 'cc.download', label: 'Download the Perigee Export', category: 'Call Cycles', section: 'Call Cycles' },
  { key: 'cc.adherence.view', label: 'View Call Cycle Adherence', category: 'Call Cycles', section: 'Call Cycles' },
  { key: 'cc.control_files.manage', label: 'Manage Perigee Control Files', category: 'Call Cycles', section: 'Call Cycles' },
  { key: 'cc.perigee.manage', label: 'Manage the Rep Perigee connection', category: 'Call Cycles', section: 'Call Cycles' },

  // ── Shared ─────────────────────────────────────────────────────────────
  { key: 'shared.stores.view', label: 'View Stores', category: 'Stores', section: 'Shared' },
  { key: 'shared.stores.manage', label: 'Manage Stores', category: 'Stores', section: 'Shared' },
  { key: 'shared.activity_log.view', label: 'View Activity Log', category: 'Activity', section: 'Shared' },
  { key: 'shared.site_guide.view', label: 'View Site Guide', category: 'Activity', section: 'Shared' },

  // ── System (portal administration) ─────────────────────────────────────
  { key: 'system.users.view', label: 'View Users', category: 'Users', section: 'System' },
  { key: 'system.users.manage', label: 'Create / Edit / Delete Users', category: 'Users', section: 'System' },
  { key: 'system.channels.view', label: 'View Sales Channels', category: 'Configuration', section: 'System' },
  { key: 'system.channels.manage', label: 'Manage Sales Channels', category: 'Configuration', section: 'System' },
  { key: 'system.settings.view', label: 'View Settings', category: 'Configuration', section: 'System' },
  { key: 'system.settings.manage', label: 'Edit Settings', category: 'Configuration', section: 'System' },
  { key: 'system.roles.manage', label: 'Manage Roles & Permissions', category: 'Configuration', section: 'System' },
];

export const PERMISSION_CATEGORIES = [...new Set(ALL_PERMISSIONS.map(p => p.category))];

const ALL_PERMISSION_KEYS = ALL_PERMISSIONS.map(p => p.key);

const keysIn = (section: PermissionSection) =>
  ALL_PERMISSIONS.filter(p => p.section === section).map(p => p.key);

const BA_KEYS = keysIn('BA Measurement');
const CC_KEYS = keysIn('Call Cycles');
const SHARED_KEYS = keysIn('Shared');

/** The Perigee connection is system config, so it is withheld from MD. */
const PERIGEE_KEYS = ['ba.perigee.manage', 'cc.perigee.manage'];

export const DEFAULT_ROLES: RoleConfig[] = [
  {
    name: 'super_admin',
    label: 'Super Admin',
    description: 'Full system access. All permissions locked on.',
    builtIn: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    name: 'md',
    label: 'MD',
    description: 'Both projects in full, plus users and channels — but not roles, settings or the Perigee API tokens.',
    builtIn: true,
    permissions: [
      ...BA_KEYS.filter(k => !PERIGEE_KEYS.includes(k)),
      ...CC_KEYS.filter(k => !PERIGEE_KEYS.includes(k)),
      ...SHARED_KEYS,
      'system.users.view', 'system.users.manage',
      'system.channels.view', 'system.channels.manage',
    ],
  },
  {
    name: 'admin',
    label: 'Admin',
    description: 'Day-to-day management across both projects. No roles, settings or API tokens.',
    builtIn: true,
    permissions: [
      ...BA_KEYS.filter(k => !PERIGEE_KEYS.includes(k)),
      ...CC_KEYS.filter(k => !PERIGEE_KEYS.includes(k)),
      ...SHARED_KEYS,
      'system.users.view', 'system.users.manage',
      'system.channels.view',
    ],
  },
  {
    name: 'marketing',
    label: 'Marketing',
    description: 'The BA Measurement project in full. No access to Call Cycles.',
    builtIn: true,
    permissions: [
      ...BA_KEYS.filter(k => !PERIGEE_KEYS.includes(k)),
      ...SHARED_KEYS,
    ],
  },
  {
    name: 'sales',
    label: 'Sales',
    description: 'The Call Cycles project for internal reps. No access to BA Measurement.',
    builtIn: true,
    permissions: [
      ...CC_KEYS.filter(k => !PERIGEE_KEYS.includes(k)),
      ...SHARED_KEYS,
    ],
  },
  {
    name: 'client',
    label: 'Client',
    description: 'Read-only access to the BA dashboards and reports.',
    builtIn: true,
    permissions: [
      'ba.leaderboard.view', 'ba.dashboard.view', 'ba.kpi.sales', 'ba.kpi.display',
      'ba.guide.view', 'shared.site_guide.view',
    ],
  },
];

/**
 * Permission keys as they were named before the project split, mapped to their
 * replacements. A saved roles.json written under the old names would otherwise
 * silently grant nothing once enforcement went live.
 */
const LEGACY_KEY_MAP: Record<string, string> = {
  'dashboard.view': 'ba.dashboard.view',
  'leaderboard.view': 'ba.leaderboard.view',
  'kpi.visit_analytics': 'ba.dashboard.view',
  'kpi.training': 'ba.kpi.training',
  'kpi.sales': 'ba.kpi.sales',
  'kpi.display': 'ba.kpi.display',
  'kpi.red_flags': 'ba.kpi.red_flags',
  'scores.view': 'ba.scores.view',
  'scores.manage': 'ba.scores.manage',
  'scoring_guide.view': 'ba.guide.view',
  'upload.visits': 'ba.upload.visits',
  'upload.dispo': 'ba.upload.dispo',
  'upload.training': 'ba.upload.training',
  'upload.targets': 'ba.upload.targets',
  'upload.display': 'ba.upload.display',
  'upload.red_flags': 'ba.upload.red_flags',
  'bas.view': 'ba.bas.view',
  'bas.manage': 'ba.bas.manage',
  'kpi_controls.view': 'ba.kpi_controls.view',
  'kpi_controls.manage': 'ba.kpi_controls.manage',
  'reminders.view': 'ba.reminders.view',
  'reminders.manage': 'ba.reminders.manage',
  'stores.view': 'shared.stores.view',
  'stores.manage': 'shared.stores.manage',
  'activity_log.view': 'shared.activity_log.view',
  'site_guide.view': 'shared.site_guide.view',
  'users.view': 'system.users.view',
  'users.manage': 'system.users.manage',
  'channels.view': 'system.channels.view',
  'channels.manage': 'system.channels.manage',
  'settings.view': 'system.settings.view',
  'settings.manage': 'system.settings.manage',
  'roles.manage': 'system.roles.manage',
  // Written by the first Call Cycles build, before the cc.* namespace existed.
  'callcycle.view': 'cc.schedule.view',
  'callcycle.upload': 'cc.planner.upload',
  'callcycle.manage': 'cc.schedule.manage',
  'callcycle.download': 'cc.download',
  'callcycle.control_files': 'cc.control_files.manage',
  'callcycle.adherence': 'cc.adherence.view',
};

const VALID_KEYS = new Set(ALL_PERMISSION_KEYS);

/**
 * Permissions that already existed as a real, grantable capability in the
 * version a stored roles.json could have been written under.
 *
 * The `callcycle.*` keys are deliberately EXCLUDED. They existed for only a few
 * hours before being renamed to `cc.*`, and no saved roles.json in the wild was
 * written while they were current — so treating them as pre-existing would make
 * the whole Call Cycles section look like something an admin had chosen to
 * switch off, and every existing Admin would silently lose it. Their entry in
 * LEGACY_KEY_MAP still stands, so a roles.json that genuinely does hold them is
 * translated correctly.
 */
const PRE_EXISTING_KEYS = new Set(
  Object.entries(LEGACY_KEY_MAP)
    .filter(([oldKey]) => !oldKey.startsWith('callcycle.'))
    .map(([, newKey]) => newKey),
);

/** Translate any stored permission list into current keys, dropping dead ones. */
function migratePermissions(perms: string[]): string[] {
  const out = new Set<string>();
  for (const p of perms || []) {
    if (VALID_KEYS.has(p)) { out.add(p); continue; }
    const mapped = LEGACY_KEY_MAP[p];
    if (mapped && VALID_KEYS.has(mapped)) out.add(mapped);
  }
  return [...out];
}

/**
 * Reconcile a saved built-in role with its current definition.
 *
 * Migrating alone is not enough. A role saved before the split can only carry
 * permissions that existed then, so every NEW capability would arrive switched
 * off — an existing Admin would quietly lose Reports, Products, Week Mapping
 * and the entire Call Cycles section without anyone touching their role.
 *
 * So: keep exactly what was saved for anything that existed before (a
 * deliberate revocation stays revoked), and fall back to the role's default for
 * anything that is new. A permission that did not exist cannot have been
 * revoked on purpose.
 */
function reconcileBuiltIn(def: RoleConfig, storedPermissions: string[]): string[] {
  const migrated = new Set(migratePermissions(storedPermissions));
  for (const key of def.permissions) {
    if (!PRE_EXISTING_KEYS.has(key)) migrated.add(key);
  }
  return [...migrated];
}

/**
 * Merge whatever is stored in roles.json with the current role definitions.
 * Pure, so the migration can be tested without touching Blob.
 */
export function mergeStoredRoles(saved: RoleConfig[]): RoleConfig[] {
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_ROLES;

  const byName = new Map(saved.map(r => [r.name, r]));
  const out: RoleConfig[] = [];

  for (const def of DEFAULT_ROLES) {
    const stored = byName.get(def.name);
    byName.delete(def.name);
    if (!stored) {
      // A built-in role added after this roles.json was written.
      out.push(def);
      continue;
    }
    out.push({
      ...def,
      // super_admin is documented and rendered as "all permissions locked on",
      // so re-assert that on read rather than letting it drift as new keys land.
      permissions: def.name === 'super_admin'
        ? ALL_PERMISSION_KEYS
        : reconcileBuiltIn(def, stored.permissions),
      label: stored.label || def.label,
    });
  }

  // Any custom roles the admin created on /roles. These get no new-key
  // fallback — a role someone built by hand should only hold what they ticked.
  for (const custom of byName.values()) {
    out.push({ ...custom, builtIn: false, permissions: migratePermissions(custom.permissions) });
  }

  return out;
}

export async function loadRoles(): Promise<RoleConfig[]> {
  return mergeStoredRoles(await readJson<RoleConfig[]>(BLOB_KEY, []));
}

export async function saveRoles(roles: RoleConfig[]): Promise<void> {
  await writeJson(BLOB_KEY, roles);
}

/** The permission set for a role name. Unknown role = no permissions. */
export function permissionsForRole(roles: RoleConfig[], roleName: string): Set<string> {
  const role = roles.find(r => r.name === roleName);
  return new Set(role?.permissions ?? []);
}
