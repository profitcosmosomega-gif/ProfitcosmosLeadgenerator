import { z } from 'zod';
import { getDb } from '@/db/client';
import { authedApiHandler, json, parseJson, userActor } from '@/lib/api';
import { MAX_IMPORT_BYTES, runImport } from '@/modules/imports/service';

export const dynamic = 'force-dynamic';

const importInput = z
  .object({
    csv: z.string().min(1).max(MAX_IMPORT_BYTES),
    fileName: z.string().trim().max(200).nullable().optional(),
    dryRun: z.boolean().default(true),
  })
  .strict();

/** Import leads from CSV. Defaults to a dry run; send `dryRun: false` to commit. Admin and owner. */
export const POST = authedApiHandler('admin', async (req, ctx) => {
  const input = await parseJson(req, importInput);
  const result = await runImport(getDb(), ctx.user.organizationId, input, userActor(ctx));
  return json(result, { status: input.dryRun ? 200 : 201 });
});
