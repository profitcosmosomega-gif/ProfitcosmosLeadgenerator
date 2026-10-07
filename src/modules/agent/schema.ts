import { z } from 'zod';

/** JSON Schema for a tool input, generated from its Zod schema (the single source of truth). */
export function toolInputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  return json;
}
