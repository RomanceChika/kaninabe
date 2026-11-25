/**
 * 題材の**生成テスト**を実 DB に当てて回す口(と、実行しないものを報告する口)。
 *
 * 実行するのは app の vitest である(依存も `pg` も `@supabase/supabase-js` も app のもので
 * あり、一時ツリーはそこへの symlink を持っている)。通し実行の側で第 2 のテスト実行系を
 * 持たない —— 実行したいのは**本物のハーネスで本物の DB で実行する**ことそのものである。
 *
 * **実行するものは件数で報告する。** RLS の挙動テストは画面と同じ経路(`api` スキーマのビュー)で
 * 読む —— そのビューは表ごとの `surface_migration` から生成されるようになったので、題材の
 * 一時 workdir にも surface が立ち、**実行できる**。件数を報告するのは、「緑」が何本ぶんの緑なのかを
 * 黙らせないためである(0 本の緑と全部の緑を区別できるようにする)。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { LocalStack } from './db-reset.js';
import { readPassed } from './db-report.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { EQUIVALENCE_TEST_ROLES, RLS_TEST_ROLES, generatedTestDirs } from './db-test-places.js';

/**
 * テスト実行系(vitest)の入口を**名前で**解く。
 *
 * **置き場を綴らない。** ワークスペースの依存は hoist の有無で居場所が変わる —— 実測: 版を
 * 揃えて 1 本にした瞬間、`app/node_modules/vitest/vitest.mjs` と綴っていたこの 1 行が実在しない
 * ファイルを指した(ADR-0013 の規律「依存を名前で参照してよいが、置き場で参照してはならない」。
 * `server-only` で 1 度踏んだのと同じ形である)。`vitest/package.json` は `exports` で公開されて
 * いるので、そこから隣の `vitest.mjs` を指す。
 *
 * **解けなければ null。** 空文字に倒して spawn すると「何を起動したか分からない失敗」になるので、
 * 呼び出し側が段を飛ばして報告する(scripts-code-quality.md §根は製品が宣言する)。
 *
 * @param repoRoot リポジトリルート(依存の解決の起点)
 * @returns vitest の入口の絶対パス。解けなければ null
 */
function vitestEntry(repoRoot: string): string | null {
  try {
    const require_ = createRequire(path.join(repoRoot, 'package.json'));
    return path.join(path.dirname(require_.resolve('vitest/package.json')), 'vitest.mjs');
  } catch {
    return null;
  }
}

/** 生成テストの内訳(実行するもの・実行しないもの)。 */
export interface GeneratedTestFiles {
  /** 一致の証明(集約ごと + 保存点ごと)。 */
  readonly equivalence: readonly string[];
  /** RLS の挙動(画面と同じ経路 = api のビューで読む)。 */
  readonly rls: readonly string[];
}

/**
 * 生成物から生成テストのファイルを種類ごとに拾う。
 *
 * 拾う置き場は**置き場の配置の役割**(`eq-test` / `eq-save-test` / `rls-test`)の逆引きの根から引く(綴りを持たない。
 * vitest の設定の `include` も同じ役割から引くので、両者が食い違わない — `db-test-places.ts`)。
 *
 * @param generatedFiles 生成物(リポジトリルート相対パス → 内容)
 * @param roots その題材が宣言した根
 * @param layout 置き場の配置(アプリの枠の後段が与える)
 * @returns 種類ごとの生成テスト(どちらも実行する)
 */
export function generatedTestFiles(
  generatedFiles: ReadonlyMap<string, string>,
  roots: ProductRoots,
  layout: ProductLayout,
): GeneratedTestFiles {
  const files = [...generatedFiles.keys()].sort();
  const equivalenceDirs = generatedTestDirs(layout, roots, EQUIVALENCE_TEST_ROLES);
  const rlsDirs = generatedTestDirs(layout, roots, RLS_TEST_ROLES);
  return {
    equivalence: files.filter((file) => equivalenceDirs.some((dir) => file.startsWith(dir))),
    rls: files.filter((file) => rlsDirs.some((dir) => file.startsWith(dir))),
  };
}

/**
 * 生成された表の DDL のファイル名から、その題材の表の全数を**空にする順**で取り出す。
 *
 * 表の DDL は「参照先が先」の番号で並んでいる(外部キーの置き場の規則)ので、**逆に並べると
 * 参照する側が先**になる。1 文の `truncate` は順序に依らないが、逆順にしておくと逐次削除へ
 * 切り替えたときも同じ並びが使える。
 *
 * @param migrations 依存順に並べた migration の `[パス, 内容]`
 * @returns 表の名前(空にする順)
 */
export function tablesOf(migrations: readonly (readonly [string, string])[]): readonly string[] {
  const names = migrations
    .map(([file]) => /_ddl_(.+)\.sql$/.exec(path.basename(file))?.[1])
    .filter((name): name is string => name !== undefined);
  return [...names].reverse();
}

/** 生成テストの実行の結末。 */
export interface TestRunResult {
  /** 全部通ったか。 */
  readonly ok: boolean;
  /** 所要(ミリ秒)。 */
  readonly elapsedMs: number;
  /** vitest の出力(通ったときも件数を読むために持つ)。 */
  readonly output: string;
  /** vitest の JSON の報告から読んだ「通ったテストの件数」(読めなければ null。出力の文字は読まない。db-report.ts の readPassed)。 */
  readonly passed: number | null;
}

/**
 * 一時ツリーの生成テスト(一致の証明と RLS の挙動)を実 DB に当てて回す。
 *
 * @param args 一時ツリーの vitest 設定・root・リポジトリルート・接続情報
 * @returns 通ったか・所要・出力・件数
 */
export function runGeneratedTests(args: {
  readonly configFile: string;
  readonly root: string;
  readonly repoRoot: string;
  /** 実 DB の接続情報(実 DB の要らない試験 = 生成した配線の試験と操作のユニットテストは null。`wiring-tests.ts`)。 */
  readonly stack: LocalStack | null;
  readonly roots: ProductRoots;
  /**
   * 結末を vitest の JSON の報告としてこのファイルにも書く(件数の正 = `readPassed`。生成器ごとにも数える = `wiring-tests.ts` の `kindOutcomes`)。
   * 同時に、it の外の失敗(未処理の例外・拒否)の数を `unhandledFileOf(reportFile)` に書く報告者も付ける(JSON の報告はそれを持たない。`readUnhandled`)。
   */
  readonly reportFile: string;
}): TestRunResult {
  const started = Date.now();
  // 前の実行の報告を読まない(この実行が書かなかったら件数は読めない = null)。
  rmSync(args.reportFile, { force: true });
  const entry = vitestEntry(args.repoRoot);
  if (entry === null) {
    return {
      ok: false,
      elapsedMs: 0,
      output: 'テスト実行系(vitest)を依存として解けませんでした(生成テストを実行できません)',
      passed: null,
    };
  }
  const env = {
    ...process.env,
    ...(args.stack === null
      ? {}
      : {
          SUPABASE_URL: args.stack.apiUrl,
          SUPABASE_ANON_KEY: args.stack.anonKey,
          SUPABASE_SERVICE_ROLE_KEY: args.stack.serviceRoleKey,
          SUPABASE_DB_URL: args.stack.databaseUrl,
        }),
    // 表示の基準とプロセスの TZ は app の統合テストと同じ値に固定する(datetime.md §テスト)。
    TZ: 'Pacific/Chatham',
    DISPLAY_TIMEZONE: 'Asia/Tokyo',
  };
  try {
    const output = execFileSync(
      process.execPath,
      [entry, 'run', '--config', args.configFile, '--root', args.root, '--reporter=default', '--reporter=json', `--outputFile.json=${args.reportFile}`, `--reporter=${writeUnhandledReporter(args.reportFile)}`],
      { cwd: args.root, encoding: 'utf-8', env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, elapsedMs: Date.now() - started, output, passed: readPassed(args.reportFile) };
  } catch (error) {
    const failure = error as { readonly stdout?: string; readonly stderr?: string };
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}` || String(error);
    return { ok: false, elapsedMs: Date.now() - started, output, passed: readPassed(args.reportFile) };
  }
}

/** it の外の失敗の数を書くファイル(JSON の報告の隣)。 */
export function unhandledFileOf(reportFile: string): string {
  return `${reportFile}.unhandled.json`;
}

/**
 * it の外の失敗(未処理の例外・拒否)の数を書く報告者を、JSON の報告の隣に置く(差分点検 S27-1)。vitest の JSON の報告は it とファイルの結末しか持たず、
 * it の後の未処理の拒否は終了コードにだけ出る。報告者は `onTestRunEnd` の第 2 引数(未処理の失敗の全部)の数を書く。
 *
 * @param reportFile JSON の報告のファイル
 * @returns 報告者のモジュールの絶対パス
 */
function writeUnhandledReporter(reportFile: string): string {
  const module = `${reportFile}.unhandled-reporter.mjs`;
  // 前の実行の数を読まない(報告者が届かなかった実行は null = 結末を読めない、にする)。
  rmSync(unhandledFileOf(reportFile), { force: true });
  writeFileSync(
    module,
    [
      "import { writeFileSync } from 'node:fs';",
      '/** it の外の失敗の数を書く(題材の通し実行が置く)。 */',
      'export default class UnhandledCount {',
      '  onTestRunEnd(_modules, errors) {',
      `    writeFileSync(${JSON.stringify(unhandledFileOf(reportFile))}, JSON.stringify({ unhandled: errors.length }));`,
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  return module;
}

/**
 * it の外の失敗の数を読む(報告者が書かなかった・読めないなら null = 結末を読めない)。
 *
 * @param reportFile JSON の報告のファイル
 */
export function readUnhandled(reportFile: string): number | null {
  const file = unhandledFileOf(reportFile);
  if (!existsSync(file)) return null;
  try {
    const value = (JSON.parse(readFileSync(file, 'utf-8')) as { unhandled?: unknown }).unhandled;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

/** 実行の結末の食い違いを言うための、生成器ごとの結末のうち読む欄。 */
interface ExplainedOutcome {
  readonly failed: number;
  readonly missing: readonly string[];
  readonly broken: readonly string[];
}

/**
 * vitest の終了コードと報告の食い違い(差分点検 S27-1)。表が名指す落ち方(落ちた it・読み込みの失敗)は表との照らしが扱うので、ここは
 * それで説明できない赤だけを言う: it の外の失敗が 1 件でもある・結末を読めない・0 以外で終わったのに落ちた it も読み込みの失敗も無い。
 *
 * @param run 実行の結末(`ok` = 終了コード 0)
 * @param kinds 生成器ごとの結末
 * @param unhandled it の外の失敗の数(`readUnhandled`)
 * @returns 食い違いの文面(無ければ空)
 */
export function exitProblems(run: Pick<TestRunResult, 'ok'>, kinds: ReadonlyMap<string, ExplainedOutcome>, unhandled: number | null): readonly string[] {
  if (unhandled === null) return ['[実行の結末を読めない] it の外の失敗の数を書く報告が無い(vitest が報告者まで届かずに終わった)'];
  if (unhandled > 0) return [`[it の外の失敗] 未処理の例外・拒否が ${unhandled} 件(it の結末に結び付かないので表では名指せない。出力を見て直す)`];
  const explained = [...kinds.values()].some((outcome) => outcome.failed > 0 || outcome.missing.length > 0 || outcome.broken.length > 0);
  return run.ok || explained ? [] : ['[説明の無い赤] vitest が 0 以外で終わったのに、落ちた it も読み込みの失敗も無い(設定・後始末の失敗など。出力を見て直す)'];
}
