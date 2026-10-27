import { z } from "zod";
export const retryPolicySchema = z
  .object({
    totalSeconds: z.number().int().min(30).max(1800),
    attemptSeconds: z.number().int().min(15).max(600),
    automaticRetries: z.number().int().min(0).max(3),
  })
  .refine((v) => v.attemptSeconds <= v.totalSeconds, {
    message: "单次等待不能超过每项总时限",
  });
export type RetryPolicy = z.infer<typeof retryPolicySchema>;
export const defaultRetryPolicy: RetryPolicy = {
  totalSeconds: 300,
  attemptSeconds: 120,
  automaticRetries: 1,
};
