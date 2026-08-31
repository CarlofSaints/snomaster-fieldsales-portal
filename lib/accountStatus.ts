/**
 * Account activation.
 *
 * Deactivating a user changes NOTHING about their data. Their role, scores,
 * visits, training, call cycles and store assignments all stay exactly where
 * they are. The single effect is that they can no longer get in: login is
 * refused, and any session already open dies on its next request.
 *
 * `active` is optional because every user created before this flag existed has
 * no such field. ABSENT MEANS ACTIVE, so the test is `!== false` and never
 * `=== true` — inverting it would lock out the whole existing user base.
 *
 * Kept in its own module, importing nothing, so the login page can show the
 * same sentence the API sends without pulling Blob storage into the client.
 */

/** Shown to a user who is refused entry because their account is deactivated. */
export const INACTIVE_MESSAGE =
  'This project did not receive financial sign-off and will be unavailable until sign-off is granted.';

export function isActive(user: { active?: boolean } | null | undefined): boolean {
  return !!user && user.active !== false;
}
