import { authedApiHandler, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** The signed-in staff user. Any role. */
export const GET = authedApiHandler('viewer', async (_req, { user }) => json(user));
