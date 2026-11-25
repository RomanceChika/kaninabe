/**
 * 題材の**生成した試験の全部**を、題材の一時ツリーで実行する口(fix27 A2)。実 DB の要らない試験(配線の試験 = ブラウザ側の守り・Cron の起動口、
 * 操作の生成ユニットテスト)はここで、実 DB に当てる試験(一致の証明・RLS の挙動)は `db-tests.ts` の同じ実行の口で回し、結末を生成器ごとに数えて
 * 表(`__tests__/samples/sample-coverage.ts`)と照らす。
 *
 * ## 製品の実物を写す
 *
 * 生成した試験は、製品が手で書く支え(操作の試験の偽の口と性質の照らし・リクエスト前段のセッションの更新)を import する。題材はそれを持たないので、
 * 解けない import を**ホストの製品の同じ置き場**から写す(口の実装 `harness-ports.ts` を写すのと同じ扱い。写した先の import も同じ規則で辿る)。
 * ホストにも無いもの(題材ごとの手書きの口 = ジョブの起動口など)は写さず、その試験は読み込みで落ちる —— 表はそれを「n/a(ホストに無い部品)」の行で
 * 名指し、読み込みの失敗が名指す部品が表と食い違えば赤にする(n/a を免除の口にしない)。
 *
 * ## assertion の無い試験は赤(守りの観測)
 *
 * 生成器は見るものの無い試験を出さない(出す試験には落ちうる assertion が 1 つ以上ある)。実行時の側の網として、題材の木の設定が `expect.requireAssertions` を持つことを、
 * assertion を 1 つも持たない it を置いて実行し、赤になることで観測する(`assertion-probe.ts`。表の `guard:require-assertions` の行)。
 *
 * ## 拒否の観測
 *
 * 守りを見る試験は、見る相手が作り物でも緑になりうる(見張る口が 0 本の表は何も見ずに通る)。そこで表が `refusal` を宣言した種類は、**関門を外した木**
 * (リクエスト前段を素通しにした木)でもう一度実行し、赤になる it の数を表と照らす。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProductLayout } from '../../../model/product/layout.js';
import { requestGatePath } from '../../../model/product/layout.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { sampleSourceAlias, sampleSourceRoot } from './db-places.js';
import { writeServerOnlyStub } from './server-only-stub.js';
import { includeVitestConfig } from './db-parity-tree.js';
import { generatedTestDirs, EQUIVALENCE_TEST_ROLES, RLS_TEST_ROLES } from './db-test-places.js';
import { exitProblems, readUnhandled, runGeneratedTests, type TestRunResult } from './db-tests.js';
import { sampleAppRoot as sampleAppRootOf } from './db-tree.js';
import { naFactsOf, runProblems, type CoverageTable } from './sample-coverage-check.js';
import { probeNoAssertion } from './assertion-probe.js';

/** 生成器ごとの結末(表の `test:{生成器}` の行と照らす)。 */
export interface KindOutcome {
  /** 通った it の数。 */
  readonly passed: number;
  /** 落ちた it の数。 */
  readonly failed: number;
  /** 読み込みで落ちたファイルが名指した、解けないモジュール(名前順・重複なし)。 */
  readonly missing: readonly string[];
  /** it が 1 本も無いファイル・解けないモジュール以外の理由で読み込みが落ちたファイル(`{ファイル}: {理由}`)。 */
  readonly broken: readonly string[];
}

/** vitest の JSON の報告のうち読む欄。 */
interface JsonReport {
  readonly testResults?: readonly {
    readonly name: string;
    readonly message?: string;
    readonly assertionResults: readonly { readonly status: string }[];
  }[];
}

/** 読み込みの失敗の文面から、解けないモジュールの指定子を取る(取れなければ null)。 */
function missingModule(message: string): string | null {
  return /Cannot find (?:module|package) '([^']+)'/.exec(message)?.[1] ?? null;
}

/**
 * vitest の JSON の報告を、生成器ごとの結末に数える。
 *
 * @param reportText JSON の本文
 * @param kindOf 一時ツリーの絶対パス → 生成器(数えないファイルは null)
 * @returns 生成器 → 結末
 */
export function kindOutcomes(reportText: string, kindOf: (file: string) => string | null): ReadonlyMap<string, KindOutcome> {
  const report = JSON.parse(reportText) as JsonReport;
  const out = new Map<string, { passed: number; failed: number; missing: Set<string>; broken: string[] }>();
  for (const result of report.testResults ?? []) {
    const kind = kindOf(result.name);
    if (kind === null) continue;
    const entry = out.get(kind) ?? { passed: 0, failed: 0, missing: new Set<string>(), broken: [] };
    out.set(kind, entry);
    entry.passed += result.assertionResults.filter((assertion) => assertion.status === 'passed').length;
    entry.failed += result.assertionResults.filter((assertion) => assertion.status !== 'passed').length;
    const message = result.message ?? '';
    if (message === '') continue;
    const module = missingModule(message);
    if (module !== null) entry.missing.add(module);
    else entry.broken.push(`${path.basename(result.name)}: ${message.split('\n')[0] ?? ''}`);
  }
  return new Map([...out].map(([kind, entry]) => [kind, { passed: entry.passed, failed: entry.failed, missing: [...entry.missing].sort(), broken: entry.broken.sort() }]));
}

/**
 * 実 DB の要らない生成した試験(実 DB に当てる 3 種の置き場の外にある `*.test.ts`)。
 *
 * @param generatedBy 生成物 → 生成器
 * @param roots その題材が宣言した根
 * @param layout 置き場の配置
 * @returns リポジトリルート相対のパス(名前順)
 */
export function wiringTestFiles(generatedBy: ReadonlyMap<string, string>, roots: ProductRoots, layout: ProductLayout): readonly string[] {
  const dbDirs = generatedTestDirs(layout, roots, [...EQUIVALENCE_TEST_ROLES, ...RLS_TEST_ROLES]);
  return [...generatedBy.keys()].filter((file) => /\.test\.tsx?$/.test(file) && !dbDirs.some((dir) => file.startsWith(dir))).sort();
}

/** import の指定子(`from '…'`・`import('…')`・副作用の import)。 */
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)'([^']+)'/g;

/** その位置に解けるファイル(TypeScript の解決のうち、この木で使う形)。 */
function resolveAt(base: string): string | null {
  return [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.js$/, '.ts'), path.join(base, 'index.ts')].find((candidate) => existsSync(candidate) && !candidate.endsWith('/')) ?? null;
}

/**
 * 生成した試験が(木にある生成物を経て)import するのに一時ツリーで解けないモジュールを、ホストの製品の同じ置き場から写す(写した先の import も辿る)。
 * 辿るのは相対の指定子とソースの根の別名だけで、ソースの根の外へは出ない。
 *
 * @param args 一時ツリー・ホストのリポジトリ・起点のファイル・根と配置
 * @returns 写したファイル(リポジトリルート相対。名前順)
 */
export function carryHostSupport(args: {
  readonly tree: string;
  readonly repoRoot: string;
  readonly files: readonly string[];
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}): readonly string[] {
  const sourceRoot = sampleSourceRoot(args.roots, args.layout);
  const alias = `${sampleSourceAlias(args.layout)}/`;
  const carried = new Set<string>();
  const seen = new Set<string>();
  const queue = [...args.files];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(path.join(args.tree, file), 'utf-8');
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? '';
      const relative = specifier.startsWith(alias)
        ? path.join(sourceRoot, specifier.slice(alias.length))
        : specifier.startsWith('.')
          ? path.normalize(path.join(path.dirname(file), specifier))
          : null;
      if (relative === null || !relative.startsWith(`${sourceRoot}/`)) continue;
      const inTree = resolveAt(path.join(args.tree, relative));
      // 木にあるもの(生成物)はその先の import を辿る(生成したリクエスト前段が手書きのセッションの更新を呼ぶ形)。
      if (inTree !== null) {
        queue.push(path.relative(args.tree, inTree));
        continue;
      }
      const host = resolveAt(path.join(args.repoRoot, relative));
      if (host === null) continue;
      const target = path.relative(args.repoRoot, host);
      mkdirSync(path.dirname(path.join(args.tree, target)), { recursive: true });
      cpSync(host, path.join(args.tree, target));
      carried.add(target);
      queue.push(target);
    }
  }
  return [...carried].sort();
}

/**
 * 実行の設定を一時ツリーに置く(試験は名指しの並び)。
 *
 * @param args 一時ツリー・実装の木の根・試験(リポジトリルート相対)
 * @returns vitest の設定と root
 */
export function writeWiringHarness(args: { readonly tree: string; readonly app: string; readonly files: readonly string[] }): { readonly configFile: string; readonly root: string } {
  const app = path.join(args.tree, args.app);
  writeServerOnlyStub(app);
  const configFile = path.join(app, 'vitest.samples-wiring.mts');
  writeFileSync(configFile, includeVitestConfig(args.files.map((file) => path.relative(app, path.join(args.tree, file)))).join('\n'));
  return { configFile, root: app };
}

/**
 * 関門を外した木にする(リクエスト前段を素通しにする。保護範囲の宣言はそのまま)。元に戻す関数を返す。
 *
 * @param tree 一時ツリーのルート
 * @param roots その題材が宣言した根
 * @param layout 置き場の配置
 * @returns 元に戻す関数(前段が無ければ null)
 */
export function neuterRequestGate(tree: string, roots: ProductRoots, layout: ProductLayout): (() => void) | null {
  const gate = requestGatePath(layout, roots);
  if (gate === null || !existsSync(path.join(tree, gate))) return null;
  const file = path.join(tree, gate);
  const original = file.replace(/\.ts$/, '.original.ts');
  renameSync(file, original);
  writeFileSync(
    file,
    [
      "import { NextResponse } from 'next/server';",
      `export { config } from './${path.basename(original, '.ts')}';`,
      '/** 関門を外した前段(拒否の観測のための変異)。 */',
      'export function proxy(): NextResponse {',
      '  return NextResponse.next();',
      '}',
      '',
    ].join('\n'),
  );
  return () => renameSync(original, file);
}

/** 生成した試験の段の結末(配線の段・実 DB の段で同じ形)。 */
export interface CoverageRunStage {
  /** 生成器ごとの結末。 */
  readonly kinds: ReadonlyMap<string, KindOutcome>;
  /** 表との食い違い(あれば段は赤)。 */
  readonly problems: readonly string[];
  /** 実行の結末(食い違いがあれば ok は false。出力の先頭に食い違いを載せる)。 */
  readonly run: TestRunResult;
}

/**
 * 一時ツリーの絶対パスから生成器を引く口を作る(vitest の報告のパスは実体の綴り = macOS では `/private` が付くことがあるので、末尾で照らす)。
 *
 * @param generatedBy 生成物 → 生成器
 * @returns 絶対パス → 生成器(生成物でなければ null)
 */
export function kindOfPath(generatedBy: ReadonlyMap<string, string>): (file: string) => string | null {
  return (file) => {
    for (const [relative, kind] of generatedBy) if (file.endsWith(`/${relative}`)) return kind;
    return null;
  };
}

/**
 * 配線の段: 実 DB の要らない生成した試験を、ホストの支えを写した一時ツリーで実行し、拒否の観測を宣言した行があれば関門を外した木でもう一度実行して、
 * 表と照らす。
 *
 * @param args 題材・一時ツリー・ホスト・生成物の出どころ・根と配置
 * @returns 生成器ごとの結末と食い違いと実行の結末
 */
export function runWiringStage(args: {
  readonly sample: string;
  readonly tree: string;
  readonly repoRoot: string;
  readonly generatedBy: ReadonlyMap<string, string>;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
  /** 題材の表(`__tests__/samples/sample-coverage.ts`)。 */
  readonly table: CoverageTable;
}): CoverageRunStage {
  const files = wiringTestFiles(args.generatedBy, args.roots, args.layout);
  carryHostSupport({ tree: args.tree, repoRoot: args.repoRoot, files, roots: args.roots, layout: args.layout });
  const harness = writeWiringHarness({ tree: args.tree, app: sampleAppRootOf(args.roots), files });
  const reportFile = path.join(args.tree, 'samples-wiring.json');
  const execute = (): { readonly run: TestRunResult; readonly kinds: ReadonlyMap<string, KindOutcome>; readonly exit: readonly string[] } => {
    const run = runGeneratedTests({ ...harness, repoRoot: args.repoRoot, stack: null, roots: args.roots, reportFile });
    const counted = existsSync(reportFile) ? kindOutcomes(readFileSync(reportFile, 'utf-8'), kindOfPath(args.generatedBy)) : new Map<string, KindOutcome>();
    const kinds = withoutAlias(counted, `${sampleSourceAlias(args.layout)}/`);
    return { run, kinds, exit: exitProblems(run, kinds, readUnhandled(reportFile)) };
  };
  const first = files.length === 0 ? { run: { ok: true, elapsedMs: 0, output: '', passed: 0 }, kinds: new Map<string, KindOutcome>(), exit: [] } : execute();
  const rows = args.table[args.sample] ?? {};
  const watched = Object.entries(rows).filter(([key, row]) => key.startsWith('test:') && row.stage === 'wiring' && row.refusal !== undefined).map(([key]) => key.slice('test:'.length));
  const refusal = new Map<string, number>();
  if (watched.length > 0) {
    const restore = neuterRequestGate(args.tree, args.roots, args.layout);
    try {
      const neutered = execute();
      for (const kind of watched) refusal.set(kind, neutered.kinds.get(kind)?.failed ?? 0);
    } finally {
      restore?.();
    }
  }
  const assertionProbe = probeNoAssertion({ tree: args.tree, repoRoot: args.repoRoot, roots: args.roots });
  const problems = [...runProblems(args.sample, 'wiring', { kinds: first.kinds, refusal, assertionProbe, ...naFactsOf(args.tree, args.roots) }, args.table), ...first.exit];
  // 落ちた it は表の照らしが名指す(読み込みの失敗はホストに無い部品として表が名指すもの)。終了コードは、それで説明できない赤(it の外の失敗・
  // 結末を読めない・落ちた it の無い 0 以外の終わり)だけを足す(差分点検 S27-1。以前は ok: true で全部を覆っていた)。
  return { kinds: first.kinds, problems, run: withProblems({ ...first.run, ok: true }, problems, '生成した試験(配線の段)') };
}

/**
 * 解けない部品の指定から、ソースの根の別名を外す(表はソースの根からの相対で名指す。別名の綴りは配置が持つ)。
 *
 * @param kinds 生成器ごとの結末
 * @param prefix 別名の頭(`{別名}/`)
 * @returns 外した結末
 */
export function withoutAlias(kinds: ReadonlyMap<string, KindOutcome>, prefix: string): ReadonlyMap<string, KindOutcome> {
  return new Map([...kinds].map(([kind, outcome]) => [kind, { ...outcome, missing: outcome.missing.map((module) => (module.startsWith(prefix) ? module.slice(prefix.length) : module)).sort() }]));
}

/**
 * 実行の結末に、表との食い違いを重ねる(食い違いがあれば赤)。
 *
 * @param run 実行の結末
 * @param problems 表との食い違い
 * @param what 段の名前
 * @returns 重ねた結末
 */
export function withProblems(run: TestRunResult, problems: readonly string[], what: string): TestRunResult {
  if (problems.length === 0) return run;
  return { ...run, ok: false, output: `${what}が題材の表(sample-coverage.ts)と食い違います:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n${run.output}` };
}
