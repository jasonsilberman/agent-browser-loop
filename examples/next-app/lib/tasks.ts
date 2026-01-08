import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Task, TaskStatus } from "../schema";

const TASKS_FILE = join(process.cwd(), "data", "tasks.json");

type TasksStore = Record<string, Task[]>;

function ensureDataDir() {
  const dataDir = join(process.cwd(), "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function getAllTasksStore(): TasksStore {
  ensureDataDir();
  if (!existsSync(TASKS_FILE)) {
    return {};
  }
  try {
    const data = readFileSync(TASKS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveAllTasks(store: TasksStore): void {
  ensureDataDir();
  writeFileSync(TASKS_FILE, JSON.stringify(store, null, 2));
}

export function getTasks(userId: string): Task[] {
  const store = getAllTasksStore();
  return store[userId] || [];
}

export function saveTasks(userId: string, tasks: Task[]): void {
  const store = getAllTasksStore();
  store[userId] = tasks;
  saveAllTasks(store);
}

export function addTask(userId: string, task: Task): Task[] {
  const tasks = getTasks(userId);
  tasks.push(task);
  saveTasks(userId, tasks);
  return tasks;
}

export function deleteTask(userId: string, id: string): Task[] {
  const tasks = getTasks(userId).filter((t) => t.id !== id);
  saveTasks(userId, tasks);
  return tasks;
}

export function toggleTask(userId: string, id: string): Task[] {
  const tasks = getTasks(userId).map((t): Task => {
    if (t.id === id) {
      const newStatus: TaskStatus =
        t.status === "completed" ? "pending" : "completed";
      return { ...t, status: newStatus };
    }
    return t;
  });
  saveTasks(userId, tasks);
  return tasks;
}

export type GlobalStats = {
  totalUsers: number;
  totalTasks: number;
  pendingTasks: number;
  completedTasks: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
};

export function getGlobalStats(): GlobalStats {
  const store = getAllTasksStore();
  const users = Object.keys(store);
  const allTasks = users.flatMap((u) => store[u]);

  return {
    totalUsers: users.length,
    totalTasks: allTasks.length,
    pendingTasks: allTasks.filter((t) => t.status === "pending").length,
    completedTasks: allTasks.filter((t) => t.status === "completed").length,
    highPriority: allTasks.filter((t) => t.priority === "high").length,
    mediumPriority: allTasks.filter((t) => t.priority === "medium").length,
    lowPriority: allTasks.filter((t) => t.priority === "low").length,
  };
}
