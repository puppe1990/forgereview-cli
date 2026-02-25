<!-- TODO: Add banner image/logo here -->

<h1 align="center">ForgeReview CLI</h1>

<p align="center">
  <strong>Catch bugs before they reach your pull request — AI code review from the terminal.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@forgereview/cli"><img src="https://img.shields.io/npm/v/@forgereview/cli.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@forgereview/cli"><img src="https://img.shields.io/npm/dm/@forgereview/cli.svg" alt="npm downloads"></a>
  <a href="https://github.com/forgereviewtech/cli/blob/main/LICENSE"><img src="https://img.shields.io/github/license/forgereviewtech/cli" alt="license"></a>
  <a href="https://github.com/forgereviewtech/cli"><img src="https://img.shields.io/github/stars/forgereviewtech/cli" alt="stars"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version"></a>
</p>

<p align="center">
  <a href="https://forgereview.io">Website</a> &middot;
  <a href="https://app.forgereview.io">Sign Up</a> &middot;
  <a href="https://github.com/forgereviewtech/cli/issues">Issues</a>
</p>

---

```bash
npm install -g @forgereview/cli
```

---

## Quick Start

```bash
# 1. Install
npm install -g @forgereview/cli

# 2. Authenticate (or skip for trial mode — no account needed)
forgereview auth login

# 3. Review your code
forgereview review
```

That's it. ForgeReview analyzes your changes, finds issues, and lets you fix them interactively — or auto-fix everything at once with `forgereview review --fix`.

<!-- TODO: Add demo GIF showing interactive review in action -->

## What It Does

### Code Review

Analyze local changes, staged files, commits, or branch diffs. ForgeReview finds bugs, security issues, performance problems, and style violations — then suggests fixes with real code.

```bash
forgereview review                    # Review working tree changes (interactive)
forgereview review --staged           # Only staged files
forgereview review --branch main      # Compare against a branch
forgereview review --fix              # Auto-apply all fixable issues
forgereview review --prompt-only      # Structured output for AI agents
```

Reviews are **context-aware** — ForgeReview reads your `.cursorrules`, `claude.md`, and `.forgereview.md` so suggestions follow your team's standards. [More on review modes](#review-modes)

### PR Suggestions

Fetch AI-powered suggestions for open pull requests directly from your terminal.

```bash
forgereview pr suggestions --pr-url https://github.com/org/repo/pull/42
forgereview pr suggestions --pr-number 42 --repo-id <id>
```

Filter by severity, export as JSON or Markdown, or pipe into an AI agent with `--prompt-only` for automated fixes.

### Decision Memory

AI agents make dozens of decisions per session — architecture choices, trade-offs, why approach X was picked over Y. Without a record, that reasoning vanishes when the session ends.

ForgeReview captures agent decisions into your repo as structured markdown. When you or another agent return to the code, the full context is there.

```bash
forgereview decisions enable           # Install hooks + initialize config
forgereview decisions status           # See what's been captured
forgereview decisions show [name]      # View PR or module memory
forgereview decisions promote          # Promote decisions to long-term memory
```

Stored in `.kody/pr/by-sha/<head-sha>.md` — versioned with your code, readable by humans and agents. [More on decision memory](#decision-memory-1)

---

## Best With AI Agents

ForgeReview is designed to work **inside AI coding agents**. While you can use it standalone, the real power comes when your agent runs reviews automatically and fixes issues in a loop — no manual intervention needed.

**Works with:** Claude Code, Cursor, Windsurf, GitHub Copilot, Gemini CLI, and [20+ more environments](https://review-skill.com/).

### Install the Skill (recommended)

The fastest way to get started. Auto-detects your installed IDEs and sets everything up:

```bash
curl -fsSL https://review-skill.com/install | bash
```

This installs the ForgeReview CLI globally and deploys the review skill into every supported agent on your machine — Claude Code, Cursor, Windsurf, and others. One command, all environments.

### How It Works With Agents

Once installed, your AI agent can autonomously:

1. **Write code** as usual
2. **Run `forgereview review --prompt-only`** to analyze changes
3. **Read the structured output** and understand each issue
4. **Fix the issues** automatically
5. **Repeat** until the review is clean

This creates a tight feedback loop: the agent writes, reviews, and fixes — all without leaving your IDE.

Beyond reviews, ForgeReview also captures **what your agent decided and why** via [Decision Memory](#decision-memory). Every reasoning step is saved into your repo — so when you (or another agent) pick up the work later, the full context is already there. No more re-explaining what was done or losing decisions between sessions.

### Setup: Claude Code

Add to your project's `CLAUDE.md`:

```markdown
## Code Review
After implementing changes, run `forgereview review --prompt-only` to check for issues.
If issues are found, fix them and re-run until clean.
```

Or use the skill directly — after installing via the command above, just ask Claude Code to review your code and it will use ForgeReview automatically.

### Setup: Cursor / Windsurf

Add to your `.cursorrules` or equivalent:

```
When writing code:
1. Implement the feature
2. Run: forgereview review --prompt-only
3. If issues are found, fix them automatically
4. Repeat until review is clean
5. Show final result
```

### Setup: Headless / Shared Environments

Set a team key so agents and shared machines are authenticated without individual logins:

```bash
export FORGEREVIEW_TEAM_KEY=forgereview_xxxxx
forgereview review --prompt-only
```

Works with Codex, CI runners, remote dev environments, and any context where personal login isn't practical. Get your key at [app.forgereview.io/settings/cli](https://app.forgereview.io/settings/cli).

### Copy & Paste Workflow (interactive)

If you prefer manual control:

1. Run `forgereview review`
2. Navigate to a file with issues
3. Select **"Copy fix prompt for AI agent"**
4. Paste into Claude Code or Cursor — the AI fixes it

The copied prompt includes file path, line numbers, severity, and detailed suggestions — optimized for AI agents.

## Installation

### Skill installer (recommended — CLI + all your agents)

```bash
curl -fsSL https://review-skill.com/install | bash
```

Installs the CLI and deploys the review skill to all detected agents in one step.

### CLI only

<details>
<summary><strong>npm</strong></summary>

```bash
npm install -g @forgereview/cli
```
</details>

<details>
<summary><strong>npx (no install)</strong></summary>

```bash
npx @forgereview/cli review
```
</details>

<details>
<summary><strong>curl</strong></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/forgereviewtech/cli/main/install.sh | bash
```
</details>

<details>
<summary><strong>Homebrew (coming soon)</strong></summary>

```bash
brew install forgereview/tap/forgereview
```
</details>

## Review Modes

### Interactive (default)

```bash
forgereview review
```

Navigate files with issue counts, preview fixes before applying, and copy AI-friendly prompts to paste into Claude Code or Cursor.

### Auto-fix

```bash
forgereview review --fix
```

Applies all fixable issues at once. Shows a confirmation prompt before making changes.

### AI Agent

```bash
forgereview review --prompt-only
```

Minimal, structured output designed for Claude Code, Cursor, and Windsurf. Perfect for autonomous generate-review-fix loops.

<details>
<summary><strong>More: output formats &amp; flags</strong></summary>

#### Output Formats

```bash
forgereview review                           # Interactive (default)
forgereview review --format json             # JSON output
forgereview review --format markdown         # Markdown report
forgereview review --prompt-only             # AI agent output
forgereview review --format markdown -o report.md  # Save to file
```

#### Diff Targets

```bash
forgereview review                           # Working tree changes
forgereview review --staged                  # Staged files only
forgereview review --commit HEAD~1           # Specific commit
forgereview review --branch main             # Compare against branch
forgereview review src/index.ts src/utils.ts # Specific files
```

#### All Flags

| Flag | Description |
|------|-------------|
| `--staged` | Analyze only staged files |
| `--commit <sha>` | Analyze a specific commit |
| `--branch <name>` | Compare against a branch |
| `--rules-only` | Only check configured rules |
| `--fast` | Faster analysis for large diffs |
| `--fix` | Auto-apply all fixable issues |
| `--prompt-only` | AI agent optimized output |
| `--context <file>` | Include custom context file |
| `--format <fmt>` | Output format: `terminal`, `json`, `markdown` |
| `--output <file>` | Save output to file |
| `--fail-on <severity>` | Exit code 1 if issues meet or exceed severity |
| `-i, --interactive` | Explicitly enable interactive mode |

</details>

## Decision Memory

Full reference for the decision capture system ([intro above](#decision-memory)).

```bash
# Enable with specific agents
forgereview decisions enable --agents claude,cursor,codex

# Custom Codex config path
forgereview decisions enable --agents codex --codex-config ~/.codex/config.toml

# Overwrite existing config
forgereview decisions enable --force

# Check what's been captured on current branch
forgereview decisions status

# View decisions for a PR or specific module
forgereview decisions show [name]

# Promote PR-level decisions to long-term module memory
forgereview decisions promote --branch feat/auth --modules auth,users

# Disable hooks (preserves all captured data in .kody/)
forgereview decisions disable
```

**How it works:** Hooks fire on agent turn-complete events and persist decisions to `.kody/pr/by-sha/<head-sha>.md`. Files are committed to your repo, versioned with your code, readable by humans and agents.

**Supported agents:** Claude Code, Cursor, Codex.

## CI/CD & Git Hooks

### Pre-push Hook

```bash
forgereview hook install --fail-on error   # Block pushes with errors
forgereview hook status                     # Check hook status
forgereview hook uninstall                  # Remove hook
```

### Pipeline Usage

```bash
# Strict rules check with JSON output
forgereview review --rules-only --format json --fail-on error

# Generate markdown report artifact
forgereview review --format markdown --output review-report.md
```

## Authentication

ForgeReview supports multiple auth methods depending on your setup:

### Trial Mode (no account)

Just run `forgereview review`. No signup needed. You get 5 reviews/day with up to 10 files and 500 lines per file — enough to try it out. [Sign up free](https://app.forgereview.io) to remove limits.

### Personal Login

For individual developers. Creates a session with automatic token refresh.

```bash
forgereview auth login           # Sign in with email/password
forgereview auth status          # Check auth status and usage
forgereview auth logout          # Sign out
```

Credentials are stored locally in `~/.forgereview/credentials.json`.

### Team Key

For teams where not everyone needs their own account. A single shared key gives the whole team access — developers just set the key and start reviewing, no individual signup required.

```bash
forgereview auth team-key --key forgereview_xxxxx
```

Or set it as an environment variable:

```bash
export FORGEREVIEW_TEAM_KEY=forgereview_xxxxx
```

Get your team key at [app.forgereview.io/settings/cli](https://app.forgereview.io/settings/cli). Team keys have configurable device limits managed from the dashboard.

This is also the recommended auth method for AI coding agents (Claude Code, Cursor, Codex) — set the env var once and every agent session is authenticated automatically.

### CI/CD Token

For pipelines and automated environments. Generated from your personal login:

```bash
forgereview auth token           # Generate a CI/CD token
```

Then use it in your pipeline:

```bash
export FORGEREVIEW_TOKEN=<your-token>
forgereview review --format json --fail-on error
```

> **Note:** For PR-level reviews in CI/CD, we recommend using the [ForgeReview platform](https://app.forgereview.io) GitHub/GitLab integration instead of the CLI. It's purpose-built for PR workflows with inline comments, status checks, and team dashboards.

<details>
<summary><strong>Environment variables</strong></summary>

| Variable | Description |
|----------|-------------|
| `FORGEREVIEW_API_URL` | API endpoint (default: `https://api.forgereview.io`). HTTPS only (except localhost). |
| `FORGEREVIEW_TOKEN` | CI/CD token for automated pipelines (generated via `forgereview auth token`) |
| `FORGEREVIEW_TEAM_KEY` | Team key for shared team access and AI coding agents |

</details>

## Privacy & Security

ForgeReview sends your code diffs to the ForgeReview API for analysis. We take this seriously:

- **HTTPS only** — All API communication is encrypted. Custom API URLs are validated.
- **No training on your code** — Your code is not used to train models.
- **Minimal data** — Only diffs and context files are sent, not your entire codebase.
- **Credentials stored locally** — Auth tokens are kept in `~/.forgereview/credentials.json` on your machine.

## Contributing

We welcome contributions! Please see our [issues page](https://github.com/forgereviewtech/cli/issues) to get started.

```bash
npm install       # Install dependencies
npm run build     # Build
npm run dev       # Watch mode
npm test          # Run tests
```

## License

[MIT](LICENSE)
