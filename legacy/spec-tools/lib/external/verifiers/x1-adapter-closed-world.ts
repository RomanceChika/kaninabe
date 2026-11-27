/**
 * X1 アダプタの閉世界チェック。
 *
 * external-spec-writing.md の要求(3 段):
 *   (a) 各 `adapter` パスが実在し、ファイル内に `port` の名前が現れる
 *   (b) 基盤の層(置き場の配置の役割 `infrastructure`。Next.js なら `app/src/infrastructure/`)直下のディレクトリの全数が、①集約名(entity_spec の
 *       entity / state machine 名)②仕組みの土台ディレクトリ(置き場の配置が宣言する層と土台の表。口は
 *       `lib/model/framework-base-dirs.ts`。`supabase` / `__tests__` ほか)③data_table で `internal: true` のテーブル名
 *       (`jobs` / `tutorial_docs` / `ai_usage` / `domain_events` … を data_table から機械的に
 *       引く。特定のテーブル名をここへハードコードしない)④語彙の `adapter_root` の
 *       いずれかに分類される(どれでもないディレクトリ = 無宣言の外部連携 = エラー)
 *   (c) 各 `adapter_root` 配下の `.ts`(テスト・fake を除く)が、いずれかの連携の
 *       `adapter` に宣言されている(宣言の無いアダプタ = エラー)
 *   (d) 製品の木の全ファイルの値の import について、宣言した SDK のパッケージ(`sdk_packages` / 土台の `sdkPackages`)は
 *       その置き場か `client_ui` でしか引けず、基盤の層は宣言の無い外部パッケージを引けない(点検 9 回目 B9-4。
 *       本体は `../sdk-placement.ts`)
 *
 * **3 段はどれも `app/` が実在する環境でだけ成立する**(仕様と実装の突合であり、仕様だけの
 * 検査ではない)。`app/` が無ければ 3 段そろって飛ばす —— S7・A11・A12・A14 と同じ扱いである。
 *
 * **なぜディレクトリの全数を見るのか。** (a) だけでは「宣言した連携が実在するか」しか
 * 見えず、「宣言していない連携アダプタがこっそり増える」穴は塞がれない。実際にこの版の
 * 開設前、実在するアダプタ 4 本(discord / anthropic / notion のうち 4 ファイル)が
 * 仕様のどこにも無宣言だった。ディレクトリの全数を分類する形にすることで、次にアダプタが
 * 増えたときも同じ穴を機械が検出する。
 *
 * **③がハードコードでなく data_table 由来である理由。** 当初は `jobs` を体系側の固定の
 * 除外としていたが、`app/src/infrastructure/tutorial/`(`tutorial_docs` / `ai_usage` という
 * 非集約の内部テーブルを読み書きするだけのリポジトリ)のように、同じ性質の非集約ディレクトリ
 * が今後も増えうる。「ドメイン仕様に現れない内部テーブル」は data_table の `internal: true`
 * が既に機械可読な形で宣言しているため、ここから引けば足りる(裁定 2026-09-04)。
 */

import path from 'node:path';
import { appGrounded, isDirectory, isFile, listEntries, toRelative, walkFiles } from '../../io/paths.js';
import { readText } from '../../io/read-text.js';
import type { Finding } from '../../kernel/finding.js';
import { absentFor } from '../../kernel/scope-owner.js';
import { EXTERNAL_CATALOG_ID } from '../../model/external/parse-external.js';
import { inputValue, unusableOf, type CatalogInput, type InputGapNote } from '../../kernel/input-state.js';
import type { SpecModel } from '../../model/types.js';
import { productBaseDirPaths } from '../../model/framework-base-dirs.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';
import { layoutScan } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { checkSdkPlacement } from '../sdk-placement.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X1';

/** X1 の指摘を組み立てる。 */
function x1(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** X1 の入力。 */
export interface AdapterClosedWorldInput {
  /** 構築済みのドメイン仕様モデル(集約名・state machine 名の母集合)。 */
  readonly domain: SpecModel;
  /**
   * テーブル仕様の**入力の状態**(`internal: true` のテーブル名の母集合。(b) だけが読む。**必須**)。
   *
   * **未選択は「内部テーブルは宣言されていない」という事実**で、分類の母集合は 3 本(集約名・土台・語彙)で判定してよい
   * (テーブル仕様を採っていない製品の接続層のディレクトリは、集約か土台かアダプタのどれかであるべき)。
   * **阻害は「分からない」**で、どれにも当たらないディレクトリが内部テーブルのリポジトリかもしれないので、
   * そのディレクトリの判定だけを出さず、見ていないことを `adapterClosedWorldGaps` が名指して返す。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /** 読み込み済みの外部連携カタログ(X0 はローダーが済ませてある)。 */
  readonly catalog: ExternalCatalogSpec;
  /** リポジトリルートの絶対パス(アダプタの実装とディレクトリ走査に使う)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木の位置)。 */
  readonly roots: ProductRoots;
  /**
   * 置き場の配置(基盤の層の走査の根と、集約でないディレクトリ = 土台の表の宣言元)。
   *
   * **土台の一覧をここに持たない。** 接続層(`supabase`)・テスト支援(`__tests__`)などはどれも**フレームワークが形として決めている土台**であり、
   * 同じ事実を X1・A11・W1・lint がそれぞれ免除リストとして持っていた。正は配置が宣言する層と土台の表で、ここはそれをパスで引くだけである。
   */
  readonly layout: ProductLayout;
}

/**
 * アダプタの閉世界を検証する。
 *
 * @param input ドメインモデル・data_table・外部連携カタログ・リポジトリルート
 * @returns 違反のリスト
 */
export function verifyAdapterClosedWorld(input: AdapterClosedWorldInput): Finding[] {
  // (a)〜(d) はどれも app/ の実ファイルを見る項なので、**app/ が無い環境では 3 つとも飛ばす**。
  // (b)(c) は「走査したディレクトリが無ければ 0 件」で暗黙に飛んでいたのに (a) だけが
  // 「実在しません」を出していた —— 同じ検査器の中で接地の有無を非対称にすると、仕様だけを
  // 持つリポジトリ(新規プロジェクト・サンプル)が「まず外の誰と繋がるか」を宣言できない。
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  return [
    ...checkAdapterImplementations(input.catalog, input.repoRoot),
    ...checkInfrastructureDirectories(input),
    ...checkUndeclaredAdapterFiles(input.catalog, input.repoRoot),
    ...checkSdkPlacement(input, x1),
  ];
}

/**
 * テーブル仕様が阻害のために、(b) が判定を出さなかったディレクトリの記録(使えるとき・未選択のときは空)。
 *
 * 未選択は事実(内部テーブルは宣言されていない)なので載せない。阻害のときだけ、どの分類にも当たらない
 * ディレクトリを名指して返す(**無ければ見ていないものも無いので空**)。実行ログが 1 行で報告する。
 *
 * @param input X1 の入力
 */
export function adapterClosedWorldGaps(input: AdapterClosedWorldInput): readonly InputGapNote[] {
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  const gap = unusableOf(input.dataTables, 'data_tables');
  if (gap === null || gap.state !== 'blocked') return [];
  const found = unclassifiedDirectories(input);
  if (found === null || found.entries.length === 0) return [];
  return [
    {
      gap,
      consequence: '接続層の直下のディレクトリが、内部テーブル(internal: true)のリポジトリに当たるかは見ていません',
      subjects: found.entries.map((entry) => `${found.relative}/${entry}`),
    },
  ];
}

/** (a) adapter パスの実在と、ファイル内の port 名の実在。 */
function checkAdapterImplementations(catalog: ExternalCatalogSpec, repoRoot: string): Finding[] {
  return catalog.integrations.flatMap((integration) => {
    const absolute = path.join(repoRoot, integration.adapter);
    if (!isFile(absolute)) {
      const missing = x1({
        message: `連携 ${integration.id} の adapter ${integration.adapter} が実在しません`,
        location: integration.location,
        suggestion: '実在するファイルパス(リポジトリルート相対)に直すか、アダプタを実装する',
        counterexample: { integration: integration.id, adapter: integration.adapter },
      });
      return [absentFor({ kind: 'catalog', id: EXTERNAL_CATALOG_ID }, missing)];
    }
    if (!readText(absolute).includes(integration.port)) {
      return [
        x1({
          message: `連携 ${integration.id} の実装 ${integration.adapter} に port ${integration.port} がありません`,
          location: integration.location,
          suggestion: `${integration.adapter} に ${integration.port} を実装するか、port を実際の型名に直す`,
          counterexample: { integration: integration.id, port: integration.port },
        }),
      ];
    }
    return [];
  });
}

/** 集約名(entity_spec の entity / state machine 名)の集合。 */
function knownAggregateDirNames(model: SpecModel): ReadonlySet<string> {
  const names = new Set<string>();
  for (const specs of model.aggregates.values()) {
    if (specs.entity !== undefined) names.add(specs.entity.entity);
    for (const machine of specs.stateMachines) names.add(machine.machine);
  }
  return names;
}

/** data_table で `internal: true` のテーブル名の集合(jobs / tutorial_docs / ai_usage / domain_events …)。 */
function internalTableNames(dataTables: DataTableSpecModel): ReadonlySet<string> {
  const names = new Set<string>();
  for (const table of dataTables.tables) {
    if (table.internal) names.add(table.table);
  }
  return names;
}

/**
 * (b) の分類のうち、**テーブル仕様に依らない 3 分類**(集約名 / 土台 / 語彙の adapter_root)のどれにも当たらない
 * 接続層直下のディレクトリ(内部テーブル名に当たるかは、呼び手がテーブル仕様の状態に応じて決める)。
 */
function unclassifiedDirectories(input: AdapterClosedWorldInput): { readonly relative: string; readonly entries: readonly string[] } | null {
  const relative = layoutScan(input.layout, input.roots.app, 'infrastructure')?.dir ?? null;
  if (relative === null) return null;
  const root = path.join(input.repoRoot, relative);
  if (!isDirectory(root)) return null;
  const known = knownAggregateDirNames(input.domain);
  const bases = productBaseDirPaths(input.layout, input.roots.app);
  const adapterRoots = new Set(input.catalog.vocabulary.service.map((term) => path.basename(term.adapterRoot)));
  const entries = listEntries(root).filter(
    (entry) =>
      isDirectory(path.join(root, entry)) &&
      !bases.has(`${relative}/${entry}`) &&
      !known.has(entry) &&
      !adapterRoots.has(entry),
  );
  return { relative, entries };
}

/**
 * (b) 接続層の直下のディレクトリの全数が 4 分類のいずれかに収まること。
 * テーブル仕様が阻害のとき、内部テーブル名に当たるかを決められないディレクトリの判定は出さない(`adapterClosedWorldGaps` が言う)。
 */
function checkInfrastructureDirectories(input: AdapterClosedWorldInput): Finding[] {
  const found = unclassifiedDirectories(input);
  if (found === null || input.dataTables.state === 'blocked') return [];
  const { relative } = found;
  const tables = inputValue(input.dataTables);
  const internal = tables === undefined ? new Set<string>() : internalTableNames(tables);
  const findings: Finding[] = [];
  for (const entry of found.entries) {
    if (internal.has(entry)) continue;
    findings.push(
      x1({
        message: `${relative}/${entry} はどの分類(集約名 / 宣言された土台ディレクトリ / data_table で internal: true のテーブル名 / 語彙の adapter_root)にも当てはまりません`,
        location: input.catalog.location,
        suggestion:
          '集約(entity_spec の entity)のディレクトリなら綴りを直す。仕組みの土台なら ' +
          '置き場の配置(アプリの枠の後段の値)の層と土台の表(source-root の structure.baseDirs)に足す。内部テーブルのリポジトリなら data_table 側で ' +
          `table: ${entry} / internal: true を宣言する。外部サービスのアダプタなら ` +
          `external.md の vocabulary.service に "- id / label / adapter_root: ${relative}/${entry}" を足す`,
        counterexample: { directory: `${relative}/${entry}` },
      }),
    );
  }
  return findings;
}

/** テスト・fake として adapter_root の走査から除くファイルか。 */
function isAdapterSourceFile(name: string): boolean {
  if (!name.endsWith('.ts')) return false;
  return !name.endsWith('.test.ts') && !name.endsWith('.fake.ts');
}

/** (c) adapter_root 配下の実装ファイルが、いずれかの連携の adapter に宣言されていること。 */
function checkUndeclaredAdapterFiles(catalog: ExternalCatalogSpec, repoRoot: string): Finding[] {
  const declared = new Set(catalog.integrations.map((integration) => integration.adapter));
  const findings: Finding[] = [];
  for (const term of catalog.vocabulary.service) {
    const root = path.join(repoRoot, term.adapterRoot);
    for (const absolute of walkFiles(root, isAdapterSourceFile)) {
      const relative = toRelative(repoRoot, absolute);
      if (declared.has(relative)) continue;
      findings.push(
        x1({
          message: `${relative} はどの連携にも adapter として宣言されていません`,
          location: catalog.location,
          suggestion: 'external.md の integrations に adapter として宣言するか、不要なファイルなら削除する',
          counterexample: { adapter: relative },
        }),
      );
    }
  }
  return findings;
}
