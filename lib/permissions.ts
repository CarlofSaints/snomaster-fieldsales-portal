import { loadUsers, type User } from './userData';
import { loadRoles, permissionsForRole } from './roleData';
import { isActive } from './accountStatus';

/**
 * Server-side permission enforcement.
 *
 * Permissions are resolved from the user's role on EVERY request. Nothing is
 * read from the client — the browser holds a copy of the permission list purely
 * to decide what to draw, and a tampered copy buys nothing because the API
 * checks again here.
 *
 * Use `requirePermission` in place of `requireRole` anywhere a route belongs to
 * one of the two projects. `requireRole` is kept for the handful of routes that
 * are genuinely about identity rather than a feature (login, own account).
 */

export async function getUserPermissions(user: User): Promise<Set<string>> {
  const roles = await loadRoles();
  return permissionsForRole(roles, user.role);
}

async function userFromRequest(req: Request): Promise<User | null> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return null;
  const users = await loadUsers();
  const user = users.find(u => u.id === userId) ?? null;
  // A deactivated account holds no permissions, which turns off every route
  // guarded here in one move.
  return isActive(user) ? user : null;
}

/**
 * Resolve the caller and confirm they hold `permission`.
 * Returns null when unauthenticated OR unauthorised — callers should 401/403
 * without distinguishing, so a probe can't enumerate what exists.
 *
 * Pass several keys to require ANY of them (a page that several roles reach by
 * different routes). For ALL of them, call this more than once.
 */
export async function requirePermission(
  req: Request,
  permission: string | string[],
): Promise<User | null> {
  const user = await userFromRequest(req);
  if (!user) return null;

  const held = await getUserPermissions(user);
  const wanted = Array.isArray(permission) ? permission : [permission];
  return wanted.some(p => held.has(p)) ? user : null;
}

/** True when the caller holds the permission. For branching inside a handler. */
export async function hasPermission(req: Request, permission: string): Promise<boolean> {
  return (await requirePermission(req, permission)) !== null;
}

/**
 * Which Perigee projects may this caller see visit data for?
 *
 * This is the check that keeps the two businesses apart: BA visits belong to
 * Marketing, internal-rep visits belong to Sales, and neither should be able to
 * pull the other's rows out of a shared endpoint.
 */
export async function allowedVisitProjects(user: User): Promise<('ba' | 'reps')[]> {
  const held = await getUserPermissions(user);
  const out: ('ba' | 'reps')[] = [];
  if (held.has('ba.dashboard.view') || held.has('ba.leaderboard.view') || held.has('ba.scores.view')) out.push('ba');
  if (held.has('cc.schedule.view') || held.has('cc.adherence.view')) out.push('reps');
  return out;
}
