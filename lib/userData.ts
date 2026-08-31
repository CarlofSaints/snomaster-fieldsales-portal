import { readJson, writeJson } from './blob';

/**
 * A role name. Deliberately a plain string rather than a union: roles are data
 * (see `config/roles.json`) and admins create their own on /roles, so the code
 * must not assume it knows the full list. The built-ins below are the ones the
 * app ships with and special-cases.
 */
export type Role = string;

export const BUILT_IN_ROLES = ['super_admin', 'md', 'admin', 'marketing', 'sales', 'client'] as const;

/** The only role that is hard-wired: it always holds every permission. */
export const SUPER_ADMIN: Role = 'super_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  surname: string;
  cellNumber?: string;
  passwordHash: string;
  role: Role;
  /**
   * Can this account sign in? Absent means yes — see lib/accountStatus.ts.
   * Deactivating leaves every other field, and all of the user's data, intact.
   */
  active?: boolean;
  /**
   * Show the sign-off notice to this user while they are still working.
   * Independent of `active` on purpose: this is the warning that goes out
   * BEFORE access is withdrawn, so it must reach someone who can still log in.
   * A deactivated user is told the same thing at the login screen instead.
   */
  signOffNotice?: boolean;
  forcePasswordChange: boolean;
  createdAt: string;
  resetToken?: string;
  resetTokenExpiry?: string;
}

const BLOB_KEY = 'users.json';

export async function loadUsers(): Promise<User[]> {
  return readJson<User[]>(BLOB_KEY, []);
}

export async function saveUsers(users: User[]): Promise<void> {
  await writeJson(BLOB_KEY, users);
}
