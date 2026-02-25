import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { gitService } from '../services/git.service.js';
import { contextService } from '../services/context.service.js';
import { terminalFormatter } from '../formatters/terminal.js';
import { jsonFormatter } from '../formatters/json.js';
import { markdownFormatter } from '../formatters/markdown.js';
import { promptFormatter } from '../formatters/prompt.js';
import { interactiveUI } from '../ui/interactive.js';
import { fixService } from '../services/fix.service.js';
import { codexReviewService } from '../services/codex-review.service.js';
import type { GlobalOptions, OutputFormat, ReviewResult, Severity } from '../types/index.js';
import fs from 'fs/promises';

export const reviewCommand = new Command('review')
  .description('Analyze code for AI review')
  .argument('[files...]', 'Specific files to analyze')
  .option('-s, --staged', 'Analyze only staged files')
  .option('-c, --commit <sha>', 'Analyze diff from a specific commit')
  .option('-b, --branch <name>', 'Compare current branch against specified branch (e.g., main)')
  .option('--full', 'Analyze the full repository (all tracked and untracked files)')
  .option('--rules-only', 'Review using only configured rules (no general suggestions)')
  .option('--fast', 'Fast mode: quicker analysis with lighter checks')
  .option('-i, --interactive', 'Interactive mode: navigate and apply fixes')
  .option('--fix', 'Automatically apply all fixable issues')
  .option('--prompt-only', 'Output optimized for AI agents (minimal, structured)')
  .option('--fail-on <severity>', 'Exit with code 1 if issues meet or exceed severity (info, warning, error, critical)')
  .option('--context <file>', 'Custom context file to include in review')
  .action(async (files: string[], options: { staged?: boolean; commit?: string; branch?: string; full?: boolean; rulesOnly?: boolean; fast?: boolean; interactive?: boolean; fix?: boolean; promptOnly?: boolean; context?: string; failOn?: string }, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOptions & { staged?: boolean; commit?: string };
    const spinner = ora();

    try {
      // Override format if --prompt-only is set
      if (options.promptOnly) {
        globalOpts.format = 'prompt';
      }

      if (options.full && (files?.length > 0 || options.branch || options.commit || options.staged)) {
        throw new Error('--full cannot be combined with files, --staged, --commit, or --branch');
      }

      let result: ReviewResult;

      if (!globalOpts.quiet) {
        spinner.start(chalk.cyan('Running with local Codex CLI...'));
      }

      if (!globalOpts.quiet) {
        spinner.text = chalk.cyan('Getting file changes...');
      }

      const diffs = await getDiffs(files, options, globalOpts.verbose);

      if (diffs.length === 0) {
        spinner.fail(chalk.yellow('No changes to review'));
        if (globalOpts.verbose) {
          console.log(chalk.dim('[verbose] Checked scopes:'));
          console.log(chalk.dim(`  - Specific files: ${files && files.length > 0 ? files.join(', ') : 'none'}`));
          console.log(chalk.dim(`  - Branch comparison: ${options.branch || 'none'}`));
          console.log(chalk.dim(`  - Commit: ${options.commit || 'none'}`));
          console.log(chalk.dim(`  - Staged only: ${options.staged ? 'yes' : 'no'}`));
          console.log(chalk.dim(`  - Full repository: ${options.full ? 'yes' : 'no'}`));
          console.log(chalk.dim(`  - Default: ${!files?.length && !options.branch && !options.commit && !options.staged && !options.full ? 'working tree (staged + unstaged)' : 'no'}`));
        }
        return;
      }

      const chunkResults: ReviewResult[] = [];
      for (let index = 0; index < diffs.length; index++) {
        const chunk = diffs[index];

        // Enrich each diff chunk with project context.
        if (!globalOpts.quiet) {
          spinner.text = chalk.cyan(`Reading project context... (${index + 1}/${diffs.length})`);
        }

        if (globalOpts.verbose) {
          console.log(chalk.dim(`[verbose] Reading project context files for chunk ${index + 1}/${diffs.length}...`));
        }

        const enrichedDiff = await contextService.enrichDiffWithContext(chunk, options.context, globalOpts.verbose);

        if (!globalOpts.quiet) {
          spinner.text = chalk.cyan(`Analyzing code... (${index + 1}/${diffs.length})`);
        }

        if (globalOpts.verbose) {
          console.log(chalk.dim(`[verbose] Using local Codex CLI for chunk ${index + 1}/${diffs.length}`));
        }

        const chunkResult = await codexReviewService.analyze(enrichedDiff, {
          verbose: globalOpts.verbose,
          fast: options.fast,
          rulesOnly: options.rulesOnly,
        });
        chunkResults.push(chunkResult);
      }

      result = mergeResults(chunkResults, diffs.length);
      const modeLabel = options.fast ? ' (fast mode)' : '';
      spinner.succeed(chalk.green(`Review complete! (Codex local mode)${modeLabel}`));

      // Handle fix mode
      if (options.fix) {
        await interactiveUI.runQuickFix(result);
        return;
      }

      // Handle interactive mode (now default if no output format specified)
      const shouldUseInteractive = options.interactive || (!globalOpts.output && globalOpts.format === 'terminal');

      if (shouldUseInteractive) {
        await interactiveUI.run(result);
        return;
      }

      // Regular output (only when --format or --output is specified)
      const output = formatOutput(result, globalOpts.format);

      if (globalOpts.output) {
        await fs.writeFile(globalOpts.output, output, 'utf-8');
        console.log(chalk.green(`\nOutput saved to ${globalOpts.output}`));
      } else if (globalOpts.format === 'terminal') {
        console.log(output);
      } else {
        console.log(output);
      }

      // Check --fail-on after output
      if (options.failOn) {
        const severityOrder: Record<string, number> = { info: 0, warning: 1, error: 2, critical: 3 };
        const threshold = severityOrder[options.failOn] ?? 0;
        const hasBlockingIssues = result.issues.some(
          (i) => (severityOrder[i.severity] ?? 0) >= threshold,
        );
        if (hasBlockingIssues) {
          process.exit(1);
        }
      }

    } catch (error) {
      spinner.fail(chalk.red('Review failed'));

      if (error instanceof Error) {
        console.error(chalk.red(error.message));
        if (globalOpts.verbose) {
          console.error(error.stack);
        }
      } else {
        console.error(chalk.red('An unexpected error occurred'));
        if (globalOpts.verbose) {
          console.error(error);
        }
      }
      process.exit(1);
    }
  });

async function getDiffs(files: string[], options: { staged?: boolean; commit?: string; branch?: string; full?: boolean }, verbose?: boolean): Promise<string[]> {
  let diffs: string[];

  gitService.setVerbose(!!verbose);

  if (options.full) {
    if (verbose) {
      console.log(chalk.dim('[verbose] Getting full repository diff'));
    }
    diffs = await gitService.getFullRepositoryDiffChunks();
  } else if (files && files.length > 0) {
    if (verbose) {
      console.log(chalk.dim(`[verbose] Getting diff for specific files: ${files.join(', ')}`));
    }
    diffs = [await gitService.getDiffForFiles(files)];
  } else if (options.branch) {
    if (verbose) {
      console.log(chalk.dim(`[verbose] Getting diff for branch: ${options.branch}`));
    }
    diffs = [await gitService.getDiffForBranch(options.branch)];
  } else if (options.commit) {
    if (verbose) {
      console.log(chalk.dim(`[verbose] Getting diff for commit: ${options.commit}`));
    }
    diffs = [await gitService.getDiffForCommit(options.commit)];
  } else if (options.staged) {
    if (verbose) {
      console.log(chalk.dim('[verbose] Getting staged diff only'));
    }
    diffs = [await gitService.getStagedDiff()];
  } else {
    if (verbose) {
      console.log(chalk.dim('[verbose] Getting working tree diff (staged + unstaged)'));
    }
    diffs = [await gitService.getWorkingTreeDiff()];
  }

  const nonEmptyDiffs = diffs.map(d => d.trim()).filter(Boolean);

  if (verbose) {
    const totalChars = nonEmptyDiffs.reduce((sum, d) => sum + d.length, 0);
    console.log(chalk.dim(`[verbose] Diff chunks: ${nonEmptyDiffs.length}, total size: ${totalChars} characters`));
    if (nonEmptyDiffs.length === 0) {
      console.log(chalk.dim('[verbose] No changes detected in the requested scope'));
    } else {
      // Show first 500 chars of diff for debugging
      const preview = nonEmptyDiffs[0].substring(0, 500);
      console.log(chalk.dim(`[verbose] Diff preview (chunk 1):\n${preview}${nonEmptyDiffs[0].length > 500 ? '\n... (truncated)' : ''}`));
    }
  }

  return nonEmptyDiffs;
}

function mergeResults(results: ReviewResult[], chunkCount: number): ReviewResult {
  const seen = new Set<string>();
  const issues = [];
  let filesAnalyzed = 0;
  let duration = 0;

  for (const result of results) {
    filesAnalyzed += result.filesAnalyzed || 0;
    duration += result.duration || 0;
    for (const issue of result.issues) {
      const key = `${issue.file}:${issue.line}:${issue.endLine || ''}:${issue.severity}:${issue.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(issue);
      }
    }
  }

  const summary = chunkCount > 1
    ? `Chunked full review completed (${chunkCount} chunks). Found ${issues.length} issue(s).`
    : (results[0]?.summary || 'Review completed');

  return {
    summary,
    issues,
    filesAnalyzed,
    duration,
  };
}

function formatOutput(result: ReviewResult, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return jsonFormatter.format(result);
    case 'markdown':
      return markdownFormatter.format(result);
    case 'prompt':
      return promptFormatter.format(result);
    case 'terminal':
    default:
      return terminalFormatter.format(result);
  }
}
