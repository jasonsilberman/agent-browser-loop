"use server";

import { revalidatePath } from "next/cache";
import {
  addTask,
  deleteTask,
  type GlobalStats,
  getGlobalStats,
  getTasks,
  toggleTask,
} from "../lib/tasks";
import { createTaskSchema, type Task, type TaskPriority } from "../schema";

export type TaskActionState = {
  ok: boolean;
  message: string;
  tasks?: Task[];
};

export async function getTasksAction(userId: string): Promise<Task[]> {
  return getTasks(userId);
}

export async function getGlobalStatsAction(): Promise<GlobalStats> {
  return getGlobalStats();
}

export async function createTaskAction(
  _prevState: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium") as TaskPriority;
  const userId = String(formData.get("userId") ?? "").trim();

  if (!userId) {
    return { ok: false, message: "User not logged in" };
  }

  const result = createTaskSchema.safeParse({ title, priority });
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const newTask: Task = {
    id: crypto.randomUUID(),
    title: result.data.title,
    priority: result.data.priority,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  const tasks = addTask(userId, newTask);
  revalidatePath("/");

  return {
    ok: true,
    message: "Task created successfully",
    tasks,
  };
}

export async function toggleTaskAction(
  userId: string,
  id: string,
): Promise<TaskActionState> {
  const tasks = toggleTask(userId, id);
  revalidatePath("/");

  return {
    ok: true,
    message: "Task toggled",
    tasks,
  };
}

export async function deleteTaskAction(
  userId: string,
  id: string,
): Promise<TaskActionState> {
  const tasks = deleteTask(userId, id);
  revalidatePath("/");

  return {
    ok: true,
    message: "Task deleted",
    tasks,
  };
}
