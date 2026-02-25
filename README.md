# ForgeReview CLI

AI code review in your terminal, powered by local Codex.

## What this CLI does today

- Reviews code from your git workspace (`forgereview review`)
- Applies fixable suggestions (`forgereview review --fix`)
- Supports multiple review scopes (`--staged`, `--commit`, `--branch`, `--full`, specific files)
- Fetches pull-request suggestions (`forgereview pr suggestions`)
- Installs a pre-push review hook (`forgereview hook install`)
- Captures and promotes decision memory (`forgereview decisions ...`)
- Manages authentication modes (`forgereview auth ...`)

## Requirements

- Node.js 18+
- Git repository for `review` commands

## Install

```bash
npm install -g @forgereview/cli
```

Or from source:

```bash
git clone https://github.com/forgereviewtech/cli.git
cd cli
npm install
npm run build
npm link
```

## Quick start

Run in the target repository:

```bash
forgereview review
```

Auto-apply all fixable issues:

```bash
forgereview review --fix
```

Run full repository review (tracked + untracked files):

```bash
forgereview review --full
```

## Main command

### `forgereview review [files...]`

Analyze code for AI review.

#### Scopes

```bash
forgereview review                            # working tree (staged + unstaged)
forgereview review --staged                   # staged only
forgereview review --commit <sha>             # specific commit
forgereview review --branch main              # compare current branch against main
forgereview review --full                     # entire repository
forgereview review src/a.ts src/b.ts          # specific files
```

#### Output and behavior

```bash
forgereview review --format json
forgereview review --format markdown
forgereview review --prompt-only
forgereview review --output report.md --format markdown
forgereview review --fast
forgereview review --rules-only
forgereview review --context .forgereview.md
forgereview review --fail-on error
forgereview review --interactive
```

#### Flags

| Flag | Description |
|---|---|
| `-s, --staged` | Analyze only staged files |
| `-c, --commit <sha>` | Analyze diff from a specific commit |
| `-b, --branch <name>` | Compare current branch against branch |
| `--full` | Analyze the full repository (tracked + untracked files) |
| `--rules-only` | Use only configured rules |
| `--fast` | Faster, lighter analysis |
| `-i, --interactive` | Interactive navigation mode |
| `--fix` | Automatically apply all fixable issues |
| `--prompt-only` | Minimal structured output for AI agents |
| `--fail-on <severity>` | Exit 1 when issues meet threshold (`info`, `warning`, `error`, `critical`) |
| `--context <file>` | Include custom context file |

Notes:
- `--full` cannot be combined with `files`, `--staged`, `--commit`, or `--branch`.
- Very large repositories are split into multiple chunks automatically in full mode.

## Other commands

### Pull request suggestions

```bash
forgereview pr suggestions --pr-url https://github.com/org/repo/pull/42
forgereview pr suggestions --pr-number 42 --repo-id <repoId>
forgereview pr suggestions --pr-url <url> --severity critical,error --category security_vulnerability
```

### Git hook

```bash
forgereview hook install
forgereview hook install --fail-on error --no-fast
forgereview hook status
forgereview hook uninstall
```

### Decision memory

```bash
forgereview decisions enable
forgereview decisions status
forgereview decisions show
forgereview decisions promote
forgereview decisions disable
```

### Authentication

```bash
forgereview auth status
forgereview auth login --email <email> --password <password>
forgereview auth team-key --key <team_key>
forgereview auth token
forgereview auth logout
```

### Upgrade helper

```bash
forgereview upgrade
```

## Global options

```bash
forgereview --help
forgereview --version
forgereview --verbose
forgereview --quiet
forgereview --format <terminal|json|markdown>
forgereview --output <file>
```

## Troubleshooting

- `No changes to review`: there is no diff in the selected scope. Use another scope (`--staged`, `--branch`, `--commit`, `--full`).
- `Not a git repository`: run inside a git repo or initialize one with `git init`.
- If local Codex analysis is slow on large repos, rerun with `--fast`, narrowed scope, or specific files.

## License

MIT
