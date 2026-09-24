/**
 * pack-project.ts — packs this repo into one AI-ready context file.
 *
 * Run:  npx tsx pack-project.ts [flags]
 *
 *   (no flags)              every file in full (like before, but safer and better structured)
 *   --focus <paths...>      files/folders you're changing → full code, plus their direct
 *                           imports & importers; everything else → signatures only
 *   --depth <n>             import hops around the focus kept in full (default 1)
 *   --sig-depth <n>         only files within n hops of the focus get signatures; the rest
 *                           appear in the file tree only (default: all files — use 2–3 on big repos)
 *   --task "<text>"         your request, placed at the END of the pack
 *   --no-diff               leave out uncommitted git changes
 *   --out <file>            output file (default project_context.txt)
 *   --max-file-kb <n>       skip files larger than this (default 150)
 *
 * Example:
 *   npx tsx pack-project.ts --focus src/features/risk-matrix --task "Add a severity filter"
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// ───────────────────────── Configuration ─────────────────────────

const ROOT = process.cwd();

/**
 * TypeScript compiler API, loaded from the project's own node_modules when available.
 * TypeScript ≤ 6 ships it; TypeScript 7 (native) does not. Without it the script falls back
 * to a built-in parser: slightly less precise signatures, same features otherwise.
 * Typed loosely on purpose so this file compiles whichever TypeScript version is installed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts: any = (() => {
  try {
    const mod = createRequire(path.join(ROOT, 'package.json'))('typescript');
    return typeof mod?.createSourceFile === 'function' ? mod : null;
  } catch {
    return null;
  }
})();

/** Directories never packed. */
const IGNORED_DIRS = new Set([
  'node_modules', 'public', '.git', 'dist', 'build', 'coverage', '.next',
  '.turbo', '.vite', '.cache', 'out', 'storybook-static', '__snapshots__',
]);

/** Extensions eligible for packing. */
const ALLOWED_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.css', '.scss',
  '.md', '.sql', '.graphql', '.gql', '.yml', '.yaml',
]);

/** Dot-files / extension-less files still worth packing. */
const ALLOWED_BASENAMES = new Set(['.env.example', 'Dockerfile', '.cursorrules', '.clinerules']);

/** Files never packed. */
const IGNORED_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'pack-project.ts', 'pack-project.js', 'pack-project.mjs',
]);

/** Path patterns never packed (minified bundles, source maps, test snapshots). */
const IGNORED_PATTERNS = [/\.min\.(js|css)$/, /\.map$/, /\.snap$/];

/** Project-rules files: shown first, in their own section. */
const RULES_FILES = ['AI_RULES.md', 'CLAUDE.md', 'AGENTS.md', '.cursorrules', '.clinerules'];

/** Files always included in full, even outside the focus. */
const ALWAYS_FULL = /^(package\.json|tsconfig(\.\w+)?\.json|vite\.config\.\w+|README\.md|\.env\.example)$/;

/** Code files that can be reduced to signatures. */
const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;

const MAX_DIFF_CHARS = 40_000;
const MAX_IMPORTERS_PER_FILE = 10;
const CHARS_PER_TOKEN = 3.5;
const LARGE_PACK_TOKENS = 150_000;

/** Secret patterns → replacement. Applied to every packed file and the git diff. */
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

// ───────────────────────── Types ─────────────────────────

type Mode = 'full' | 'signatures' | 'tree-only';

interface Options {
  focus: string[];
  depth: number;
  sigDepth: number;
  task: string;
  diff: boolean;
  out: string;
  maxFileKb: number;
}

interface PackedFile {
  rel: string;
  mode: Mode;
  content: string;
  tokens: number;
}

interface ImportGraph {
  imports: Map<string, Set<string>>;
  importers: Map<string, Set<string>>;
}

// ───────────────────────── Helpers ─────────────────────────

const toPosix = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

const estimateTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

const git = (args: string[]): string => {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const parseArgs = (argv: string[]): Options => {
  const opts: Options = { focus: [], depth: 1, sigDepth: Infinity, task: '', diff: true, out: 'project_context.txt', maxFileKb: 150 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${flag}`);
      return v;
    };
    switch (flag) {
      case '--focus':
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opts.focus.push(toPosix(argv[++i]));
        break;
      case '--depth': opts.depth = Number(value()); break;
      case '--sig-depth': opts.sigDepth = Number(value()); break;
      case '--task': opts.task = value(); break;
      case '--no-diff': opts.diff = false; break;
      case '--out': opts.out = value(); break;
      case '--max-file-kb': opts.maxFileKb = Number(value()); break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return opts;
};

// ───────────────────────── File discovery ─────────────────────────

/** Walks the directory tree manually (fallback when git is unavailable). */
const walk = (dir: string): string[] => {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) result.push(...walk(full));
    } else if (entry.isFile()) {
      result.push(toPosix(path.relative(ROOT, full)));
    }
  }
  return result;
};

/** Lists files via git (respects .gitignore), falling back to a directory walk. */
const listFiles = (): string[] => {
  const fromGit = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const files = fromGit ? fromGit.split('\0').filter(Boolean).map(toPosix) : walk(ROOT);
  return files.filter((f) => fs.existsSync(path.join(ROOT, f)));
};

const isEligible = (rel: string, outFile: string): boolean => {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some((dir) => IGNORED_DIRS.has(dir))) return false;
  if (base === outFile || IGNORED_FILES.has(base)) return false;
  if (IGNORED_PATTERNS.some((re) => re.test(rel))) return false;
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') return false; // never pack real env files
  return ALLOWED_BASENAMES.has(base) || ALLOWED_EXTENSIONS.has(path.extname(base).toLowerCase());
};

// ───────────────────────── Redaction ─────────────────────────

const redact = (text: string): { text: string; count: number } => {
  let count = 0;
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) {
    const matches = out.match(re);
    if (matches) {
      count += matches.length;
      out = out.replace(re, replacement);
    }
  }
  return { text: out, count };
};

// ───────────────────────── Import graph ─────────────────────────

/** Reads a tsconfig/jsconfig (JSON with comments and trailing commas). */
const readJsonc = (file: string): Record<string, any> | null => {
  try {
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Path aliases (e.g. "@/*" → ["src/*"]) from the first tsconfig that defines them. */
const loadPathAliases = (): { baseDir: string; paths: Record<string, string[]> } => {
  for (const name of ['tsconfig.app.json', 'tsconfig.json', 'jsconfig.json']) {
    const file = path.join(ROOT, name);
    const opts = fs.existsSync(file) ? readJsonc(file)?.compilerOptions : null;
    if (opts?.paths) return { baseDir: path.resolve(ROOT, opts.baseUrl ?? '.'), paths: opts.paths };
  }
  return { baseDir: ROOT, paths: {} };
};

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/** Import specifiers in a file (static, dynamic, re-exports, require). */
const findSpecifiers = (text: string): string[] => {
  if (ts) return ts.preProcessFile(text, true, true).importedFiles.map((f: { fileName: string }) => f.fileName);
  const specs: string[] = [];
  const re = /(?:\bimport\s*(?:[\w*{}\s,$]+?\s*from\s*)?|\bexport\s*[\w*{}\s,$]*?\s*from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`\n]+)["'`]/g;
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) specs.push(m[1]);
  return specs;
};

const buildImportGraph = (texts: Map<string, string>, fileSet: Set<string>): ImportGraph => {
  const { baseDir, paths } = loadPathAliases();
  const imports = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();

  /** Maps a specifier to a repo file (relative imports and tsconfig aliases; packages ignored). */
  const resolve = (spec: string, fromAbs: string): string | undefined => {
    const bases: string[] = [];
    if (spec.startsWith('.')) bases.push(path.resolve(path.dirname(fromAbs), spec));
    for (const [alias, targets] of Object.entries(paths)) {
      const prefix = alias.replace(/\*$/, '');
      const wildcard = alias.endsWith('*');
      if (wildcard ? spec.startsWith(prefix) : spec === alias) {
        const rest = wildcard ? spec.slice(prefix.length) : '';
        for (const t of targets) bases.push(path.resolve(baseDir, t.replace('*', rest)));
      }
    }
    for (const base of bases) {
      const rel = toPosix(path.relative(ROOT, base));
      // Handles ESM-style "./x.js" imports that point at "./x.ts".
      const stems = [rel, rel.replace(/\.(m|c)?jsx?$/, '')];
      for (const stem of stems) for (const s of RESOLVE_SUFFIXES) if (fileSet.has(stem + s)) return stem + s;
    }
    return undefined;
  };

  for (const [rel, text] of texts) {
    if (!CODE_FILE.test(rel)) continue;
    const abs = path.join(ROOT, rel);
    const deps = new Set<string>();

    for (const spec of findSpecifiers(text)) {
      const target = resolve(spec, abs);
      if (target && target !== rel) deps.add(target);
    }

    imports.set(rel, deps);
    for (const dep of deps) {
      if (!importers.has(dep)) importers.set(dep, new Set());
      importers.get(dep)!.add(rel);
    }
  }
  return { imports, importers };
};

/** Focus files plus their neighbours (imports and importers) up to `depth` hops. */
const neighbourhood = (seeds: string[], depth: number, graph: ImportGraph): Set<string> => {
  const full = new Set(seeds);
  let frontier = seeds;

  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const f of frontier) {
      const neighbours = [
        ...(graph.imports.get(f) ?? []),
        ...[...(graph.importers.get(f) ?? [])].slice(0, MAX_IMPORTERS_PER_FILE),
      ];
      for (const n of neighbours) {
        if (!full.has(n)) {
          full.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return full;
};

/** Dependencies before dependents; `last` files (the focus) go at the end, nearest the task. */
const dependencyOrder = (files: string[], imports: Map<string, Set<string>>, last: Set<string>): string[] => {
  const inSet = new Set(files);
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (f: string): void => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const dep of imports.get(f) ?? []) if (inSet.has(dep)) visit(dep);
    order.push(f);
  };
  [...files].sort().forEach(visit);
  return [...order.filter((f) => !last.has(f)), ...order.filter((f) => last.has(f))];
};

// ───────────────────────── Signatures (skeleton) ─────────────────────────

/** Keeps imports, types, interfaces, props and signatures; replaces function bodies with { /* … *\/ }. */
const toSignatures = (rel: string, text: string): string =>
  (ts ? astSignatures(rel, text) : scanSignatures(text)).replace(/\n{3,}/g, '\n\n').trim();

/** Precise version, using the TypeScript compiler API. */
const astSignatures = (rel: string, text: string): string => {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX
    : rel.endsWith('.jsx') ? ts.ScriptKind.JSX
    : /\.[mc]?js$/.test(rel) ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const cuts: Array<{ start: number; end: number; replacement: string }> = [];

  const visit = (node: any): void => {
    const isFunctionLike = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isConstructorDeclaration(node)
      || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);

    if (isFunctionLike && node.body) {
      const body = node.body;
      if (ts.isBlock(body) || body.getWidth(sf) > 120) {
        cuts.push({ start: body.getStart(sf), end: body.getEnd(), replacement: '{ /* … */ }' });
        return;
      }
    }
    if (ts.isArrayLiteralExpression(node) && node.getWidth(sf) > 600) {
      cuts.push({ start: node.getStart(sf), end: node.getEnd(), replacement: `[ /* … ${node.elements.length} items */ ]` });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  let out = '';
  let pos = 0;
  for (const { start, end, replacement } of cuts) {
    out += text.slice(pos, start) + replacement;
    pos = end;
  }
  out += text.slice(pos);
  return out;
};

/**
 * Fallback without the compiler API: a character scanner that skips strings, templates,
 * comments and regexes, and replaces any `{ … }` that follows `)`, `=>` or a return type.
 */
const scanSignatures = (text: string): string => {
  const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';']);
  let out = '';
  let depth = 0; // > 0 while inside a body being dropped
  let prev = ''; // previous significant character
  let i = 0;

  const emit = (s: string): void => { if (depth === 0) out += s; };

  const endOfTemplate = (start: number): number => {
    let j = start + 1;
    while (j < text.length && text[j] !== '`') {
      if (text[j] === '\\') j += 2;
      else if (text[j] === '$' && text[j + 1] === '{') {
        let d = 1;
        j += 2;
        while (j < text.length && d > 0) {
          if (text[j] === '`') j = endOfTemplate(j);
          else { if (text[j] === '{') d++; else if (text[j] === '}') d--; j++; }
        }
      } else j++;
    }
    return j + 1;
  };

  const opensBody = (): boolean => {
    const tail = out.trimEnd();
    if (tail.endsWith('=>')) return true;
    const k = tail.lastIndexOf(')');
    if (k === -1) return false;
    const after = tail.slice(k + 1);
    return after.trim() === '' || /^\s*:\s*[^{};=()]+$/.test(after);
  };

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    let end = i + 1;

    if (c === '/' && next === '/') {
      end = text.indexOf('\n', i); if (end === -1) end = text.length;
    } else if (c === '/' && next === '*') {
      end = text.indexOf('*/', i + 2); end = end === -1 ? text.length : end + 2;
    } else if (c === '"' || c === "'") {
      end = i + 1;
      while (end < text.length && text[end] !== c && text[end] !== '\n') end += text[end] === '\\' ? 2 : 1;
      end++;
    } else if (c === '`') {
      end = endOfTemplate(i);
    } else if (c === '/' && next !== '>' && REGEX_BEFORE.has(prev)) {
      let inClass = false;
      end = i + 1;
      while (end < text.length && text[end] !== '\n' && (inClass || text[end] !== '/')) {
        if (text[end] === '\\') end++;
        else if (text[end] === '[') inClass = true;
        else if (text[end] === ']') inClass = false;
        end++;
      }
      end++;
    } else if (c === '{') {
      if (depth > 0) depth++;
      else if (opensBody()) { out += '{ /* … */ }'; depth = 1; }
      else out += c;
      prev = c; i++; continue;
    } else if (c === '}') {
      if (depth > 0) depth--; else out += c;
      prev = c; i++; continue;
    }

    emit(text.slice(i, end));
    if (!/\s/.test(c)) prev = c;
    i = end;
  }
  return out;
};

// ───────────────────────── Output sections ─────────────────────────

const renderTree = (paths: string[], marks: Map<string, string>): string => {
  type TreeNode = Map<string, TreeNode>;
  const root: TreeNode = new Map();
  for (const p of paths) {
    let node = root;
    for (const part of p.split('/')) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part)!;
    }
  }

  const lines: string[] = [];
  const draw = (node: TreeNode, prefix: string, dir: string): void => {
    const entries = [...node.entries()].sort(
      ([a, an], [b, bn]) => Number(bn.size > 0) - Number(an.size > 0) || a.localeCompare(b),
    );
    entries.forEach(([name, child], i) => {
      const isLast = i === entries.length - 1;
      const full = dir ? `${dir}/${name}` : name;
      const mark = marks.get(full);
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${name}${child.size ? '/' : ''}${mark ? `  [${mark}]` : ''}`);
      if (child.size) draw(child, prefix + (isLast ? '    ' : '│   '), full);
    });
  };
  draw(root, '', '');
  return lines.join('\n');
};

const fileBlock = (f: PackedFile): string => `<file path="${f.rel}" mode="${f.mode}">\n${f.content}\n</file>`;

const gitSection = (includeDiff: boolean): { text: string; redactions: number } => {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch) return { text: '', redactions: 0 };

  const log = git(['log', '--oneline', '-n', '10']);
  let diff = includeDiff
    ? git(['diff', 'HEAD', '--', '.', ':(exclude)package-lock.json', ':(exclude)yarn.lock', ':(exclude)pnpm-lock.yaml'])
    : '';
  if (diff.length > MAX_DIFF_CHARS) diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n… [diff truncated]`;
  const { text: safeDiff, count } = redact(diff);

  const parts = [`Branch: ${branch}`, `Recent commits:\n${log || '(none)'}`];
  if (safeDiff) parts.push(`Uncommitted changes (work in progress):\n${safeDiff}`);
  return { text: `<git_state>\n${parts.join('\n\n')}\n</git_state>`, redactions: count };
};

const READING_GUIDE = `How to read this pack:
- <project_rules>: non-negotiable conventions for this codebase. Follow them.
- <file_tree>: every file in the repo. [full] = complete source below, [sig] = signatures only, unmarked = not included.
- mode="signatures": function bodies are replaced with { /* … */ }. Types, props and signatures are exact; implementations are hidden. Never guess a hidden implementation — ask for the file instead.
- mode="full": complete, current source. Files are ordered dependencies-first; the files being worked on come last.
- <git_state>: recent commits and uncommitted work in progress.
- <task> at the end: what to do.`;

const RESPONSE_FORMAT = `<response_format>
1. Start with a short plan: which files you will change or create, and why. State any assumption the code above does not confirm.
2. Then output ONLY the files that change. For each, give its path and either the complete new file or the exact lines to replace with enough surrounding context to locate them.
3. Do not re-output unchanged files.
4. Do not invent imports, props, types or APIs that are not shown above. If you need something that is only a signature or missing, say so and ask for it.
5. Match the conventions visible in the full files (naming, styling, state management, error handling).
</response_format>`;

// ───────────────────────── Main ─────────────────────────

const packProject = (): void => {
  const opts = parseArgs(process.argv.slice(2));
  const outFile = path.basename(opts.out);
  const focusing = opts.focus.length > 0;
  console.log(`Packing ${ROOT}${focusing ? ` (focus: ${opts.focus.join(', ')})` : ''}\n`);

  // 1. Discover and read eligible files.
  const eligible = listFiles().filter((f) => isEligible(f, outFile)).sort();
  const texts = new Map<string, string>();
  const skipped: string[] = [];
  for (const rel of eligible) {
    const abs = path.join(ROOT, rel);
    if (fs.statSync(abs).size > opts.maxFileKb * 1024) { skipped.push(rel); continue; }
    const text = fs.readFileSync(abs, 'utf8');
    if (text.includes('\u0000')) { skipped.push(rel); continue; } // binary
    texts.set(rel, text);
  }

  // 2. Separate rules files; decide a mode for every other file.
  const rulesFiles = eligible.filter((f) => RULES_FILES.includes(f) && texts.has(f));
  const packable = eligible.filter((f) => texts.has(f) && !rulesFiles.includes(f));
  const graph = buildImportGraph(texts, new Set(packable));
  const seedList = packable.filter((f) => opts.focus.some((p) => f === p || f.startsWith(`${p}/`)));
  const seeds = new Set(seedList);
  const full = neighbourhood(seedList, opts.depth, graph);
  const sigScope = Number.isFinite(opts.sigDepth) ? neighbourhood(seedList, Math.max(opts.sigDepth, opts.depth), graph) : null;

  if (focusing && seeds.size === 0) {
    throw new Error(`--focus matched no files: ${opts.focus.join(', ')} (paths are relative to ${ROOT})`);
  }

  const modeOf = (rel: string): Mode => {
    if (!focusing || full.has(rel) || ALWAYS_FULL.test(path.posix.basename(rel))) return 'full';
    return CODE_FILE.test(rel) && (!sigScope || sigScope.has(rel)) ? 'signatures' : 'tree-only';
  };

  // 3. Build packed files (with redaction).
  let redactions = 0;
  const pack = (rel: string, mode: Mode): PackedFile => {
    const raw = texts.get(rel)!;
    const shaped = mode === 'signatures' ? toSignatures(rel, raw) : raw.trimEnd();
    const { text, count } = redact(shaped);
    redactions += count;
    return { rel, mode, content: text, tokens: estimateTokens(text) };
  };

  const modes = new Map(packable.map((f) => [f, modeOf(f)] as const));
  const fullList = packable.filter((f) => modes.get(f) === 'full');
  const nonCodeFull = fullList.filter((f) => !CODE_FILE.test(f) || ALWAYS_FULL.test(path.posix.basename(f)));
  const codeFull = dependencyOrder(fullList.filter((f) => !nonCodeFull.includes(f)), graph.imports, seeds);

  const rules = rulesFiles.map((f) => pack(f, 'full'));
  const signatures = packable.filter((f) => modes.get(f) === 'signatures').map((f) => pack(f, 'signatures'));
  const fulls = [...nonCodeFull, ...codeFull].map((f) => pack(f, 'full'));
  const gitState = gitSection(opts.diff);
  redactions += gitState.redactions;

  // 4. Assemble: rules → tree → signatures → full code → git state → task (last).
  const marks = new Map<string, string>([
    ...rules.map((f) => [f.rel, 'rules'] as [string, string]),
    ...signatures.map((f) => [f.rel, 'sig'] as [string, string]),
    ...fulls.map((f) => [f.rel, 'full'] as [string, string]),
    ...skipped.map((f) => [f, 'skipped: too large'] as [string, string]),
  ]);
  const projectName = (() => {
    try { return JSON.parse(texts.get('package.json') ?? '{}').name ?? path.basename(ROOT); }
    catch { return path.basename(ROOT); }
  })();
  const allPacked = [...rules, ...signatures, ...fulls];
  const totalTokens = allPacked.reduce((sum, f) => sum + f.tokens, 0) + estimateTokens(gitState.text);

  const sections = [
    `# Project context: ${projectName}`,
    `Generated ${new Date().toISOString()} · ${fulls.length} full, ${signatures.length} signatures-only · ~${totalTokens.toLocaleString()} tokens`,
    READING_GUIDE,
    rules.length ? `<project_rules>\n${rules.map(fileBlock).join('\n\n')}\n</project_rules>` : '',
    `<file_tree>\n${renderTree([...rulesFiles, ...packable, ...skipped].sort(), marks)}\n</file_tree>`,
    signatures.length ? `<reference_signatures>\n${signatures.map(fileBlock).join('\n\n')}\n</reference_signatures>` : '',
    `<source_files>\n${fulls.map(fileBlock).join('\n\n')}\n</source_files>`,
    gitState.text,
    opts.task ? `<task>\n${opts.task}\n</task>` : '<task>\nThe request follows after this pack.\n</task>',
    RESPONSE_FORMAT,
  ].filter(Boolean);

  fs.writeFileSync(path.join(ROOT, opts.out), `${sections.join('\n\n')}\n`, 'utf8');

  // 5. Report.
  console.log(`Packed → ${opts.out}`);
  console.log(`  full: ${fulls.length}   signatures: ${signatures.length}   tree-only: ${packable.length - fulls.length - signatures.length}   skipped (too large/binary): ${skipped.length}`);
  console.log(`  parser: ${ts ? `TypeScript ${ts.version} compiler API` : 'built-in (TypeScript compiler API not found)'}`);
  console.log(`  ~${totalTokens.toLocaleString()} tokens${redactions ? `   ·   ${redactions} secret(s) redacted` : ''}`);
  console.log('  Largest files:');
  [...allPacked].sort((a, b) => b.tokens - a.tokens).slice(0, 8)
    .forEach((f) => console.log(`    ${String(f.tokens).padStart(7)}  ${f.rel} [${f.mode}]`));
  if (!rules.length) console.log('\n  Tip: add an AI_RULES.md at the root with your stack, conventions and invariants — it goes first in every pack.');
  if (totalTokens > LARGE_PACK_TOKENS) {
    const sigTokens = signatures.reduce((sum, f) => sum + f.tokens, 0);
    const nextSig = Number.isFinite(opts.sigDepth) ? opts.sigDepth - 1 : 2;
    const hint = !focusing ? 'Use --focus to cut it down.'
      : sigTokens > totalTokens / 2 && nextSig >= 1
        ? `Signatures are ~${sigTokens.toLocaleString()} of those — try --sig-depth ${nextSig}.`
        : `Full files are ~${(totalTokens - sigTokens).toLocaleString()} of those — narrow --focus${opts.depth > 0 ? ' or use --depth 0' : ''}.`;
    console.warn(`\n  ⚠ Large pack (>${LARGE_PACK_TOKENS.toLocaleString()} tokens). ${hint}`);
  }
};

try {
  packProject();
} catch (error) {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
