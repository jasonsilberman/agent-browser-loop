import { z } from "zod";

export const schema = z.object({
  user: z.string().optional(),
  queuedChecks: z.number().optional(),
  activeMonitors: z.number().optional(),
  tasks: z.array(z.string()).default([]),
});
