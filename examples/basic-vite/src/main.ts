import "./style.css";

// Types
type Priority = "low" | "medium" | "high";
type Task = {
  id: string;
  title: string;
  priority: Priority;
  completed: boolean;
  createdAt: string;
};

// Storage keys
const USER_KEY = "vite_user";
const TASKS_KEY = "vite_tasks";

// DOM Elements
const clock = document.getElementById("clock")!;
const loginPanel = document.getElementById("login-panel")!;
const userPanel = document.getElementById("user-panel")!;
const taskPanel = document.getElementById("task-panel")!;
const loginForm = document.getElementById("login-form") as HTMLFormElement;
const loginError = document.getElementById("login-error")!;
const userName = document.getElementById("user-name")!;
const logoutBtn = document.getElementById("logout-btn")!;
const taskForm = document.getElementById("task-form") as HTMLFormElement;
const taskInput = document.getElementById("task-input") as HTMLInputElement;
const taskPriority = document.getElementById(
  "task-priority",
) as HTMLSelectElement;
const pendingList = document.getElementById("pending-list")!;
const completedList = document.getElementById("completed-list")!;
const pendingEmpty = document.getElementById("pending-empty")!;
const completedEmpty = document.getElementById("completed-empty")!;
const pendingCount = document.getElementById("pending-count")!;
const completedCount = document.getElementById("completed-count")!;
const pendingBadge = document.getElementById("pending-badge")!;
const activityLog = document.getElementById("activity-log")!;

// Stats elements
const statTotal = document.getElementById("stat-total")!;
const statPending = document.getElementById("stat-pending")!;
const statCompleted = document.getElementById("stat-completed")!;
const statRate = document.getElementById("stat-rate")!;
const barHigh = document.getElementById("bar-high")!;
const barMedium = document.getElementById("bar-medium")!;
const barLow = document.getElementById("bar-low")!;
const countHigh = document.getElementById("count-high")!;
const countMedium = document.getElementById("count-medium")!;
const countLow = document.getElementById("count-low")!;

// State
let currentUser: string | null = null;
let tasks: Task[] = [];

// Helpers
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function formatTime(): string {
  return `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function log(message: string): void {
  const li = document.createElement("li");
  li.textContent = `[${formatTime().slice(11, 19)}] ${message}`;
  activityLog.insertBefore(li, activityLog.firstChild);
  // Keep only last 20 entries
  while (activityLog.children.length > 20) {
    activityLog.removeChild(activityLog.lastChild!);
  }
}

// Storage
function loadUser(): string | null {
  return localStorage.getItem(USER_KEY);
}

function saveUser(user: string): void {
  localStorage.setItem(USER_KEY, user);
}

function clearUser(): void {
  localStorage.removeItem(USER_KEY);
}

function loadTasks(): Task[] {
  const data = localStorage.getItem(TASKS_KEY);
  return data ? JSON.parse(data) : [];
}

function saveTasks(): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

// UI Updates
function updateClock(): void {
  clock.textContent = formatTime();
}

function updateAuthUI(): void {
  if (currentUser) {
    loginPanel.hidden = true;
    userPanel.hidden = false;
    taskPanel.hidden = false;
    userName.textContent = currentUser;
  } else {
    loginPanel.hidden = false;
    userPanel.hidden = true;
    taskPanel.hidden = true;
  }
}

function updateStats(): void {
  const total = tasks.length;
  const pending = tasks.filter((t) => !t.completed).length;
  const completed = tasks.filter((t) => t.completed).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const high = tasks.filter((t) => t.priority === "high").length;
  const medium = tasks.filter((t) => t.priority === "medium").length;
  const low = tasks.filter((t) => t.priority === "low").length;

  statTotal.textContent = String(total);
  statPending.textContent = String(pending);
  statCompleted.textContent = String(completed);
  statRate.innerHTML = `${rate}<span class="stat-unit">%</span>`;

  pendingBadge.textContent = `${pending} PENDING`;

  // Priority bars
  const maxCount = Math.max(high, medium, low, 1);
  barHigh.style.width = `${(high / maxCount) * 100}%`;
  barMedium.style.width = `${(medium / maxCount) * 100}%`;
  barLow.style.width = `${(low / maxCount) * 100}%`;
  countHigh.textContent = String(high);
  countMedium.textContent = String(medium);
  countLow.textContent = String(low);
}

function createTaskElement(task: Task): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `task-item${task.completed ? " completed" : ""}`;
  li.dataset.id = task.id;

  const checkbox = document.createElement("button");
  checkbox.type = "button";
  checkbox.className = `task-checkbox${task.completed ? " checked" : ""}`;
  checkbox.setAttribute(
    "aria-label",
    task.completed ? "Mark incomplete" : "Mark complete",
  );
  checkbox.addEventListener("click", () => toggleTask(task.id));

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;

  const priority = document.createElement("span");
  priority.className = `priority priority-${task.priority}`;
  priority.textContent = task.priority.toUpperCase();

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "task-delete";
  deleteBtn.textContent = "X";
  deleteBtn.setAttribute("aria-label", "Delete task");
  deleteBtn.addEventListener("click", () => deleteTask(task.id));

  li.appendChild(checkbox);
  li.appendChild(title);
  li.appendChild(priority);
  li.appendChild(deleteBtn);

  return li;
}

function renderTasks(): void {
  const pending = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  pendingList.innerHTML = "";
  completedList.innerHTML = "";

  pending.forEach((task) => {
    pendingList.appendChild(createTaskElement(task));
  });

  completed.forEach((task) => {
    completedList.appendChild(createTaskElement(task));
  });

  pendingCount.textContent = String(pending.length);
  completedCount.textContent = String(completed.length);
  pendingEmpty.hidden = pending.length > 0;
  completedEmpty.hidden = completed.length > 0;

  updateStats();
}

// Actions
function login(email: string, password: string): boolean {
  if (password !== "demo") {
    loginError.textContent = "Invalid password. Use: demo";
    log("Login failed: invalid password");
    return false;
  }

  const user = email.split("@")[0] || "operator";
  currentUser = user;
  saveUser(user);
  loginError.textContent = "";
  log(`Operator ${user} logged in`);
  updateAuthUI();
  return true;
}

function logout(): void {
  const user = currentUser;
  currentUser = null;
  clearUser();
  log(`Operator ${user} logged out`);
  updateAuthUI();
}

function addTask(title: string, priority: Priority): void {
  const task: Task = {
    id: generateId(),
    title,
    priority,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  saveTasks();
  renderTasks();
  log(`Task added: ${title}`);
}

function toggleTask(id: string): void {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks();
    renderTasks();
    log(`Task ${task.completed ? "completed" : "reopened"}: ${task.title}`);
  }
}

function deleteTask(id: string): void {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    tasks = tasks.filter((t) => t.id !== id);
    saveTasks();
    renderTasks();
    log(`Task deleted: ${task.title}`);
  }
}

// Event Listeners
loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();
  if (login(email, password)) {
    loginForm.reset();
  }
});

logoutBtn.addEventListener("click", logout);

taskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = taskInput.value.trim();
  const priority = taskPriority.value as Priority;
  if (title) {
    addTask(title, priority);
    taskInput.value = "";
    taskPriority.value = "medium";
  }
});

// Initialize
function init(): void {
  updateClock();
  setInterval(updateClock, 1000);

  currentUser = loadUser();
  tasks = loadTasks();

  updateAuthUI();
  renderTasks();

  if (currentUser) {
    log(`Session restored for ${currentUser}`);
  }
}

init();
