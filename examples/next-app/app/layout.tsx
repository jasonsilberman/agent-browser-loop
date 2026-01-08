import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Task Control System",
  description: "Industrial task management dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <h1>TASK-CTRL-01</h1>
            <div className="topbar-status">
              <span className="status-dot">SYSTEM</span>
              <span className="timestamp" suppressHydrationWarning>
                {new Date().toISOString().replace("T", " ").slice(0, 19)} UTC
              </span>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
