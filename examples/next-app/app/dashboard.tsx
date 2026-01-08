"use client";

import { useCallback, useEffect, useState } from "react";
import type { GlobalStats } from "../lib/tasks";
import LoginForm from "./login-form";
import { getGlobalStatsAction } from "./task-actions";
import TaskManager from "./task-manager";

export default function Dashboard() {
  const [user, setUser] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [stats, setStats] = useState<GlobalStats | null>(null);

  const loadStats = useCallback(async () => {
    const data = await getGlobalStatsAction();
    setStats(data);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("abl_user");
    if (stored) {
      setUser(stored);
    }
    setHydrated(true);
    loadStats();
  }, [loadStats]);

  const handleLogin = (username: string) => {
    localStorage.setItem("abl_user", username);
    setUser(username);
    loadStats();
  };

  const handleLogout = () => {
    localStorage.removeItem("abl_user");
    setUser(null);
    loadStats();
  };

  if (!hydrated) {
    return (
      <div className="loading">
        <span>INITIALIZING...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <main className="main-grid">
        <div className="left-col">
          <LoginForm onLogin={handleLogin} />
        </div>
        <div className="right-col">
          <section className="panel">
            <div className="panel-header">
              <h2>SYSTEM STATS</h2>
              <span className="status-indicator online">LIVE</span>
            </div>
            {stats ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">USERS</span>
                  <span className="stat-value cyan">{stats.totalUsers}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">TOTAL TASKS</span>
                  <span className="stat-value">{stats.totalTasks}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">PENDING</span>
                  <span className="stat-value yellow">
                    {stats.pendingTasks}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">COMPLETED</span>
                  <span className="stat-value green">
                    {stats.completedTasks}
                  </span>
                </div>
              </div>
            ) : (
              <p className="muted">Loading stats...</p>
            )}
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>PRIORITY BREAKDOWN</h2>
            </div>
            {stats ? (
              <div className="priority-bars">
                <div className="priority-row">
                  <span className="priority-label high">HIGH</span>
                  <div className="bar-container">
                    <div
                      className="bar high"
                      style={{
                        width: `${stats.totalTasks ? (stats.highPriority / stats.totalTasks) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="priority-count">{stats.highPriority}</span>
                </div>
                <div className="priority-row">
                  <span className="priority-label medium">MED</span>
                  <div className="bar-container">
                    <div
                      className="bar medium"
                      style={{
                        width: `${stats.totalTasks ? (stats.mediumPriority / stats.totalTasks) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="priority-count">{stats.mediumPriority}</span>
                </div>
                <div className="priority-row">
                  <span className="priority-label low">LOW</span>
                  <div className="bar-container">
                    <div
                      className="bar low"
                      style={{
                        width: `${stats.totalTasks ? (stats.lowPriority / stats.totalTasks) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="priority-count">{stats.lowPriority}</span>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="main-grid">
      <div className="left-col">
        <section className="panel user-panel">
          <div className="panel-header">
            <h2>OPERATOR</h2>
            <span className="status-indicator online">ACTIVE</span>
          </div>
          <div className="user-info">
            <span className="user-name">{user}</span>
            <button type="button" onClick={handleLogout} className="btn-ghost">
              LOGOUT
            </button>
          </div>
        </section>
        <TaskManager userId={user} />
      </div>
      <div className="right-col">
        <section className="panel">
          <div className="panel-header">
            <h2>GLOBAL METRICS</h2>
            <span className="status-indicator online">LIVE</span>
          </div>
          {stats ? (
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">USERS</span>
                <span className="stat-value cyan">{stats.totalUsers}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">TOTAL TASKS</span>
                <span className="stat-value">{stats.totalTasks}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">PENDING</span>
                <span className="stat-value yellow">{stats.pendingTasks}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">COMPLETED</span>
                <span className="stat-value green">{stats.completedTasks}</span>
              </div>
            </div>
          ) : (
            <p className="muted">Loading...</p>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>PRIORITY BREAKDOWN</h2>
          </div>
          {stats ? (
            <div className="priority-bars">
              <div className="priority-row">
                <span className="priority-label high">HIGH</span>
                <div className="bar-container">
                  <div
                    className="bar high"
                    style={{
                      width: `${stats.totalTasks ? (stats.highPriority / stats.totalTasks) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="priority-count">{stats.highPriority}</span>
              </div>
              <div className="priority-row">
                <span className="priority-label medium">MED</span>
                <div className="bar-container">
                  <div
                    className="bar medium"
                    style={{
                      width: `${stats.totalTasks ? (stats.mediumPriority / stats.totalTasks) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="priority-count">{stats.mediumPriority}</span>
              </div>
              <div className="priority-row">
                <span className="priority-label low">LOW</span>
                <div className="bar-container">
                  <div
                    className="bar low"
                    style={{
                      width: `${stats.totalTasks ? (stats.lowPriority / stats.totalTasks) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="priority-count">{stats.lowPriority}</span>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
