<p align="center">
  <img src="readme-header.png" alt="Agent Browser Loop" width="100%" />
</p>

# Agent Browser Loop

**Let your coding agent verify its own work.**

AI coding agents can write code, run type checks, even execute unit tests - but they can't click through the app like a user would. They get stuck waiting for humans to manually verify "does the button work? does the form submit? does the error message appear?"

Agent Browser Loop gives agents a browser they can drive. Write code, navigate to the page, fill the form, click submit, check the browser logs, take a screenshot, see the error, fix it, retry - all without human intervention.

This doesn't eliminate human review - but it lets agents verify and unblock themselves instead of stopping at every turn. **Engineers can give agents a longer leash, and agents can build features end-to-end while proving they actually work.**

---

## Install

Requires [Bun](https://bun.sh).

```bash
bun install -g agent-browser-loop
agent-browser setup
```

This installs the CLI globally, downloads Playwright Chromium, and copies skill files to `.claude/skills/` so Claude, OpenCode, and other AI agents know how to use the browser.

## Quick Start

```bash
agent-browser open http://localhost:3000 --headed
agent-browser act click:button_0 type:input_0:"hello"
agent-browser wait --text "Success"
agent-browser state
agent-browser close
```

The `--headed` flag shows the browser. Omit for headless mode.

## How Agents Use It

The agent works in a loop: **open -> act -> wait/verify -> repeat**

```bash
# 1. Open the app
agent-browser open http://localhost:3000/login

# 2. Fill form and submit
agent-browser act type:input_0:user@example.com type:input_1:password123 click:button_0

# 3. Wait for navigation
agent-browser wait --text "Welcome back"

# 4. Verify state
agent-browser state
```

Every command returns the current page state - interactive elements, form values, scroll position, console errors, network failures. The agent sees exactly what it needs to verify the code works or debug why it doesn't.

## CLI Reference

| Command | Description |
|---------|-------------|
| `open <url>` | Open URL (starts daemon if needed) |
| `act <actions...>` | Execute actions |
| `wait` | Wait for condition |
| `state` | Get current page state |
| `screenshot` | Capture screenshot |
| `sessions` | List all active sessions |
| `close` | Close session or daemon |
| `setup` | Install browser + skill files |

### Actions

```bash
agent-browser act click:button_0           # Click element
agent-browser act type:input_0:hello       # Type text
agent-browser act press:Enter              # Press key
agent-browser act scroll:down:500          # Scroll
agent-browser act navigate:http://...      # Navigate
```

Multiple actions: `agent-browser act click:input_0 type:input_0:hello press:Enter`

### Wait Conditions

```bash
agent-browser wait --text "Welcome"        # Text appears
agent-browser wait --selector "#success"   # Element exists
agent-browser wait --url "/dashboard"      # URL matches
agent-browser wait --not-text "Loading"    # Text disappears
agent-browser wait --timeout 60000         # Custom timeout
```

### Options

```bash
--headed              # Show browser window
--new                 # Create new session with auto-generated ID
--session <id>        # Target specific session (from --new)
--json                # JSON output
--no-state            # Skip state in response
```

## Multi-Session

Run multiple browser sessions in parallel:

```bash
# Create sessions with auto-generated IDs
agent-browser open --new http://localhost:3000     # Output: Session: swift-fox
agent-browser open --new http://localhost:3000     # Output: Session: calm-river

# Target specific sessions
agent-browser act -s swift-fox click:button_0
agent-browser state -s calm-river

# List all sessions
agent-browser sessions
```

## State Output

```
URL: http://localhost:3000/login
Title: Login
Scroll: 0px above, 500px below

Interactive Elements:
  [0] ref=input_0 textbox "Email" (placeholder="Enter email")
  [1] ref=input_1 textbox "Password" (type="password")
  [2] ref=button_0 button "Sign In"

Errors:
Console: [error] Failed to load resource: 404
Network: 404 GET /api/user
```

Use `ref` values in actions: `click:button_0`, `type:input_0:hello`

## Screenshots

```bash
agent-browser screenshot -o screenshot.png       # Save to file
agent-browser screenshot --full-page -o full.png # Full scrollable page
agent-browser screenshot                         # Output base64
```

Useful for visual debugging when text state isn't enough to diagnose issues.

## HTTP Server Mode

For multi-session scenarios or HTTP integrations:

```bash
agent-browser server --headed
# Runs at http://localhost:3790
# API spec at GET /openapi.json
```

## Configuration

CLI flags or config file (`agent.browser.config.ts`):

```ts
import { defineBrowserConfig } from "agent-browser-loop";

export default defineBrowserConfig({
  headless: false,
  viewportWidth: 1440,
  viewportHeight: 900,
});
```

## What This Is NOT For

This tool is for agents to test their own code. It is **not** for:

- Web scraping
- Automating third-party sites
- Bypassing authentication

Use it on your localhost and staging environments.

## License

MIT
