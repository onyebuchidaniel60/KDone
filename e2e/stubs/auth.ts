/**
 * Test stub for `@/auth`.
 *
 * The HTTP E2E suite drives identity through the `x-kdone-user-id` harness, so
 * it never needs a real Auth.js session. Stubbing `@/auth` keeps `next-auth`
 * (and therefore `next/server`) out of the plain vitest module graph.
 */
export const auth = async (): Promise<null> => null;
export const handlers = { GET: () => new Response(null), POST: () => new Response(null) };
export const signIn = async (): Promise<null> => null;
export const signOut = async (): Promise<null> => null;
export const isDevLoginEnabled = false;
