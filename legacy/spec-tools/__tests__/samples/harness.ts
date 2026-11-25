/**
 * サンプルシステム(製品ではない別題材の仕様一式)を、本物の仕組みに 1 往復通す通し実行。
 *
 * 目的は**過剰適合の実測**である。検証器・生成器が製品の構造(集約名・語彙・
 * 「この形の仕様しか来ない」という暗黙の前提)に寄りかかっていれば、別題材の fixture は
 * ここで落ちる。したがってこの通し実行は**fixture のための特別扱いを一切しない** ——
 * 読むローダーも、実行する検証器も、適用する生成器も、CLI(`cli/verify-docs.ts` /
 * `cli/generate-docs.ts`)が使うものと同一である。
 *
 * 手順は 4 段:
 *   1. 一時ディレクトリに fixture(`fixtures/samples/{name}/docs/specs/**`)を写す
 *   2. 全ローダー → `runAllVerifications`(V/A/Q/S/T/N/J/K/H/Z/X/Y/U/G/W/M 群)
 *   3. `testGenerators` → `applyGeneratedSections`(一時ディレクトリへ書き出す)
 *   4. 生成された `app/src/domain/generated/**` と生成テスト(RLS の挙動)を、**本物のエンジン**
 *      (実行時パッケージ `@kaninabe/runtime` を依存として解く。束 ①-b・ADR-0013)と `app/src/domain/`
 *      の純関数・**本物のハーネス**(`__tests__/rls-{world,expect,oracle}.ts`)に
 *      つないだ一時 tsconfig で `tsc --noEmit`
 *
 * 生成 SQL(保存点の複合 RPC・定型 5 形の RPC 本文・RLS 補助関数・RLS の select ポリシー)は
 * **字面の検査だけ**を行う —— 関数を作るものは骨格(関数定義の頭・`$$` の対応・末尾)に加えて
 * **本文の構文**(`begin` / `end;` の対応・`if` と `end if`・`loop` と `end loop`・丸括弧の
 * 釣り合い・権限の 3 行)まで、ポリシーは `revoke` / RLS の有効化 / `drop` と `create` が対で
 * あること / `using` 句の数まで見る。実 DB は docs のテストでは使わない方針であり、
 * `pg_query` 系の依存をここで足さないためである。
 *
 * 一時ディレクトリの直下に fixture の**根の宣言**(`product.md`)を写すのは、`detectRepoRoot`
 * (lib/io/paths.ts)が「宣言を上へ探す」規則でリポジトリルートを決めるためである。
 * 束 ①-a までは**空の `.git` を置いて `.git` 探索を騙していた** —— 宣言を置けばルートが
 * 決まるので、騙す必要が無くなった(設計メモ §3 の発見 2)。
 */

import { longIdentifiers, longIdentifierText } from '../../lib/sql/identifier-length.js';
import { TEST_LAYOUT, TEST_PLATFORM, TEST_VERIFY_INPUTS } from '../helpers/platform.js';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withoutGitEnv } from '../helpers/git-env.js';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_DECL_FILE, walkFiles } from '../../lib/io/paths.js';
import { loadProductRoots } from '../../lib/model/product/loader.js';
import { sampleAppRoot } from '../../lib/targets/supabase/samples/db-tree.js';
import type { ProductRoots } from '../../lib/model/product/types.js';
import { loadSpecModel } from '../../lib/model/loader.js';
import type { SpecModel } from '../../lib/model/types.js';
import { createGuardServices } from '../../lib/guard/services.js';
import { testGenerators } from '../helpers/generators.js';
import { runAllVerifications } from '../../lib/compose/verify-pipeline.js';
import { bucketCounts, type BucketCounts } from '../../lib/extension/bucket.js';
import type { ExtensionLedgerModel } from '../../lib/model/extension/types.js';
import { loadQuerySpecModel } from '../../lib/model/query/loader.js';
import { loadScreenSpecModel } from '../../lib/model/screen/loader.js';
import { loadDesignTokens } from '../../lib/model/design/loader.js';
import { loadActionSpecModel } from '../../lib/model/trace/loader.js';
import { loadDataTableSpecModel } from '../../lib/model/data/loader.js';
import { loadNotificationSpecModel } from '../../lib/model/notification/loader.js';
import { loadJobSpecModel } from '../../lib/model/job/loader.js';
import { loadConfigSpecModel } from '../../lib/model/config/loader.js';
import { loadAuthSpecModel } from '../../lib/model/auth/loader.js';
import { loadGuaranteeSpecModel } from '../../lib/model/guarantee/loader.js';
import { loadSurfaceSpecModel } from '../../lib/model/surface/loader.js';
import { loadExternalSpecModel } from '../../lib/model/external/loader.js';
import { loadUsecaseSpecModel } from '../../lib/model/usecase/loader.js';
import { completeGenerateContext } from '../../lib/generate/generate-context.js';
import { mutationReportOfContext } from '../../lib/mutation/context-report.js';
import { placementProblemsOf, type BlockProblem } from '../../lib/generate/render/book/block-check.js';
import { applyGeneratedSections } from '../../lib/generate/apply-sections.js';
import { writableTreesOf } from '../../lib/generate/write-gate.js';
import type { FileSection } from '../../lib/generate/apply-sections.js';
import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import { unfrozenConstantRefusals } from '../../lib/gen-kit/frozen-constants.js';
import type { GenerateInputs } from '../../lib/generate/generate-inputs.js';
import type { Finding } from '../../lib/kernel/finding.js';
import { findVocabularyLeaks, type VocabularyLeak } from './host-vocabulary.js';
import { findUnexplainedWording, type UnexplainedWording } from './generated-wording.js';
import { loadedGates } from '../../lib/relations/screen-reachability/index.js';
import { rerunOnGeneratedTree, writeFrameStubs, type GeneratedTreeRun } from './generated-tree.js';

/**
 * 題材の表(`sample-coverage.ts`)。仕組みの CLI(samples:db)が題材の側を読む入口はこの通し実行の 1 本だけなので(層の基線)、表もここから渡す。
 */
export { PARITY_FIRED_PAIRS, PARITY_SKIPPED_PAIRS, SAMPLE_COVERAGE } from './sample-coverage.js';

/** このリポジトリのルート(`legacy/spec-tools/__tests__/samples` から 4 段上)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** fixture の置き場。 */
const SAMPLES_ROOT = fileURLToPath(new URL('../fixtures/samples/', import.meta.url));

/**
 * 生成 TS の型検査で「本物」につなぐ、`app/src/` 直下の**仕組みの部品**。
 *
 * `app/src/domain/generated
/**
 * 接続層(`infrastructure/supabase/client.ts`)の**最小の実物**。
 *
 * 本物の接続層は、そのアプリの DB から生成した行の型(`database.types.ts`)を型引数に取る ——
 * つまり**アプリごとに違う実物**であり、ホストのものを借りると fixture の型検査にホストの表が
 * 混ざる。型として要るのは「クライアントの型」と「それを作る関数」の 2 つだけなので、ここが
 * その最小形を書く(アダプタと同じ扱い。仕組みの側の型は本物を使う)。
 */
const SUPABASE_CLIENT_STUB: readonly string[] = [
  '/** fixture の通し実行が置く最小の接続層(行の型はアプリごとに違うので借りない)。 */',
  "import type { RowSource, RpcSource } from '@kaninabe/adapter-postgrest';",
  "import { retryRollbacks } from '@kaninabe/adapter-postgrest';",
  '',
  '/**',
  ' * この型でクライアントを持ち回る。',
  ' *',
  ' * 本物は `@supabase/supabase-js` の `SupabaseClient` だが、それは製品(`app/`)の依存であり、配布の木には居ない。',
  ' * 通し実行が見るのは型の組み合わせだけなので、口の実装(`harness-ports`)が触る 2 手 —— 管理 API でユーザを読む手と、',
  ' * ビューを読む手 —— だけを宣言した最小の型にしている。',
  ' */',
  'export interface AppSupabaseClient {',
  '  readonly auth: {',
  '    readonly admin: {',
  '      getUserById(id: string): Promise<{ readonly data: { readonly user: { readonly app_metadata: Record<string, unknown> } | null } }>;',
  '    };',
  '  };',
  '  from(view: string): {',
  '    select(columns: string): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;',
  '  };',
  '}',
  '',
  '/** service role の封印(本物と同じ形)。 */',
  'declare const SERVICE_BRAND: unique symbol;',
  '',
  '/** service role クライアント(RLS をバイパスする)。 */',
  "export type ServiceClient = AppSupabaseClient & { readonly [SERVICE_BRAND]: 'service' };",
  '',
  '/**',
  ' * service role クライアントを作る。',
  ' *',
  ' * @returns 認可を素通しするクライアント',
  ' */',
  'export function createServiceRoleClient(): ServiceClient {',
  '  return undefined as unknown as ServiceClient;',
  '}',
  '',
  '/** 関数名を実行時に決める口だけを取り出す(製品の接続層が持つポートの適合。ADR-0013)。RPC を呼ぶ道はやり直しの口だけ(点検 27 回目の決め)。 */',
  'export function rpcSourceOf(client: AppSupabaseClient): RpcSource {',
  '  return retryRollbacks(client);',
  '}',
  '',
  '/** 表・行・列を指定して読む口だけを取り出す(同じポートの適合)。 */',
  'export function rowSourceOf(client: AppSupabaseClient): RowSource {',
  '  const source: unknown = client;',
  '  return source as RowSource;',
  '}',
  '',
];

/**
 * 接続層の上で DB への口の束を組む配線(`infrastructure/supabase/db-ports.ts`)の最小の実物。
 *
 * 本物の配線と同じ組み立て(クライアント → 事実の読み取り・保存点の複合 RPC・定型 RPC)で、生成した組み立ての根はこの束を受け取るだけである。
 *
 * @param bindingsModule 製品が渡す宣言の束(生成物 `runtime-bindings`)への、このファイルからの相対の指定
 * @returns モジュールの行
 */
function dbPortsStub(bindingsModule: string): readonly string[] {
  return [
    '/** fixture の通し実行が置く DB への口の束の配線(本物と同じ組み立て)。 */',
    "import { createFactReader, createRpcCaller, createUsecaseRepository } from '@kaninabe/adapter-postgrest';",
    "import type { DbPorts } from '@kaninabe/runtime/ports';",
    `import { runtimeBindings } from '${bindingsModule}';`,
    "import { createServiceRoleClient, rowSourceOf, rpcSourceOf } from './client';",
    '',
    '/**',
    ' * DB への口の束を組む。',
    ' *',
    ' * @returns 事実の読み取り・保存点の複合 RPC・定型 RPC の 3 つの口',
    ' */',
    'export function createDbPorts(): DbPorts {',
    '  const client = createServiceRoleClient();',
    '  return {',
    '    facts: createFactReader(rowSourceOf(client)),',
    '    usecases: createUsecaseRepository(rpcSourceOf(client), runtimeBindings.invariantOfMessage),',
    '    rpc: createRpcCaller(rpcSourceOf(client), runtimeBindings.invariantOfMessage),',
    '  };',
    '}',
    '',
  ];
}

/**
 * ハーネスの**口の実装**(製品側の手書き。束 ①-d 手 2)の写し元。
 *
 * **ハーネス本体も、住所を保つアダプタ 6 本も、もう写さない** ——
 * 本体は実行時パッケージ(`@kaninabe/runtime/testing/**`。ADR-0013)にあって依存として解け、アダプタは
 * `npm run generate` が一時ツリーにも書き出す(生成器 `code-harness-adapters`)。写しは **1 本だけ**
 * であり、それは口の実装(`harness-ports.ts` = 実 DB とセッションに触る製品の接続層)である。
 *
 * 写し元は**明示の分岐**で選ぶ: 製品に `app/` の実物があればそれを(開発用リポジトリ)、無ければ
 * `fixtures/samples-harness/` の代用を(配布の木。型を満たすだけで、実 DB の口は呼ばれたら throw する)。
 * どちらを使ったかは実行ログに 1 行出す(プロセスで 1 回)。
 *
 * **symlink ではなく写す** —— TypeScript は既定で symlink の実体(realpath)を基準に相対 import を
 * 解くので、symlink にすると `./seed` が**ホストの製品の**シードを指してしまい、fixture の木の外へ出る。
 */
const PRODUCT_HARNESS_PORTS = path.join(REPO_ROOT, 'app/src/infrastructure/__tests__/harness-ports.ts');

/** 製品に実物が無いときの代用(型を満たすだけ)。 */
const FIXTURE_HARNESS_PORTS = fileURLToPath(new URL('../fixtures/samples-harness/harness-ports.ts', import.meta.url));

/**
 * 通し実行を載せているリポジトリが、実装の木を持つ**製品**か(開発用リポジトリ = true / 配布の木 = false)。
 *
 * 配布の木は仕組みと**題材のデモ製品**(実装の木は `generate` が書く生成物だけ)で、「別の製品の語が混ざらないか」を
 * 見る相手(ホスト)がいない —— デモ製品の語彙は一般語を含み、別の題材の生成物と必ず重なるので、語の漏れの走査は
 * ホストが製品のときだけ行う。
 */
const HOST_IS_PRODUCT = existsSync(PRODUCT_HARNESS_PORTS);

/** 口の実装の写し元の選択を、プロセスで 1 回だけ実行ログに出したか。 */
let announcedPortsSource = false;

/**
 * 口の実装の写し元を選ぶ。
 *
 * @returns 写し元のファイル(絶対パス)
 */
function harnessPortsSource(): string {
  if (!announcedPortsSource) {
    announcedPortsSource = true;
    console.info(
      HOST_IS_PRODUCT
        ? '通し実行の口の実装: 製品の app/ の実物(app/src/infrastructure/__tests__/harness-ports.ts)を写します'
        : '通し実行の口の実装: app/ が無いので fixtures/samples-harness/harness-ports.ts の代用を写します(ホストの語の漏れの走査は行いません)',
    );
  }
  return HOST_IS_PRODUCT ? PRODUCT_HARNESS_PORTS : FIXTURE_HARNESS_PORTS;
}

/** 生成 SQL(複合 RPC の migration)の置き場(リポジトリルート相対)。 */
const MIGRATIONS_DIR = 'supabase/migrations';

/** 生成 TS の型検査の結果。 */
export interface TypecheckResult {
  /** 型エラーが 0 件なら true。 */
  readonly ok: boolean;
  /** `tsc` の出力を行に割ったもの(ok なら空)。 */
  readonly diagnostics: readonly string[];
}

/** 生成 SQL の骨格・本文の検査の結果。 */
export interface SqlCheckResult {
  /** 検査した migration のファイル(リポジトリルート相対)。 */
  readonly files: readonly string[];
  /** そのうち保存点の複合 RPC(`_usecase_` を名に持つもの)。 */
  readonly usecaseFiles: readonly string[];
  /** そのうち定型 5 形の RPC 本文(`_rpc_` を名に持つもの)。 */
  readonly rpcFiles: readonly string[];
  /** そのうち RLS の select ポリシー(`_policies_` を名に持つもの)。 */
  readonly policyFiles: readonly string[];
  /** そのうち RLS 補助関数(`_helper_` を名に持つもの)。 */
  readonly helperFiles: readonly string[];
  /** そのうち表の DDL(`_ddl_` を名に持つもの)。 */
  readonly ddlFiles: readonly string[];
  /** そのうち外から届く surface のビュー(`_api_view_` を名に持つもの)。 */
  readonly apiViewFiles: readonly string[];
  /** そのうち表の権限(`_grants` を名に持つもの。系に 1 本)。 */
  readonly grantsFiles: readonly string[];
  /** 骨格・構文を満たさなかったもの(`{ファイル}: {理由}`)。空なら健全。 */
  readonly problems: readonly string[];
}

/** `runSampleSystem` の任意の指定。 */
export interface SampleRunOptions {
  /**
   * 一時ツリーを消さずに残すか(既定は消す)。
   *
   * **実 DB に当てる通し実行(`cli/samples-db.ts`)のためだけの口**である。あの通し実行は生成物を
   * 一時 workdir へ並べ直したあと、**同じツリーで生成テストを実行する** —— 消してしまうと、
   * 型検査のために組んだツリー(本物のエンジンへの symlink・写したハーネス)をもう一度組む
   * ことになり、同じ段取りが 2 か所に増える。
   */
  readonly keepRoot?: boolean;
  /**
   * 一時ツリーへ写した仕様の本文を、通し実行の前に書き換える(一時ツリーのルート相対のパス → 書き換え)。
   *
   * 既存の題材に**まだ題材が使っていない宣言**を足した形(例: 利用者の欄の値でロールを絞る)で
   * 仕組みを通すための口である。fixture 本体は書き換えない —— 書き換えるのは一時ツリーの写しだけで、
   * 書き換えの前後で本文が変わらなければ throw する(置き換えが空振りして、何も試さないまま緑になるのを防ぐ)。
   * 題材に無いパスは空の本文で渡し、書き換えの結果を新しいファイルとして置く(題材に宣言を 1 枚足す形)。
   */
  readonly rewrite?: Readonly<Record<string, (text: string) => string>>;
  /**
   * 生成の後の木の回し直し(`generatedTree`)の前に足すファイル(一時ツリーのルート相対 → 本文)。回し直す検査が題材の木でも効くことの
   * 負例(宣言の無い口を植えると赤)のための口で、生成物・型検査・SQL の検査には混ざらない(回し直しの直前に書く)。
   */
  readonly plantAfterGenerate?: Readonly<Record<string, string>>;
}

/** 1 つのサンプルシステムを通した結果。 */
export interface SampleRun {
  /**
   * 一時ツリーのルート(`keepRoot` を指定したときだけ)。
   *
   * 消す責任は呼び側にある —— 指定しなければ、**または返す前に throw したら**、
   * `runSampleSystem` が必ず消す。
   */
  readonly root?: string;
  /** その題材が宣言した根(呼び側が生成物の置き場を組み立てるのに使う)。 */
  readonly roots: ProductRoots;
  /** `runAllVerifications` の全 Finding(実行順)。 */
  readonly findings: readonly Finding[];
  /** そのうち `severity === 'error'`。 */
  readonly errors: readonly Finding[];
  /** そのうち `severity === 'warning'`。 */
  readonly warnings: readonly Finding[];
  /**
   * warning の区分(拡張候補 / 未分類。台帳は仕組み自身のもので、題材に依らない)。
   * 未分類は「仕組みの宿題として台帳に載っていない警告」で、題材の性質として残るものはここに数える。
   */
  readonly buckets: BucketCounts;
  /** 生成物(リポジトリルート相対パス → 内容)。 */
  readonly generatedFiles: ReadonlyMap<string, string>;
  /** 生成物 → それを出した生成器の識別子(複数の生成器が章を差し込むファイルは名前順に `+` で連ねる)。 */
  readonly generatedBy: ReadonlyMap<string, string>;
  /**
   * 生成の後の木の回し直し(段の宣言 `onGeneratedTree` の段だけ。`generated-tree.ts`)。生成の前の verify(`findings`)では実装の木を読む段が
   * 飛ぶので、ここが題材の上で J2 の閉世界と X8 を回す(fix27 A2)。
   */
  readonly generatedTree: GeneratedTreeRun;
  /**
   * 標識の置き場の問題(`generate` の CLI が exit 1 で止める検査と同じ 1 本。block-check.ts)。
   * 0 件でなければ、実 CLI の `generate` もこの題材で止まる。
   */
  readonly placementProblems: readonly BlockProblem[];
  /** 生成 TS の型検査。 */
  readonly typecheck: TypecheckResult;
  /** 生成 SQL の骨格検査。 */
  readonly sql: SqlCheckResult;
  /**
   * 生成物に出ていた**ホスト(製品)の語**(W1 の出力側の目。host-vocabulary.ts)。
   *
   * W1 は仕組み側コードの文字列リテラルを見るので、生成器の散文・既定文言・生成器が自分の
   * 位置から読んだ実ファイルに埋まった語は捕まらない。空でなければ、別のシステムの生成物に
   * こちらのアプリの語が混ざっているということである。
   */
  readonly vocabularyLeaks: readonly VocabularyLeak[];
  /**
   * 生成コードに出た**説明できない日本語**(文言表の目。generated-wording.ts)。
   *
   * 生成物の日本語の出どころは「サンプルの仕様」と「文言表(`lib/messages/messages.ts`)」の
   * 2 つしか無い。どちらでも説明できない文が出ていたら、それは生成器のどこかに直接書かれた
   * 文言である —— 別の言語のアプリを作るときに「何を訳せばよいか」が分からなくなる。
   */
  readonly unexplainedWording: readonly UnexplainedWording[];
}

/**
 * 生成が throw したら、**その前に出ていた verify の指摘を印字してから**投げ直す。
 *
 * 生成器は素の `throw` を持たず、前提が破れたときだけ `GeneratorPreconditionError` を投げる
 * (「検査 N が先に止めるはず」と示す形)。その検査の Finding は既に手元にあるのに、
 * 通し実行は `return` 文でしか外へ出さないので、投げられた瞬間に読めなくなっていた。
 *
 * @param findings verify の全 Finding
 * @param run 生成の本体
 * @returns 生成の結果(throw したら投げ直すので返らない)
 */
function withFindingsOnThrow(findings: readonly Finding[], run: () => GenerateOutcome): GenerateOutcome {
  try {
    return run();
  } catch (error) {
    const errors = findings.filter((finding) => finding.severity === 'error');
    if (errors.length > 0) {
      console.error(
        `生成が止まる前の verify の error ${errors.length} 件:\n` +
          errors.map((finding) => `  [${finding.verifier}] ${finding.message}`).join('\n'),
      );
    }
    throw error;
  }
}

/**
 * サンプルシステムを 1 往復通す。
 *
 * @param name fixture のディレクトリ名(`fixtures/samples/{name}`)
 * @param options 一時ツリーを残すか(既定は消す)
 * @returns 検証の Finding・生成物・型検査・SQL の骨格検査
 */
export async function runSampleSystem(name: string, options: SampleRunOptions = {}): Promise<SampleRun> {
  const root = mkdtempSync(path.join(tmpdir(), `sample-${name}-`));
  // `keepRoot` は「**返せたときだけ**消す責任が呼び側に移る」印である —— 途中で throw した
  // 経路では呼び側は `root` を受け取っていないので、誰も消せない(独立レビュー ③-2-b F-5)。
  let handedOver = false;
  try {
    const { roots, domainRoot } = copySampleSpecs(name, root, options.rewrite);
    // **検証は app/ を置く前に実行する。** app/ があると A6・A11・A12・S7 等の
    // 「実装との突合」が有効になり、fixture(仕様だけ)には実装が無いので全部落ちる。
    // fixture が見たいのは仕様側の検査であり、実装との突合は本物のリポジトリの仕事である。
    const { findings, extensionLedger } = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot });
    prepareApp(root, roots);
    writeAppStubs(root, roots, domainRoot);
    writeFrameStubs(root, roots);
    // **生成の前に verify の指摘を外へ出す道を作っておく。** `findings` は `return` 文でしか
    // 外に出ないので、生成器が前提エラー(`GeneratorPreconditionError`)で throw すると
    // **直前の verify の error が 1 件も画面に出ない** —— 生成器は「検査 N が先に止めるはず」と
    // 示すのに、その検査の指摘が読めない状態になる(束 ㉒ の独立レビュー R-2 が実測)。
    const { written, placementProblems, generatedBy } = withFindingsOnThrow(findings, () => generate(root, roots, domainRoot, findings, extensionLedger));
    const generatedFiles = new Map<string, string>();
    for (const file of written) {
      generatedFiles.set(file, readFileSync(path.join(root, file), 'utf-8'));
    }
    const sampleSpecFiles = walkFiles(path.join(root, roots.specs), (name) => name.endsWith('.md'));
    const specText = sampleSpecFiles.map((file) => readFileSync(file, 'utf-8')).join('\n');
    const generatedTree = await rerunOnGeneratedTree(root, roots, options.plantAfterGenerate);
    handedOver = options.keepRoot === true;
    return {
      ...(options.keepRoot === true ? { root } : {}),
      roots,
      findings,
      errors: findings.filter((finding) => finding.severity === 'error'),
      warnings: findings.filter((finding) => finding.severity === 'warning'),
      buckets: bucketCounts(findings, extensionLedger.ledger),
      generatedFiles,
      generatedBy,
      generatedTree,
      placementProblems,
      typecheck: typecheckGenerated(root),
      sql: checkSql(generatedFiles),
      vocabularyLeaks: HOST_IS_PRODUCT
        ? findVocabularyLeaks({
            hostRepoRoot: REPO_ROOT,
            sampleModel: loadSpecModel(domainRoot, { repoRoot: root }).model,
            sampleSpecFiles,
            generatedFiles,
          })
        : [],
      unexplainedWording: findUnexplainedWording({ generatedFiles, specText }),
    };
  } finally {
    if (!handedOver) rmSync(root, { recursive: true, force: true });
  }
}

/**
 * 題材の根の宣言と仕様の木を一時ツリーへ写し、写しの本文を書き換える(書き換えが空振りしたら throw)。
 *
 * 宣言を先に写す。これが無いと `detectRepoRoot` が一時ディレクトリの外へ登ってしまう。
 */
function copySampleSpecs(
  name: string,
  root: string,
  rewrite: SampleRunOptions['rewrite'],
): { readonly roots: ProductRoots; readonly domainRoot: string } {
  const sampleRoot = path.join(SAMPLES_ROOT, name);
  cpSync(path.join(sampleRoot, PRODUCT_DECL_FILE), path.join(root, PRODUCT_DECL_FILE));
  const roots = loadProductRoots(root).model.roots;
  if (roots === null) throw new Error(`${name} の ${PRODUCT_DECL_FILE} を読めません`);
  cpSync(path.join(sampleRoot, roots.specs), path.join(root, roots.specs), { recursive: true });
  for (const [relative, edit] of Object.entries(rewrite ?? {})) {
    const target = path.join(root, relative);
    // 題材に無いファイル(足す宣言)は空の本文として渡す。
    const before = existsSync(target) ? readFileSync(target, 'utf-8') : '';
    const after = edit(before);
    if (after === before) throw new Error(`rewrite が ${relative} を変えませんでした`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, after);
  }
  return { roots, domainRoot: path.join(root, roots.specs, 'domain') };
}

/**
 * 題材の写しを 1 か所だけ壊して(`rewrite`)、**検証だけ**を本物の仕組みに通す(生成と型検査はしない)。
 *
 * 検査の効き目の証明(壊すと鳴る負例)のための軽い入口である。仕組みは `runSampleSystem` と同じもの
 * (同じ写し方・同じ `runAllVerifications`)を使い、題材のための特別扱いをしない。一時ツリーは必ず消す。
 *
 * @param name fixture のディレクトリ名
 * @param rewrite 一時ツリーの写しの書き換え(省略は無改変)
 * @returns 検証の全 Finding
 */
export async function verifySample(
  name: string,
  rewrite?: SampleRunOptions['rewrite'],
): Promise<readonly Finding[]> {
  const root = mkdtempSync(path.join(tmpdir(), `sample-verify-${name}-`));
  try {
    const { domainRoot } = copySampleSpecs(name, root, rewrite);
    return (await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot })).findings;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * 生成 TS の型検査のために、一時ツリーに実装の木と依存の解決を用意する。
 *
 * **実物はもう 1 本も借りない。** 束 ①-b までは評価器・純関数・実行器・汎用 RPC の口を
 * `app/src/**` から symlink で借り、束 ①-b の時点では「設計図 → 行の値」の 1 本
 * (`eq-subject.ts`)が docs の中に残っていた。束 ①-c で配り方が決まり(`tsc` → `dist`)、
 * それも実行時パッケージ `@kaninabe/runtime/sql/eq-subject` へ出たので、**依存として解ける**。
 * 残るのは依存の解決だけである。
 */
function prepareApp(root: string, roots: ProductRoots): void {
  const app = sampleAppRoot(roots);
  mkdirSync(path.join(root, app, 'src/domain'), { recursive: true });
  // 依存の解決も本物と同じにする。node_modules ごと借りるのが最も素直である ——
  // **これは実物の借用ではなく依存の解決**であり、規約が認めている借り方である
  // (scripts-code-quality.md §借りる向き「借りてよいのは…依存の解決だけである」)。
  // CI の docs ジョブは、このために app の依存も入れる(.github/workflows/ci.yml)。
  //
  // 2 段ある。ワークスペースのパッケージ(`@kaninabe/runtime`)はリポジトリルートの `node_modules` に
  // 居て、製品の依存(zod・pg・@supabase/**)は `app/node_modules` に居る。Node と TypeScript は
  // 親へ遡って探すので、**両方を同じ入れ子で置けばどちらの配置でも解ける** ——
  // hoist される版でも hoist されない版でも同じ結果になる(CI と手元で解決が変わらない)。
  symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'));
  symlinkSync(path.join(REPO_ROOT, 'app/node_modules'), path.join(root, app, 'node_modules'));
}

/**
 * 生成物が参照する「**アプリごとに違う実物**」の最小形を置く(接続層と受信のアダプタ)。
 *
 * 仕組みの側の型(実行器・段取り・汎用 RPC の口)はすべて本物を symlink で借りている。ここが
 * 書くのは、本物が**そのアプリの DB / そのアプリの相手**に縛られていて借りられない 2 つだけで
 * ある。中身は宣言から決まるので、fixture ごとの特別扱いは 1 つも無い。
 *
 * @param root 一時ツリーのルート
 * @param roots その題材が宣言した根
 * @param domainRoot ドメイン仕様の木の絶対パス
 */
function writeAppStubs(root: string, roots: ProductRoots, domainRoot: string): void {
  const app = sampleAppRoot(roots);
  const clientFile = path.join(root, app, 'src/infrastructure/supabase/client.ts');
  mkdirSync(path.dirname(clientFile), { recursive: true });
  writeFileSync(clientFile, SUPABASE_CLIENT_STUB.join('\n'));
  // 生成した組み立ての根は DB への口の束(`createDbPorts`)を受け取るだけなので、束を組む配線も置く(本物の配線と同じ組み立て。③-e2C)。
  const bindingsModule = path.relative(path.dirname(clientFile), path.join(root, roots.generated, 'runtime-bindings'));
  writeFileSync(path.join(path.dirname(clientFile), 'db-ports.ts'), dbPortsStub(bindingsModule.startsWith('.') ? bindingsModule : `./${bindingsModule}`).join('\n'));
  writeHarnessPorts(root, roots);
  const catalog = loadExternalSpecModel(path.join(domainRoot, '../backend/external.md'), { repoRoot: root }).model
    .catalog;
  for (const integration of catalog?.integrations ?? []) {
    if (integration.direction !== 'inbound') continue;
    const file = path.join(root, integration.adapter);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      [
        '/** fixture の通し実行が置く最小のアダプタ(相手の本文の形だけを知る層)。 */',
        "import type { InboundPayload, InboundReceiver } from '@kaninabe/runtime/inbound';",
        '',
        '/**',
        ` * ${integration.summary} の本文を読む。`,
        ' *',
        ' * @returns 外部イベント ID と受信の RPC に渡す本文',
        ' */',
        `export function create${integration.port}(): InboundReceiver {`,
        '  return {',
        "    signatureHeader: 'x-signature',",
        '    read: (rawBody: string): InboundPayload | null => {',
        '      const body = JSON.parse(rawBody) as { id?: string; target?: string };',
        '      if (body.id === undefined || body.target === undefined) return null;',
        '      return { eventId: body.id, payload: { record: {}, target_id: body.target } };',
        '    },',
        '  };',
        '}',
        '',
      ].join('\n'),
    );
  }
}

/**
 * ハーネスの**口の実装**と、その周りの「アプリごとに違う実物」を一時ツリーに置く。
 *
 * 生成された挙動テストを型検査に載せるには、それが呼ぶアダプタ 6 本が要るが、**それは生成物である**
 * (`code-harness-adapters`。束 ①-d 手 2)—— ハーネス本体は実行時パッケージから依存として解ける。
 * ここが置くのは、口の実装 1 本と、それが触る「そのアプリの DB / そのアプリのテスト基盤」だけである
 * —— 行の型(`database.types.ts`)・セッション属性の書き込み口・シード(実 DB に触る手足)の 3 つで、
 * どれも接続層の stub と同じ性格であり、fixture ごとの特別扱いは 1 つも無い。
 *
 * @param root 一時ツリーのルート
 * @param roots その題材が宣言した根
 */
function writeHarnessPorts(root: string, roots: ProductRoots): void {
  const app = sampleAppRoot(roots);
  const testsDir = path.join(root, app, 'src/infrastructure/__tests__');
  mkdirSync(testsDir, { recursive: true });
  cpSync(harnessPortsSource(), path.join(testsDir, 'harness-ports.ts'));
  writeFileSync(path.join(testsDir, 'seed.ts'), SEED_STUB.join('\n'));
  mkdirSync(path.join(root, app, 'src/composition/__tests__'), { recursive: true });
  const supabaseDir = path.join(root, app, 'src/infrastructure/supabase');
  writeFileSync(path.join(supabaseDir, 'database.types.ts'), DATABASE_TYPES_STUB.join('\n'));
  writeFileSync(path.join(supabaseDir, 'session.ts'), SESSION_STUB.join('\n'));
  // `server-only` は型宣言を持たない印だけのパッケージで、本物のツリーでは Next.js の
  // 環境宣言が型を与えている。fixture にはそれが無いので、ここで 1 行だけ宣言する。
  // 置き場はソースの根(`src/`)の外 —— ソースの根の直下は枠が名前で呼びうる置き場で、J2 の閉世界が「宣言の無い入口になりうる名前」と赤にする
  // (生成の後の木で J2 を回し直して見つかった。fix27 A2)。
  mkdirSync(path.join(root, app, 'types'), { recursive: true });
  writeFileSync(path.join(root, app, SERVER_ONLY_DECLARATION), SERVER_ONLY_STUB.join('\n'));
}

/** 行の型(`database.types.ts`)の最小形 —— アプリごとに違う実物なので借りない。 */
const DATABASE_TYPES_STUB: readonly string[] = [
  '/** fixture の通し実行が置く最小の行の型(表の形はアプリごとに違うので借りない)。 */',
  'export interface Database {',
  '  readonly api: { readonly Views: Readonly<Record<string, { readonly Row: { readonly id: string } }>> };',
  '}',
  '',
];

/** セッション属性の書き込み口の最小形(本物はそのアプリの実行者の表を読む)。 */
const SESSION_STUB: readonly string[] = [
  '/** fixture の通し実行が置く最小のセッション属性の書き込み口。 */',
  "import type { ServiceClient } from './client';",
  '',
  '/**',
  ' * 実行者の行から session: true の欄をセッションへ写す。',
  ' *',
  ' * @param client service role クライアント',
  ' * @param actorId 実行者の id',
  ' */',
  'export async function writeSessionProfile(client: ServiceClient, actorId: string): Promise<void> {',
  '  await Promise.resolve([client, actorId]);',
  '}',
  '',
];

/** シード(実 DB に触る手足)の最小形 —— 接続情報も truncate の対象もアプリごとに違う。 */
const SEED_STUB: readonly string[] = [
  '/** fixture の通し実行が置く最小のシード(実 DB に触る手足はアプリごとに違うので借りない)。 */',
  "import type { Client as PgClient } from 'pg';",
  "import type { AppSupabaseClient } from '../supabase/client';",
  '',
  '/** 作った認証ユーザ。 */',
  'export interface SeededMember {',
  '  readonly id: string;',
  '  readonly email: string;',
  '  readonly password: string;',
  '}',
  '',
  '/**',
  ' * RLS が効くクライアントを作る。',
  ' *',
  ' * @param accessToken 実行者のアクセストークン(省略で未ログイン)',
  ' * @returns RLS が適用されるクライアント',
  ' */',
  'export function createRlsClient(accessToken?: string): AppSupabaseClient {',
  '  return undefined as unknown as AppSupabaseClient;',
  '}',
  '',
  '/**',
  ' * ドメインの表と認証ユーザを空にする。',
  ' *',
  ' * @param client service role クライアント',
  ' */',
  'export async function resetDatabase(client: AppSupabaseClient): Promise<void> {',
  '  await Promise.resolve(client);',
  '}',
  '',
  '/**',
  ' * 認証ユーザだけを作る。',
  ' *',
  ' * @param client service role クライアント',
  ' * @returns 作られた認証ユーザ',
  ' */',
  'export async function seedAuthUser(client: AppSupabaseClient): Promise<SeededMember> {',
  '  return Promise.resolve({ id: String(client), email: \'\', password: \'\' });',
  '}',
  '',
  '/**',
  ' * ログインしてアクセストークンを得る。',
  ' *',
  ' * @param member 認証ユーザ',
  ' * @returns アクセストークン',
  ' */',
  'export async function signIn(member: SeededMember): Promise<string> {',
  '  return Promise.resolve(member.id);',
  '}',
  '',
  '/**',
  ' * ローカル DB へ pg 直結して 1 つの処理を実行する。',
  ' *',
  ' * @param run 接続を受け取る処理',
  ' * @returns run の戻り値',
  ' */',
  'export async function withPg<T>(run: (pg: PgClient) => Promise<T>): Promise<T> {',
  '  return run(undefined as unknown as PgClient);',
  '}',
  '',
  '/**',
  ' * ローカル DB へ pg 直結した接続を 1 本開く(閉じるのは呼び側)。',
  ' *',
  ' * @returns 接続済みクライアント',
  ' */',
  'export async function connectPg(): Promise<PgClient> {',
  '  return Promise.resolve(undefined as unknown as PgClient);',
  '}',
  '',
];

/** `server-only`(型を持たない印のパッケージ)の宣言。 */
const SERVER_ONLY_STUB: readonly string[] = ["declare module 'server-only';", ''];

/** その型宣言の置き場(実装の木の根からの相対。ソースの根の外)。 */
const SERVER_ONLY_DECLARATION = 'types/server-only.d.ts';

/** 全生成器を回して、ファイルごとのセクションにまとめる(`cli/generate-docs.ts` と同じ回し方)。 */
function sectionsByFile(model: SpecModel, ctx: GenerateContext, owners?: Map<string, Set<string>>): Map<string, FileSection[]> {
  const byFile = new Map<string, FileSection[]>();
  for (const generator of testGenerators()) {
    for (const section of generator.generate(model, ctx)) {
      const list = byFile.get(section.file) ?? [];
      list.push(section);
      byFile.set(section.file, list);
      owners?.set(section.file, (owners.get(section.file) ?? new Set<string>()).add(generator.id));
    }
  }
  return byFile;
}

/** `generate` の結果(書き出したファイルと、標識の置き場の問題)。 */
interface GenerateOutcome {
  readonly written: readonly string[];
  readonly placementProblems: readonly BlockProblem[];
  /** 生成物 → 出した生成器(`SampleRun.generatedBy`)。 */
  readonly generatedBy: ReadonlyMap<string, string>;
}

/**
 * 全生成器を実行して一時ツリーへ書き出す。
 *
 * 入力の作り方は `cli/generate-docs.ts` と同じである(同じ事実の入力口を 1 つに保つため)。
 * ハンドブックが写す「実装の実物」(`book`)だけは、fixture に app の実装が無いので空にする。
 *
 * @param root 一時ツリーのルート
 * @param roots その題材が宣言した根
 * @param domainRoot ドメイン仕様の木の絶対パス
 * @param findings verify の全 Finding(CLI と同じく警告を章へ配る)
 * @param extensionLedger 拡張候補の台帳(CLI と同じく警告の区分に使う)
 * @returns 書き出したファイル(リポジトリルート相対)と、標識の置き場の問題
 */
function generate(
  root: string,
  roots: ProductRoots,
  domainRoot: string,
  findings: readonly Finding[],
  extensionLedger: ExtensionLedgerModel,
): GenerateOutcome {
  const { model } = loadSpecModel(domainRoot, { repoRoot: root });
  if (model === null) return { written: [], placementProblems: [], generatedBy: new Map() };
  const specs = path.join(root, roots.specs);
  const at = (relative: string): string => path.join(specs, relative);
  const options = { repoRoot: root } as const;
  const actions = loadActionSpecModel(at('backend/actions'), options).model;
  const auth = loadAuthSpecModel(at('backend/auth.md'), options).model;
  const inputs: GenerateInputs = {
    // CLI と同じく**生成対象のリポジトリ**を渡す(生成器が自分の位置から解かないため)。
    // fixture は docs/rules を持たないので、「書き方の例」の章はここでは生成されない。
    repoRoot: root,
    guards: createGuardServices(),
    roots,
    queries: loadQuerySpecModel(at('backend/queries'), options).model,
    screens: loadScreenSpecModel(at('frontend'), { ...options, roots, layout: TEST_LAYOUT }).model,
    design: loadDesignTokens(at('frontend/design'), options).model,
    dataTables: loadDataTableSpecModel(at('backend/data/tables'), options).model,
    notifications: loadNotificationSpecModel(at('backend/notifications.md'), options).model,
    jobs: loadJobSpecModel(at('backend/jobs.md'), options).model,
    config: loadConfigSpecModel(at('backend/config.md'), options).model,
    auth,
    gates: loadedGates(auth.flow?.gates ?? []),
    guarantees: loadGuaranteeSpecModel(at('backend/guarantees.md'), options).model,
    surface: loadSurfaceSpecModel(at('backend/surface.md'), options).model,
    external: loadExternalSpecModel(at('backend/external.md'), options).model,
    usecases: loadUsecaseSpecModel(at('frontend/usecases'), options).model,
    ...(actions === null ? {} : { actions }),
    book: {},
  };
  // 章の描き方・仕様の生テキスト・検証の警告の載せ方は CLI と同じ 1 本(completeGenerateContext)。
  // 通し実行が実 CLI と違う章の描き方で緑になる穴を作らないため、2 周回さず 1 周で書き出しと検査の両方を見る。
  const ctx = completeGenerateContext(root, roots, TEST_PLATFORM, TEST_LAYOUT, model, inputs, findings, mutationReportOfContext, undefined, extensionLedger);

  const owners = new Map<string, Set<string>>();
  const byFile = sectionsByFile(model, ctx, owners);
  // 凍結の関所も CLI と同じ 1 本で、書く前に止める(通し実行が凍らせ忘れの生成器を黙って通さないように。点検 10 回目 A10-5)。
  const unfrozen = unfrozenConstantRefusals(byFile);
  if (unfrozen.length > 0) throw new Error(`凍結の関所: ${unfrozen.map((refusal) => `${refusal.file}: ${refusal.reason}`).join(' / ')}`);
  // 標識の置き場の検査も CLI と同じ 1 本(placementProblemsOf)で、書き出す章そのものに対して回す。
  const placementProblems = placementProblemsOf(byFile, model, ctx);
  const generatedBy = new Map([...owners].map(([file, ids]) => [file, [...ids].sort().join('+')]));
  return { written: applyGeneratedSections(byFile, root, { check: false, trees: writableTreesOf(roots, { ownFrameworkTree: false }) }).written, placementProblems, generatedBy };
}

/** 生成 TS の型検査に使う tsconfig(app/tsconfig.json の判定を写したもの)。 */
function tsconfigFor(root: string): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        exactOptionalPropertyTypes: true,
        noFallthroughCasesInSwitch: true,
        forceConsistentCasingInFileNames: true,
        isolatedModules: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        noEmit: true,
        // 受信の配線は `process.env` から鍵を読む(app/tsconfig.json と同じ土俵に揃える)。
        // 型定義は借りている node_modules から引く(一時ツリーの上には @types が無い)。
        // 2 か所見るのは、ワークスペースの依存が hoist されるかどうかで居場所が変わるためである
        // (prepare で両方を同じ入れ子で symlink している)。
        types: ['node'],
        typeRoots: [`${root}/app/node_modules/@types`, `${root}/node_modules/@types`],
        baseUrl: root,
        paths: { '@/*': ['app/src/*'] },
      },
      include: [
        'app/src/domain/generated/**/*.ts',
        // 生成物は `domain/generated/**` の外にも出る。受信口とその配線は**手書きの層を
        // 1 つも参照しない**(アダプタだけが手書きで、その口はここが最小の実装を置く)ので、
        // fixture でも型検査に載せられる —— 載せないと「宣言を 1 行足したら生成物が型エラーに
        // なる」経路が誰にも踏まれないまま残る(独立レビュー ⑲-2b 指摘 2-D)。
        'app/src/composition/inbound/**/*.ts',
        'app/src/app/api/inbound/**/*.ts',
        // **RLS の挙動テストと engine ⇔ RPC の一致の証明も生成物である**(束 ⑳-4b / ⑳-5a)。
        // 呼び先のハーネス 8 本は仕組み側の手書きなので写してつなぎ、そこが触る「そのアプリの
        // 実物」(行の型・セッションの書き込み口・シード)だけを最小形で置く —— 載せないと
        // 「宣言を 1 行足したら生成テストが型エラーになる」経路が誰にも踏まれないまま残る
        // (独立レビュー ⑳-4b ⑦)。
        'app/src/infrastructure/**/*.ts',
        // **保存点の一致の証明も生成物である**(束 ⑳-5a2)。期待は実行器(`operation/_template`)、
        // 実測は実 DB(`infrastructure`)なので、置き場は配線の層である。呼び先のハーネス 4 本を
        // 写してつなぎ、実行器は本物への symlink で借りる。
        'app/src/composition/__tests__/**/*.ts',
        `app/${SERVER_ONLY_DECLARATION}`,
      ],
    },
    null,
    2,
  );
}

/**
 * 生成された TS を型検査する。
 *
 * 対象は `app/src/domain/generated/**` と、**手書きの層を 1 つも要求しない生成物**
 * (受信口とその配線)、それに **RLS の挙動テストと一致の証明**(呼び先のハーネス 8 本を
 * 写してつなぐ)である。
 * 保存点の Server Action・composition・1 画面フォームは載せない —— `@/components` や
 * hooks といった**そのアプリの画面**を参照するので、アプリ本体が無い fixture では型が付かない
 * (その突合は app 側の検査の仕事)。
 *
 * @param root 一時ツリーのルート
 * @returns 型エラーの有無と `tsc` の出力
 */
function typecheckGenerated(root: string): TypecheckResult {
  const configPath = path.join(root, 'tsconfig.samples.json');
  writeFileSync(configPath, tsconfigFor(root));
  // 型検査の道具は**自分のパッケージの `typescript`**(名前で解く。住所の綴りを持たない)。
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  try {
    execFileSync(process.execPath, [tsc, '--noEmit', '-p', configPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
      env: withoutGitEnv(),
    });
    return { ok: true, diagnostics: [] };
  } catch (error) {
    const output = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`;
    const diagnostics = output.split('\n').filter((line) => line.trim() !== '');
    return { ok: false, diagnostics: diagnostics.length === 0 ? [String(error)] : diagnostics };
  }
}

/**
 * 生成 SQL(複合 RPC と定型 RPC の本文)の骨格と構文を字面で見る。
 *
 * 骨格は 3 つ ——①関数定義の頭 ②`$$` が偶数個(本体が閉じている) ③末尾のセミコロン。
 * 本文はさらに 5 つ ——④`begin` のブロックがあり `end;` で閉じる ⑤`if` と `end if` の数が合う
 * ⑥`loop` と `end loop` の数が合う ⑦丸括弧が釣り合う ⑧作成の insert が `id` 以外の列を
 * 1 つ以上入れる(退化した本文を落とす)。定型 RPC は加えて
 * ⑨権限の 3 行(`comment on function` / `revoke all` / `grant execute`)を持つ。
 * plpgsql の意味検査はここではしない(実 DB を使わない範囲での上限)。
 *
 * @param generatedFiles 生成物(パス → 内容)
 * @returns 検査したファイルと、満たさなかったもの
 */
function checkSql(generatedFiles: ReadonlyMap<string, string>): SqlCheckResult {
  const files: string[] = [];
  const problems: string[] = [];
  for (const [file, content] of generatedFiles) {
    if (!file.startsWith(`${MIGRATIONS_DIR}/`) || !file.endsWith('.sql')) continue;
    files.push(file);
    problems.push(...sqlProblems(file, content));
    problems.push(...longIdentifiers(content).map((entry) => `${file}: ${longIdentifierText(entry)}`));
  }
  const sorted = files.sort();
  return {
    files: sorted,
    usecaseFiles: sorted.filter((file) => file.includes(USECASE_INFIX)),
    rpcFiles: sorted.filter((file) => file.includes(RPC_INFIX)),
    policyFiles: sorted.filter((file) => file.includes(POLICIES_INFIX)),
    helperFiles: sorted.filter((file) => file.includes(HELPER_INFIX)),
    ddlFiles: sorted.filter((file) => file.includes(DDL_INFIX)),
    apiViewFiles: sorted.filter((file) => file.includes(API_VIEW_INFIX)),
    grantsFiles: sorted.filter((file) => file.includes(GRANTS_INFIX)),
    problems,
  };
}

/** 保存点の複合 RPC のファイル名の印。 */
const USECASE_INFIX = '_usecase_';

/** 定型 RPC の本文のファイル名の印。 */
const RPC_INFIX = '_rpc_';

/** RLS の select ポリシー全数のファイル名の印。 */
const POLICIES_INFIX = '_policies_';

/** RLS 補助関数のファイル名の印。 */
const HELPER_INFIX = '_helper_';

/** 表の DDL のファイル名の印。 */
const DDL_INFIX = '_ddl_';

/** 外から届く surface のビューのファイル名の印。 */
const API_VIEW_INFIX = '_api_view_';

/** 表の権限のファイル名の印(系に 1 本なので後ろに対象の名前が付かない)。 */
const GRANTS_INFIX = '_grants';

/**
 * 表の権限の SQL の骨格を見る(関数もビューも作らない 2 種目)。
 *
 * 見るのは 3 つ ——①`revoke all on` と `grant … on` が**同じ本数**あること(剥奪だけして
 * 与え忘れた表を作らない)②1 本以上あること(表が 1 枚もない系ではこのファイルが出ない)
 * ③関数を作らないこと。**意味の突合は実 DB が持つ**(`ddl-parity` の ACL の閉世界)。
 *
 * @param file 生成ファイル(報告用)
 * @param content 全文
 * @returns 満たさなかったもの
 */
function grantsProblems(file: string, content: string): readonly string[] {
  const problems: string[] = [];
  const code = stripSqlNoise(content);
  const revoked = count(code, /\brevoke all on\b/g);
  const granted = count(code, /\bgrant\s+[\w,\s]+\s+on\b/g);
  if (revoked === 0) problems.push(`${file}: revoke all on の行がありません`);
  if (revoked !== granted) {
    problems.push(`${file}: revoke all on(${revoked})と grant(${granted})の本数が合いません`);
  }
  if (/create\s+or\s+replace\s+function/i.test(code)) {
    problems.push(`${file}: 関数を作っています(権限の migration は権限だけを触る)`);
  }
  return problems;
}

/** SQL 1 枚の骨格と構文の問題を並べる。 */
function sqlProblems(file: string, content: string): readonly string[] {
  // 関数を作らない 2 種(RLS の select ポリシー・表の DDL)と、関数とビューを両方作る 1 種
  // (surface のビュー)は、見る骨格が別である。
  if (file.includes(POLICIES_INFIX)) return policyProblems(file, content);
  if (file.includes(DDL_INFIX)) return ddlProblems(file, content);
  if (file.includes(API_VIEW_INFIX)) return apiViewProblems(file, content);
  if (file.includes(GRANTS_INFIX)) return grantsProblems(file, content);
  const problems: string[] = [];
  if (!/create\s+or\s+replace\s+function\s+[\w.]+\s*\(/i.test(content)) {
    problems.push(`${file}: create or replace function の頭がありません`);
  }
  const dollars = content.match(/\$\$/g)?.length ?? 0;
  if (dollars === 0 || dollars % 2 !== 0) {
    problems.push(`${file}: $$ の対応が取れていません(${dollars} 個)`);
  }
  if (!content.trimEnd().endsWith(';')) {
    problems.push(`${file}: 末尾がセミコロンで終わっていません`);
  }
  problems.push(...bodyProblems(file, content));
  if (!file.includes(RPC_INFIX) && !file.includes(HELPER_INFIX)) return problems;
  for (const clause of ['comment on function', 'revoke all on function', 'grant execute on function']) {
    if (!content.includes(clause)) problems.push(`${file}: ${clause} の行がありません`);
  }
  return problems;
}

/**
 * 外から届く surface のビューの SQL の骨格を見る。
 *
 * 見るのは 5 つ ——①ビューを作り直す `drop view if exists` と `create view` が対であること
 * ②`security_invoker = true` が付いていること(行の防御を変えていない証拠)③隠し列の述語が
 * あるなら `$$` の対応が取れ、権限の 2 行(`revoke all` / `grant execute`)が述語の数だけ
 * 並ぶこと ④読みの権限を開ける `grant select` があること ⑤丸括弧が釣り合うこと。
 * **意味の突合は実 DB が持つ**(`api-parity` が `pg_views` / `information_schema` を読み直す)
 * ので、ここは「字面として流せる形か」までである。
 *
 * @param file 生成ファイル(報告用)
 * @param content 全文
 * @returns 満たさなかったもの
 */
function apiViewProblems(file: string, content: string): readonly string[] {
  const problems: string[] = [];
  // 骨格の数はコメントを落としてから数える(説明文にも同じ語が出る)。
  const code = stripSqlNoise(content);
  const created = count(code, /\bcreate view\b/g);
  const dropped = count(code, /\bdrop view if exists\b/g);
  if (created !== dropped || created === 0) {
    problems.push(`${file}: create view(${created})と drop view if exists(${dropped})の数が合いません`);
  }
  if (count(code, /security_invoker = true/g) !== created) {
    problems.push(`${file}: security_invoker = true が create view と対になっていません`);
  }
  if (!code.includes('grant select on api.')) problems.push(`${file}: grant select on api. の行がありません`);
  const masks = count(code, /create or replace function api\./g);
  const dollars = count(code, /\$\$/g);
  if (dollars !== masks * 2) problems.push(`${file}: $$ の対応が取れていません(${dollars} 個 / 述語 ${masks} 本)`);
  for (const clause of ['revoke all on function', 'grant execute on function']) {
    if (count(code, new RegExp(clause.replace(/ /g, '\\s+'), 'g')) !== masks) {
      problems.push(`${file}: ${clause} の行(${masks} 本の述語ぶん)が揃っていません`);
    }
  }
  const depth = parenDepth(code);
  if (depth !== 0) problems.push(`${file}: 丸括弧が釣り合っていません(${depth})`);
  if (!content.trimEnd().endsWith(';')) problems.push(`${file}: 末尾がセミコロンで終わっていません`);
  return problems;
}

/**
 * RLS の select ポリシーの SQL の骨格を見る。
 *
 * 見るのは 4 つ ——①権限を落として付け直す `revoke` ②RLS を有効にする `alter table`
 * ③ポリシーごとに `drop policy if exists` と `create policy … for select to … using (…)` が
 * 対で出ること ④丸括弧が釣り合うこと。**意味の突合は実 DB が持つ**(`policy-parity` が
 * このファイルをトランザクションで適用して `pg_policies` を読み直す)ので、ここは
 * 「字面として流せる形か」までである。
 *
 * @param file 生成ファイル(報告用)
 * @param content 全文
 * @returns 満たさなかったもの
 */
function policyProblems(file: string, content: string): readonly string[] {
  const problems: string[] = [];
  for (const clause of ['revoke all on public.', 'enable row level security']) {
    if (!content.includes(clause)) problems.push(`${file}: ${clause} の行がありません`);
  }
  const created = count(content, /\bcreate policy\b/g);
  const dropped = count(content, /\bdrop policy if exists\b/g);
  if (created !== dropped) {
    problems.push(`${file}: create policy(${created})と drop policy if exists(${dropped})の数が合いません`);
  }
  const using = count(content, /\busing \(/g);
  if (using !== created) problems.push(`${file}: using 句(${using})が create policy(${created})と対になっていません`);
  const selects = count(content, /\bfor select to (?:anon|authenticated)\b/g);
  if (selects !== created) problems.push(`${file}: for select の宛先(${selects})が create policy(${created})と対になっていません`);
  const depth = parenDepth(stripSqlNoise(content));
  if (depth !== 0) problems.push(`${file}: 丸括弧が釣り合っていません(${depth})`);
  if (!content.trimEnd().endsWith(';')) problems.push(`${file}: 末尾がセミコロンで終わっていません`);
  return problems;
}

/**
 * 表の DDL の SQL の骨格を見る。
 *
 * 見るのは 6 つ ——①表そのものを作る `create table if not exists` ②RLS を有効にする
 * `alter table` ③`add constraint` は必ず `drop constraint if exists` か `if not exists` の
 * 守りとセットであること(= 2 度流せること)④**`check` の条件式が 1 つの丸括弧で包まれていること**
 * ⑤`do $$ … $$` の対応が取れていること ⑥丸括弧が釣り合うこと。
 * **意味の突合は実 DB が持つ**(`ddl-parity` が pg_catalog を読み直す)ので、ここは
 * 「字面として流せる形か」までである。
 *
 * ④を見るのは、丸括弧の釣り合いだけでは `check (a > 0) or (b < 0)` のような**流せない字面**を
 * 通してしまうからである(`checks[].rule` を持つ表で実際に出た)。「先頭が `(`」でも足りない
 * —— 最初の括弧が式の途中で閉じていたら、その先は `check` の外に出てしまう。
 *
 * @param file 生成ファイル(報告用)
 * @param content 全文
 * @returns 満たさなかったもの
 */
function ddlProblems(file: string, content: string): readonly string[] {
  const problems: string[] = [];
  for (const clause of ['create table if not exists public.', 'enable row level security']) {
    if (!content.includes(clause)) problems.push(`${file}: ${clause} の行がありません`);
  }
  const added = count(content, /\badd constraint\b/g);
  const guarded = count(content, /\bdrop constraint if exists\b/g) + count(content, /\bif not exists \(/g);
  if (added > guarded) {
    problems.push(`${file}: add constraint(${added})に対して 2 度流せる守り(${guarded})が足りません`);
  }
  for (const match of stripSqlNoise(content).matchAll(/\badd constraint\s+(\S+)\s+check\s+([^\n]*);/g)) {
    if (wrappedInParens((match[2] ?? '').trim())) continue;
    problems.push(`${file}: CHECK ${match[1] ?? ''} の条件式が 1 つの丸括弧で包まれていません`);
  }
  const dollars = count(content, /\$\$/g);
  if (dollars % 2 !== 0) problems.push(`${file}: $$ の対応が取れていません(${dollars} 個)`);
  const depth = parenDepth(stripSqlNoise(content));
  if (depth !== 0) problems.push(`${file}: 丸括弧が釣り合っていません(${depth})`);
  if (!content.trimEnd().endsWith(';')) problems.push(`${file}: 末尾がセミコロンで終わっていません`);
  return problems;
}

/**
 * 本文(`$$` の内側)の構文の釣り合いを見る。
 *
 * `begin … end;` のブロックを要求するのは **plpgsql の本文だけ**である。RLS 補助関数は
 * `language sql` の 1 文(`select exists (…)`)なので、ブロックそのものを持たない ——
 * 言語を見ずに一律で要求すると、正しい生成物が落ちる。
 *
 * @param file 生成ファイル(報告用)
 * @param content 全文
 * @returns 満たさなかったもの
 */
function bodyProblems(file: string, content: string): readonly string[] {
  const open = content.indexOf('$$');
  const close = content.lastIndexOf('$$');
  if (open < 0 || close <= open) return [];
  const body = stripSqlNoise(content.slice(open + 2, close));
  const problems: string[] = [];
  const procedural = /\blanguage\s+plpgsql\b/i.test(content);
  // `begin` の数は数えない —— 例外を捕まえる入れ子のブロック(受信 RPC)が普通にあるためで、
  // 見るのは「ブロックが開いていること」と「本文が閉じていること」の 2 つである。
  if (procedural && count(body, /\bbegin\b/g) === 0) problems.push(`${file}: begin のブロックがありません`);
  if (procedural && !body.trimEnd().endsWith('end;')) problems.push(`${file}: 本文が end; で終わっていません`);
  const closedIf = count(body, /\bend\s+if\b/g);
  const openedIf = count(body.replace(/\bend\s+if\b/g, ' '), /\bif\b/g);
  if (openedIf !== closedIf) problems.push(`${file}: if(${openedIf})と end if(${closedIf})の数が合いません`);
  const closedLoop = count(body, /\bend\s+loop\b/g);
  const openedLoop = count(body.replace(/\bend\s+loop\b/g, ' '), /\bloop\b/g);
  if (openedLoop !== closedLoop) problems.push(`${file}: loop(${openedLoop})と end loop(${closedLoop})の数が合いません`);
  const depth = parenDepth(body);
  if (depth !== 0) problems.push(`${file}: 丸括弧が釣り合っていません(${depth})`);
  problems.push(...degenerateCreate(file, body));
  return problems;
}

/** 作成の本文(`on conflict (id) do nothing` を持つ insert)の列を取り出す正規表現。 */
const CREATE_INSERT = /insert\s+into\s+[\w.]+\s*\(([^)]*)\)[\s\S]*?on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing/i;

/**
 * **退化した作成の本文**(入れる列が `id` だけ)を落とす。
 *
 * 構文の釣り合いだけを見ていると「列を 1 つも入れない insert」は釣り合ってしまい、
 * 通し実行が緑のまま NOT NULL に当たる本文が出る(束 ⑳-2 の独立レビュー 8-A が実測した形)。
 * 作成は id のほかに必ず 1 列以上入れる —— そうでない集約は entity_spec が id しか持たない
 * ことになり、表そのものが要らない。
 *
 * @param file 生成ファイル(報告用)
 * @param body `$$` の内側(文字列リテラルと行コメントを潰したもの)
 * @returns 問題の並び(無ければ空)
 */
function degenerateCreate(file: string, body: string): readonly string[] {
  const match = CREATE_INSERT.exec(body);
  if (match === null) return [];
  const columns = (match[1] ?? '').split(',').map((column) => column.trim()).filter((column) => column !== '');
  if (columns.length > 1) return [];
  return [`${file}: 作成の本文が退化しています(入れる列が ${columns.join(', ') || '無し'} だけ)`];
}

/** 文字列リテラルと行コメントを空白に潰す(数え間違いの元を先に落とす)。 */
function stripSqlNoise(body: string): string {
  return body.replace(/'(?:[^']|'')*'/g, " '' ").replace(/--[^\n]*/g, ' ');
}

/**
 * 式の全体が 1 つの丸括弧で包まれているか(最初の `(` が**末尾で**閉じるか)。
 *
 * `check ${式}` という字面は、式が丸括弧で包まれていることに寄りかかっている。
 * `(a > 0) or (b < 0)` は先頭が `(` で釣り合ってもいるが、`check (a > 0)` までで文が切れて
 * 残りが構文エラーになる。
 *
 * @param expression `check` の後ろ(末尾のセミコロンは含まない)
 * @returns 包まれていれば true
 */
function wrappedInParens(expression: string): boolean {
  if (!expression.startsWith('(')) return false;
  let depth = 0;
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === '(') depth += 1;
    else if (expression[index] === ')') {
      depth -= 1;
      if (depth === 0) return index === expression.length - 1;
    }
  }
  return false;
}

/** 正規表現に当たった数。 */
function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/** 丸括弧の釣り合い(0 なら健全。負なら閉じすぎ)。 */
function parenDepth(body: string): number {
  let depth = 0;
  for (const character of body) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
  }
  return depth;
}
