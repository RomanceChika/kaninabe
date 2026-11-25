/**
 * 題材の一時ツリーで**構造の突合**(生成物の期待表 ⇔ 実 DB)を実行するかどうかの判定。
 *
 * ## 何を実行したいのか
 *
 * 構造の突合(`app/src/infrastructure/__tests__` 配下の `*-parity.test.ts`)が読むのは 2 つしか
 * 無い —— **生成物の期待表**と、**実 DB の pg_catalog** である。どちらも題材ごとに揃って
 * いる(期待表は生成物、実 DB は通し実行が空から構築したもの)ので、**原理的には全部実行できる**。
 * 実行できないものがあるなら、それは突合そのものの性質ではなく、**そのテストの書き方が題材の
 * 外に出ている**ということである。
 *
 * ## 免除リストを持たない
 *
 * 出方は 2 つしか無く、どちらも機械で判定できる。
 *
 *   1. **一時ツリーの外を import している**(ホストのハーネス・ホストの行の型・
 *      `legacy/spec-tools` の実装)。相対 import を一時ツリーで解いてみれば分かる。
 *   2. **このリポジトリのアプリの名前を本文が名指している**(表ごとの `it` を手で並べる形・
 *      固定のジョブ名・固定の関数署名)。ホストの data_table とジョブカタログが宣言する
 *      名前のうち**この題材が宣言していない**ものが、コメントを落とした字面に現れるかを
 *      見れば分かる。
 *
 * したがってここに「実行しないものの一覧」は無い。ただし**回る組は閉じた表で固定する**(`sample-coverage.ts`。点検 26 回目 A26-1):
 * 分類の理由は導かれるが、前に回っていた対が外れたことは誰も見ていなかったので、表と食い違えばこの段を赤にする。
 *`*-parity.test.ts` が 1 本増えたら次の実行で
 * 自動的に分類され、**足し忘れて黙って外れる経路**が存在しない。理由も実行のたびに導かれる
 * ので、宣言が変われば理由も変わる。
 */

import path from 'node:path';
import { walkFiles } from '../../../io/paths.js';
import { loadDataTableSpecModel } from '../../../model/data/loader.js';
import { droppedTableName } from '../../../model/data/dropped-tables.js';
import { loadJobSpecModel } from '../../../model/job/loader.js';
import { MIGRATION_ORDER } from './db-migrations.js';
import { firedPairProblems } from './sample-coverage-check.js';
import { boundNames, mentions, sourceClosure } from './db-parity-source.js';
import { writeParityHarness } from './db-parity-tree.js';
import { runGeneratedTests, type TestRunResult } from './db-tests.js';
import type { LocalStack } from './db-reset.js';
import { specPath } from '../../../model/product/paths.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import { sampleInfrastructureTests } from './db-places.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** 構造の突合の置き場(リポジトリルート相対)。 */
function parityRoot(roots: ProductRoots, layout: ProductLayout): string {
  return sampleInfrastructureTests(roots, layout);
}

/** 構造の突合のファイル名の末尾。 */
const PARITY_SUFFIX = '-parity.test.ts';

/** 構造の突合 1 本の判定。 */
export interface ParityVerdict {
  /** テストのパス(リポジトリルート相対)。 */
  readonly file: string;
  /** この題材で実行できるか。 */
  readonly fit: boolean;
  /** 実行できない理由(実行できるなら null)。宣言から導いた字面であり、書き置いたものではない。 */
  readonly reason: string | null;
  /**
   * 実行するときに一緒に持ち込む部品(リポジトリルート相対。実行しないなら省略)。
   *
   * 突合のテストが同じ置き場の小さな部品に分かれているのは責務の分割であって、アプリへの
   * 依存ではない。持ち込む先も同じ判定を通っている(`db-parity-source.ts`)。
   */
  readonly carries?: readonly string[];
}

/**
 * 構造の突合のテストを全部拾う(分類の母集合)。
 *
 * @param repoRoot このリポジトリのルート
 * @returns テストのパス(リポジトリルート相対。名前順)
 */
export function parityTestFiles(repoRoot: string, roots: ProductRoots, layout: ProductLayout): readonly string[] {
  const root = path.join(repoRoot, parityRoot(roots, layout));
  return walkFiles(root, (name) => name.endsWith(PARITY_SUFFIX))
    .map((absolute) => path.relative(repoRoot, absolute))
    .sort();
}

/**
 * **ホスト**(この生成器が住むリポジトリのアプリ)が宣言する DB の名前を集める。
 *
 * 表と関数は data_table、ジョブ名はジョブカタログが正である。ここが母集合になるのは、
 * 構造の突合が名指す固有名は必ずこのどれかだからである(列名は表の宣言の内側にあり、
 * 表を名指さずに列だけを名指すテストは書けない)。
 *
 * @param repoRoot このリポジトリのルート
 * @returns 宣言された名前の集合
 */
export function hostDeclaredNames(repoRoot: string, roots: ProductRoots): ReadonlySet<string> {
  const names = new Set<string>();
  const tables = loadDataTableSpecModel(path.join(repoRoot, specPath(roots, 'backend/data/tables')), { repoRoot });
  for (const table of tables.model.tables) {
    names.add(table.table);
    for (const fn of table.functions) names.add(fn.name);
  }
  // 読めずに落とした表も、ホストが宣言する名前である(宣言の中身=関数名は信用して読めないが、表の名前は置き場のファイル名で分かる)。
  // 外すと、その表を名指すテストを「題材が宣言していない名前を名指していない」と読んで通してしまう。
  for (const file of tables.model.droppedTables ?? []) names.add(droppedTableName(file));
  const jobs = loadJobSpecModel(path.join(repoRoot, specPath(roots, 'backend/jobs.md')), { repoRoot });
  for (const job of jobs.model.catalog?.jobs ?? []) names.add(job.id);
  return names;
}

/**
 * **題材**が宣言する DB の名前を、生成 migration の名前から集める。
 *
 * 生成 migration は「印 + 対象の名前」で示す(`_ddl_{表}` / `_rpc_{関数}`)ので、
 * 宣言から導ける名前はここに全部出る。印の表は `db-migrations.ts` が 1 つだけ持つ。
 *
 * @param migrations 依存順に並べた migration の `[パス, 内容]`
 * @returns この題材が宣言した名前の集合
 */
export function sampleDeclaredNames(
  migrations: readonly (readonly [string, string])[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [file] of migrations) {
    const base = path.basename(file, '.sql');
    for (const infix of MIGRATION_ORDER) {
      const at = base.indexOf(infix);
      if (at === -1) continue;
      const subject = base.slice(at + infix.length);
      if (subject !== '') names.add(subject);
      break;
    }
  }
  return names;
}

/** 実行できない理由を 1 行にする(名前は多いので頭の 3 つだけ挙げて総数を報告する)。 */
function foreignReason(foreign: readonly string[]): string {
  const head = foreign.slice(0, 3).join(' / ');
  const rest = foreign.length > 3 ? ` ほか ${foreign.length - 3} 件` : '';
  return `この題材が宣言していない名前を本文が名指している(${head}${rest})`;
}

/**
 * 構造の突合 1 本を、この題材で実行できるかどうかに分類する。
 *
 * @param args テストのパス(リポジトリルート相対)・リポジトリルート・一時ツリー・
 *   ホストの宣言・この題材の宣言
 * @returns 判定(実行できないなら導かれた理由つき)
 */
export function classifyParityTest(args: {
  readonly file: string;
  readonly repoRoot: string;
  readonly treeRoot: string;
  readonly hostNames: ReadonlySet<string>;
  readonly sampleNames: ReadonlySet<string>;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}): ParityVerdict {
  const closure = sourceClosure(args);
  if (closure.unresolved.length > 0) {
    return { file: args.file, fit: false, reason: `${closure.unresolved.join(' / ')} が一時ツリーに無い` };
  }
  const bound = boundNames(closure.text);
  const foreign = [...args.hostNames]
    .filter((name) => !args.sampleNames.has(name) && !bound.has(name) && mentions(closure.text, name))
    .sort();
  if (foreign.length > 0) return { file: args.file, fit: false, reason: foreignReason(foreign) };
  return { file: args.file, fit: true, reason: null, carries: closure.files.filter((f) => f !== args.file) };
}

/**
 * 構造の突合を全部分類する。
 *
 * @param args リポジトリルート・一時ツリー・この題材が宣言した名前
 * @returns テストごとの判定(名前順)
 */
export function classifyParityTests(args: {
  readonly repoRoot: string;
  readonly treeRoot: string;
  readonly sampleNames: ReadonlySet<string>;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}): readonly ParityVerdict[] {
  const hostNames = hostDeclaredNames(args.repoRoot, args.roots);
  return parityTestFiles(args.repoRoot, args.roots, args.layout).map((file) =>
    classifyParityTest({ ...args, file, hostNames }),
  );
}

/** 構造の突合の段の結末(何を実行し、何を実行せず、実行した結果どうだったか)。 */
export interface ParityStage {
  /** テストごとの判定(実行しないものの理由はここにある)。 */
  readonly verdicts: readonly ParityVerdict[];
  /** 実際に実行したテスト(リポジトリルート相対)。 */
  readonly fired: readonly string[];
  /** 回る組の閉じた表との食い違い(`sample-coverage.ts`。あれば段は赤)。 */
  readonly pairProblems: readonly string[];
  /** 実行の結末(閉じた表との食い違いがあれば ok は false)。 */
  readonly run: TestRunResult;
}

/** 実行の結末に、閉じた表との食い違いを重ねる(食い違いがあれば赤。実行の出力はそのまま後ろに残す)。 */
function withPairProblems(run: TestRunResult, problems: readonly string[]): TestRunResult {
  if (problems.length === 0) return run;
  return {
    ...run,
    ok: false,
    output: `構造の突合を回す組が閉じた表と食い違います:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n${run.output}`,
  };
}

/** 実行するものが 1 本も無い題材の結末(**0 本は緑ではない**。2 段目と同じ規律)。 */
function nothingToFire(verdicts: readonly ParityVerdict[]): TestRunResult {
  return {
    ok: false,
    elapsedMs: 0,
    passed: null,
    output:
      '構造の突合を 1 本も実行できませんでした(実行するものが無いので緑と報告できません)。導かれた理由:\n' +
      verdicts.map((verdict) => `  - ${verdict.file}: ${verdict.reason ?? ''}`).join('\n'),
  };
}

/**
 * 構造の突合の段を回す —— 分類して、実行できるものを一時ツリーへ写して、実 DB に当てる。
 *
 * @param args 一時ツリー・リポジトリルート・依存順の migration・接続情報
 * @returns 判定と実行の結末
 */
export function runParityStage(args: {
  /** 題材の名前(回る組の閉じた表の行)。 */
  readonly sample: string;
  /** 回る組の閉じた表と回らない理由の表(題材の表 `__tests__/samples/sample-coverage.ts` の PARITY_FIRED_PAIRS / PARITY_SKIPPED_PAIRS)。 */
  readonly pairs: { readonly fired: Readonly<Record<string, readonly string[]>>; readonly skipped: Readonly<Record<string, Readonly<Record<string, string>>>> };
  readonly tree: string;
  readonly repoRoot: string;
  readonly migrations: readonly (readonly [string, string])[];
  readonly stack: LocalStack;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}): ParityStage {
  const verdicts = classifyParityTests({
    repoRoot: args.repoRoot,
    treeRoot: args.tree,
    sampleNames: sampleDeclaredNames(args.migrations),
    roots: args.roots,
    layout: args.layout,
  });
  const fit = verdicts.filter((verdict) => verdict.fit);
  const fired = fit.map((verdict) => verdict.file);
  const reasons = new Map(verdicts.filter((verdict) => !verdict.fit).map((verdict) => [path.basename(verdict.file), verdict.reason ?? '']));
  const pairProblems = firedPairProblems(args.sample, fired.map((file) => path.basename(file)), reasons, args.pairs.fired, args.pairs.skipped);
  if (fired.length === 0) return { verdicts, fired, pairProblems, run: withPairProblems(nothingToFire(verdicts), pairProblems) };
  const harness = writeParityHarness({
    root: args.tree,
    repoRoot: args.repoRoot,
    files: fired,
    carried: [...new Set(fit.flatMap((verdict) => verdict.carries ?? []))].sort(),
    roots: args.roots,
  });
  return {
    verdicts,
    fired,
    pairProblems,
    run: withPairProblems(runGeneratedTests({ ...harness, repoRoot: args.repoRoot, stack: args.stack, roots: args.roots, reportFile: path.join(args.tree, 'samples-parity.json') }), pairProblems),
  };
}

/**
 * 段の中身を報告する行(実行するもの・実行しないものとその理由)。
 *
 * **実行しないものを黙って飛ばさない** —— 何本の緑なのかと、何が検査の範囲外なのかが、CI のログ
 * だけで読めるようにしておく。
 *
 * @param stage 段の結末
 * @returns 印字する行
 */
export function describeParity(stage: ParityStage): readonly string[] {
  return [
    `構造の突合 ${stage.fired.length} ファイルを実行します`,
    ...stage.verdicts
      .filter((verdict) => !verdict.fit)
      .map((verdict) => `構造の突合 ${path.basename(verdict.file)} は実行しません — ${verdict.reason ?? ''}`),
    ...stage.pairProblems.map((problem) => `構造の突合の組の食い違い ${problem}`),
  ];
}
