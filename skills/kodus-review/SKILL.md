---
name: forgereview-review
description: Use the ForgeReview CLI to run code reviews and apply fixes based on CLI output. Trigger when asked to review code with ForgeReview, run `forgereview review`, use `--prompt-only`, or act on ForgeReview review results.
---

# ForgeReview Review

## Goal

Use the ForgeReview CLI to review changes and resolve issues. Prefer machine-friendly output via `--prompt-only`, then apply fixes in code.

## Workflow

1) Ensure ForgeReview CLI is available.
- Run `forgereview --help` to confirm.
- If missing, ask the user to install the CLI and stop.

2) Ensure authentication if required.
- If `forgereview review` fails with auth, run `forgereview auth login` (interactive) and retry.
- For team keys, use `forgereview auth team-key --key <key>` when provided by the user.

3) Run review using prompt-only output.
- Default: `forgereview review --prompt-only`.
- If user specifies files: `forgereview review --prompt-only <files...>`.
- If user asks for staged/commit/branch: add `--staged`, `--commit <sha>`, or `--branch <name>`.
- If user wants fast: add `--fast`.

4) Parse results and apply fixes.
- Use the output to locate files and lines.
- Make minimal, targeted changes to address each issue.
- If an issue is not actionable or is a false positive, explain why and skip.

5) Re-run review if needed.
- After fixes, rerun `forgereview review --prompt-only` to confirm issues are resolved.

## Notes

- Prefer `--prompt-only` for predictable parsing.
- Avoid `--interactive` unless the user explicitly asks.
- Use `review --help` to undertstand review possibilities
