import { z } from 'zod';

export const validateContract = <T>(schema: z.ZodSchema<T>, data: any) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Contract Validation Failed: ${errors}`);
  }
  return result.data;
};

export const APIResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
  message: z.string().optional(),
});

export const APIErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    message: z.string(),
    details: z.any().optional(),
  }),
});
