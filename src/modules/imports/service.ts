import { z } from 'zod';
import type { Database } from '@/db/client';
import { leadImports, type ImportCounts } from '@/db/schema';
import { Errors } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { captureLead, type CaptureOutcome } from '@/modules/leads/capture';
import { actorUserId, type Actor } from '@/modules/leads/history';
import { emailField, phoneField } from '@/modules/leads/schemas';
import { parseCsv } from './csv';

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2_000_000;

/** Accepted CSV headers (case-insensitive, spaces/dashes treated as underscores). */
const COLUMN_ALIASES: Record<string, ImportField> = {
  name: 'fullName',
  full_name: 'fullName',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  phone_number: 'phone',
  mobile: 'phone',
  country: 'country',
  source: 'source',
  utm_source: 'source',
  medium: 'medium',
  utm_medium: 'medium',
  campaign: 'campaign',
  utm_campaign: 'campaign',
  experience: 'experienceLevel',
  experience_level: 'experienceLevel',
  markets: 'marketsOfInterest',
  markets_of_interest: 'marketsOfInterest',
  marketing_email_consent: 'marketingEmailConsent',
};

type ImportField =
  | 'fullName'
  | 'email'
  | 'phone'
  | 'country'
  | 'source'
  | 'medium'
  | 'campaign'
  | 'experienceLevel'
  | 'marketsOfInterest'
  | 'marketingEmailConsent';

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const importRow = z
  .object({
    fullName: optional(z.string().trim().max(200)),
    email: optional(emailField),
    phone: optional(phoneField),
    country: optional(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter ISO country code')
        .transform((v) => v.toUpperCase()),
    ),
    source: optional(z.string().trim().max(100)),
    medium: optional(z.string().trim().max(100)),
    campaign: optional(z.string().trim().max(200)),
    experienceLevel: optional(
      z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.enum(['beginner', 'intermediate', 'experienced'])),
    ),
    marketsOfInterest: optional(
      z
        .string()
        .transform((v) =>
          v
            .split(';')
            .map((m) => m.trim())
            .filter(Boolean),
        )
        .pipe(z.array(z.string().max(100)).max(20)),
    ),
    marketingEmailConsent: optional(
      z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.enum(['yes', 'no', 'true', 'false', '1', '0']))
        .transform((v) => ['yes', 'true', '1'].includes(v)),
    ),
  })
  .refine((row) => row.email || row.phone, { message: 'Each row needs an email or a phone' });

export interface ImportRowResult {
  row: number;
  outcome: CaptureOutcome | 'error';
  leadId?: string;
  errors?: { field: string; message: string }[];
}

export interface ImportResult {
  dryRun: boolean;
  importId?: string;
  counts: ImportCounts;
  unknownColumns: string[];
  rows: ImportRowResult[];
}

class DryRunRollback extends Error {
  constructor(readonly result: ImportResult) {
    super('dry run');
  }
}

function mapHeader(header: string[]) {
  const columns: (ImportField | null)[] = [];
  const unknownColumns: string[] = [];
  for (const raw of header) {
    const key = raw
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const field = COLUMN_ALIASES[key] ?? null;
    if (!field && raw.trim()) unknownColumns.push(raw.trim());
    columns.push(field);
  }
  if (!columns.includes('email') && !columns.includes('phone')) {
    throw Errors.validation('The CSV needs an "email" or "phone" column');
  }
  return { columns, unknownColumns };
}

/**
 * Import leads from CSV. Each row goes through the same capture path as the web form
 * (deduplication by email/phone, fill-only updates, suppression list).
 *
 * A dry run executes the exact same work inside a transaction that is rolled back, so the preview
 * always matches what a real import would do.
 */
export async function runImport(
  db: Database,
  organizationId: string,
  input: { csv: string; fileName?: string | null; dryRun: boolean },
  actor: Actor,
): Promise<ImportResult> {
  let table: string[][];
  try {
    table = parseCsv(input.csv);
  } catch (error) {
    throw Errors.validation(`Could not read the CSV: ${(error as Error).message}`);
  }
  const [header, ...dataRows] = table;
  if (!header || dataRows.length === 0) throw Errors.validation('The CSV has no data rows');
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw Errors.validation(`The CSV has more than ${MAX_IMPORT_ROWS} rows; split it up`);
  }
  const { columns, unknownColumns } = mapHeader(header);

  const run = async (): Promise<ImportResult> => {
    return db.transaction(async (tx) => {
      const rows: ImportRowResult[] = [];
      const counts: ImportCounts = {
        rows: dataRows.length,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      };

      for (const [index, cells] of dataRows.entries()) {
        const rowNumber = index + 2; // 1-based, after the header line
        const record: Record<string, string> = {};
        columns.forEach((field, i) => {
          if (field) record[field] = cells[i] ?? '';
        });
        const parsed = importRow.safeParse(record);
        if (!parsed.success) {
          counts.errors++;
          rows.push({
            row: rowNumber,
            outcome: 'error',
            errors: parsed.error.issues.map((issue) => ({
              field: issue.path.join('.') || 'row',
              message: issue.message,
            })),
          });
          continue;
        }
        const data = parsed.data;
        try {
          // Savepoint per row: one bad row cannot abort the whole import.
          const result = await tx.transaction((rowTx) =>
            captureLead(rowTx, {
              organizationId,
              channel: 'import',
              contact: {
                fullName: data.fullName,
                email: data.email,
                phone: data.phone,
                country: data.country,
              },
              qualification: {
                ...(data.experienceLevel ? { experienceLevel: data.experienceLevel } : {}),
                ...(data.marketsOfInterest ? { marketsOfInterest: data.marketsOfInterest } : {}),
              },
              attribution: { source: data.source, medium: data.medium, campaign: data.campaign },
              consents: data.marketingEmailConsent
                ? [{ channel: 'email', purpose: 'marketing' }]
                : [],
              consentEvidence: {
                method: 'csv_import',
                fileName: input.fileName ?? null,
                importedByUserId: actorUserId(actor),
              },
              actor,
            }),
          );
          if (result.outcome === 'created') counts.created++;
          else if (result.outcome === 'updated') counts.updated++;
          else counts.skipped++;
          rows.push({ row: rowNumber, outcome: result.outcome, leadId: result.leadId });
        } catch (error) {
          counts.errors++;
          rows.push({
            row: rowNumber,
            outcome: 'error',
            errors: [{ field: 'row', message: (error as Error).message.slice(0, 200) }],
          });
        }
      }

      const result: ImportResult = { dryRun: input.dryRun, counts, unknownColumns, rows };
      if (input.dryRun) throw new DryRunRollback(result);

      const [record] = await tx
        .insert(leadImports)
        .values({
          organizationId,
          createdByUserId: actorUserId(actor),
          fileName: input.fileName ?? null,
          counts,
        })
        .returning({ id: leadImports.id });
      await recordAudit(tx, {
        organizationId,
        actorType: actor.type === 'user' ? 'user' : 'system',
        actorUserId: actorUserId(actor),
        action: 'leads.imported',
        entityType: 'lead_import',
        entityId: record?.id ?? null,
        metadata: { ...counts },
        requestId: actor.requestId ?? null,
      });
      return { ...result, importId: record?.id };
    });
  };

  try {
    return await run();
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}
