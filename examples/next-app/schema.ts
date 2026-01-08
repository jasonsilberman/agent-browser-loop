import { z } from "zod";

export const schema = z.object({
  user: z.string().optional(),
  activeRuns: z.number().optional(),
  queuedChecks: z.number().optional(),
  signalStatus: z.string().optional(),
});

// Task Management Schemas
export const taskPrioritySchema = z.enum(["low", "medium", "high"]);
export const taskStatusSchema = z.enum(["pending", "completed"]);

export const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1, "Title is required").max(100, "Title too long"),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  createdAt: z.string(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title too long"),
  priority: taskPrioritySchema,
});

export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
