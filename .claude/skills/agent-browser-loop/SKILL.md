---
name: agent-browser-loop
description: Use when an agent must drive a live browser session in a back-and-forth loop (state -> explicit actions -> state) for UI validation, reproducible QA, or debugging UI behavior. Prefer this over one-shot CLI usage when an agent needs inspectable, stepwise control.
---


# Agent Browser Loop

Control a browser via CLI. Execute actions, read state, and verify UI changes in a stepwise loop.

## Quick Start

> **TIP**: Check package.json for dev server scripts to find the port to test

```bash
# Open a URL (starts browser daemon automatically)
agent-browser open http://localhost:3000

# Interact and verify
agent-browser act click:button_0
agent-browser wait --text "Success"
agent-browser state

# Close when done
agent-browser close
```

Use `--headed` to see the browser: `agent-browser open http://localhost:3000 --headed`

## Core Loop

1. **Open**: `agent-browser open <url>` - starts daemon, navigates to URL
2. **Act**: `agent-browser act <actions...>` - interact with elements
3. **Wait**: `agent-browser wait --text/--selector/--url` - wait for conditions
4. **State**: `agent-browser state` - read current page state
5. **Repeat** until task complete
6. **Close**: `agent-browser close` - stop browser daemon

## Commands

| Command | Purpose |
|---------|---------|
| `open <url>` | Open URL (starts daemon if needed) |
| `act <actions...>` | Execute actions |
| `wait` | Wait for conditions |
| `state` | Get current page state |
| `screenshot` | Capture screenshot |
| `close` | Close browser and daemon |
| `status` | Check if daemon is running |

## Action Syntax

Actions use format `action:target` or `action:target:value`:

```bash
# Navigation
agent-browser act navigate:http://localhost:3000

# Click elements
agent-browser act click:button_0
agent-browser act click:link_2

# Type into inputs
agent-browser act type:input_0:hello
agent-browser act type:input_1:"text with spaces"

# Keyboard
agent-browser act press:Enter
agent-browser act press:Tab

# Scroll
agent-browser act scroll:down
agent-browser act scroll:up:500

# Multiple actions
agent-browser act click:input_0 type:input_0:hello press:Enter
```

## Wait Conditions

```bash
# Wait for text
agent-browser wait --text "Welcome"

# Wait for element
agent-browser wait --selector "#success"

# Wait for URL
agent-browser wait --url "/dashboard"

# Wait for disappearance
agent-browser wait --not-text "Loading..."
agent-browser wait --not-selector ".spinner"

# Custom timeout (default 30s)
agent-browser wait --text "Done" --timeout 60000
```

## Element References

State includes interactive elements with stable refs:

```
Interactive Elements:
  [0] ref=input_0 textbox "Email" (placeholder="Enter email")
  [1] ref=input_1 textbox "Password" (type="password")
  [2] ref=button_0 button "Sign In"
  [3] ref=link_0 link "Forgot password?" (href="/forgot")
```

**Use `ref` values in actions**: `click:button_0`, `type:input_0:hello`

Refs are type-prefixed (`button_`, `input_`, `link_`, `checkbox_`, `select_`) and stable within a session.

## Reading State

State includes:
- Current URL and title
- Scroll position
- Interactive elements with values
- Console and network errors

```
URL: http://localhost:3000/login
Title: Login
Tabs: 1

Scroll: 0px above, 500px below

Interactive Elements:
  [0] ref=input_0 textbox "Email" value="user@test.com"
  [1] ref=input_1 textbox "Password" (type="password")
  [2] ref=checkbox_0 checkbox "Remember me" (checked="true")
  [3] ref=button_0 button "Sign In"

Errors:
Console:
  - [error] Failed to load resource: 404
Network:
  - 404 GET /api/user
```

## Complete Example: Login Flow

```bash
# 1. Open login page
agent-browser open http://localhost:3000/login

# 2. Fill form and submit
agent-browser act \
  type:input_0:user@example.com \
  type:input_1:password123 \
  click:button_0

# 3. Wait for login to complete
agent-browser wait --text "Welcome" --timeout 5000

# 4. Verify state
agent-browser state

# 5. Close when done
agent-browser close
```

## Options

```bash
# Headed mode (visible browser)
agent-browser open http://localhost:3000 --headed

# Custom viewport size
agent-browser open http://localhost:3000 --width 1920 --height 1080

# Resize mid-session
agent-browser resize 1920 1080
```

## Profiles (Session Storage)

Save and reuse cookies/localStorage across sessions. The profile name (e.g., `admin`, `testuser`) is an arbitrary identifier you choose.

```bash
# Capture: opens browser, you interact, press Enter in terminal to save
agent-browser profile capture admin --url http://localhost:3000/login

# Or save from an already-open session
agent-browser open http://localhost:3000/login --headed
# ... log in manually ...
agent-browser profile save admin

# Use saved profile - auto-saves updated tokens on close
agent-browser open http://localhost:3000/dashboard --profile admin
# ... use the app (tokens may refresh) ...
agent-browser close  # Updated tokens saved back to profile

# Use --no-save for read-only (don't save changes back)
agent-browser open http://localhost:3000 --profile admin --no-save

# List/manage profiles
agent-browser profile list
agent-browser profile show admin
agent-browser profile delete admin
```

Profiles are stored locally (`.agent-browser/profiles/`) or globally (`~/.config/agent-browser/profiles/`).

## Multi-Session

Run multiple browsers in parallel with `--new`:

```bash
agent-browser open --new http://localhost:3000     # Output: Session: swift-fox
agent-browser open --new http://localhost:3000     # Output: Session: calm-river

agent-browser act -s swift-fox click:button_0      # Target session
agent-browser sessions                              # List all
agent-browser close -s swift-fox                    # Close one session
agent-browser close --all                           # Close all, stop daemon
```

## Screenshots

```bash
agent-browser screenshot -o screenshot.png       # Save to file
agent-browser screenshot --full-page -o full.png # Full scrollable page
agent-browser screenshot                         # Output base64
```

Use when text state isn't enough to diagnose visual issues.

## Debugging Tips

1. **Action does nothing?** Check errors in state output
2. **Element not found?** Run `agent-browser state` to see current refs
3. **Waiting times out?** Check exact text/selector, try simpler condition
4. **Need visual check?** Use `--headed` or `agent-browser screenshot`
5. **Refs changed?** DOM updates can change refs - re-fetch state

## HTTP Server Mode

For multi-session scenarios or HTTP-based integrations:

```bash
# Start HTTP server
agent-browser server --headed

# Server at http://localhost:3790
# Full API spec at GET /openapi.json
```

## Full Reference

See REFERENCE.md for complete CLI documentation.
