"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { Task, TaskPriority } from "../schema";
import {
  createTaskAction,
  deleteTaskAction,
  getTasksAction,
  type TaskActionState,
  toggleTaskAction,
} from "./task-actions";

const initialState: TaskActionState = {
  ok: false,
  message: "",
};

type TaskManagerProps = {
  userId: string;
};

export default function TaskManager({ userId }: TaskManagerProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [formState, formAction, formPending] = useActionState(
    createTaskAction,
    initialState,
  );

  useEffect(() => {
    getTasksAction(userId).then((data) => {
      setTasks(data);
      setLoading(false);
    });
  }, [userId]);

  useEffect(() => {
    if (formState.ok && formState.tasks) {
      setTasks(formState.tasks);
    }
  }, [formState]);

  const handleToggle = (id: string) => {
    startTransition(async () => {
      const result = await toggleTaskAction(userId, id);
      if (result.tasks) {
        setTasks(result.tasks);
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteTaskAction(userId, id);
      if (result.tasks) {
        setTasks(result.tasks);
      }
    });
  };

  const priorityLabels: Record<TaskPriority, string> = {
    low: "LOW",
    medium: "MED",
    high: "HIGH",
  };

  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const completedTasks = tasks.filter((t) => t.status === "completed");

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>TASK QUEUE</h2>
        <span className="badge">{pendingTasks.length} PENDING</span>
      </div>

      <form action={formAction} className="task-form">
        <input type="hidden" name="userId" value={userId} />
        <div className="task-form-row">
          <input
            name="title"
            type="text"
            placeholder="New task..."
            required
            data-testid="task-title-input"
            className="task-input"
          />
          <select
            name="priority"
            defaultValue="medium"
            data-testid="task-priority-select"
            className="task-select"
          >
            <option value="low">LOW</option>
            <option value="medium">MEDIUM</option>
            <option value="high">HIGH</option>
          </select>
          <button
            type="submit"
            disabled={formPending}
            data-testid="add-task-button"
            className="btn-primary"
          >
            {formPending ? "..." : "ADD"}
          </button>
        </div>
        {formState.message && !formState.ok && (
          <p className="form-error">{formState.message}</p>
        )}
      </form>

      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        <div className="task-lists">
          <div className="task-section">
            <h3>
              PENDING <span className="count">{pendingTasks.length}</span>
            </h3>
            {pendingTasks.length === 0 ? (
              <p className="empty">No pending tasks</p>
            ) : (
              <ul className="task-list" data-testid="pending-tasks">
                {pendingTasks.map((task) => (
                  <li
                    key={task.id}
                    className="task-item"
                    data-testid={`task-${task.id}`}
                  >
                    <button
                      type="button"
                      className="task-checkbox"
                      onClick={() => handleToggle(task.id)}
                      disabled={isPending}
                      aria-label="Mark complete"
                      data-testid={`toggle-${task.id}`}
                    />
                    <span className="task-title">{task.title}</span>
                    <span className={`priority priority-${task.priority}`}>
                      {priorityLabels[task.priority]}
                    </span>
                    <button
                      type="button"
                      className="task-delete"
                      onClick={() => handleDelete(task.id)}
                      disabled={isPending}
                      aria-label="Delete task"
                      data-testid={`delete-${task.id}`}
                    >
                      X
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="task-section">
            <h3>
              COMPLETED <span className="count">{completedTasks.length}</span>
            </h3>
            {completedTasks.length === 0 ? (
              <p className="empty">No completed tasks</p>
            ) : (
              <ul className="task-list" data-testid="completed-tasks">
                {completedTasks.map((task) => (
                  <li
                    key={task.id}
                    className="task-item completed"
                    data-testid={`task-${task.id}`}
                  >
                    <button
                      type="button"
                      className="task-checkbox checked"
                      onClick={() => handleToggle(task.id)}
                      disabled={isPending}
                      aria-label="Mark incomplete"
                      data-testid={`toggle-${task.id}`}
                    />
                    <span className="task-title">{task.title}</span>
                    <span className={`priority priority-${task.priority}`}>
                      {priorityLabels[task.priority]}
                    </span>
                    <button
                      type="button"
                      className="task-delete"
                      onClick={() => handleDelete(task.id)}
                      disabled={isPending}
                      aria-label="Delete task"
                      data-testid={`delete-${task.id}`}
                    >
                      X
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
