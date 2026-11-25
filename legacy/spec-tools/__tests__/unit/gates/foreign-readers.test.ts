import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DATA_STEPS } from '../../../lib/data/checks.js';
import { readTsTree } from '../../../lib/io/read-ts-tree.js';
import { USECASE_DATA_TABLE_DEPENDENTS } from '../../../lib/verify/usecase-input-notes.js';
import { OPERATION_INPUT_DEPENDENTS } from '../../../lib/verify/operation-input-notes.js';
import { PLACEMENT_PARTS } from '../../../lib/verify/placement-notes.js';
import { REACHABILITY_DEPENDENTS } from '../../../lib/verify/reachability-notes.js';
import { RISK_SOURCES } from '../../../lib/risk/run.js';

/**
 * **他の種類のモデルを生で持つ入力の欄の全数を、`lib/` 全域で固定する**(入力の状態-h・-i)。
 *
 * 入力の型に、入力の状態(`CatalogInput`)を通さない他の種類のモデル(`QuerySpecModel` など)の欄があると、その欄を読む検査は
 * 「採ったのに読めなかった」ときも「採っていない」ときと同じ「無い」として黙って回る(読めずに落とした仕様を「実在しない」と言う偽の error になる)。
 * 読み手の名指し(`operation-input-notes.ts` ほかの表)に載っていない読み手が残らないよう、次を AST と本文の走査で固定する。
 *
 *   0. 走査の範囲は **`lib/` 全域**。各群の**主語の種類**(その群が検査する種類そのものの欄。`SUBJECTS`)だけを除く。
 *      範囲の外に残すのは、生成・導出・台帳側(`OUT_OF_RANGE`。呼び手の入力の状態が決める)だけで、**群ごとに欄の一覧で固定する**(増減・入れ替えのどれでも赤)
 *   1. 範囲の中で見つかった**他の種類の生のモデル**の欄は、ここの表(`FOREIGN_FIELDS`)に載っている(載っていない欄が足されたら赤・表だけにある欄も赤)
 *   2. 表の各欄の読み手(検査 ID)は、名指しの表(`via`)に、その種類の材料を引く検査として載っている
 *   3. 欄を読むファイルは、表の読み手に居る(表に無い読み手が足されたら赤)。**欄ごとに読み手の置き場(`scanDir`)を持つか、持たない理由(`unscanned`)を宣言する**。
 *      読み手を走査できるのは、検査器が入力の型を受けて `{受け口}.{欄}`(既定は `input`)で読む欄。持たない欄は理由で 3 つに分かれ、各分類の本数を固定する:
 *      `wiring` = 群の入口が入力の型へ写すだけ(読むのは写した先の欄で、そちらを走査する)/ `derive` = 導出・計画の部品が受ける(次の 4)/
 *      `declared` = T 群の段の `reads` 宣言と過不足なく一致を見る(別のテスト)
 *   4. `derive` の欄を持つ入力型を引数に取る関数の**呼び出し箇所**を AST で拾い、呼び手のファイルを固定する。呼び手の欄(`UsecaseContext.dataTables` など)は
 *      `CatalogInput` で、検出器が表から除くので、どの走査にも載らない —— 新しい検査が `inputValue(ctx.dataTables)` を導出の部品へ渡して阻害を言わずに回っても、欄の走査では緑になる。
 *      そこで呼び手は、導出の部品どうし(入力型を宣言したファイル)・範囲の外(生成・導出側)・`DERIVE_CALLERS`(阻害を言う手段つきの宣言)のどれかでなければ赤にする
 *
 * 限界(検出は**入力の型の欄**だけ):
 *   - 型を介さず別の経路で他の種類を渡す書き方(関数の引数・クロージャ・インラインの型)は拾わない
 *   - 拾う型は `RAW_TYPES` の `*SpecModel` と `OperationCatalogs` だけ。モデルの中身のカタログの型(`ExternalCatalogSpec` など)で持つ欄(A2・J2 の `external` ほか)は拾わない
 *   - `load*SpecModel` を import して直に読む検証器(例 `lib/product/verifiers/p2-declared-uses.ts`)は型を介さないので見えない
 *   - 3 は `{受け口}.{欄}` の綴りの決め打ち(受け口は欄ごとに宣言)。分割代入や、別の名前で受けるファイルは読み手として見えない。`unscanned` の欄は読み手を走査していない(分類ごとの本数を固定するだけ)
 *   - `wiring` の 6 欄は、写した先(`ScreenInput` の欄。走査済み)に頼る。**`lib/screen/run.ts` が `options.queries` などを写さずに直接読む新しいコードは拾えない**(写し方そのものは見ていない)
 *   - `derive` の欄は 4 の呼び手の固定で見る。見えるのは識別子で直に呼ぶ形とメソッドの `x.name(` だけ(別名の import・名前空間の import・関数を値で渡す形は拾わない)。
 *     引数の型は `Readonly<T>`・`T | undefined`・`readonly T[]`・`T & U` の中も見るが、`Promise<T>` などの別の型で包む形・タプル・型パラメータの制約は拾わない
 *   - **`derive` の入力型を引数に取る関数の宣言(`functionsTaking`)が拾わない形**(2 実例が出るまで実装で拾わない。下の番号はテストのコメントが指す):
 *       ① オブジェクトのプロパティ・クラスのプロパティに束縛した矢印・関数式(`{ f: (i: T) => … }` / `class K { f = (i: T) => … }`)
 *       ② コンストラクタ(`constructor(i: T)`)と、その呼び出し `new K(x)`(`NewExpression` は見ない)
 *       ③ interface / 型リテラルのメソッドシグネチャ(`MethodSignature`)
 *       ④ 文字列名・計算名のメソッド(`'m'(i: T) {}`)と、その呼び出し `k['m'](x)`(要素アクセスの呼び出しは見ない)
 *       ⑤ 修飾名の型参照(`ns.T`。名前空間の import 越しの型)と、`Pick` / `Omit` / `Record` / `Exclude` などの素通しの一覧に無い標準の型
 *       ⑥ 名前なしの `export default`(関数も矢印も)
 *       ⑦ `keyof T`・`unique symbol` などの型演算子(`readonly` だけを素通しにする)
 *       ⑧ 初期化子が矢印・関数式そのものでない束縛(`as` / `satisfies` / 括弧 / 高階関数の引数を初期化子にした `const`)・引数に型注釈の無い文脈型付けの矢印(`const f: Handler = (i) => …`)・
 *          `set` アクセサ・`#private` メソッド・代入式で束縛した関数(`f = (i: T) => …`)
 *   - 呼び手の走査(`callerFilesOf`)は、メソッド名を識別子での呼び出し(`name(`)でも拾うので、同名の無関係な自由関数を呼ぶファイルを呼び手に入れうる(**過検出。偽の赤になる側で安全**)
 *   - **推移的な迂回は拾わない**: 導出の部品を呼ぶ関数が別の型を引数に取り、その型の宣言が走査の範囲の外か、拾う型(`derive` の欄を持つ入力型)の一覧に載らないとき、その関数の呼び手は見えない
 *   - **宣言済みの呼び手の中で呼び出しが増える形は赤にならない**(赤になるのは、宣言に無い新しいファイルが呼ぶときだけ。宣言した呼び手が何本呼ぶかは数えない)
 *   - 宣言した呼び手が欄に何を渡すか(`inputValue(ctx.dataTables)` か、阻害を除いた値か)と、`DERIVE_CALLERS` の `pipeline`(配線が材料ごとに阻害を言うこと)の中身は見ない。範囲の外の呼び手は、その入口の入力の状態が決める
 *   - 範囲の外(`OUT_OF_RANGE`)は欄の一覧で固定するだけで、そこでの阻害の扱いは呼び手(生成の入口・台帳)の入力の状態が決める
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));

/** 他の種類の生のモデルの型 → 種類の名前。 */
const RAW_TYPES: Readonly<Record<string, string>> = {
  QuerySpecModel: 'queries',
  ScreenSpecModel: 'screens',
  UsecaseSpecModel: 'usecases',
  AuthSpecModel: 'auth',
  JobSpecModel: 'jobs',
  NotificationSpecModel: 'notifications',
  ActionSpecModel: 'actions',
  ConfigSpecModel: 'config',
  DataTableSpecModel: 'dataTables',
  ExternalSpecModel: 'external',
  GuaranteeSpecModel: 'guarantees',
  SurfaceSpecModel: 'surface',
  OperationCatalogs: 'catalogs',
};

/** 群ごとの主語の種類(その群が検査する種類そのもの。主語の種類の欄は他の種類ではない)。先に当たった行が勝つ。 */
const SUBJECTS: readonly (readonly [RegExp, string])[] = [
  [/^lib\/(model\/)?(screen|ux)\//, 'screens'],
  [/^lib\/(model\/)?usecase\//, 'usecases'],
  [/^lib\/(model\/job|job|targets\/[^/]+\/job)\//, 'jobs'],
  [/^lib\/(model\/)?auth\//, 'auth'],
  [/^lib\/(model\/)?notification\//, 'notifications'],
  [/^lib\/(model\/)?query\//, 'queries'],
  [/^lib\/(model\/)?config\//, 'config'],
  [/^lib\/(model\/)?external\//, 'external'],
  [/^lib\/(model\/)?guarantee\//, 'guarantees'],
  [/^lib\/(model\/surface|target-api|api)\//, 'surface'],
  [/^lib\/(model\/)?data\//, 'dataTables'],
  [/^lib\/(model\/)?trace\//, 'actions'],
];

/**
 * 型ごとの主語の種類(ディレクトリでは決まらないもの)。群の配線が複数の群の入力の型を 1 つのファイルに持つ型と、
 * ディレクトリの主語とは別の検査(A2 の置き場の取り合い = どの種類も主語に持たない)の入力の型。`null` は「主語を持たない」(どの欄も他の種類)。
 */
const SUBJECT_TYPES: Readonly<Record<string, string | null>> = {
  AuthRunArgs: 'auth',
  GuaranteeRunArgs: 'guarantees',
  ScreenRunArgs: 'screens',
  PlacementClaimSources: null,
  PlacementCollisionInput: null,
};

/**
 * 範囲の外に残す欄(生成・導出・台帳側)。呼び手(生成の入口・台帳)の入力の状態が決めるので、ここでは**群ごとに欄の一覧で固定する**:
 * 増えたら赤(新しい欄が生成・導出側に足された印)・減っても赤(表を直す)・入れ替わっても赤。
 */
interface OutOfRange {
  readonly label: string;
  readonly pattern: RegExp;
  /** 見つかる欄(`keyOf` の綴り)の一覧。 */
  readonly keys: readonly string[];
}

const OUT_OF_RANGE: readonly OutOfRange[] = [
  { label: '生成(文書・実装の部品)', pattern: /^lib\/generate\//, keys: [
    'lib/generate/render/code-rpc-expectations.ts ExpectationContext.actions',
    'lib/generate/render/code-rpc-expectations.ts ExpectationContext.jobs',
    'lib/generate/render/l2-sweep-catalogs.ts JobEvidenceContext.actions',
  ] },
  { label: '受信口の導出', pattern: /^lib\/inbound\//, keys: [
    'lib/inbound/inbound-functions.ts InboundFunctionInput.dataTables',
    'lib/inbound/inbound-functions.ts InboundFunctionInput.external',
    'lib/inbound/inbound-plan.ts InboundPlanInput.dataTables',
  ] },
  { label: '実行結果の表', pattern: /^lib\/results\//, keys: [
    'lib/results/cases.ts ResultCasesInput.actions',
    'lib/results/cases.ts ResultCasesInput.dataTables',
    'lib/results/cases.ts ResultCasesInput.jobs',
    'lib/results/save-cases.ts SaveResultInput.actions',
    'lib/results/save-cases.ts SaveResultInput.dataTables',
    'lib/results/save-cases.ts SaveResultInput.usecases',
  ] },
  { label: 'SQL の導出', pattern: /^lib\/sql\//, keys: [
    'lib/sql/rpc-facts.ts RpcFactsInput.actions',
  ] },
  { label: '一致の証明の世界', pattern: /^lib\/world\//, keys: [
    'lib/world/eq-catalog.ts EqCatalogInput.actions',
    'lib/world/eq-catalog.ts EqCatalogInput.dataTables',
    'lib/world/eq-catalog.ts EqCatalogInput.jobs',
    'lib/world/eq-save-catalog.ts EqSaveCatalogInput.actions',
    'lib/world/eq-save-catalog.ts EqSaveCatalogInput.dataTables',
    'lib/world/eq-save-catalog.ts EqSaveCatalogInput.usecases',
  ] },
  { label: '生成器の文脈(`GenerateContext` の種類ごとの任意の欄)', pattern: /^lib\/gen-kit\//, keys: [
    'lib/gen-kit/generator.ts GenerateContext.actions',
    'lib/gen-kit/generator.ts GenerateContext.surface',
    'lib/gen-kit/generator.ts GenerateContext.auth',
    'lib/gen-kit/generator.ts GenerateContext.config',
    'lib/gen-kit/generator.ts GenerateContext.dataTables',
    'lib/gen-kit/generator.ts GenerateContext.external',
    'lib/gen-kit/generator.ts GenerateContext.guarantees',
    'lib/gen-kit/generator.ts GenerateContext.jobs',
    'lib/gen-kit/generator.ts GenerateContext.notifications',
    'lib/gen-kit/generator.ts GenerateContext.queries',
    'lib/gen-kit/generator.ts GenerateContext.screens',
    'lib/gen-kit/generator.ts GenerateContext.usecases',
  ] },
  { label: '変異の目録(検査器を壊して測る入力)', pattern: /^lib\/mutation\//, keys: [
    'lib/mutation/types.ts MutationSubject.actions',
    'lib/mutation/types.ts MutationSubject.dataTables',
    'lib/mutation/types.ts MutationSubject.jobs',
  ] },
  { label: '全種類のテストケース ID を集める台帳(`TcSources`)', pattern: /^lib\/spec-index\//, keys: [
    'lib/spec-index/sources.ts TcSources.actions',
    'lib/spec-index/sources.ts TcSources.auth',
    'lib/spec-index/sources.ts TcSources.dataTables',
    'lib/spec-index/sources.ts TcSources.external',
    'lib/spec-index/sources.ts TcSources.frameworkGuarantees',
    'lib/spec-index/sources.ts TcSources.guarantees',
    'lib/spec-index/sources.ts TcSources.jobs',
    'lib/spec-index/sources.ts TcSources.notifications',
    'lib/spec-index/sources.ts TcSources.queries',
    'lib/spec-index/sources.ts TcSources.screens',
    'lib/spec-index/sources.ts TcSources.usecases',
  ] },
  { label: '確認の要否の導出が読むカタログの束(`OperationCatalogs` の定義)', pattern: /^lib\/semantics\//, keys: [
    'lib/semantics/operation-catalogs.ts OperationCatalogs.dataTables',
    'lib/semantics/operation-catalogs.ts OperationCatalogs.jobs',
    'lib/semantics/operation-catalogs.ts OperationCatalogs.notifications',
  ] },
];

/** 他の種類の生のモデルを持つ欄 1 つ。 */
interface ForeignField {
  /** 欄を宣言するファイル(`lib/` 始まり)。 */
  readonly file: string;
  readonly type: string;
  readonly field: string;
  /** 欄が持つ種類(`RAW_TYPES` の値)。 */
  readonly kind: string;
  /** 欄を読む検査(検査 ID)。阻害を名指しの表で言うもの。 */
  readonly readers: readonly string[];
  /** 読み手を名指す表。 */
  readonly via: 'operation-input-notes' | 'reachability-notes' | 'usecase-input-notes' | 'jobs-group' | 'data-step-reads' | 'placement-notes' | 'risk-sources';
  /** 読み手のファイルがある場所(`lib/` 始まりの接頭辞。ファイル 1 本でもよい)。`unscanned` と排他で、どちらかを必ず宣言する。 */
  readonly scanDir?: string;
  /** 読み手が欄を受ける名前(`{受け口}.{欄}`)。省略は `input`。 */
  readonly accessor?: string;
  /** ファイル名から検査 ID が決まらない読み手のファイル(ファイル → そのファイルが動かす検査 ID)。 */
  readonly readerFiles?: Readonly<Record<string, readonly string[]>>;
  /** 読み手を走査しない理由(`scanDir` と排他)。分類ごとの本数をテストが固定する。 */
  readonly unscanned?: 'wiring' | 'derive' | 'declared';
}

/**
 * 欄を読み、欠けた材料を**否定できない側に倒している**検査。倒せるのは、読めずに仕様を落としただけの阻害(`invalid`。部分のモデルが渡る)まで。
 * 置き場ごと無い・読めない阻害(`available: false`)ではモデルが渡らず、検査は実行されないので、保留の呼び出しの代わりに**名指しの表の行**で言う
 * (表の行は `exceptReasons: ['invalid']` で、読めて落としただけの阻害では出さない)。倒している箇所の綴り(`marker`)がファイルに残っていることをテストが見る
 * (倒すのをやめたら赤)。
 */
const CONSERVATIVE_READERS: readonly { readonly id: string; readonly kind: string; readonly file: string; readonly marker: string }[] = [
  { id: 'S12', kind: 'queries', file: 'lib/screen/verifiers/s12-error-reachability.ts', marker: 'if (query === undefined) return true;' },
];

const QUERY_READERS = ['S2', 'S4', 'S8', 'S12', 'S14', 'S18', 'S19'];
const AUTH_READERS = ['S7', 'S13', 'S14', 'S15', 'S16'];
const ACTION_READERS = ['Y2', 'Y5', 'Y8', 'Y10', 'Y12'];
const SCREEN_REACH_READERS = ['S13', 'S16', 'Y1', 'Y3', 'Y5'];

/** 他の種類の生のモデルを持つ入力の欄の全数(足したら、読み手を名指しの表に載せる)。 */
const FOREIGN_FIELDS: readonly ForeignField[] = [
  { file: 'lib/model/screen/types-model.ts', type: 'ScreenInput', field: 'queries', kind: 'queries', readers: QUERY_READERS, via: 'operation-input-notes', scanDir: 'lib/screen/verifiers/' },
  { file: 'lib/model/screen/types-model.ts', type: 'ScreenInput', field: 'usecases', kind: 'usecases', readers: ['S16'], via: 'operation-input-notes', scanDir: 'lib/screen/verifiers/' },
  { file: 'lib/model/screen/types-model.ts', type: 'ScreenInput', field: 'auth', kind: 'auth', readers: AUTH_READERS, via: 'reachability-notes', scanDir: 'lib/screen/verifiers/' },
  { file: 'lib/screen/run.ts', type: 'ScreenRunOptions', field: 'queries', kind: 'queries', readers: QUERY_READERS, via: 'operation-input-notes', unscanned: 'wiring' },
  { file: 'lib/screen/run.ts', type: 'ScreenRunOptions', field: 'usecases', kind: 'usecases', readers: ['S16'], via: 'operation-input-notes', unscanned: 'wiring' },
  { file: 'lib/screen/run.ts', type: 'ScreenRunOptions', field: 'auth', kind: 'auth', readers: AUTH_READERS, via: 'reachability-notes', unscanned: 'wiring' },
  { file: 'lib/verify/screens-group.ts', type: 'ScreenRunArgs', field: 'queries', kind: 'queries', readers: QUERY_READERS, via: 'operation-input-notes', unscanned: 'wiring' },
  { file: 'lib/verify/screens-group.ts', type: 'ScreenRunArgs', field: 'usecases', kind: 'usecases', readers: ['S16'], via: 'operation-input-notes', unscanned: 'wiring' },
  { file: 'lib/verify/screens-group.ts', type: 'ScreenRunArgs', field: 'auth', kind: 'auth', readers: AUTH_READERS, via: 'reachability-notes', unscanned: 'wiring' },
  { file: 'lib/verify/screens-group.ts', type: 'ScreenRunArgs', field: 'actions', kind: 'actions', readers: ['S17', 'S18', 'S19'], via: 'operation-input-notes', unscanned: 'derive' },
  { file: 'lib/verify/screens-group.ts', type: 'ScreenRunArgs', field: 'catalogs', kind: 'catalogs', readers: ['S19'], via: 'operation-input-notes', unscanned: 'derive' },
  { file: 'lib/verify/reachability-notes.ts', type: 'ScreensForReachability', field: 'screens', kind: 'screens', readers: SCREEN_REACH_READERS, via: 'reachability-notes', unscanned: 'derive' },
  { file: 'lib/verify/reachability-notes.ts', type: 'ScreensForReachability', field: 'auth', kind: 'auth', readers: [...AUTH_READERS, 'Y3', 'Y5'], via: 'reachability-notes', unscanned: 'derive' },
  { file: 'lib/usecase/derive.ts', type: 'UsecaseInput', field: 'actions', kind: 'actions', readers: ACTION_READERS, via: 'operation-input-notes', scanDir: 'lib/usecase/verifiers/' },
  { file: 'lib/usecase/derive.ts', type: 'UsecaseInput', field: 'screens', kind: 'screens', readers: ['Y1', 'Y3', 'Y5'], via: 'reachability-notes', scanDir: 'lib/usecase/verifiers/' },
  { file: 'lib/usecase/derive.ts', type: 'UsecaseInput', field: 'catalogs', kind: 'catalogs', readers: ['Y5'], via: 'operation-input-notes', scanDir: 'lib/usecase/', readerFiles: { 'lib/usecase/derive-effort.ts': ['Y5'] } },
  { file: 'lib/usecase/composite.ts', type: 'CompositeInput', field: 'actions', kind: 'actions', readers: ACTION_READERS, via: 'operation-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/composite.ts', type: 'CompositeInput', field: 'dataTables', kind: 'dataTables', readers: ['Y8', 'Y10', 'Y12'], via: 'usecase-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/operation-plan.ts', type: 'OperationBuildInput', field: 'actions', kind: 'actions', readers: ACTION_READERS, via: 'operation-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/operation-plan.ts', type: 'OperationBuildInput', field: 'dataTables', kind: 'dataTables', readers: ['Y8', 'Y10', 'Y12'], via: 'usecase-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/operation-plan.ts', type: 'OperationBuildInput', field: 'jobs', kind: 'jobs', readers: ['Y5'], via: 'operation-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/plan-build.ts', type: 'BuildInput', field: 'actions', kind: 'actions', readers: ACTION_READERS, via: 'operation-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/plan-build.ts', type: 'BuildInput', field: 'dataTables', kind: 'dataTables', readers: ['Y8', 'Y10', 'Y12'], via: 'usecase-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/step-plan.ts', type: 'PlanInput', field: 'actions', kind: 'actions', readers: ACTION_READERS, via: 'operation-input-notes', unscanned: 'derive' },
  { file: 'lib/usecase/step-plan.ts', type: 'PlanInput', field: 'dataTables', kind: 'dataTables', readers: ['Y8', 'Y10', 'Y12'], via: 'usecase-input-notes', unscanned: 'derive' },
  { file: 'lib/ux/context.ts', type: 'UxContext', field: 'catalogs', kind: 'catalogs', readers: ['U1'], via: 'operation-input-notes', scanDir: 'lib/ux/', accessor: 'ctx', readerFiles: { 'lib/ux/confirm.ts': ['U1'] } },
  { file: 'lib/job/run.ts', type: 'JobRunInput', field: 'actions', kind: 'actions', readers: ['J2'], via: 'operation-input-notes', scanDir: 'lib/job/verifiers/' },
  { file: 'lib/job/run.ts', type: 'JobRunInput', field: 'screens', kind: 'screens', readers: ['J2'], via: 'operation-input-notes', scanDir: 'lib/job/verifiers/' },
  { file: 'lib/job/run.ts', type: 'JobRunInput', field: 'auth', kind: 'auth', readers: ['J2'], via: 'jobs-group', scanDir: 'lib/job/verifiers/' },
  { file: 'lib/job/verifiers/j2-endpoint-reach.ts', type: 'EndpointReachInput', field: 'actions', kind: 'actions', readers: ['J2'], via: 'operation-input-notes', scanDir: 'lib/job/verifiers/j2-endpoint-reach.ts' },
  { file: 'lib/job/verifiers/j2-entry-closed.ts', type: 'EntryClosedInput', field: 'auth', kind: 'auth', readers: ['J2'], via: 'jobs-group', scanDir: 'lib/job/verifiers/j2-entry-closed.ts' },
  { file: 'lib/job/verifiers/j2-entry-collision.ts', type: 'EntryCollisionInput', field: 'screens', kind: 'screens', readers: ['J2'], via: 'operation-input-notes', scanDir: 'lib/job/verifiers/j2-entry-collision.ts' },
  { file: 'lib/job/verifiers/j2-entry-collision.ts', type: 'EntryCollisionInput', field: 'auth', kind: 'auth', readers: ['J2'], via: 'jobs-group', scanDir: 'lib/job/verifiers/j2-entry-collision.ts' },
  { file: 'lib/job/verifiers/j2-entry-origin-guard.ts', type: 'EntryOriginGuardInput', field: 'auth', kind: 'auth', readers: ['J2'], via: 'jobs-group', scanDir: 'lib/job/verifiers/j2-entry-origin-guard.ts' },
  { file: 'lib/job/verifiers/j2-scan-origin.ts', type: 'ScanOriginInput', field: 'actions', kind: 'actions', readers: ['J2'], via: 'operation-input-notes', scanDir: 'lib/job/verifiers/j2-scan-origin.ts' },
  { file: 'lib/job/verifiers/j2-scan-origin.ts', type: 'ScanOriginInput', field: 'auth', kind: 'auth', readers: ['J2'], via: 'jobs-group', scanDir: 'lib/job/verifiers/j2-scan-origin.ts' },
  { file: 'lib/generality/run.ts', type: 'GeneralityRunInput', field: 'notifications', kind: 'notifications', readers: ['W1', 'W2'], via: 'operation-input-notes', scanDir: 'lib/generality/', readerFiles: { 'lib/generality/run.ts': ['W1', 'W2'] } },
  { file: 'lib/generality/run.ts', type: 'GeneralityRunInput', field: 'jobs', kind: 'jobs', readers: ['W1', 'W2'], via: 'operation-input-notes', scanDir: 'lib/generality/', readerFiles: { 'lib/generality/run.ts': ['W1', 'W2'] } },
  { file: 'lib/generality/run.ts', type: 'GeneralityRunInput', field: 'config', kind: 'config', readers: ['W1', 'W2'], via: 'operation-input-notes', scanDir: 'lib/generality/', readerFiles: { 'lib/generality/run.ts': ['W1', 'W2'] } },
  { file: 'lib/data/input.ts', type: 'DataBackingValues', field: 'actions', kind: 'actions', readers: ['T6', 'T17', 'T11'], via: 'data-step-reads', unscanned: 'declared' },
  { file: 'lib/data/input.ts', type: 'DataBackingValues', field: 'jobs', kind: 'jobs', readers: ['T19', 'T22', 'T28', 'T26', 'T24', 'T11'], via: 'data-step-reads', unscanned: 'declared' },
  { file: 'lib/data/input.ts', type: 'DataBackingValues', field: 'usecases', kind: 'usecases', readers: ['T11', 'T12'], via: 'data-step-reads', unscanned: 'declared' },
  { file: 'lib/data/input.ts', type: 'DataBackingValues', field: 'external', kind: 'external', readers: ['T12'], via: 'data-step-reads', unscanned: 'declared' },
  { file: 'lib/data/input.ts', type: 'DataBackingValues', field: 'surface', kind: 'surface', readers: ['T12'], via: 'data-step-reads', unscanned: 'declared' },
  { file: 'lib/trace/placement-claims.ts', type: 'PlacementClaimSources', field: 'actions', kind: 'actions', readers: ['A2'], via: 'placement-notes', scanDir: 'lib/trace/placement-claims.ts', accessor: 'sources', readerFiles: { 'lib/trace/placement-claims.ts': ['A2'] } },
  { file: 'lib/trace/placement-claims.ts', type: 'PlacementClaimSources', field: 'usecases', kind: 'usecases', readers: ['A2'], via: 'placement-notes', scanDir: 'lib/trace/placement-claims.ts', accessor: 'sources', readerFiles: { 'lib/trace/placement-claims.ts': ['A2'] } },
  { file: 'lib/trace/verifiers/a2-placement-collision.ts', type: 'PlacementCollisionInput', field: 'actions', kind: 'actions', readers: ['A2'], via: 'placement-notes', scanDir: 'lib/trace/verifiers/a2-placement-collision.ts' },
  { file: 'lib/trace/verifiers/a2-placement-collision.ts', type: 'PlacementCollisionInput', field: 'usecases', kind: 'usecases', readers: ['A2'], via: 'placement-notes', scanDir: 'lib/trace/verifiers/a2-placement-collision.ts' },
  { file: 'lib/risk/verifiers/r2-ground-writers.ts', type: 'GroundWritersInput', field: 'actions', kind: 'actions', readers: ['R2'], via: 'risk-sources', scanDir: 'lib/risk/verifiers/r2-ground-writers.ts' },
  { file: 'lib/risk/verifiers/r2-ground-writers.ts', type: 'GroundWritersInput', field: 'dataTables', kind: 'dataTables', readers: ['R2'], via: 'risk-sources', scanDir: 'lib/risk/verifiers/r2-ground-writers.ts' },
  { file: 'lib/risk/verifiers/r5-abuse.ts', type: 'AbuseInput', field: 'dataTables', kind: 'dataTables', readers: ['R5'], via: 'risk-sources', scanDir: 'lib/risk/verifiers/r5-abuse.ts' },
  { file: 'lib/risk/verifiers/r2-sites.ts', type: 'SiteInput', field: 'actions', kind: 'actions', readers: ['R2'], via: 'risk-sources', scanDir: 'lib/risk/verifiers/r2-sites.ts' },
  { file: 'lib/risk/verifiers/r2-sites.ts', type: 'SiteInput', field: 'dataTables', kind: 'dataTables', readers: ['R2'], via: 'risk-sources', scanDir: 'lib/risk/verifiers/r2-sites.ts' },
  { file: 'lib/risk/verifiers/r2-trace.ts', type: 'TraceCatalogs', field: 'dataTables', kind: 'dataTables', readers: ['R2'], via: 'risk-sources', scanDir: 'lib/risk/verifiers/r2-trace.ts', accessor: 'catalogs' },
];

/** 欄の識別子。 */
const keyOf = (item: { readonly file: string; readonly type: string; readonly field: string }): string => `${item.file} ${item.type}.${item.field}`;

/** 見つかった欄 1 つ。 */
interface FoundMember {
  readonly type: string;
  readonly field: string;
  readonly kind: string;
}

/**
 * 本文から、他の種類の生のモデルを持つ型の欄を拾う(`interface` と、型リテラルの別名の両方。入力の状態 `CatalogInput` で持つ欄と、主語の種類の欄は除く)。
 *
 * @param source ファイルの本文
 * @param own その場所が主語に持つ種類(なければ null)
 * @param subjectTypes 型ごとの主語の種類(場所では決まらない型。省略は `SUBJECT_TYPES`)
 */
function foreignRawMembers(source: string, own: string | null, subjectTypes: Readonly<Record<string, string | null>> = SUBJECT_TYPES): FoundMember[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true);
  const found: FoundMember[] = [];
  const visit = (node: ts.Node): void => {
    const members = ts.isInterfaceDeclaration(node) ? node.members : ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) ? node.type.members : null;
    if (members !== null && (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))) {
      const subject = node.name.text in subjectTypes ? (subjectTypes[node.name.text] ?? null) : own;
      for (const member of members) {
        if (!ts.isPropertySignature(member) || member.type === undefined) continue;
        const text = member.type.getText(file);
        if (/\bCatalogInput\b/.test(text)) continue;
        for (const [typeName, kind] of Object.entries(RAW_TYPES)) {
          if (kind !== subject && new RegExp(`\\b${typeName}\\b`).test(text)) found.push({ type: node.name.text, field: member.name.getText(file), kind });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** そのファイルが主語に持つ種類(`SUBJECTS` の先に当たった行。なければ null)。 */
const subjectOf = (file: string): string | null => SUBJECTS.find(([pattern]) => pattern.test(file))?.[1] ?? null;

/**
 * 見つかった欄を、範囲の外(`OUT_OF_RANGE`)の群ごとに集め、範囲の中の欄(表に載るべきもの)と分ける。
 *
 * @param sources ファイル名 → 本文(`lib/` 始まり)
 */
function classifyFound(sources: ReadonlyMap<string, string>): { readonly inRange: string[]; readonly outOfRange: ReadonlyMap<string, string[]> } {
  const inRange: string[] = [];
  const outOfRange = new Map<string, string[]>();
  for (const [file, source] of sources) {
    if (!file.endsWith('.ts')) continue;
    for (const member of foreignRawMembers(source, subjectOf(file))) {
      const group = OUT_OF_RANGE.find((entry) => entry.pattern.test(file));
      const key = keyOf({ file, ...member });
      if (group === undefined) inRange.push(key);
      else outOfRange.set(group.label, [...(outOfRange.get(group.label) ?? []), key]);
    }
  }
  return { inRange, outOfRange };
}

/**
 * 範囲の外の群のうち、見つかった欄の一覧が固定の一覧と違うもの(増えても減っても入れ替わっても返す)。
 *
 * @param found 群の名前 → 見つかった欄
 * @param expected 固定の一覧(省略は `OUT_OF_RANGE`)
 */
const outOfRangeDiffs = (found: ReadonlyMap<string, readonly string[]>, expected: readonly OutOfRange[] = OUT_OF_RANGE): { readonly label: string; readonly found: readonly string[]; readonly expected: readonly string[] }[] =>
  expected
    .map((entry) => ({ label: entry.label, found: [...(found.get(entry.label) ?? [])].sort(), expected: [...entry.keys].sort() }))
    .filter((entry) => JSON.stringify(entry.found) !== JSON.stringify(entry.expected));

/** 欄を読むファイル(置き場の接頭辞の下で `{受け口}.{欄}` を含むもの)と、そのファイルが動かす検査 ID(決まらなければ null)。 */
function readersOf(entry: Pick<ForeignField, 'scanDir' | 'accessor' | 'field' | 'readerFiles'>, sources: ReadonlyMap<string, string>): { readonly file: string; readonly ids: readonly (string | null)[] }[] {
  const pattern = new RegExp(`\\b${entry.accessor ?? 'input'}\\.${entry.field}\\b`);
  return [...sources]
    .filter(([file, source]) => file.startsWith(entry.scanDir ?? '') && pattern.test(source))
    .map(([file]) => ({ file, ids: entry.readerFiles?.[file] ?? [idOfFile(file)] }));
}

/** 検査器のファイル名から検査 ID(`s14-state-visibility.ts` → `S14`)。 */
const idOfFile = (name: string): string | null => /^([a-z])(\d+)-/.exec(name.split('/').pop() ?? '')?.slice(1).join('').toUpperCase() ?? null;

/** 導出の部品(`unscanned: 'derive'` の欄を持つ入力型)の呼び手 1 ファイル。呼び手は、阻害を言う手段を宣言する。 */
interface DeriveCaller {
  /** 呼び手のファイル(`lib/` 始まり)。 */
  readonly file: string;
  /** 検査器なら検査 ID(ファイル名の ID と一致することを見る)。群の配線のように検査器でなければ null。 */
  readonly id: string | null;
  /**
   * 呼び手が阻害を言う手段:
   * `usecase-input-notes` = ユースケースの表(`USECASE_DATA_TABLE_DEPENDENTS`)に検査 ID が載る /
   * `trace-gap` = 自分で `dataTablesGap(` を呼んで、使えなかった材料を実行ログに載せる(trace の検査) /
   * `pipeline` = 全検査の配線(`verify-pipeline.ts`)。入力の状態を決める側で、阻害の行は配線が材料ごとに言う(中身までは見ない)
   */
  readonly reports: 'usecase-input-notes' | 'trace-gap' | 'pipeline';
}

/** 導出の部品を呼ぶ検査器・配線(足したら、阻害を言う手段を宣言する。宣言に無い呼び手が足されたら赤・呼ばなくなった宣言も赤)。 */
const DERIVE_CALLERS: readonly DeriveCaller[] = [
  { file: 'lib/usecase/verifiers/y8-param-source.ts', id: 'Y8', reports: 'usecase-input-notes' },
  { file: 'lib/usecase/verifiers/y10-plan-resolution.ts', id: 'Y10', reports: 'usecase-input-notes' },
  { file: 'lib/usecase/verifiers/y12-save-renderable.ts', id: 'Y12', reports: 'usecase-input-notes' },
  { file: 'lib/trace/verifiers/a15-operation-plan.ts', id: 'A15', reports: 'trace-gap' },
  { file: 'lib/trace/verifiers/a19-compute-facts.ts', id: 'A19', reports: 'trace-gap' },
  { file: 'lib/compose/verify-pipeline.ts', id: null, reports: 'pipeline' },
];

/** 型の引数を素通しで包む標準の型(中の型参照まで剥がして見る)。 */
const TRANSPARENT_WRAPPERS: ReadonlySet<string> = new Set(['Readonly', 'ReadonlyArray', 'Array', 'Partial', 'Required', 'NonNullable']);

/**
 * 型の注釈が入力型(`typeNames`)を指すか。素の参照のほか、`Readonly<T>`・`T | undefined`・`T & U`・`readonly T[]`・`(T)` の中の参照も見る。
 * 拾わない形: 型の引数に入れて包む別の型(`Promise<T>`・`Map<K, T>`)・タプル・型パラメータの制約(`<U extends T>`)・関数型の引数・`typeof` / `ReturnType<>` で導いた型・
 * `readonly` 以外の型演算子(`keyof T`)・修飾名(`ns.T`)・`Pick` / `Omit` / `Record`(ヘッダの限界欄)。
 */
function mentionsType(type: ts.TypeNode, sourceFile: ts.SourceFile, typeNames: ReadonlySet<string>): boolean {
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText(sourceFile);
    if (typeNames.has(name)) return true;
    return TRANSPARENT_WRAPPERS.has(name) && (type.typeArguments ?? []).some((argument) => mentionsType(argument, sourceFile, typeNames));
  }
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.some((member) => mentionsType(member, sourceFile, typeNames));
  if (ts.isArrayTypeNode(type)) return mentionsType(type.elementType, sourceFile, typeNames);
  if (ts.isParenthesizedTypeNode(type)) return mentionsType(type.type, sourceFile, typeNames);
  // 型演算子で素通しにするのは `readonly T[]` の `readonly` だけ。`keyof T`・`unique symbol` は入力型そのものを取る形ではない(限界欄の⑦)
  if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) return mentionsType(type.type, sourceFile, typeNames);
  return false;
}

/** 入力型を引数に取る関数・メソッドの宣言 1 件。 */
interface TakingDeclaration {
  readonly name: string;
  readonly file: string;
  /** クラスのメソッド・オブジェクトのメソッド短縮形(呼ぶ側は `x.name(` の形)。 */
  readonly method: boolean;
}

/**
 * 入力型(`typeNames`)を引数に取る関数(関数宣言・`const` に束縛した関数式 / 矢印関数)とメソッド(クラスのメソッド・オブジェクトのメソッド短縮形)の宣言。
 * 引数の型は `mentionsType` が剥がして見る。
 *
 * @param sources ファイル名 → 本文(`lib/` 始まり)
 * @param typeNames 引数の型の名前
 */
function takingDeclarations(sources: ReadonlyMap<string, string>, typeNames: ReadonlySet<string>): readonly TakingDeclaration[] {
  const found: TakingDeclaration[] = [];
  for (const [file, source] of sources) {
    if (!file.endsWith('.ts') || ![...typeNames].some((name) => source.includes(name))) continue;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    const takes = (parameters: ts.NodeArray<ts.ParameterDeclaration>): boolean =>
      parameters.some((parameter) => parameter.type !== undefined && mentionsType(parameter.type, sourceFile, typeNames));
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name !== undefined && takes(node.parameters)) found.push({ name: node.name.text, file, method: false });
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && takes(node.parameters)) found.push({ name: node.name.text, file, method: true });
      const initializer = ts.isVariableDeclaration(node) ? node.initializer : undefined;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && takes(initializer.parameters)) {
        found.push({ name: node.name.text, file, method: false });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

/** 入力型を引数に取る関数(メソッドを含む)の名前 → 宣言したファイル(同じ名前が複数あれば後勝ち。呼び手の走査は名前だけを使う)。 */
const functionsTaking = (sources: ReadonlyMap<string, string>, typeNames: ReadonlySet<string>): ReadonlyMap<string, string> =>
  new Map(takingDeclarations(sources, typeNames).map((declaration) => [declaration.name, declaration.file]));

/** 入力型を引数に取るメソッドの名前(呼ぶ側が `x.name(` と書く関数)。 */
const methodsTaking = (sources: ReadonlyMap<string, string>, typeNames: ReadonlySet<string>): ReadonlySet<string> =>
  new Set(takingDeclarations(sources, typeNames).filter((declaration) => declaration.method).map((declaration) => declaration.name));

/**
 * 関数(名前)を呼ぶ箇所のファイル。識別子で直に呼ぶ形(`name(`)と、メソッドの名前(`methods`)を `x.name(` で呼ぶ形を拾う。
 * 別名の import・名前空間の import(`ns.name(`)・関数を値で渡す形は拾わない。
 *
 * @param sources ファイル名 → 本文(`lib/` 始まり)
 * @param names 呼ばれる関数の名前
 * @param methods `names` のうち、メソッドとして呼ばれるもの(省略は無し)
 * @returns 呼び手のファイル(昇順・重複なし)
 */
function callerFilesOf(sources: ReadonlyMap<string, string>, names: ReadonlySet<string>, methods: ReadonlySet<string> = new Set()): readonly string[] {
  const files = new Set<string>();
  for (const [file, source] of sources) {
    if (!file.endsWith('.ts') || ![...names].some((name) => source.includes(name))) continue;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && names.has(callee.text)) files.add(file);
        if (ts.isPropertyAccessExpression(callee) && methods.has(callee.name.text)) files.add(file);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...files].sort();
}

/**
 * 導出の部品の呼び手のうち、説明のつかないもの。説明がつくのは次だけ: 導出の部品どうし(入力型を宣言したファイル自身)/
 * 範囲の外(生成・導出・台帳側。呼び手の入力の状態が決める)/ 宣言した呼び手(`DERIVE_CALLERS`)。
 *
 * @param callers 呼び手のファイル
 * @param typeFiles 導出の入力型を宣言したファイル
 * @param declared 宣言した呼び手
 * @param outOfRange 範囲の外の群(省略は `OUT_OF_RANGE`)
 */
const unexplainedCallers = (callers: readonly string[], typeFiles: ReadonlySet<string>, declared: readonly DeriveCaller[], outOfRange: readonly OutOfRange[] = OUT_OF_RANGE): readonly string[] =>
  callers.filter((file) => !typeFiles.has(file) && !outOfRange.some((entry) => entry.pattern.test(file)) && !declared.some((caller) => caller.file === file));

describe('他の種類のモデルを生で持つ入力の欄は、lib/ 全域で全数が表に載っている', () => {
  const sources = readTsTree(LIB_DIR, 'lib/');

  it('走査の母集合が空でない(組み立てが壊れても緑にしない)', () => {
    expect(sources.size).toBeGreaterThan(500);
  });

  it('範囲の中で見つかった欄の全数が表と一致する(表に無い欄が足されたら赤・表だけにある欄も赤)', () => {
    expect(classifyFound(sources).inRange.sort()).toEqual(FOREIGN_FIELDS.map(keyOf).sort());
  });

  it('範囲の外(生成・導出・台帳側)は群ごとに欄の一覧で固定する(増減・入れ替えで赤)', () => {
    expect(outOfRangeDiffs(classifyFound(sources).outOfRange)).toEqual([]);
  });

  it('表の欄の種類は、入力の型の欄の型と一致する', () => {
    for (const entry of FOREIGN_FIELDS) {
      const members = foreignRawMembers(sources.get(entry.file) ?? '', null, {}).filter((member) => member.type === entry.type && member.field === entry.field);

      expect(members.map((member) => member.kind), keyOf(entry)).toContain(entry.kind);
    }
  });
});

describe('表の読み手は、名指しの表に載っている', () => {
  const jobsGroup = readFileSync(`${LIB_DIR}verify/jobs-group.ts`, 'utf-8');

  /** 名指しの表ごとの、検査 ID → 引く材料の種類(実物の表・実物のコードから引く)。 */
  const NAMED: Readonly<Record<ForeignField['via'], ReadonlyMap<string, ReadonlySet<string>>>> = {
    'operation-input-notes': new Map(OPERATION_INPUT_DEPENDENTS.map((dependent) => [dependent.id, new Set(dependent.needs.map((need) => need.input))])),
    'reachability-notes': new Map(REACHABILITY_DEPENDENTS.map((dependent) => [dependent.id, new Set(dependent.gapInputs ?? ['screens', 'auth'])])),
    'usecase-input-notes': new Map(USECASE_DATA_TABLE_DEPENDENTS.map((dependent) => [dependent.id, new Set(['dataTables'])])),
    // J2 の認証の阻害は表を持たず、群の配線(`jobs-group.ts`)が結果の `scanOriginUnchecked` を「認証仕様が読めないため」の行で言う(その綴りが残っている間だけ載せる)。
    'jobs-group': new Map(jobsGroup.includes('scanOriginUnchecked') && jobsGroup.includes('認証仕様が読めないため') ? [['J2', new Set(['auth'])]] : []),
    // T 群は段の `reads` 宣言が阻害の行の源(`dataStepGaps`)。
    'data-step-reads': new Map(DATA_STEPS.filter((step) => step.reads.length > 0).map((step) => [step.id, new Set<string>(step.reads.map((read) => read.kind))])),
    // A2 の置き場の取り合いは、主張の集まりごとに阻害の行を言う(`describePlacementGaps`)。
    'placement-notes': new Map([['A2', new Set<string>(PLACEMENT_PARTS.map((part) => part.key))]]),
    // R2 は引く材料の表(`RISK_SOURCES`)の全行で阻害の行を言う(`lib/risk/run.ts`)。
    'risk-sources': new Map([['R2', new Set<string>(RISK_SOURCES.map((source) => source.kind))], ['R5', new Set<string>(['dataTables'])]]),
  };

  it('各読み手が、その種類の材料を引く検査として載っている(カタログの束 `catalogs` は 3 種類を引く)', () => {
    for (const entry of FOREIGN_FIELDS) {
      for (const reader of entry.readers) {
        const needs = NAMED[entry.via].get(reader);
        const wanted = entry.kind === 'catalogs' ? ['dataTables', 'notifications', 'jobs'] : [entry.kind];

        expect(needs, `${keyOf(entry)} の読み手 ${reader} が ${entry.via} に載っていない`).toBeDefined();
        for (const need of wanted) expect([...(needs ?? [])], `${reader} が ${need} を引く検査として ${entry.via} に載っていない`).toContain(need);
      }
    }
  });

  it('T 群は、表の読み手が段の `reads` の宣言と過不足なく一致する(宣言した段が表に無ければ赤・表の段が宣言していなくても赤)', () => {
    for (const entry of FOREIGN_FIELDS.filter((candidate) => candidate.via === 'data-step-reads')) {
      const declared = DATA_STEPS.filter((step) => step.reads.some((read) => read.kind === entry.kind)).map((step) => step.id);

      expect([...entry.readers].sort(), keyOf(entry)).toEqual(declared.sort());
    }
  });

  it('否定できない側に倒している読み手は、倒す箇所が残り、保留(foreignBlocked)を持たず、名指しの表の行は「読めて落としただけ」を除く', () => {
    for (const conservative of CONSERVATIVE_READERS) {
      const source = readTsTree(LIB_DIR, 'lib/').get(conservative.file) ?? '';
      const needs = OPERATION_INPUT_DEPENDENTS.find((dependent) => dependent.id === conservative.id)?.needs.filter((need) => need.input === conservative.kind) ?? [];

      expect(source, `${conservative.id} が否定できない側に倒す箇所`).toContain(conservative.marker);
      expect(source, `${conservative.id} が保留(foreignBlocked)を持つなら倒す必要が無い`).not.toContain('foreignBlocked(');
      // 置き場ごと無い・読めない阻害では検査が実行されないので、行で名指す。除くのは「読めて落としただけ」(invalid)だけ
      expect(needs.map((need) => need.exceptReasons), `${conservative.id} の名指しの表の行`).toEqual([['invalid']]);
    }
  });
});

describe('検証器のファイルで input.{欄} を読むものは、表の読み手に居る', () => {
  const sources = readTsTree(LIB_DIR, 'lib/');

  it('表に無い読み手が足されたら赤(欄を読むファイルの検査 ID が、表の読み手と倒している読み手に含まれる)', () => {
    for (const entry of FOREIGN_FIELDS) {
      if (entry.scanDir === undefined) continue;
      const readers = readersOf(entry, sources);
      const allowed = [...entry.readers, ...CONSERVATIVE_READERS.filter((candidate) => candidate.kind === entry.kind).map((candidate) => candidate.id)];

      expect(readers.length, `${keyOf(entry)} を読むファイルが 1 つも見つからない(走査が空振り)`).toBeGreaterThan(0);
      for (const reader of readers) {
        for (const id of reader.ids) expect(allowed, `${keyOf(entry)} を読む ${reader.file} の検査 ID(${id ?? '決まらない — readerFiles に宣言する'})が表の読み手にいない`).toContain(id);
      }
    }
  });

  it('読み手を走査するか・しない理由(wiring / derive / declared)を、全欄が必ず 1 つ宣言する。分類ごとの本数を固定する', () => {
    for (const entry of FOREIGN_FIELDS) expect([entry.scanDir !== undefined, entry.unscanned !== undefined], `${keyOf(entry)} は scanDir か unscanned のどちらか 1 つ`).toEqual(entry.scanDir === undefined ? [false, true] : [true, false]);
    const classes = { scanned: 0, wiring: 0, derive: 0, declared: 0 };
    for (const entry of FOREIGN_FIELDS) classes[entry.unscanned ?? 'scanned'] += 1;

    expect(classes).toEqual({ scanned: 30, wiring: 6, derive: 13, declared: 5 });
    // T 群は段の `reads` との過不足で閉じている(別のテスト)ので、declared はそこだけ
    for (const entry of FOREIGN_FIELDS.filter((candidate) => candidate.unscanned === 'declared')) expect(entry.via).toBe('data-step-reads');
  });

  describe('導出の部品(`derive` の欄を持つ入力型を引数に取る関数)の呼び手', () => {
    const derived = FOREIGN_FIELDS.filter((entry) => entry.unscanned === 'derive');
    const types = new Set(derived.map((entry) => entry.type));
    const typeFiles = new Set(derived.map((entry) => entry.file));
    const functions = functionsTaking(sources, types);
    const callers = callerFilesOf(sources, new Set(functions.keys()), methodsTaking(sources, types));

    it('入力型ごとに、それを引数に取る関数が見つかる(空振りしない)', () => {
      for (const type of types) {
        const taking = functionsTaking(sources, new Set([type]));

        expect(taking.size, `${type} を引数に取る関数が 1 つも見つからない`).toBeGreaterThan(0);
      }
      expect(callers.length).toBeGreaterThan(0);
    });

    it('呼び手は、導出の部品どうし・範囲の外(生成・導出側)・宣言した呼び手のどれか(新しい検査が阻害を言わずに導出の部品へ渡したら赤)', () => {
      expect(unexplainedCallers(callers, typeFiles, DERIVE_CALLERS)).toEqual([]);
    });

    it('宣言した呼び手は、いまも導出の部品を呼んでいる(呼ばなくなった宣言は赤)', () => {
      expect(DERIVE_CALLERS.map((caller) => caller.file).filter((file) => !callers.includes(file))).toEqual([]);
    });

    it('宣言した呼び手は、阻害を言う手段を持つ(検査 ID はファイル名と一致し、ユースケースの表か trace の gap の呼び出しが残る)', () => {
      const usecaseIds = USECASE_DATA_TABLE_DEPENDENTS.map((dependent) => dependent.id);
      for (const caller of DERIVE_CALLERS) {
        const source = sources.get(caller.file) ?? '';

        expect(caller.id === null, `${caller.file} は配線(pipeline)のときだけ検査 ID を持たない`).toBe(caller.reports === 'pipeline');
        if (caller.id !== null) expect(idOfFile(caller.file), `${caller.file} の検査 ID`).toBe(caller.id);
        if (caller.reports === 'usecase-input-notes') expect(usecaseIds, `${caller.id} がユースケースの表に載っていない`).toContain(caller.id);
        if (caller.reports === 'trace-gap') expect(source, `${caller.file} が使えなかった材料を dataTablesGap で言っていない`).toContain('dataTablesGap(');
      }
    });
  });

  it('読み手のうち、阻害を保留するもの(画面の検査の query_spec / usecase_spec)は、ファイルに保留の呼び出しがある', () => {
    for (const entry of FOREIGN_FIELDS) {
      if (entry.scanDir !== 'lib/screen/verifiers/' || entry.kind === 'auth') continue;
      for (const [file, source] of sources) {
        const conservative = CONSERVATIVE_READERS.some((candidate) => candidate.file === file);
        if (conservative || !file.startsWith(entry.scanDir) || !new RegExp(`\\binput\\.${entry.field}\\b`).test(source)) continue;
        expect(source, `${file} が ${entry.kind} の阻害を保留していない`).toContain(`foreignBlocked(ctx, '${entry.kind}')`);
      }
    }
  });
});

describe('検出器のわざと壊す確認', () => {
  it('他の種類の生のモデルの欄を拾う', () => {
    expect(foreignRawMembers('interface In { readonly queries: QuerySpecModel; readonly n: number }', 'screens')).toEqual([{ type: 'In', field: 'queries', kind: 'queries' }]);
  });

  it('| null や | undefined を付けた欄も拾う', () => {
    expect(foreignRawMembers('interface In { actions: ActionSpecModel | null; jobs?: JobSpecModel | undefined }', 'screens').map((member) => member.field)).toEqual(['actions', 'jobs']);
  });

  it('型リテラルの別名の欄も拾う', () => {
    expect(foreignRawMembers('type In = { readonly queries: QuerySpecModel };', 'screens')).toEqual([{ type: 'In', field: 'queries', kind: 'queries' }]);
  });

  it('入力の状態で持つ欄・主語の種類の欄は拾わない', () => {
    expect(foreignRawMembers('interface In { queries: CatalogInput<QuerySpecModel>; screens: ScreenSpecModel }', 'screens')).toEqual([]);
  });

  it('場所では主語が決まらない型は、型の名前で主語を決める(それ以外の型の同じ欄は拾う)', () => {
    const source = 'interface ScreenRunArgs { screens: ScreenSpecModel; queries: QuerySpecModel } interface Other { screens: ScreenSpecModel }';

    expect(foreignRawMembers(source, null).map((member) => `${member.type}.${member.field}`)).toEqual(['ScreenRunArgs.queries', 'Other.screens']);
    // 主語を持たない型(null)は、ディレクトリの主語の種類の欄も他の種類として拾う
    expect(foreignRawMembers('interface PlacementCollisionInput { actions: ActionSpecModel | undefined }', 'actions').map((member) => member.field)).toEqual(['actions']);
  });

  it('カタログの束(OperationCatalogs)は他の種類を生で束ねるので拾う', () => {
    expect(foreignRawMembers('interface In { catalogs: OperationCatalogs }', 'screens')).toEqual([{ type: 'In', field: 'catalogs', kind: 'catalogs' }]);
  });

  it('場所から主語を引く: 群のディレクトリ・model 側・ジョブの後段', () => {
    expect(subjectOf('lib/job/verifiers/j2-x.ts')).toBe('jobs');
    expect(subjectOf('lib/targets/supabase/job/j3-pgcron-parity.ts')).toBe('jobs');
    expect(subjectOf('lib/model/trace/loader.ts')).toBe('actions');
    expect(subjectOf('lib/verify/screens-group.ts')).toBeNull();
  });

  it('範囲の外の群は、増えても減っても入れ替わっても赤になる(群ごとに欄の一覧で固定)', () => {
    const table: readonly OutOfRange[] = [{ label: 'SQL の導出', pattern: /^lib\/sql\//, keys: ['lib/sql/a.ts In.queries'] }];

    expect(outOfRangeDiffs(new Map([['SQL の導出', ['lib/sql/a.ts In.queries']]]), table)).toEqual([]);
    expect(outOfRangeDiffs(new Map([['SQL の導出', ['lib/sql/a.ts In.queries', 'lib/sql/b.ts In.jobs']]]), table)).toHaveLength(1);
    expect(outOfRangeDiffs(new Map(), table)).toHaveLength(1);
    // 件数が同じでも入れ替わっていれば赤
    expect(outOfRangeDiffs(new Map([['SQL の導出', ['lib/sql/b.ts In.jobs']]]), table)).toHaveLength(1);
  });

  it('欄を読むファイルは、受け口の名前と置き場の接頭辞で拾い、検査 ID が決まらなければ null で返す(readerFiles で宣言させる)', () => {
    const sources = new Map([
      ['lib/x/verifiers/s1-a.ts', 'input.queries.find()'],
      ['lib/x/verifiers/other.ts', 'input.queries'],
      ['lib/y/verifiers/s2-b.ts', 'input.queries'],
      ['lib/x/verifiers/s3-c.ts', 'ctx.queries'],
    ]);

    expect(readersOf({ scanDir: 'lib/x/', field: 'queries' }, sources)).toEqual([
      { file: 'lib/x/verifiers/s1-a.ts', ids: ['S1'] },
      { file: 'lib/x/verifiers/other.ts', ids: [null] },
    ]);
    expect(readersOf({ scanDir: 'lib/x/', field: 'queries', accessor: 'ctx' }, sources)).toEqual([{ file: 'lib/x/verifiers/s3-c.ts', ids: ['S3'] }]);
    expect(readersOf({ scanDir: 'lib/x/', field: 'queries', readerFiles: { 'lib/x/verifiers/other.ts': ['W1', 'W2'] } }, sources).map((reader) => reader.ids)).toEqual([['S1'], ['W1', 'W2']]);
  });

  it('入力型を引数に取る関数(宣言・const の関数式)を拾い、識別子で直に呼ぶ箇所のファイルだけを返す', () => {
    const sources = new Map([
      ['lib/a/plan.ts', 'export interface PlanInput { x: number }\nexport function planIt(input: PlanInput): number { return input.x; }\nexport const planAgain = (input: PlanInput, n: number): number => input.x + n;\nexport function other(n: number): number { return n; }'],
      ['lib/b/use.ts', 'import { planIt } from "../a/plan.js";\nexport const run = (): number => planIt({ x: 1 });'],
      ['lib/c/use2.ts', 'import * as plan from "../a/plan.js";\nexport const run = (): number => plan.planIt({ x: 1 });'],
      ['lib/d/use3.ts', 'import { planAgain, other } from "../a/plan.js";\nexport const run = (): number => planAgain({ x: 1 }, other(2));'],
    ]);
    const functions = functionsTaking(sources, new Set(['PlanInput']));

    expect([...functions]).toEqual([['planIt', 'lib/a/plan.ts'], ['planAgain', 'lib/a/plan.ts']]);
    // 名前空間の import 越しの呼び出し(plan.planIt)は拾わない(限界)。`other` は入力型を取らないので対象外
    expect(callerFilesOf(sources, new Set(functions.keys()))).toEqual(['lib/b/use.ts', 'lib/d/use3.ts']);
  });

  it('入力型は、Readonly<T>・T | undefined・readonly T[]・T & U・括弧の中でも拾い、クラスのメソッド・オブジェクトのメソッド短縮形も拾う', () => {
    const source = [
      'export function a(input: Readonly<PlanInput>): void {}',
      'export const b = (input: PlanInput | undefined): void => {};',
      'export function c(inputs: readonly PlanInput[]): void {}',
      'export function d(input: PlanInput & { extra: number }): void {}',
      'export function e(input: (PlanInput)): void {}',
      'export function f(inputs: ReadonlyArray<Partial<PlanInput>>): void {}',
      'export class K { m(input: PlanInput): void {} static s(input: Readonly<PlanInput>): void {} }',
      'export const o = { short(input: PlanInput): void {}, arrow: (input: PlanInput): void => {} };',
      'export function skipped(n: number, p: Promise<PlanInput>, m: Map<string, PlanInput>, t: [PlanInput]): void {}',
    ].join('\n');
    const sources = new Map([['lib/a/plan.ts', source]]);
    const types = new Set(['PlanInput']);

    // `arrow`(オブジェクトのプロパティに束縛した矢印)が居ないのは意図した負例: 拾わない(限界欄の①)。`skipped`(Promise / Map / タプル)も同じく `mentionsType` の拾わない形
    expect([...functionsTaking(sources, types).keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'm', 's', 'short']);
    expect([...methodsTaking(sources, types)].sort()).toEqual(['m', 's', 'short']);
  });

  // 形ごとに `it` を分ける(将来どれかが拾われるようになったとき、失敗した形が題で分かる)。実装で拾うように変えるときは、その形を正例へ移す
  it.each([
    ['① オブジェクトのプロパティの矢印', 'export const o = { arrow: (input: PlanInput): void => {} };'],
    ['① オブジェクトのプロパティの関数式', 'export const o = { fn: function (input: PlanInput): void {} };'],
    ['① クラスのプロパティの矢印', 'export class K { prop = (input: PlanInput): void => {}; }'],
    ['② コンストラクタ', 'export class K { constructor(input: PlanInput) {} }'],
    ['③ interface のメソッドシグネチャ', 'export interface Api { sig(input: PlanInput): void }'],
    ['④ 文字列名のメソッド', "export class Q { 'quoted'(input: PlanInput): void {} }"],
    ['⑤ 修飾名の型参照', 'export function qualified(input: ns.PlanInput): void {}'],
    ['⑤ Pick', "export function picked(input: Pick<PlanInput, 'x'>): void {}"],
    ['⑤ Omit', "export function omitted(input: Omit<PlanInput, 'x'>): void {}"],
    ['⑤ Record', 'export function recorded(input: Record<string, PlanInput>): void {}'],
    ['⑤ Exclude', "export function excluded(input: Exclude<PlanInput, 'x'>): void {}"],
    ['⑥ 名前なしの export default の矢印', 'export default (input: PlanInput): void => {};'],
    ['⑥ 名前なしの export default の関数', 'export default function (input: PlanInput): void {}'],
    ['⑦ keyof', 'export function keyed(key: keyof PlanInput): void {}'],
    ['⑦ unique symbol(入力型を含まない型演算子。`readonly` 以外を素通しにしないことの確認)', 'export function uniq(token: unique symbol): void {}'],
    ['⑧ 高階関数の引数を初期化子にした const', 'export const wrapped = wrap((input: PlanInput): void => {});'],
    ['⑧ as で包んだ矢印', 'export const casted = ((input: PlanInput): void => {}) as Handler;'],
    ['⑧ satisfies で包んだ矢印', 'export const checked = ((input: PlanInput): void => {}) satisfies Handler;'],
    ['⑧ 括弧で包んだ矢印', 'export const parenthesized = ((input: PlanInput): void => {});'],
    ['⑧ 引数に型注釈の無い文脈型付けの矢印', 'export const contextual: Handler = (input) => {};'],
    ['⑧ set アクセサ', 'export class S { set value(input: PlanInput) {} }'],
    ['⑧ #private メソッド', 'export class P { #hidden(input: PlanInput): void {} }'],
    ['⑧ 代入式で束縛した関数', 'let assigned: Handler;\nassigned = (input: PlanInput): void => {};'],
  ])('拾わない形は拾わない(限界欄の①〜⑧): %s', (_label, source) => {
    const sources = new Map([['lib/a/plan.ts', source]]);
    const types = new Set(['PlanInput']);

    expect([...functionsTaking(sources, types).keys()]).toEqual([]);
    expect(methodsTaking(sources, types).size).toBe(0);
  });

  it('メソッドは `x.name(` の形の呼び出しも拾う(メソッドでない名前の `x.name(` は拾わない)', () => {
    const sources = new Map([
      ['lib/a/plan.ts', 'export class K { m(input: PlanInput): void {} }\nexport function plain(input: PlanInput): void {}'],
      ['lib/b/use.ts', 'export const run = (k: K): void => k.m({ x: 1 });'],
      ['lib/c/use.ts', 'export const run = (k: K): void => k.plain({ x: 1 });'],
    ]);
    const types = new Set(['PlanInput']);

    expect(callerFilesOf(sources, new Set(functionsTaking(sources, types).keys()), methodsTaking(sources, types))).toEqual(['lib/b/use.ts']);
  });

  it('導出の部品の呼び手: 入力型を宣言したファイル・範囲の外・宣言した呼び手は説明がつき、それ以外は返す', () => {
    const declared: readonly DeriveCaller[] = [{ file: 'lib/v/ok.ts', id: 'Y1', reports: 'usecase-input-notes' }];
    const outOfRange: readonly OutOfRange[] = [{ label: '生成', pattern: /^lib\/generate\//, keys: [] }];

    expect(unexplainedCallers(['lib/u/plan.ts', 'lib/generate/x.ts', 'lib/v/ok.ts', 'lib/v/new-check.ts'], new Set(['lib/u/plan.ts']), declared, outOfRange)).toEqual(['lib/v/new-check.ts']);
  });

  it('範囲の外の群と範囲の中を分ける: 生成側は数え、検証側は表に載せる欄として返す', () => {
    const sources = new Map([
      ['lib/sql/x.ts', 'interface A { actions: ActionSpecModel | undefined }'],
      ['lib/verify/y.ts', 'interface B { queries: QuerySpecModel }'],
      ['lib/screen/z.ts', 'interface C { screens: ScreenSpecModel }'],
    ]);

    expect(classifyFound(sources)).toEqual({ inRange: ['lib/verify/y.ts B.queries'], outOfRange: new Map([['SQL の導出', ['lib/sql/x.ts A.actions']]]) });
  });

  it('検査器のファイル名から検査 ID を取る', () => {
    expect(idOfFile('lib/screen/verifiers/s14-state-visibility.ts')).toBe('S14');
    expect(idOfFile('lib/usecase/verifiers/y10-plan-resolution.ts')).toBe('Y10');
    expect(idOfFile('lib/screen/verifier.ts')).toBeNull();
  });
});
