# Agent Browser Loop - CLI Reference

<!-- TIP: Check package.json for dev server scripts to find the port to test (e.g. dev:basic, dev:next) -->

Complete CLI reference for `agent-browser`.

## Commands

### `open <url>`

Open a URL in the browser. Automatically starts daemon if not running.

```bash
agent-browser open <url> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--headed` | Show browser window (default: headless) |
| `--new, -n` | Create new session with auto-generated ID |
| `--session, -s <id>` | Target session (from `--new`) |
| `--profile, -p <name>` | Load profile and save back on close |
| `--no-save` | Don't save profile changes on close (read-only) |
| `--width, -W <pixels>` | Viewport width (default: 1280) |
| `--height, -H <pixels>` | Viewport height (default: 720) |
| `--json` | Output as JSON |

**Examples:**
```bash
agent-browser open http://localhost:3000
agent-browser open http://localhost:3000 --headed
agent-browser open http://localhost:3000 --width 1920 --height 1080
agent-browser open http://localhost:3000 --profile admin  # Loads and auto-saves on close
agent-browser open http://localhost:3000 --profile admin --no-save  # Read-only
agent-browser open --new http://localhost:3000  # Output: Session: swift-fox
```

---

### `act <actions...>`

Execute one or more actions on the page.

```bash
agent-browser act <actions...> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--new, -n` | Create new session with auto-generated ID |
| `--session, -s <id>` | Target session (from `--new`) |
| `--no-state` | Skip state in response |
| `--json` | Output as JSON |

**Action Syntax:**

| Action | Syntax | Example |
|--------|--------|---------|
| Navigate | `navigate:<url>` | `navigate:http://localhost:3000/login` |
| Click | `click:<ref>` | `click:button_0` |
| Type | `type:<ref>:<text>` | `type:input_0:hello` |
| Press key | `press:<key>` | `press:Enter` |
| Scroll | `scroll:<direction>[:<amount>]` | `scroll:down:500` |
| Resize | `resize:<width>:<height>` | `resize:1920:1080` |
| Select | `select:<ref>:<value>` | `select:select_0:option1` |
| Check | `check:<ref>` | `check:checkbox_0` |
| Uncheck | `uncheck:<ref>` | `uncheck:checkbox_0` |
| Focus | `focus:<ref>` | `focus:input_0` |
| Blur | `blur:<ref>` | `blur:input_0` |
| Hover | `hover:<ref>` | `hover:button_0` |
| Clear | `clear:<ref>` | `clear:input_0` |
| Upload | `upload:<ref>:<path>` | `upload:input_0:/path/to/file.pdf` |
| Wait | `wait:<ms>` | `wait:1000` |
| Go back | `back` | `back` |
| Go forward | `forward` | `forward` |
| Reload | `reload` | `reload` |

**Key names for `press`:**
- Navigation: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`
- Arrows: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- Modifiers: `Shift`, `Control`, `Alt`, `Meta`
- Function: `F1`-`F12`
- Special: `Home`, `End`, `PageUp`, `PageDown`, `Insert`

**Examples:**
```bash
# Single action
agent-browser act click:button_0

# Multiple actions (executed in order)
agent-browser act click:input_0 type:input_0:hello press:Enter

# Text with spaces (use quotes)
agent-browser act type:input_0:"hello world"

# Form fill and submit
agent-browser act \
  type:input_0:user@example.com \
  type:input_1:password123 \
  click:button_0
```

---

### `wait`

Wait for a condition on the page.

```bash
agent-browser wait [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--text <string>` | Wait for text to appear |
| `--selector <css>` | Wait for element to exist |
| `--url <pattern>` | Wait for URL to match (substring) |
| `--not-text <string>` | Wait for text to disappear |
| `--not-selector <css>` | Wait for element to disappear |
| `--timeout <ms>` | Timeout in milliseconds (default: 30000) |
| `--session, -s <id>` | Target session (from `--new`) |
| `--json` | Output as JSON |

**Examples:**
```bash
# Wait for text
agent-browser wait --text "Welcome"
agent-browser wait --text "Login successful"

# Wait for element
agent-browser wait --selector "#success-message"
agent-browser wait --selector ".dashboard"

# Wait for URL change
agent-browser wait --url "/dashboard"
agent-browser wait --url "success=true"

# Wait for disappearance (loading states)
agent-browser wait --not-text "Loading..."
agent-browser wait --not-selector ".spinner"

# Custom timeout
agent-browser wait --text "Done" --timeout 60000
```

---

### `state`

Get the current page state.

```bash
agent-browser state [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--session, -s <id>` | Target session (from `--new`) |
| `--json` | Output as JSON |

**Output includes:**
- Current URL and page title
- Tab count
- Scroll position (pixels above/below viewport)
- Interactive elements with refs, types, labels, values
- Console errors
- Network errors (4xx/5xx responses)

**Example output:**
```
URL: http://localhost:3000/login
Title: Login - MyApp
Tabs: 1

Scroll: 0px above, 250px below

Interactive Elements:
  [0] ref=input_0 textbox "Email" (placeholder="Enter email")
  [1] ref=input_1 textbox "Password" (type="password")
  [2] ref=checkbox_0 checkbox "Remember me"
  [3] ref=button_0 button "Sign In"
  [4] ref=link_0 link "Forgot password?" (href="/forgot")

Errors:
Console:
  - [error] Failed to load resource: 404
Network:
  - 404 GET /api/config
```

---

### `screenshot`

Capture a screenshot of the current page.

```bash
agent-browser screenshot [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--output, -o <path>` | Save to file (PNG) instead of base64 output |
| `--full-page` | Capture full scrollable page |
| `--session, -s <id>` | Target session (from `--new`) |

**Examples:**
```bash
# Save to file
agent-browser screenshot -o screenshot.png

# Full page screenshot
agent-browser screenshot --full-page -o full.png

# Output base64 (for piping or programmatic use)
agent-browser screenshot
```

---

### `resize <width> <height>`

Resize the browser viewport mid-session.

```bash
agent-browser resize <width> <height> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--session, -s <id>` | Target session |
| `--json` | Output as JSON |

**Examples:**
```bash
agent-browser resize 1920 1080
agent-browser resize 375 667  # Mobile viewport
agent-browser act "resize:1920:1080"  # Via act command
```

---

### `profile <subcommand>`

Manage session storage profiles (cookies + localStorage). The `<name>` in all commands is an arbitrary identifier you choose (e.g., `admin`, `testuser`, `staging`).

#### `profile list`

List all available profiles.

```bash
agent-browser profile list [--json]
```

#### `profile show <name>`

Show profile contents.

```bash
agent-browser profile show <name> [--json]
```

#### `profile save <name>`

Save current session storage to a profile.

```bash
agent-browser profile save <name> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--session, -s <id>` | Source session |
| `--global` | Save to global profiles (`~/.config/agent-browser/profiles/`) |
| `--private` | Save to private profiles (gitignored) |
| `--description, -d <text>` | Profile description |

#### `profile delete <name>`

Delete a profile.

```bash
agent-browser profile delete <name>
```

#### `profile import <name> <path>`

Import profile from a Playwright storage state JSON file.

```bash
agent-browser profile import <name> <path> [--global] [--private]
```

#### `profile capture <name>`

Opens a headed browser, lets you interact manually (log in, etc.), then saves the session when you press Enter in the terminal.

```bash
agent-browser profile capture <name> --url <url> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--url <url>` | URL to navigate to (required) |
| `--global` | Save to global profiles |
| `--private` | Save to private profiles |
| `--description, -d <text>` | Profile description |

**Examples:**
```bash
# Capture a session (opens browser, you log in, press Enter to save)
agent-browser profile capture admin --url http://localhost:3000/login
agent-browser profile capture testuser --url http://localhost:3000/login

# Save from an already-open session instead
agent-browser open http://localhost:3000/login --headed
# ... log in manually ...
agent-browser profile save admin --description "Admin account"

# Use profile (loads saved cookies/localStorage)
agent-browser open http://localhost:3000/dashboard --profile admin

# List profiles
agent-browser profile list

# Import existing Playwright storage state file
agent-browser profile import staging ./storage-state.json --global
```

**Profile Storage Locations:**
- Local: `.agent-browser/profiles/<name>.json` (project-scoped, shareable via git)
- Private: `.agent-browser/profiles/.private/<name>.json` (gitignored)
- Global: `~/.config/agent-browser/profiles/<name>.json` (user-level)

Resolution order: private -> local -> global

---

### `close`

Close browser session or stop daemon.

```bash
agent-browser close [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--session, -s <id>` | Close specific session (daemon keeps running) |
| `--all` | Close all sessions and stop daemon |

---

### `sessions`

List all active browser sessions.

```bash
agent-browser sessions [--json]
```

---

### `status`

Check if daemon is running and list active sessions.

```bash
agent-browser status
```

---

### `setup`

Install Playwright browser and AI agent skill files.

```bash
agent-browser setup [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--skip-skill` | Skip installing skill files |
| `--target <dir>` | Target directory for skill files (default: cwd) |

Run this once after installing the package. Installs:
1. Playwright Chromium browser
2. Skill files to `.claude/skills/agent-browser-loop/`

---

### `server`

Start HTTP server mode for multi-session scenarios.

```bash
agent-browser server [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--port <number>` | Port number (default: 3790) |
| `--headed` | Show browser windows |
| `--viewport <WxH>` | Default viewport size |

Server provides REST API at `http://localhost:3790`. OpenAPI spec at `GET /openapi.json`.

---

---

## Element References

Elements are identified by type-prefixed refs that remain stable within a session:

| Prefix | Element Type |
|--------|--------------|
| `button_N` | Buttons (`<button>`, `[role="button"]`, etc.) |
| `input_N` | Text inputs, textareas |
| `link_N` | Links (`<a>` with href) |
| `checkbox_N` | Checkboxes |
| `radio_N` | Radio buttons |
| `select_N` | Select dropdowns |
| `option_N` | Select options |
| `img_N` | Images with click handlers |
| `generic_N` | Other interactive elements |

**Note:** Refs may change after DOM updates. Always re-fetch state if actions fail with "element not found".

---

## Global Options

These options work with most commands:

| Flag | Description |
|------|-------------|
| `--session, -s <id>` | Target session ID (from `--new`) |
| `--json` | JSON output format |
| `--help` | Show help |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (action failed, timeout, daemon not running, etc.) |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_BROWSER_SOCKET` | Custom socket path for daemon |
| `DEBUG` | Enable debug logging |

---

## Examples

### Login Flow
```bash
agent-browser open http://localhost:3000/login
agent-browser act type:input_0:user@test.com type:input_1:secret
agent-browser act click:button_0
agent-browser wait --text "Dashboard"
agent-browser close
```

### Form Validation Testing
```bash
agent-browser open http://localhost:3000/signup --headed
agent-browser act click:button_0  # Submit empty form
agent-browser wait --text "Email is required"
agent-browser state  # Check error states
agent-browser close
```

### Navigation Testing
```bash
agent-browser open http://localhost:3000
agent-browser act click:link_0
agent-browser wait --url "/about"
agent-browser act back
agent-browser wait --url "/"
agent-browser close
```

### Multiple Sessions
```bash
# Create sessions with auto-generated IDs
agent-browser open --new http://localhost:3000/login  # Output: Session: swift-fox
agent-browser open --new http://localhost:3000/login  # Output: Session: calm-river

# Interact with specific sessions
agent-browser act -s swift-fox type:input_0:admin@test.com
agent-browser act -s calm-river type:input_0:user@test.com

# List all sessions
agent-browser sessions

# Close specific session (daemon keeps running)
agent-browser close -s swift-fox

# Close all sessions and stop daemon
agent-browser close --all
```
