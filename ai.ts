/**
 * ai.ts — the local half of a copy-paste AI coding loop with Gemini chat.
 * Everything except talking to Gemini is automated; you paste the prompt and copy the reply.
 *
 *   start [files...]   New task. Packs the repo around the given files (usually the open file),
 *                      records baseline check results, copies the first prompt to the clipboard.
 *                      With no files, finds them from the task's keywords ("risk table" → RiskTable.tsx);
 *                      if nothing matches, sends a map of the repo and lets Gemini locate the files.
 *                      Task text: --task "…", or the AI_TASK env var, or .ai/task.md
 *                      --plan  ask for a plan first; edits start on the next round
 *                      --all   with no files: pack the whole repo in full instead
 *   next               Reads Gemini's reply from the clipboard, applies the edits, runs checks,
 *                      answers NEED_FILES / FIND / RUN, and copies the follow-up prompt
 *                      (or reports that the task is done).
 *                      --file  read the reply from .ai/reply.md instead of the clipboard
 *                      --force apply even if this exact reply was applied before
 *   repack             Fresh pack with everything touched so far — paste into a NEW Gemini chat
 *                      when the current one gets long.
 *   status | done      Show / close the current task.
 *   gem                Copy the reply-protocol instructions for a Gemini Gem to the clipboard.
 *
 *   Global flag: --no-clipboard  only write .ai/prompt.md
 *
 * Run from the repo root:  npx tsx tools/ai/ai.ts <command>
 * Optional config: tools/ai/ai.config.json (see DEFAULT_CONFIG below).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ───────────────────────── Paths & config ─────────────────────────

const ROOT = process.cwd();
const TOOL_DIR = path.dirname(path.resolve(process.argv[1] ?? 'tools/ai/ai.ts'));
const PACK_SCRIPT = path.join(TOOL_DIR, 'pack-project.ts');
const AI_DIR = path.join(ROOT, '.ai');
const SESSION_FILE = path.join(AI_DIR, 'session.json');
const PROMPT_FILE = path.join(AI_DIR, 'prompt.md');
const REPLY_FILE = path.join(AI_DIR, 'reply.md');
const PACK_FILE = '.ai/pack.txt';

interface Config {
  /** Type-check command; null disables it. Default: auto-detected. */
  typecheck: string | null;
  /** ESLint (errors only) on files the AI touched. Default: on when an ESLint config exists. */
  lint: boolean;
  /** More checks run after every applied reply, e.g. { "name": "tests", "command": "npm test -- --run" }. */
  extraChecks: Array<{ name: string; command: string }>;
  /** Extra arguments for pack-project.ts, e.g. ["--depth", "1", "--sig-depth", "2"]. */
  packArgs: string[];
  /** Above this size, suggest uploading .ai/prompt.md instead of pasting. */
  largePromptChars: number;
  /** Timeout for each check / RUN command. */
  timeoutSec: number;
}

const DEFAULT_CONFIG: Omit<Config, 'typecheck' | 'lint'> = {
  extraChecks: [],
  packArgs: [],
  largePromptChars: 120_000,
  timeoutSec: 300,
};

const MAX_FILE_BYTES = 150 * 1024;
const MAX_PROBLEM_LINES = 80;
const MAX_FIND_LINES = 30;
const MAX_AUTO_FILES = 6;
/** Above this, the "map" pack drops signatures and keeps only the file tree with exported names. */
const MAP_BUDGET_CHARS = 250_000;
/** Above this, a focused pack is shrunk automatically (signatures only near the focus, then tree only). */
const PACK_BUDGET_CHARS = 400_000;

// ───────────────────────── Small helpers ─────────────────────────

const toPosix = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5);
const hash = (s: string): string => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const pad2 = (n: number): string => String(n).padStart(2, '0');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
};

const fail = (message: string): never => {
  throw new Error(message);
};

const run = (command: string, timeoutSec: number): { code: number; output: string } => {
  const r = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
  });
  let output = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  if (r.error || r.signal) output += `\n[${r.signal ? `stopped: ${r.signal} (timeout ${timeoutSec}s?)` : r.error?.message}]`;
  return { code: r.status ?? 1, output: output.trim() };
};

const git = (args: string[]): { code: number; out: string } => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim() };
};

/** Repo-relative path if it is safe to read/write, otherwise null. */
const safeRel = (input: string): string | null => {
  const cleaned = input.trim().replace(/^[\\/]+/, '');
  if (!cleaned) return null;
  const rel = toPosix(path.relative(ROOT, path.resolve(ROOT, cleaned)));
  if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return null;
  const parts = rel.split('/');
  if (parts.some((p) => p === '.git' || p === 'node_modules' || p === '.ai')) return null;
  if (/^\.env(\..+)?$/.test(parts[parts.length - 1]) && !rel.endsWith('.env.example')) return null;
  return rel;
};

const readText = (rel: string): string | null => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return fs.readFileSync(abs, 'utf8');
};

// ───────────────────────── Secret redaction (same rules as pack-project.ts) ─────────────────────────

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '<REDACTED_PRIVATE_KEY>'],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '<REDACTED_JWT>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<REDACTED_AWS_KEY>'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g, '<REDACTED_TOKEN>'],
  [/(Bearer\s+)(?!<REDACTED)[A-Za-z0-9._~+/-]{20,}=*/gi, '$1<REDACTED>'],
  [
    /((?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key)[\w-]*["']?\s*[:=]\s*)(["'`])(?!<REDACTED)([^"'`\s]{8,})\2/gi,
    '$1$2<REDACTED>$2',
  ],
];

const redact = (text: string): string => SECRET_PATTERNS.reduce((t, [re, rep]) => t.replace(re, rep), text);

const fileBlock = (rel: string, content: string): string =>
  `<file path="${rel}">\n${redact(content.replace(/\r\n/g, '\n').trimEnd())}\n</file>`;

// ───────────────────────── Clipboard (Windows / macOS / Linux) ─────────────────────────

const psQuote = (p: string): string => `'${p.replace(/'/g, "''")}'`;

/** Copies a file's text to the clipboard. Goes through a file so non-ASCII text survives on Windows. */
const copyFileToClipboard = (file: string): boolean => {
  if (process.platform === 'win32') {
    const cmd = `Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 -LiteralPath ${psQuote(file)})`;
    return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]).status === 0;
  }
  const input = fs.readFileSync(file);
  const tools = process.platform === 'darwin' ? [['pbcopy']] : [['wl-copy'], ['xclip', '-selection', 'clipboard']];
  return tools.some(([bin, ...args]) => spawnSync(bin, args, { input }).status === 0);
};

const readClipboard = (): string => {
  if (process.platform === 'win32') {
    const tmp = path.join(AI_DIR, 'clipboard.tmp');
    const cmd = `Get-Clipboard -Raw | Out-File -Encoding utf8 -LiteralPath ${psQuote(tmp)}`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    if (r.status !== 0 || !fs.existsSync(tmp)) fail('Could not read the clipboard. Paste the reply into .ai/reply.md and run "next --file".');
    const text = fs.readFileSync(tmp, 'utf8').replace(/^\uFEFF/, '');
    fs.rmSync(tmp, { force: true });
    return text;
  }
  const tools = process.platform === 'darwin' ? [['pbpaste']] : [['wl-paste', '--no-newline'], ['xclip', '-selection', 'clipboard', '-o']];
  for (const [bin, ...args] of tools) {
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    if (r.status === 0) return r.stdout;
  }
  return fail('Could not read the clipboard. Paste the reply into .ai/reply.md and run "next --file".');
};

// ───────────────────────── Config & session ─────────────────────────

const loadConfig = (): Config => {
  const pkg = readJson(path.join(ROOT, 'package.json')) ?? {};
  const scripts: Record<string, string> = pkg.scripts ?? {};
  const user = readJson(path.join(TOOL_DIR, 'ai.config.json')) ?? {};

  const detectTypecheck = (): string | null => {
    if (scripts.typecheck) return 'npm run -s typecheck';
    for (const name of ['tsconfig.app.json', 'tsconfig.json']) {
      if (fs.existsSync(path.join(ROOT, name))) return `npx tsc -p ${name} --noEmit --pretty false`;
    }
    return null;
  };
  const hasEslintConfig = fs.readdirSync(ROOT).some((f) => /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?)$/.test(f));

  return {
    ...DEFAULT_CONFIG,
    ...user,
    typecheck: 'typecheck' in user ? user.typecheck : detectTypecheck(),
    lint: 'lint' in user ? Boolean(user.lint) : hasEslintConfig,
  };
};

interface Session {
  id: string;
  task: string;
  plan: boolean;
  focus: string[];
  touched: string[];
  round: number;
  startedAt: string;
  lastReplyHash: string;
  /** check name → normalized output lines that already failed before the task started */
  baseline: Record<string, string[]>;
  /** file → ESLint errors it had before the AI first touched it */
  lintBaseline: Record<string, string[]>;
}

const loadSession = (): Session => {
  const s = readJson(SESSION_FILE);
  return s ?? fail('No active task. Run "start" first (VS Code: AI: Start task).');
};

const saveSession = (s: Session): void => fs.writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));

const historyDir = (s: Session): string => {
  const dir = path.join(AI_DIR, 'history', s.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const ensureAiDir = (): void => {
  fs.mkdirSync(AI_DIR, { recursive: true });
  const ignore = path.join(AI_DIR, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '# Local AI working files — never commit\n*\n');
};

// ───────────────────────── Reply protocol ─────────────────────────

const FENCE = '```';

const PROTOCOL = `<reply_protocol>
A tool applies your reply to the codebase automatically. Reply with exactly these sections, in this order:

PLAN:
- 2–6 short bullets: what you will change and why. State any assumption.

EDITS:
path/from/repo/root.tsx
${FENCE}tsx
<<<<<<< SEARCH
lines copied exactly from the latest version of the file you were shown
=======
the new lines
>>>>>>> REPLACE
${FENCE}

NEED_FILES: path/a.ts, path/b.ts
FIND: someIdentifier
RUN: npm test -- SomeTest
DONE: no

Rules:
1. Put the file path on its own line directly above each fenced block. Several SEARCH/REPLACE blocks for the same file may share one fence.
2. SEARCH must match the current file exactly, character for character, and match only one place. Use the smallest unique snippet (usually 3–10 lines). Never shorten it with "..." or comments.
3. To create a file, leave SEARCH empty. To delete a file, add a line "DELETE: path".
4. Only edit files you have seen in full. If a file was shown only as signatures or not at all, list it in NEED_FILES and do not edit it yet.
5. FIND (one term per line) returns matching lines from the whole repo. Use it instead of guessing where something is defined or used.
6. RUN accepts only: npm test, npm run <script>, npx tsc|eslint|vitest|jest. Type checks and lint already run after every reply.
7. Leave out NEED_FILES, FIND and RUN when not needed. DONE: yes only when the whole task is finished; otherwise DONE: no.
8. Do not repeat unchanged code outside SEARCH/REPLACE blocks.
</reply_protocol>`;

const GEM_INSTRUCTIONS = `You are a senior engineer pair-programming on a real codebase through a local tool.
I paste you a packed snapshot of the repo (rules, file tree, signatures, full source, git state) and a task.
The tool applies your reply, runs the type checker and linter, and sends back results, requested files and search hits.

${PROTOCOL}

Also:
- Follow <project_rules> and the conventions visible in the full files.
- Never invent imports, props, types or APIs you have not seen. Ask with NEED_FILES or FIND instead.
- When the tool reports errors, fix the cause; do not silence type errors with "any", casts or ts-ignore.`;

interface EditBlock { file: string; search: string; replace: string }

interface Reply {
  plan: string;
  edits: EditBlock[];
  deletes: string[];
  needFiles: string[];
  finds: string[];
  runs: string[];
  done: boolean | null;
  malformed: string[];
}

const SEARCH_RE = /^\s*<{5,9}\s*SEARCH\s*$/;
const DIVIDER_RE = /^\s*={5,9}\s*$/;
const REPLACE_RE = /^\s*>{5,9}\s*REPLACE\s*$/;
const FENCE_RE = /^\s*`{3,}/;
const LABEL_RE = /^\s*(?:#{1,6}\s*)?[*_]*\s*(PLAN|EDITS|NEED_FILES|FIND|RUN|DONE|DELETE)\s*[*_]*\s*:\s*[*_]*\s*(.*)$/i;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

const cleanItem = (s: string): string =>
  s.replace(BULLET_RE, '').replace(/^[`'"*_]+|[`'"*_,;]+$/g, '').trim();

const isNone = (s: string): boolean => /^(none|n\/?a|-|—|nothing|no)\.?$/i.test(s.trim());

/** The file path written above a SEARCH block (or the previous block's path). */
const pathAbove = (lines: string[], index: number, lastPath: string): string => {
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim() || FENCE_RE.test(line)) continue;
    if (REPLACE_RE.test(line)) return lastPath;
    const candidate = line
      .replace(/^\s*(?:#{1,6}\s*|[-*•]\s+)?/, '')
      .replace(/^[*_`"']+|[*_`"':]+$/g, '')
      .replace(/^(?:file|path|filename|edits)\s*:\s*/i, '')
      .replace(/\s*\((?:new|new file|create[d]?)\)\s*$/i, '')
      .replace(/^[`"']+|[`"']+$/g, '')
      .trim();
    return /^[\w@.\-/\\ ]*[\w-]\.[\w]+$|^[\w@.\-/\\]+\/[\w.-]+$/.test(candidate) ? candidate : lastPath;
  }
  return lastPath;
};

const parseReply = (raw: string): Reply => {
  const lines = raw.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
  const reply: Reply = { plan: '', edits: [], deletes: [], needFiles: [], finds: [], runs: [], done: null, malformed: [] };
  const outside: string[] = [];
  let lastPath = '';

  for (let i = 0; i < lines.length; i++) {
    if (!SEARCH_RE.test(lines[i])) {
      outside.push(lines[i]);
      continue;
    }
    const file = pathAbove(lines, i, lastPath);
    const search: string[] = [];
    const replace: string[] = [];
    let j = i + 1;
    while (j < lines.length && !DIVIDER_RE.test(lines[j])) search.push(lines[j++]);
    j++;
    while (j < lines.length && !REPLACE_RE.test(lines[j])) replace.push(lines[j++]);
    if (j >= lines.length) {
      reply.malformed.push(`Unterminated SEARCH/REPLACE block for ${file || 'unknown file'} (missing ======= or >>>>>>> REPLACE).`);
      break;
    }
    reply.edits.push({ file, search: search.join('\n'), replace: replace.join('\n') });
    lastPath = file;
    i = j;
  }

  let section: string | null = null;
  const plan: string[] = [];
  const add = (key: string, value: string): void => {
    const v = cleanItem(value);
    if (!v || isNone(v)) return;
    if (key === 'NEED_FILES') reply.needFiles.push(...v.split(/[,\s]+/).map(cleanItem).filter(Boolean));
    else if (key === 'FIND') reply.finds.push(v);
    else if (key === 'RUN') reply.runs.push(v);
    else if (key === 'DELETE') reply.deletes.push(v);
  };

  for (const line of outside) {
    const m = line.match(LABEL_RE);
    if (m) {
      section = m[1].toUpperCase();
      const value = m[2].trim();
      if (section === 'PLAN' && value) plan.push(value);
      else if (section === 'DONE') reply.done = /^[*_`\s]*(yes|true|y|done)\b/i.test(value) ? true : /^[*_`\s]*(no|false|n)\b/i.test(value) ? false : null;
      else add(section, value);
      continue;
    }
    if (section === 'PLAN') {
      if (!FENCE_RE.test(line)) plan.push(line);
    } else if (section && ['NEED_FILES', 'FIND', 'RUN', 'DELETE'].includes(section) && BULLET_RE.test(line)) {
      add(section, line);
    } else if (line.trim()) {
      section = section === 'PLAN' ? section : null;
    }
  }
  reply.plan = plan.join('\n').trim();
  return reply;
};

// ───────────────────────── Applying edits ─────────────────────────

const indentOf = (s: string): string => s.match(/^\s*/)?.[0] ?? '';

const trimBlankEdges = (lines: string[]): string[] => {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};

type ReplaceResult = { content: string; fuzzy: boolean } | { error: string };

/** Replace exactly one occurrence; falls back to matching lines while ignoring indentation. */
const replaceOnce = (content: string, search: string, replace: string): ReplaceResult => {
  const occurrences = search ? content.split(search).length - 1 : 0;
  if (occurrences === 1) {
    const i = content.indexOf(search);
    return { content: content.slice(0, i) + replace + content.slice(i + search.length), fuzzy: false };
  }
  if (occurrences > 1) return { error: `SEARCH matches ${occurrences} places. Include more surrounding lines so it is unique.` };

  const fileLines = content.split('\n');
  const searchLines = trimBlankEdges(search.split('\n'));
  if (!searchLines.length) return { error: 'SEARCH is blank.' };

  const matches: number[] = [];
  for (let i = 0; i + searchLines.length <= fileLines.length; i++) {
    let ok = true;
    for (let k = 0; k < searchLines.length && ok; k++) ok = fileLines[i + k].trim() === searchLines[k].trim();
    if (ok) matches.push(i);
  }
  if (matches.length > 1) return { error: `SEARCH matches ${matches.length} places. Include more surrounding lines so it is unique.` };
  if (!matches.length) return { error: 'SEARCH text not found. It must match the current file exactly (see the current file below).' };

  const at = matches[0];
  const from = indentOf(searchLines[0]);
  const to = indentOf(fileLines[at]);
  const replacement = trimBlankEdges(replace.split('\n')).map((l) =>
    !l.trim() ? l : l.startsWith(from) ? to + l.slice(from.length) : l);
  fileLines.splice(at, searchLines.length, ...replacement);
  return { content: fileLines.join('\n'), fuzzy: true };
};

interface FileResult {
  file: string;
  applied: number;
  fuzzy: number;
  created: boolean;
  deleted: boolean;
  errors: string[];
}

const detectRepoEol = (): string => {
  const sample = readText('package.json') ?? '';
  return sample.includes('\r\n') ? '\r\n' : '\n';
};

const applyReply = (reply: Reply): FileResult[] => {
  const results = new Map<string, FileResult>();
  const resultFor = (file: string): FileResult => {
    if (!results.has(file)) results.set(file, { file, applied: 0, fuzzy: 0, created: false, deleted: false, errors: [] });
    return results.get(file)!;
  };
  const repoEol = detectRepoEol();

  const byFile = new Map<string, EditBlock[]>();
  for (const edit of reply.edits) {
    const rel = safeRel(edit.file);
    if (!rel) {
      resultFor(edit.file || '(no path)').errors.push('Missing or disallowed file path (outside the repo, .git, node_modules or .env). Put the path on its own line above the block.');
      continue;
    }
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel)!.push(edit);
  }

  for (const [rel, edits] of byFile) {
    const result = resultFor(rel);
    const original = readText(rel);
    const bom = original?.startsWith('\uFEFF') ? '\uFEFF' : '';
    const eol = original === null ? repoEol : original.includes('\r\n') ? '\r\n' : '\n';
    let content = original === null ? null : original.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

    for (const edit of edits) {
      const search = edit.search.replace(/\r\n/g, '\n');
      const replace = edit.replace.replace(/\r\n/g, '\n');
      if (!search.trim()) {
        if (content === null || !content.trim()) {
          content = `${trimBlankEdges(replace.split('\n')).join('\n')}\n`;
          result.created = original === null;
          result.applied++;
        } else {
          result.errors.push('SEARCH is empty but the file already exists. Quote the lines to replace.');
        }
        continue;
      }
      if (content === null) {
        result.errors.push('File does not exist. To create it, use an empty SEARCH.');
        continue;
      }
      const r = replaceOnce(content, search, replace);
      if ('error' in r) {
        result.errors.push(`${r.error}\nSEARCH was:\n${search}`);
      } else {
        content = r.content;
        result.applied++;
        if (r.fuzzy) result.fuzzy++;
      }
    }

    if (content !== null && result.applied > 0) {
      const abs = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bom + content.replace(/\n/g, eol));
    }
  }

  for (const target of reply.deletes) {
    const rel = safeRel(target);
    const result = resultFor(rel ?? target);
    if (!rel || readText(rel) === null) result.errors.push('Cannot delete: file not found or path not allowed.');
    else if (git(['ls-files', '--error-unmatch', rel]).code !== 0) result.errors.push('Refused to delete: file is not tracked by git (could not be restored).');
    else {
      fs.rmSync(path.join(ROOT, rel));
      result.deleted = true;
      result.applied++;
    }
  }
  return [...results.values()];
};

// ───────────────────────── Checks ─────────────────────────

const normalizeLine = (line: string): string =>
  line.split(ROOT).join('').replace(/\\/g, '/').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

interface CheckResult { name: string; ok: boolean; problems: string[]; note?: string }

/** Runs a command; only output lines not present in the baseline count as problems. */
const runCheck = (name: string, command: string, baseline: string[], cfg: Config): CheckResult => {
  const { code, output } = run(command, cfg.timeoutSec);
  if (code === 0) return { name, ok: true, problems: [] };
  const known = new Set(baseline);
  const fresh = output.split(/\r?\n/).filter((l) => l.trim() && !known.has(normalizeLine(l)));
  const real = fresh.filter((l) => !/^(Found \d+ errors?|npm (ERR!|error)|>\s)/.test(l.trim()));
  return real.length
    ? { name, ok: false, problems: fresh.slice(0, MAX_PROBLEM_LINES) }
    : { name, ok: true, problems: [], note: 'only problems that existed before this task' };
};

const baselineFor = (command: string, cfg: Config): string[] => {
  const { code, output } = run(command, cfg.timeoutSec);
  return code === 0 ? [] : output.split(/\r?\n/).filter((l) => l.trim()).map(normalizeLine);
};

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;

/** ESLint errors (severity 2) per file, or null when ESLint could not run. */
const eslintErrors = (files: string[], cfg: Config): Map<string, string[]> | null => {
  const targets = files.filter((f) => CODE_FILE.test(f) && readText(f) !== null);
  const result = new Map<string, string[]>(targets.map((f) => [f, []]));
  if (!targets.length) return result;
  const { output } = run(`npx eslint --format json ${targets.map((f) => `"${f}"`).join(' ')}`, cfg.timeoutSec);
  try {
    const start = output.indexOf('[{');
    const data: Array<{ filePath: string; messages: Array<{ severity: number; line?: number; column?: number; ruleId?: string | null; message: string }> }> =
      JSON.parse(output.slice(start, output.lastIndexOf('}]') + 2));
    for (const entry of data) {
      const rel = toPosix(path.relative(ROOT, entry.filePath));
      const errors = entry.messages
        .filter((m) => m.severity === 2)
        .map((m) => `${rel}:${m.line ?? 0}:${m.column ?? 0}  ${m.message}${m.ruleId ? `  (${m.ruleId})` : ''}`);
      result.set(rel, errors);
    }
    return result;
  } catch {
    return null;
  }
};

/** Line/column numbers are normalized away, so a moved-but-unchanged error still matches. */
const lintKey = (problem: string): string => normalizeLine(problem);

const runLint = (files: string[], s: Session, cfg: Config): CheckResult => {
  const current = eslintErrors(files, cfg);
  if (!current) return { name: 'eslint', ok: true, problems: [], note: 'could not run ESLint (skipped)' };
  const problems: string[] = [];
  for (const [file, errors] of current) {
    const known = new Set(s.lintBaseline[file] ?? []);
    problems.push(...errors.filter((e) => !known.has(lintKey(e))));
  }
  return { name: 'eslint', ok: problems.length === 0, problems: problems.slice(0, MAX_PROBLEM_LINES) };
};

/** Before the AI first touches a file, remember its existing lint errors so they aren't blamed on the AI. */
const recordLintBaseline = (files: string[], s: Session, cfg: Config): void => {
  const fresh = files.filter((f) => !(f in s.lintBaseline) && CODE_FILE.test(f));
  if (!fresh.length) return;
  const errors = eslintErrors(fresh, cfg);
  for (const f of fresh) s.lintBaseline[f] = (errors?.get(f) ?? []).map(lintKey);
};

// ───────────────────────── NEED_FILES / FIND / RUN ─────────────────────────

const trackedFiles = (): string[] => git(['ls-files']).out.split('\n').filter(Boolean);

const neededFile = (requested: string, tracked: string[]): string => {
  const rel = safeRel(requested);
  const text = rel ? readText(rel) : null;
  if (rel && text !== null) {
    return Buffer.byteLength(text) > MAX_FILE_BYTES
      ? `<file path="${rel}">\n[too large to include (${Math.round(Buffer.byteLength(text) / 1024)} KB). Use FIND for specific symbols.]\n</file>`
      : fileBlock(rel, text);
  }
  const base = path.posix.basename(toPosix(requested));
  const similar = tracked.filter((f) => path.posix.basename(f) === base).slice(0, 5);
  return `<missing path="${requested}">Not found.${similar.length ? ` Files with the same name: ${similar.join(', ')}` : ''}</missing>`;
};

const findInRepo = (term: string): string => {
  const r = spawnSync('git', ['grep', '-n', '-I', '-F', '--untracked', '--full-name', '-e', term], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const lines = (r.stdout ?? '').split('\n')
    .filter((l) => l && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)[:]/.test(l) && !/\.min\.(js|css):/.test(l))
    .map((l) => (l.length > 220 ? `${l.slice(0, 220)}…` : l));
  const shown = lines.slice(0, MAX_FIND_LINES);
  const more = lines.length > shown.length ? `\n… ${lines.length - shown.length} more matches (use a more specific term)` : '';
  return `<find term="${term.replace(/"/g, '&quot;')}">\n${shown.length ? redact(shown.join('\n')) + more : 'No matches.'}\n</find>`;
};

const RUN_ALLOWED = /^(?:npm\s+(?:test|run\s+[\w:.-]+)|npx\s+(?:tsc|eslint|vitest|jest))(?:\s|$)/;

const runRequested = (command: string, scripts: Record<string, string>, cfg: Config): { ok: boolean; text: string } => {
  const cmd = command.trim();
  const script = cmd.match(/^npm\s+(?:run\s+([\w:.-]+)|(test))/);
  const allowed = RUN_ALLOWED.test(cmd) && !/[;&|`$<>\n]/.test(cmd) && (!script || (script[2] ? 'test' in scripts : script[1] in scripts));
  if (!allowed) return { ok: false, text: `<run command="${cmd}">Not run: only npm test, npm run <existing script>, npx tsc|eslint|vitest|jest are allowed.</run>` };
  const { code, output } = run(cmd, cfg.timeoutSec);
  const tail = output.split('\n').slice(-MAX_PROBLEM_LINES).join('\n');
  return { ok: code === 0, text: `<run command="${cmd}" exit_code="${code}">\n${redact(tail)}\n</run>` };
};

// ───────────────────────── Finding files from the task text ─────────────────────────

const STOPWORDS = new Set(`a an the and or but for with into onto from to of in on at by via per as is are was be been will would should could can
  add adds adding update updates updating change changes changing make makes create creates creating fix fixes fixing new
  use uses using show shows display want need needs please also all some each every when where what which who how why
  this that these those it its them they there here then than so just only like instead able not no yes more less
  code file files component components function functions support allow allows let lets get set put remove delete move rename`.split(/\s+/));

const splitWords = (text: string): string[] =>
  text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [];

/** "buttons" → "button", "entries" → "entry"; leaves "class", "status" alone. */
const singular = (w: string): string =>
  w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y`
    : w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w;

/**
 * Picks likely focus files from the task text without any AI: file names that match
 * multi-word phrases ("risk table" → RiskTable.tsx) score highest, then content matches.
 */
const locateFiles = (task: string): Array<{ file: string; why: string }> => {
  const listed = git(['ls-files', '--cached', '--others', '--exclude-standard']).out.split('\n').filter(Boolean);
  const wantsTests = /\b(test|tests|spec|specs|stor(y|ies))\b/i.test(task);
  const candidates = listed.map(toPosix).filter((f) => CODE_FILE.test(f) && safeRel(f) && !f.startsWith('tools/ai/')
    && (wantsTests || !/(\.(test|spec|stories)\.[^.]+$|(^|\/)(__tests__|tests?)\/)/.test(f)) && readText(f) !== null);

  // A path or file name typed in the task wins outright.
  const named = candidates.filter((f) => task.includes(f) || new RegExp(`\\b${path.posix.basename(f).replace(/\./g, '\\.')}\\b`).test(task));
  if (named.length) return named.slice(0, 3).map((file) => ({ file, why: 'named in the task' }));

  const words = splitWords(task).filter((w) => w.length > 2 && !STOPWORDS.has(w)).map(singular);
  if (!words.length) return [];
  const phrases: string[][] = [];
  for (let n = 3; n >= 2; n--) for (let i = 0; i + n <= words.length; i++) phrases.push(words.slice(i, i + n));

  const scores = new Map<string, { score: number; why: string[] }>();
  const bump = (file: string, points: number, why: string): void => {
    const entry = scores.get(file) ?? { score: 0, why: [] };
    entry.score += points;
    if (!entry.why.includes(why)) entry.why.push(why);
    scores.set(file, entry);
  };

  for (const file of candidates) {
    const base = path.posix.basename(file).replace(/\.[^.]+$/, '').replace(/\.(test|spec|stories)$/, '');
    const baseKey = splitWords(base).map(singular).join('');
    const dirWords = new Set(splitWords(path.posix.dirname(file)).map(singular));
    for (const p of phrases) {
      const key = p.join('');
      if (baseKey === key) bump(file, 10, `file name = "${p.join(' ')}"`);
      else if (baseKey.includes(key)) bump(file, 6, `file name contains "${p.join(' ')}"`);
    }
    for (const w of words) {
      if (baseKey.includes(w)) bump(file, 2, `name has "${w}"`);
      else if (dirWords.has(w)) bump(file, 1, `folder "${w}"`);
    }
  }

  // Content: identifiers like RiskTable / riskTable / risk-table / risk_table.
  for (const p of phrases) {
    const pattern = p.map((w) => `${w}s?`).join('[-_ ]?');
    const hits = spawnSync('git', ['grep', '-l', '-i', '-E', '--untracked', '-e', pattern, '--', ...['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs']], { cwd: ROOT, encoding: 'utf8' });
    const files = (hits.stdout ?? '').split('\n').filter((f) => f && candidates.includes(toPosix(f)));
    if (files.length && files.length <= 25) for (const f of files) bump(toPosix(f), 3, `mentions "${p.join(' ')}"`);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const top = ranked[0]?.[1].score ?? 0;
  if (top < 6) return [];
  return ranked
    .filter(([, v]) => v.score >= Math.max(6, top * 0.6))
    .slice(0, 3)
    .map(([file, v]) => ({ file, why: v.why.slice(0, 2).join(', ') }));
};

// ───────────────────────── Pack & prompt delivery ─────────────────────────

const runPack = (focus: string[], cfg: Config, extra: string[] = []): string => {
  if (!fs.existsSync(PACK_SCRIPT)) fail(`pack-project.ts not found next to ai.ts (${PACK_SCRIPT}).`);
  const args = [...(focus.length ? ['--focus', ...focus] : []), '--out', PACK_FILE, ...extra, ...cfg.packArgs];
  // Re-use the tsx loader this process runs under.
  const r = process.execArgv.length
    ? spawnSync(process.execPath, [...process.execArgv, PACK_SCRIPT, ...args], { cwd: ROOT, stdio: 'inherit' })
    : spawnSync(`npx tsx "${PACK_SCRIPT}" ${args.map((a) => `"${a}"`).join(' ')}`, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) fail('pack-project.ts failed (see above).');
  const pack = fs.readFileSync(path.join(ROOT, PACK_FILE), 'utf8');
  const cut = pack.lastIndexOf('\n<task>\n');
  return (cut === -1 ? pack : pack.slice(0, cut)).trimEnd();
};

/**
 * Packs, then shrinks automatically when the result is too big to paste:
 * signatures only near the focus (--sig-depth 2), then the file tree with exported names only.
 * Skipped when you set --sig-depth / --tree-only yourself in ai.config.json packArgs.
 */
const packWithinBudget = (focus: string[], cfg: Config, mapMode: boolean): string => {
  const base = mapMode ? ['--map'] : [];
  const budget = mapMode ? MAP_BUDGET_CHARS : PACK_BUDGET_CHARS;
  let pack = runPack(focus, cfg, base);
  if (pack.length <= budget || cfg.packArgs.some((a) => a === '--sig-depth' || a === '--tree-only')) return pack;

  const steps = mapMode ? [['--tree-only']] : [['--sig-depth', '2'], ['--tree-only']];
  for (const step of steps) {
    console.log(`\nPack is ~${estimateTokens(pack).toLocaleString()} tokens, too big: retrying with ${step.join(' ')}.`);
    pack = runPack(focus, cfg, [...base, ...step]);
    if (pack.length <= budget) break;
  }
  return pack;
};

const deliver = (prompt: string, s: Session, label: string, cfg: Config, noClipboard: boolean): void => {
  fs.writeFileSync(PROMPT_FILE, prompt);
  fs.writeFileSync(path.join(historyDir(s), `round-${pad2(s.round + 1)}-prompt.md`), prompt);
  const tokens = estimateTokens(prompt).toLocaleString();
  const copied = !noClipboard && copyFileToClipboard(PROMPT_FILE);
  console.log(`\n→ ${label} (~${tokens} tokens) ${copied ? 'copied to the clipboard' : 'written to .ai/prompt.md'}.`);
  if (prompt.length > cfg.largePromptChars) {
    console.log('  Large prompt: if Gemini cuts it off, upload .ai/prompt.md as a file instead of pasting.');
  }
};

// ───────────────────────── Commands ─────────────────────────

const parseFlags = (argv: string[]): { positional: string[]; flags: Record<string, string | true> } => {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    if (key === 'task') flags.task = argv[++i] ?? '';
    else flags[key] = true;
  }
  return { positional, flags };
};

const start = (files: string[], flags: Record<string, string | true>, cfg: Config): void => {
  ensureAiDir();
  const taskFile = path.join(AI_DIR, 'task.md');
  const task = (typeof flags.task === 'string' ? flags.task : process.env.AI_TASK || (fs.existsSync(taskFile) ? fs.readFileSync(taskFile, 'utf8') : '')).trim();
  if (!task) fail('No task given. Use --task "…", the AI_TASK env var, or write it in .ai/task.md.');

  let focus = [...new Set(files.map(safeRel).filter((f): f is string => !!f && readText(f) !== null))];
  let focusNote = '';
  let mapMode = false;
  if (!focus.length && flags.all === true) {
    console.log('No focus: packing the whole repo in full (can be large).');
  } else if (!focus.length) {
    const found = locateFiles(task);
    if (found.length) {
      focus = found.map((f) => f.file);
      console.log('Found by keywords in the task:');
      for (const f of found) console.log(`  • ${f.file}  (${f.why})`);
      focusNote = `<focus_note>\nThe files in full were picked automatically from keywords in the task: ${focus.join(', ')}. If the code to change is elsewhere, use FIND / NEED_FILES before editing.\n</focus_note>\n\n`;
    } else {
      mapMode = true;
      console.log('No file matched the task\'s keywords: sending a map of the repo (signatures only). Gemini will locate the files first.');
      focusNote = '<focus_note>\nNo files are included in full yet. Use the file tree and signatures to work out which files matter, then request them with NEED_FILES (and FIND if needed) before editing.\n</focus_note>\n\n';
    }
  }

  const dirty = git(['status', '--porcelain']).out.split('\n').filter((l) => l && !l.includes('.ai/'));
  if (dirty.length) console.log(`Note: ${dirty.length} uncommitted change(s). Commit or stash first so AI edits are easy to review and undo.`);

  const now = new Date();
  const s: Session = {
    id: `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`,
    task, plan: flags.plan === true || mapMode, focus, touched: [], round: 0,
    startedAt: now.toISOString(), lastReplyHash: '', baseline: {}, lintBaseline: {},
  };

  const pack = packWithinBudget(focus, cfg, mapMode);

  const checks = [...(cfg.typecheck ? [{ name: 'typecheck', command: cfg.typecheck }] : []), ...cfg.extraChecks];
  for (const c of checks) {
    process.stdout.write(`Recording baseline: ${c.name}… `);
    s.baseline[c.name] = baselineFor(c.command, cfg);
    console.log(s.baseline[c.name].length ? `${s.baseline[c.name].length} existing problem line(s) will be ignored` : 'clean');
  }
  recordLintBaseline(focus, s, cfg);

  const planNote = s.plan ? '\nThis round: reply with PLAN and NEED_FILES/FIND only. No EDITS yet; I will confirm the plan first.' : '';
  const prompt = `${pack}\n\n${focusNote}<task>\n${task}\n</task>\n\n${PROTOCOL}${planNote}\n`;
  saveSession(s);
  deliver(prompt, s, 'First prompt', cfg, flags['no-clipboard'] === true);
  console.log('  Paste it into a NEW Gemini chat. When the reply arrives, use its Copy button, then run "next".');
};

const next = (flags: Record<string, string | true>, cfg: Config): void => {
  const s = loadSession();
  const raw = flags.file === true
    ? (fs.existsSync(REPLY_FILE) ? fs.readFileSync(REPLY_FILE, 'utf8') : fail('.ai/reply.md not found.'))
    : readClipboard();

  if (!raw.trim()) fail('The reply is empty. Copy Gemini\'s reply first.');
  if (raw.includes('<reply_protocol>') || raw.trimStart().startsWith('# Project context') || raw.trimStart().startsWith('## Round')) {
    fail('That is the prompt, not Gemini\'s reply. Copy the reply (Copy button under it) and run again.');
  }
  const replyHash = hash(raw);
  if (replyHash === s.lastReplyHash && flags.force !== true) fail(`This reply was already applied in round ${s.round}. Copy the new reply (or use --force).`);

  const reply = parseReply(raw);
  const nothing = !reply.edits.length && !reply.deletes.length && !reply.needFiles.length && !reply.finds.length && !reply.runs.length && reply.done === null && !reply.plan;
  if (nothing) fail('No PLAN / EDITS / NEED_FILES / FIND / RUN / DONE sections found. Was the whole reply copied? Did Gemini follow the protocol?');

  s.round++;
  s.lastReplyHash = replyHash;
  fs.writeFileSync(path.join(historyDir(s), `round-${pad2(s.round)}-reply.md`), raw);
  const pkg = readJson(path.join(ROOT, 'package.json')) ?? {};
  const scripts: Record<string, string> = pkg.scripts ?? {};

  if (reply.plan) console.log(`\nPLAN (round ${s.round}):\n${reply.plan.split('\n').map((l) => `  ${l}`).join('\n')}`);

  // 1. Apply edits.
  if (cfg.lint) {
    const willTouch = reply.edits.map((e) => safeRel(e.file)).filter((f): f is string => !!f && readText(f) !== null);
    recordLintBaseline([...new Set(willTouch)], s, cfg);
  }
  const results = applyReply(reply);
  const changed = results.filter((r) => r.applied > 0).map((r) => r.file);
  s.touched = [...new Set([...s.touched, ...changed.filter((f) => !results.find((r) => r.file === f)?.deleted)])];
  s.focus = [...new Set([...s.focus, ...reply.needFiles.map(safeRel).filter((f): f is string => !!f && readText(f) !== null)])];

  const blocks = reply.edits.length + reply.deletes.length;
  const appliedCount = results.reduce((n, r) => n + r.applied, 0);
  const failedFiles = results.filter((r) => r.errors.length);
  console.log(`\nRound ${s.round}: applied ${appliedCount}/${blocks} edit block(s) in ${changed.length} file(s)`);
  for (const r of results) {
    const tags = [r.created && 'new', r.deleted && 'deleted', r.fuzzy && `${r.fuzzy} matched ignoring indentation`].filter(Boolean).join(', ');
    console.log(`  ${r.errors.length ? '✗' : '✓'} ${r.file}${tags ? ` (${tags})` : ''}${r.errors.length ? ` — ${r.errors.length} failed` : ''}`);
  }
  for (const m of reply.malformed) console.log(`  ✗ ${m}`);

  // 2. Checks (only when something changed).
  const checks: CheckResult[] = [];
  if (appliedCount > 0) {
    if (cfg.typecheck) checks.push(runCheck('typecheck', cfg.typecheck, s.baseline.typecheck ?? [], cfg));
    if (cfg.lint) checks.push(runLint(s.touched, s, cfg));
    for (const c of cfg.extraChecks) checks.push(runCheck(c.name, c.command, s.baseline[c.name] ?? [], cfg));
    for (const c of checks) {
      console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? (c.note ? ` (${c.note})` : '') : `: ${c.problems.length} new problem line(s)`}`);
    }
  }
  const failedChecks = checks.filter((c) => !c.ok);

  // 3. Requests from the model.
  const tracked = reply.needFiles.length ? trackedFiles() : [];
  const requested = reply.needFiles.map((f) => neededFile(f, tracked));
  const finds = reply.finds.map(findInRepo);
  const runs = reply.runs.map((c) => runRequested(c, scripts, cfg));
  if (reply.needFiles.length) console.log(`  + NEED_FILES: ${reply.needFiles.join(', ')}`);
  if (reply.finds.length) console.log(`  + FIND: ${reply.finds.join(' | ')}`);
  for (const r of runs) console.log(`  ${r.ok ? '✓' : '✗'} RUN ${r.text.match(/command="([^"]*)"/)?.[1]}`);

  const problems = failedFiles.length > 0 || failedChecks.length > 0 || runs.some((r) => !r.ok) || reply.malformed.length > 0;
  const requests = requested.length > 0 || finds.length > 0;

  if (!problems && !requests && reply.done === true) {
    saveSession(s);
    console.log(`\n✓ Done in ${s.round} round(s). Review the changes in Source Control, then commit.`);
    console.log('  Run "done" to close the task (or "start" for a new one).');
    return;
  }

  // 4. Build the follow-up prompt.
  const failingPaths = new Set<string>(failedFiles.map((r) => r.file).filter((f) => readText(f) !== null));
  for (const c of failedChecks) {
    for (const line of c.problems) {
      const m = line.match(/([\w@.\-/\\]+\.(?:tsx?|jsx?|mjs|cjs))(?=[(:])/);
      const rel = m ? safeRel(m[1]) : null;
      if (rel && readText(rel) !== null) failingPaths.add(rel);
    }
  }
  const currentFiles = [...failingPaths].slice(0, MAX_AUTO_FILES).map((f) => {
    const text = readText(f)!;
    return Buffer.byteLength(text) > MAX_FILE_BYTES ? `<file path="${f}">[too large to include; use FIND or ask for a section]</file>` : fileBlock(f, text);
  });

  const parts: string[] = [`## Round ${s.round} results`];
  if (blocks) {
    const lines = results.map((r) => `- ${r.file}: ${r.applied} applied${r.errors.length ? `, ${r.errors.length} FAILED` : ''}${r.created ? ' (created)' : ''}${r.deleted ? ' (deleted)' : ''}`);
    parts.push(`<apply_results>\n${lines.join('\n')}\n</apply_results>`);
  }
  if (failedFiles.length || reply.malformed.length) {
    const details = [
      ...failedFiles.flatMap((r) => r.errors.map((e) => `[${r.file}] ${e}`)),
      ...reply.malformed,
    ];
    parts.push(`<failed_edits>\nThese edits were NOT applied. Redo them against the current file content.\n\n${details.join('\n\n')}\n</failed_edits>`);
  }
  if (failedChecks.length) {
    parts.push(`<check_failures>\nNew problems introduced by your edits (pre-existing problems are filtered out):\n${failedChecks.map((c) => `### ${c.name}\n${redact(c.problems.join('\n'))}`).join('\n\n')}\n</check_failures>`);
  } else if (appliedCount > 0) {
    parts.push(`<checks>All checks pass (${checks.map((c) => c.name).join(', ') || 'none configured'}).</checks>`);
  }
  if (currentFiles.length) parts.push(`<current_files>\nCurrent content of files with failures:\n${currentFiles.join('\n\n')}\n</current_files>`);
  if (requested.length) parts.push(`<requested_files>\n${requested.join('\n\n')}\n</requested_files>`);
  if (finds.length) parts.push(`<find_results>\n${finds.join('\n\n')}\n</find_results>`);
  if (runs.length) parts.push(`<run_results>\n${runs.map((r) => r.text).join('\n\n')}\n</run_results>`);

  let instruction: string;
  if (s.plan && s.round === 1 && !blocks) instruction = 'Plan approved. Implement it now with EDITS.';
  else if (problems) instruction = reply.done ? 'You marked DONE, but there are failures above. Fix them.' : 'Fix the failures above, then continue.';
  else if (requests) instruction = 'Here is what you asked for. Continue with EDITS.';
  else instruction = 'Edits applied and checks pass. Continue with the next step, or reply DONE: yes if the task is complete.';

  parts.push(`${instruction}\nTask: ${s.task}\nReply with the same protocol (PLAN / EDITS / NEED_FILES / FIND / RUN / DONE).`);
  saveSession(s);
  deliver(`${parts.join('\n\n')}\n`, s, `Round ${s.round + 1} prompt`, cfg, flags['no-clipboard'] === true);
  console.log('  Paste it into the SAME Gemini chat.');
};

const repack = (flags: Record<string, string | true>, cfg: Config): void => {
  const s = loadSession();
  const focus = [...new Set([...s.focus, ...s.touched])].filter((f) => readText(f) !== null);
  const pack = packWithinBudget(focus, cfg, false);
  const progress = `<progress>\nThis continues a task already in progress (${s.round} round(s) so far). Files changed so far: ${s.touched.join(', ') || 'none'}.\nThe uncommitted diff in <git_state> shows the work done so far. Continue from there.\n</progress>`;
  deliver(`${pack}\n\n<task>\n${s.task}\n</task>\n\n${progress}\n\n${PROTOCOL}\n`, s, 'Fresh pack', cfg, flags['no-clipboard'] === true);
  console.log('  Paste it into a NEW Gemini chat.');
};

const status = (): void => {
  const s = loadSession();
  console.log(`Task: ${s.task}\nStarted: ${s.startedAt}\nRounds: ${s.round}\nFocus: ${s.focus.join(', ') || '(whole repo)'}\nTouched: ${s.touched.join(', ') || 'none'}\nHistory: .ai/history/${s.id}/`);
};

const done = (): void => {
  const s = loadSession();
  fs.renameSync(SESSION_FILE, path.join(historyDir(s), 'session.json'));
  console.log(`Closed task after ${s.round} round(s). Files changed: ${s.touched.join(', ') || 'none'}. History kept in .ai/history/${s.id}/`);
};

const gem = (flags: Record<string, string | true>): void => {
  ensureAiDir();
  const file = path.join(AI_DIR, 'gem-instructions.md');
  fs.writeFileSync(file, GEM_INSTRUCTIONS);
  const copied = flags['no-clipboard'] !== true && copyFileToClipboard(file);
  console.log(`Gem instructions ${copied ? 'copied to the clipboard' : 'written'} (.ai/gem-instructions.md).`);
  console.log('In Gemini: Gems → New Gem → paste into Instructions → Save. Start each task in a chat with that Gem.');
};

// ───────────────────────── Main ─────────────────────────

const main = (): void => {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  const cfg = loadConfig();
  ensureAiDir();
  switch (command) {
    case 'start': return start(positional, flags, cfg);
    case 'next': return next(flags, cfg);
    case 'repack': return repack(flags, cfg);
    case 'status': return status();
    case 'done': return done();
    case 'gem': return gem(flags);
    default:
      console.log('Usage: npx tsx tools/ai/ai.ts <start [files…] [--task "…"] [--plan] [--all] | next [--file] [--force] | repack | status | done | gem> [--no-clipboard]');
      process.exitCode = command ? 1 : 0;
  }
};

try {
  main();
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
