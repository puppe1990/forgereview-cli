import { Command } from 'commander';
import ora from 'ora';
import type { Ora } from 'ora';
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
import type { GlobalOptions, OutputFormat, ReviewChunkTelemetry, ReviewIssue, ReviewResult } from '../types/index.js';
import fs from 'fs/promises';

type ReviewOptions = {
  staged?: boolean;
  commit?: string;
  branch?: string;
  full?: boolean;
  rulesOnly?: boolean;
  fast?: boolean;
  interactive?: boolean;
  fix?: boolean;
  promptOnly?: boolean;
  context?: string;
  failOn?: string;
  chunkMaxChars?: number;
  chunkTimeoutMs?: number;
  chunkWorkers?: number;
  chunkMaxSplitDepth?: number;
};

interface ChunkEntry {
  file: string;
  patch: string;
}

interface ReviewChunk {
  entries: ChunkEntry[];
  diff: string;
}

interface ChunkRunState {
  results: ReviewResult[];
  processedFiles: Set<string>;
  failedFiles: Set<string>;
  successfulChunks: number;
  failedChunks: number;
  telemetry: ReviewChunkTelemetry[];
}

interface ChunkExecutionConfig {
  spinner: Ora;
  quiet: boolean;
  verbose: boolean;
  contextFile?: string;
  fast: boolean;
  rulesOnly: boolean;
  timeoutMs: number;
  workers: number;
  allowPartial: boolean;
  maxSplitDepth: number;
  contextCache: Map<string, Promise<string>>;
}

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
  .option('--chunk-max-chars <n>', 'Max characters per full-review chunk', parsePositiveInt, 120000)
  .option('--chunk-timeout-ms <ms>', 'Timeout per chunk analysis in milliseconds', parsePositiveInt, 45000)
  .option('--chunk-workers <n>', 'Parallel workers for chunk analysis', parsePositiveInt, 1)
  .option('--chunk-max-split-depth <n>', 'Max recursive split depth for failed chunks', parsePositiveInt, 8)
  .action(async (files: string[], options: ReviewOptions, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOptions & { staged?: boolean; commit?: string };
    const spinner = ora();
    const interactiveTty = isInteractiveTerminal();

    try {
      // Override format if --prompt-only is set
      if (options.promptOnly) {
        globalOpts.format = 'prompt';
      }

      if (options.full && (files?.length > 0 || options.branch || options.commit || options.staged)) {
        throw new Error('--full cannot be combined with files, --staged, --commit, or --branch');
      }

      if (!interactiveTty && !globalOpts.output && globalOpts.format === 'terminal' && !options.promptOnly) {
        globalOpts.format = 'json';
        if (!globalOpts.quiet) {
          console.error(chalk.yellow('⚠ Non-interactive shell detected. Falling back to JSON output (interactive UI disabled).'));
        }
      }

      if (!globalOpts.quiet) {
        spinner.start(chalk.cyan('Running with local Codex CLI...'));
      }

      if (!globalOpts.quiet) {
        spinner.text = chalk.cyan('Getting file changes...');
      }

      const scope = await getReviewScope(files, options, globalOpts.verbose);

      if (scope.chunks.length === 0) {
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

      if (!globalOpts.quiet && scope.chunks.length > 1) {
        console.log(chalk.yellow(`⚠ Full repository diff split into ${scope.chunks.length} chunks for analysis.`));
      }

      const runState: ChunkRunState = {
        results: [],
        processedFiles: new Set<string>(),
        failedFiles: new Set<string>(),
        successfulChunks: 0,
        failedChunks: 0,
        telemetry: [],
      };

      await runChunks(scope.chunks, {
        spinner,
        quiet: !!globalOpts.quiet,
        verbose: !!globalOpts.verbose,
        contextFile: options.context,
        fast: !!options.fast,
        rulesOnly: !!options.rulesOnly,
        timeoutMs: options.chunkTimeoutMs || 45000,
        workers: Math.max(1, options.chunkWorkers || 1),
        allowPartial: !!options.full,
        maxSplitDepth: options.chunkMaxSplitDepth || 8,
        contextCache: new Map<string, Promise<string>>(),
      }, runState);

      const result = mergeResults(runState, scope.totalFiles, scope.chunks.length, !!options.full);
      const modeLabel = options.fast ? ' (fast mode)' : '';
      spinner.succeed(chalk.green(`Review complete! (Codex local mode)${modeLabel}`));

      // Handle fix mode
      if (options.fix) {
        if (!interactiveTty) {
          const fixableIssues = result.issues.filter((issue) => issue.fixable && issue.fix);
          if (!globalOpts.quiet) {
            console.log(chalk.yellow(`⚠ Non-interactive shell detected. Applying ${fixableIssues.length} fix(es) without prompt.`));
          }
          const applyResult = await fixService.applyFixes(fixableIssues);
          if (!globalOpts.quiet) {
            console.log(chalk.green(`\n✓ Applied ${applyResult.applied} fixes`));
            if (applyResult.failed > 0) {
              console.log(chalk.yellow(`⚠ Failed to apply ${applyResult.failed} fixes`));
            }
          }
          return;
        }
        await interactiveUI.runQuickFix(result);
        return;
      }

      // Handle interactive mode (now default if no output format specified)
      const shouldUseInteractive = options.interactive || (!globalOpts.output && globalOpts.format === 'terminal');

      if (shouldUseInteractive && interactiveTty) {
        await interactiveUI.run(result);
        return;
      }
      if (shouldUseInteractive && !interactiveTty && !globalOpts.quiet) {
        console.log(chalk.yellow('⚠ Interactive review UI disabled in non-interactive shell. Printing formatted output instead.'));
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

async function getReviewScope(files: string[], options: ReviewOptions, verbose?: boolean): Promise<{ chunks: ReviewChunk[]; totalFiles: number }> {
  let diffs: string[] = [];
  let chunks: ReviewChunk[] = [];
  let totalFiles = 0;

  gitService.setVerbose(!!verbose);

  if (options.full) {
    if (verbose) {
      console.log(chalk.dim('[verbose] Getting full repository diff'));
    }
    const entries = await gitService.getFullRepositoryFilePatches();
    totalFiles = entries.length;
    chunks = buildChunks(entries, options.chunkMaxChars || 120000);
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
  if (!options.full) {
    chunks = nonEmptyDiffs.map(diff => ({ entries: [], diff }));
  }

  if (verbose) {
    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.diff.length, 0);
    console.log(chalk.dim(`[verbose] Diff chunks: ${chunks.length}, total size: ${totalChars} characters`));
    if (chunks.length === 0) {
      console.log(chalk.dim('[verbose] No changes detected in the requested scope'));
    } else {
      // Show first 500 chars of diff for debugging
      const preview = chunks[0].diff.substring(0, 500);
      console.log(chalk.dim(`[verbose] Diff preview (chunk 1):\n${preview}${chunks[0].diff.length > 500 ? '\n... (truncated)' : ''}`));
    }
  }

  return { chunks, totalFiles };
}

function buildChunks(entries: ChunkEntry[], maxChars: number): ReviewChunk[] {
  const chunks: ReviewChunk[] = [];
  let current: ChunkEntry[] = [];
  let currentChars = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push({
      entries: current,
      diff: current.map(e => e.patch).join('\n\n'),
    });
    current = [];
    currentChars = 0;
  };

  for (const entry of entries) {
    const entryChars = entry.patch.length;
    if (entryChars >= maxChars) {
      flush();
      chunks.push({ entries: [entry], diff: entry.patch });
      continue;
    }

    const extra = current.length > 0 ? 2 : 0;
    if ((currentChars + extra + entryChars) > maxChars) {
      flush();
    }

    current.push(entry);
    currentChars += (current.length > 1 ? 2 : 0) + entryChars;
  }
  flush();
  return chunks;
}

async function runChunks(
  chunks: ReviewChunk[],
  config: ChunkExecutionConfig,
  state: ChunkRunState,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, config.workers);

  const worker = async () => {
    while (cursor < chunks.length) {
      const idx = cursor++;
      if (idx >= chunks.length) {
        return;
      }
      await processChunk(chunks[idx], idx + 1, chunks.length, config, state, 0, 0);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function processChunk(
  chunk: ReviewChunk,
  position: number,
  total: number,
  config: ChunkExecutionConfig,
  state: ChunkRunState,
  splitDepth: number,
  retries: number,
): Promise<void> {
  const chunkId = chunk.entries.map((e) => e.file).join('|') || `chunk-${position}`;
  if (!config.quiet) {
    config.spinner.text = chalk.cyan(`Analyzing chunk ${position}/${total} (${chunk.entries.length || 1} file${(chunk.entries.length || 1) > 1 ? 's' : ''})...`);
  }
  if (config.verbose) {
    console.log(chalk.dim(`[verbose] Chunk ${position}/${total} start: files=${chunk.entries.length || 0}, chars=${chunk.diff.length}, splitDepth=${splitDepth}, retries=${retries}`));
  }

  const getEnrichedDiff = async (): Promise<string> => {
    const cacheKey = `${config.contextFile || ''}\n${chunk.diff}`;
    const cached = config.contextCache.get(cacheKey);
    if (cached) {
      if (config.verbose) {
        console.log(chalk.dim(`[verbose] Context cache hit for chunk ${position}/${total}`));
      }
      return cached;
    }
    const promise = contextService
      .enrichDiffWithContext(chunk.diff, config.contextFile, config.verbose)
      .catch((error) => {
        config.contextCache.delete(cacheKey);
        throw error;
      });
    config.contextCache.set(cacheKey, promise);
    return promise;
  };

  const execute = async (forceFast: boolean): Promise<ReviewResult> => {
    const enrichedDiff = await getEnrichedDiff();
    return codexReviewService.analyze(enrichedDiff, {
      verbose: config.verbose,
      fast: forceFast || config.fast,
      rulesOnly: config.rulesOnly,
      timeoutMs: config.timeoutMs,
    });
  };

  const startedAt = Date.now();
  try {
    const result = await execute(false);
    state.results.push(result);
    state.successfulChunks += 1;
    for (const entry of chunk.entries) state.processedFiles.add(entry.file);
    state.telemetry.push({
      chunkId,
      position,
      total,
      files: chunk.entries.length,
      sizeChars: chunk.diff.length,
      status: 'success',
      durationMs: Date.now() - startedAt,
      retries,
      splitDepth,
    });
    if (config.verbose) {
      console.log(chalk.dim(`[verbose] Chunk ${position}/${total} success in ${Date.now() - startedAt}ms`));
    }
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = /timed out/i.test(message);
    if (!config.quiet) {
      const kind = timedOut ? 'timeout' : 'error';
      console.log(chalk.yellow(`⚠ Chunk ${position}/${total} ${kind}: ${chunk.entries.length} file(s), splitDepth=${splitDepth}`));
    }

    if (chunk.entries.length > 1 && splitDepth < config.maxSplitDepth) {
      state.telemetry.push({
        chunkId,
        position,
        total,
        files: chunk.entries.length,
        sizeChars: chunk.diff.length,
        status: 'split',
        durationMs: Date.now() - startedAt,
        retries,
        splitDepth,
        error: message.slice(0, 300),
      });
      if (!config.quiet) {
        console.log(chalk.yellow(`↳ Splitting chunk ${position}/${total} into 2 subchunks (depth ${splitDepth + 1}/${config.maxSplitDepth})`));
      }
      const mid = Math.floor(chunk.entries.length / 2);
      const left = chunk.entries.slice(0, mid);
      const right = chunk.entries.slice(mid);
      await processChunk(
        { entries: left, diff: left.map(e => e.patch).join('\n\n') },
        position,
        total,
        config,
        state,
        splitDepth + 1,
        retries,
      );
      await processChunk(
        { entries: right, diff: right.map(e => e.patch).join('\n\n') },
        position,
        total,
        config,
        state,
        splitDepth + 1,
        retries,
      );
      return;
    }

    if (timedOut && !config.fast) {
      try {
        if (!config.quiet) {
          console.log(chalk.yellow(`↳ Retrying chunk ${position}/${total} in fast mode`));
        }
        const result = await execute(true);
        state.results.push(result);
        state.successfulChunks += 1;
        for (const entry of chunk.entries) state.processedFiles.add(entry.file);
        state.telemetry.push({
          chunkId,
          position,
          total,
          files: chunk.entries.length,
          sizeChars: chunk.diff.length,
          status: 'success',
          durationMs: Date.now() - startedAt,
          retries: retries + 1,
          splitDepth,
        });
        return;
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        if (!config.allowPartial) {
          throw new Error(retryMessage);
        }
        state.failedChunks += 1;
        for (const entry of chunk.entries) state.failedFiles.add(entry.file);
        state.telemetry.push({
          chunkId,
          position,
          total,
          files: chunk.entries.length,
          sizeChars: chunk.diff.length,
          status: /timed out/i.test(retryMessage) ? 'timeout' : 'failed',
          durationMs: Date.now() - startedAt,
          retries: retries + 1,
          splitDepth,
          error: retryMessage.slice(0, 300),
        });
        if (config.verbose) {
          console.log(chalk.dim(`[verbose] Chunk failed after fast retry: ${chunk.entries[0]?.file || 'unknown'} - ${retryMessage}`));
        }
        return;
      }
    }

    if (!config.allowPartial) {
      throw error;
    }

    state.failedChunks += 1;
    for (const entry of chunk.entries) state.failedFiles.add(entry.file);
    state.telemetry.push({
      chunkId,
      position,
      total,
      files: chunk.entries.length,
      sizeChars: chunk.diff.length,
      status: timedOut ? 'timeout' : 'failed',
      durationMs: Date.now() - startedAt,
      retries,
      splitDepth,
      error: message.slice(0, 300),
    });
    if (config.verbose) {
      console.log(chalk.dim(`[verbose] Chunk failed: ${chunk.entries[0]?.file || 'unknown'} - ${message}`));
    }
  }
}

function mergeResults(state: ChunkRunState, totalFiles: number, chunkCount: number, isFull: boolean): ReviewResult {
  const results = state.results;
  const seen = new Set<string>();
  const issues: ReviewResult['issues'] = [];
  let duration = 0;
  let filesAnalyzed = 0;

  for (const result of results) {
    duration += result.duration || 0;
    filesAnalyzed += result.filesAnalyzed || 0;
    for (const issue of result.issues) {
      const normalizedMessage = issue.message.toLowerCase().replace(/\s+/g, ' ').trim();
      const key = `${issue.ruleId || ''}:${issue.file}:${issue.line}:${issue.endLine || ''}:${issue.severity}:${normalizedMessage}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(issue);
      }
    }
  }

  issues.sort((a, b) => {
    const severityWeight = (s: ReviewIssue['severity']) => ({ critical: 0, error: 1, warning: 2, info: 3 }[s] ?? 9);
    const sev = severityWeight(a.severity) - severityWeight(b.severity);
    if (sev !== 0) return sev;
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) return fileCmp;
    return a.line - b.line;
  });

  if (isFull) {
    filesAnalyzed = Math.max(filesAnalyzed, state.processedFiles.size);
  }

  let summary = results[0]?.summary || 'Review completed';
  const coverage = totalFiles > 0 ? Math.round((state.processedFiles.size / totalFiles) * 100) : 100;
  const totalChunkRuns = Math.max(chunkCount, state.successfulChunks + state.failedChunks);
  if (chunkCount > 1 || isFull) {
    summary = `Chunked full review completed (${state.successfulChunks}/${totalChunkRuns} chunks succeeded, ${state.failedChunks} failed). Found ${issues.length} issue(s). Coverage: ${coverage}% (${state.processedFiles.size}/${totalFiles} files).`;
    if (state.failedFiles.size > 0) {
      summary += ` Failed files: ${Array.from(state.failedFiles).slice(0, 5).join(', ')}${state.failedFiles.size > 5 ? '...' : ''}.`;
    }
  }

  return {
    summary,
    issues,
    filesAnalyzed,
    duration,
    meta: (chunkCount > 1 || isFull) ? {
      chunkedReview: {
        chunked: true,
        totalChunks: totalChunkRuns,
        successfulChunks: state.successfulChunks,
        failedChunks: state.failedChunks,
        totalFiles,
        processedFiles: state.processedFiles.size,
        failedFiles: Array.from(state.failedFiles).sort(),
        coverage,
        partial: state.failedChunks > 0,
        telemetry: state.telemetry,
      },
    } : undefined,
  };
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
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

export const __reviewInternals = {
  buildChunks,
  mergeResults,
  isInteractiveTerminal,
};
