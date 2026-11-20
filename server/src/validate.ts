import { z } from 'zod';
import { HttpError } from './errors.js';

/** Parse untrusted input; throws 422 validation_failed with the first issue's message. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(422, 'validation_failed', `${where}${issue?.message ?? 'Invalid input.'}`);
  }
  return result.data;
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
export const idParam = z.coerce.number().int().positive();
export { z };
