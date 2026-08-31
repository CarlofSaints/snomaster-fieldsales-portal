import { loadUsers, User, Role } from './userData';
import { isActive } from './accountStatus';

/**
 * The caller's user record WITHOUT the active check.
 * Only for the two places that must tell "deactivated" apart from "not signed
 * in" so they can explain themselves — everything else wants requireLogin.
 */
export async function findRequestUser(req: Request): Promise<User | null> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return null;
  const users = await loadUsers();
  return users.find(u => u.id === userId) ?? null;
}

export async function requireLogin(req: Request): Promise<User | null> {
  const user = await findRequestUser(req);
  // A deactivated account counts as signed out everywhere. This is what makes
  // an already-open tab stop working the moment the flag is set, rather than
  // only at the next login.
  return isActive(user) ? user : null;
}

export async function requireRole(req: Request, roles: Role[]): Promise<User | null> {
  const user = await requireLogin(req);
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

export async function requireAnyUser(req: Request): Promise<User | null> {
  return requireLogin(req);
}

export function noCacheHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  };
}
