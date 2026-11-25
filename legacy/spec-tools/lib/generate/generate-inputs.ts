/**
 * 生成の文脈のうち、**ローダーで読む入力**を 1 か所で並べる口(`cli/generate-docs.ts` と `cli/generate-book.ts`
 * が同じ 1 本を呼ぶ)。
 *
 * 入口を 2 本にしても、どの種類の仕様をどの置き場から読むかを 2 か所に持たない(片方だけ種類を足し忘れると、
 * 部分利用の入口が「別の本」を出す)。**決めるのはここ 1 本**で、章の描き方・仕様の生テキスト・検証の結果・
 * 変異の目録は `completeGenerateContext`(`generate-context.ts`)が載せる。
 *
 * 置き場はすべて製品が宣言した根(`roots`)から組み立てる。ディレクトリが無い種類は `available: false` の
 * モデルになる。
 *
 * **読み込みの結果は 2 つに分けて返す**(`readGenerateInputsWithLoads`)。
 *   - **文脈の素**(`context`)… 生成器へ渡すモデルの投影。読めたものだけを載せ、読めなかった種類は `available: false` /
 *     `catalog: null` のまま渡す(生成器の側は「無い」としか読めない)。**全部入りの `generate` の出力はこれだけで決まる**
 *   - **種類ごとの読み込みの結果**(`loads`)… 診断(findings)・落とした数(`dropped`)・読めたかを、投影で捨てずに残す。
 *     **選択は持たない**(製品が採っているか = `uses` は呼び手の明示の入力。ファイルの有無から推定しない)ので、
 *     `inputStatesOf` で `uses` と合わせて初めて入力の状態(未選択 / 阻害 / 読込済み)になる。
 *     「採ったのに無い・壊れている・落とした」を、採っていない種類と同じ見え方にしないための、報告用の入力である
 *
 * **ハンドブックだけを出す入口には、別の投影の口 `readEntryInputs` を持つ**(全部入りの口の契約は変えない)。製品が採っていない種類
 * (`uses` に無い)は**置き場に有効な仕様が残っていても読まず(ファイルの I/O なしで)、「置き場が無い」ときの結果**を渡す(未選択 = 事実として無い。
 * 種類横断の章にも、採っていない種類の材料が混ざらない)。採った種類の読み方は全部入りの口と同じ 1 本である。
 *
 * 読み込みの診断そのものは、ここでは出さない(読めなかった仕様の error は検証の各種類の 0 番の検査が出す側)。
 */

import path from 'node:path';
import { createGuardServices } from '../guard/services.js';
import { loadQuerySpecModel, missingQuerySpecModel } from '../model/query/loader.js';
import { loadScreenSpecModel, missingScreenSpecModel } from '../model/screen/loader.js';
import { loadDesignTokens, missingDesignTokens } from '../model/design/loader.js';
import { loadActionSpecModel, missingActionSpecModel } from '../model/trace/loader.js';
import { loadDataTableSpecModel, missingDataTableSpecModel } from '../model/data/loader.js';
import { loadNotificationSpecModel, missingNotificationSpecModel } from '../model/notification/loader.js';
import { loadJobSpecModel, missingJobSpecModel } from '../model/job/loader.js';
import { loadConfigSpecModel, missingConfigSpecModel } from '../model/config/loader.js';
import { loadAuthSpecModel, missingAuthSpecModel } from '../model/auth/loader.js';
import { loadGuaranteeSpecModel, missingGuaranteeSpecModel } from '../model/guarantee/loader.js';
import { loadUxPrinciplesModel, missingUxPrinciplesModel, UX_PRINCIPLES_FILE } from '../model/ux-principles/loader.js';
import { loadSurfaceSpecModel, missingSurfaceSpecModel } from '../model/surface/loader.js';
import { loadExternalSpecModel, missingExternalSpecModel } from '../model/external/loader.js';
import { loadUsecaseSpecModel, missingUsecaseSpecModel } from '../model/usecase/loader.js';
import { loadTermLedgerModel } from '../model/terms/loader.js';
import { specPath } from '../model/product/paths.js';
import { selectionOf, SPEC_KINDS, usesKind, type ProductUses, type SpecKind } from '../model/product/uses.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { availableLoad, catalogInput, mapCatalogInput, type CatalogInput, type CatalogLoad } from '../kernel/input-state.js';
import type { AuthFlowSpec, AuthGateDecl } from '../model/auth/types.js';
import type { Finding } from '../kernel/finding.js';
import { readBookInputs } from './book-inputs-loader.js';
import type { GenerateContext } from '../gen-kit/generator.js';
import { loadFrameworkGuaranteeLedger } from '../model/guarantee/framework-loader.js';
import type { FrameworkLedgerContext } from './framework-ledger-context.js';

/** 種類ごとの読み込みの結果(選択を含まない。`inputStatesOf` が `uses` と合わせて入力の状態にする)。 */
export type KindLoads = Readonly<Record<SpecKind, CatalogLoad<unknown>>>;

/**
 * ローダーで読んだ入力から並べた文脈の素(`completeGenerateContext` が完成させる)。
 *
 * **プラットフォームの設定と置き場の配置は載せない** —— 値を選ぶのは組み立ての根(CLI と通し実行)で、入力を
 * 読む側(ここ)は選ばない。根が `completeGenerateContext` で 1 回だけ載せる。
 */
export type GenerateInputs = Omit<GenerateContext, 'platform' | 'layout'> & FrameworkLedgerContext;

/** 入力を読む口の任意設定。 */
export interface InputsOptions {
  /** 仕組みの根の絶対パス(仕組みの保証台帳の置き場)。省略すると仕組みの台帳は読まない。CLI は必ず渡す。 */
  readonly frameworkRoot?: string;
}

/** ローダーで読んだ入力(生成器へのモデルの投影と、種類ごとの読み込みの結果)。 */
export interface GenerateInputsRead {
  /** 生成器へ渡す文脈の素(`completeGenerateContext` が完成させる)。 */
  readonly context: GenerateInputs;
  /** 種類ごとの読み込みの結果(診断・落とした数を捨てずに持つ)。 */
  readonly loads: KindLoads;
  /**
   * 認証フローの読み込みの結果(型つき。`loads.auth` と同じ値)。関門の入力の状態(`gatesInputOf`)を作るのに使う
   * (`KindLoads` は種類ごとに型が違うので `unknown` に潰してあり、ここから型を戻さない)。
   */
  readonly authFlow: CatalogLoad<AuthFlowSpec>;
}

/** 入力の状態を 1 つの種類について持つもの。 */
export interface KindInput {
  readonly kind: SpecKind;
  readonly input: CatalogInput<unknown>;
}

/**
 * 「カタログの欄が種類ごとに違う」モデル(`catalog` / `surface` / `spec` / `flow`)を、読み込みの結果の形へ写す。
 * `dropped` は、どのローダーも数えた「読めずにモデルへ入れなかった仕様・行」の数を渡す(0 なら、error が残っていてもモデルは欠けていない)。
 */
function loadOf(available: boolean, value: unknown, findings: readonly Finding[], dropped: number): CatalogLoad<unknown> {
  return { model: { available, catalog: value }, findings, dropped };
}

/**
 * ローダーで読んだ入力を並べた文脈と、種類ごとの読み込みの結果。
 * **全部入りの `generate` の出力はこの投影が決める**(全種類を読む)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(smoke の置き場・ハンドブックが写す資材の置き場。入力を読む側は値を選ばず、組み立ての根が渡す)
 * @returns 生成器へのモデルの投影(`context`)と、種類ごとの読み込みの結果(`loads`)
 */
export function readGenerateInputsWithLoads(
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
  options: InputsOptions = {},
): GenerateInputsRead {
  return readInputs(repoRoot, roots, layout, () => true, options);
}

/**
 * ハンドブックだけを出す入口のための投影: **製品が採っている種類だけを読む**(採っていない種類は、置き場に仕様が残っていても
 * 読まず、「置き場が無い」の結果を渡す)。種類ごとの読み込みの結果(`loads`)は採っていない種類も「置き場が無い」になるが、
 * 入力の状態は選択(`uses`)で決めるので未選択のままである(`inputStatesOf`)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根
 * @param uses 製品が採ると宣言した種類
 * @param layout 置き場の配置
 */
export function readEntryInputs(
  repoRoot: string,
  roots: ProductRoots,
  uses: ProductUses,
  layout: ProductLayout,
  options: InputsOptions = {},
): GenerateInputsRead {
  return readInputs(repoRoot, roots, layout, (kind) => usesKind(uses, kind), options);
}

/**
 * ローダーで読んだ入力を並べる(読む種類を `isOpen` で絞れる。読まない種類は、ファイルを読まずに、ローダー自身の「置き場が無い」の結果と同じ値(各ローダーの `missing…`)になる)。
 * どの種類をどの置き場から読むかを決めるのは、ここ 1 本である。
 */
function readInputs(
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
  isOpen: (kind: SpecKind) => boolean,
  options: InputsOptions,
): GenerateInputsRead {
  /** 種類の置き場の絶対パス(宣言された根からの組み立て)。 */
  const spec = (...segments: readonly string[]): string => path.join(repoRoot, specPath(roots, ...segments));

  // query_spec はドメインモデルの外側の入力なので、文脈として渡す(一覧表の生成に使う)。
  // ディレクトリが無い環境は available: false として一覧表の側で区別する。
  const queries = isOpen('queries') ? loadQuerySpecModel(spec('backend/queries'), { repoRoot }) : missingQuerySpecModel();
  // 画面仕様も同じ理由で文脈として渡す(画面一覧表と遷移図の生成に使う)。
  const screens = isOpen('screens') ? loadScreenSpecModel(spec('frontend'), { repoRoot, roots, layout }) : missingScreenSpecModel();
  // デザイントークンも同じ理由で文脈として渡す(tokens.css / tokens.ts の生成に使う)。
  const design = isOpen('design_tokens') ? loadDesignTokens(spec('frontend/design'), { repoRoot }) : missingDesignTokens();
  // action_spec も同じ理由で文脈として渡す(action_spec 個別ファイルの本文ブロックの生成に使う)。
  // ディレクトリ自体が無い環境では model が null になるので、渡さない(生成対象なし)扱いにする。
  const actionsRoot = spec('backend/actions');
  const actions = isOpen('actions') ? loadActionSpecModel(actionsRoot, { repoRoot }) : missingActionSpecModel(repoRoot, actionsRoot);
  // data_table も同じ理由で文脈として渡す(本文ブロック・一覧表・期待スキーマ表の生成に使う)。
  const dataTables = isOpen('data_tables')
    ? loadDataTableSpecModel(spec('backend/data/tables'), { repoRoot })
    : missingDataTableSpecModel();
  // 通知カタログも同じ理由で文脈として渡す(本文ブロック・ハンドブックの章・生成物の材料)。
  const notifications = isOpen('notifications')
    ? loadNotificationSpecModel(spec('backend/notifications.md'), { repoRoot })
    : missingNotificationSpecModel();
  // ジョブカタログも同じ理由で文脈として渡す(本文ブロック・ハンドブックの章・生成物の材料)。
  const jobs = isOpen('jobs') ? loadJobSpecModel(spec('backend/jobs.md'), { repoRoot }) : missingJobSpecModel();
  // 設定カタログも同じ理由で文脈として渡す(本文ブロック・ハンドブックの章の材料)。
  const config = isOpen('config') ? loadConfigSpecModel(spec('backend/config.md'), { repoRoot }) : missingConfigSpecModel();
  // 認証フロー仕様も同じ理由で文脈として渡す(本文ブロック・ハンドブックの章・生成物の材料)。
  const auth = isOpen('auth') ? loadAuthSpecModel(spec('backend/auth.md'), { repoRoot }) : missingAuthSpecModel();
  // 保証台帳も同じ理由で文脈として渡す(本文ブロック・ハンドブックの章の材料)。
  const guarantees = isOpen('guarantees')
    ? loadGuaranteeSpecModel(spec('backend/guarantees.md'), { repoRoot })
    : missingGuaranteeSpecModel();
  // UX 原則の台帳も同じ理由で文脈として渡す(ハンドブックの章と、ユースケースの予算の既定値の材料)。
  const uxPrinciples = isOpen('ux_principles')
    ? loadUxPrinciplesModel(spec(`frontend/${UX_PRINCIPLES_FILE}`), { repoRoot })
    : missingUxPrinciplesModel();
  // surface の仕様も同じ理由で文脈として渡す(公開スキーマの土台とビューの migration の材料)。
  const surface = isOpen('surface') ? loadSurfaceSpecModel(spec('backend/surface.md'), { repoRoot }) : missingSurfaceSpecModel();
  // 外部連携カタログも同じ理由で文脈として渡す(本文ブロック・ハンドブックの章・可視性の章の材料)。
  const external = isOpen('external')
    ? loadExternalSpecModel(spec('backend/external.md'), { repoRoot })
    : missingExternalSpecModel();
  // ユースケース仕様も同じ理由で文脈として渡す(usecases.ts・本文ブロック・ハンドブックの
  // 「タスク」章の生成に使う)。ADR-0011「起点は 2 つ」の束⑯a。
  const usecases = isOpen('usecases') ? loadUsecaseSpecModel(spec('frontend/usecases'), { repoRoot }) : missingUsecaseSpecModel();
  // 用語の台帳も同じ理由で文脈として渡す(ハンドブック表紙の「この本に出てくる言葉」の材料)。
  // 用語の台帳は `uses` の種類ではない(どの検査の入力でもなく、M 群が自分で読む)ので、入力の状態は持たない。
  const terms = loadTermLedgerModel(spec('terms.md'), { repoRoot }).model;

  const authFlow: CatalogLoad<AuthFlowSpec> = { model: { available: auth.model.available, catalog: auth.model.flow }, findings: auth.findings, dropped: auth.dropped };
  // 関門の入力の状態。この投影が持つ「採る種類」は `isOpen`(全部入りは全種類・ハンドブックの入口は `uses`)で、そこから決める(CLI は実際の `uses` で決め直して載せる)。
  const gates = mapCatalogInput(catalogInput(isOpen('auth') ? 'selected' : 'unselected', authFlow), (flow) => flow.gates);

  const context: GenerateInputs = {
    repoRoot,
    roots,
    guards: createGuardServices(),
    queries: queries.model,
    screens: screens.model,
    design: design.model,
    dataTables: dataTables.model,
    notifications: notifications.model,
    jobs: jobs.model,
    config: config.model,
    auth: auth.model,
    gates,
    guarantees: guarantees.model,
    // 仕組みの保証台帳は製品の `uses` に依らず読む(製品が外せない義務)。根を渡さなければ読まない(単体テスト用。CLI は必ず渡す)。
    ...(options.frameworkRoot === undefined
      ? {}
      : {
          frameworkLedger: {
            load: loadFrameworkGuaranteeLedger(options.frameworkRoot),
            ownTree: path.resolve(options.frameworkRoot) === path.resolve(repoRoot),
          },
        }),
    uxPrinciples: uxPrinciples.model,
    surface: surface.model,
    external: external.model,
    usecases: usecases.model,
    terms,
    ...(actions.model === null ? {} : { actions: actions.model }),
    // ハンドブックのパーツ見本・スクショの撮影日時は実装と成果物が正なので、ここで読む。
    book: readBookInputs(repoRoot, roots, layout, design.model.spec?.brand?.icon ?? null),
  };

  const loads: KindLoads = {
    actions: loadOf(actions.model !== null, actions.model, actions.findings, actions.dropped),
    queries: availableLoad(queries.model, queries.findings, queries.dropped),
    data_tables: availableLoad(dataTables.model, dataTables.findings, dataTables.dropped),
    notifications: loadOf(notifications.model.available, notifications.model.catalog, notifications.findings, notifications.dropped),
    jobs: loadOf(jobs.model.available, jobs.model.catalog, jobs.findings, jobs.dropped),
    config: loadOf(config.model.available, config.model.catalog, config.findings, config.dropped),
    auth: authFlow,
    guarantees: loadOf(guarantees.model.available, guarantees.model.catalog, guarantees.findings, guarantees.dropped),
    external: loadOf(external.model.available, external.model.catalog, external.findings, external.dropped),
    surface: loadOf(surface.model.available, surface.model.spec, surface.findings, surface.dropped),
    screens: availableLoad(screens.model, screens.findings, screens.dropped),
    usecases: availableLoad(usecases.model, usecases.findings, usecases.dropped),
    ux_principles: loadOf(uxPrinciples.model.available, uxPrinciples.model.spec, uxPrinciples.findings, uxPrinciples.dropped),
    design_tokens: loadOf(design.model.available, design.model.spec, design.findings, design.dropped),
  };
  return { context, loads, authFlow };
}

/**
 * 認証フローの関門(`gates`)の入力の状態を、読み込みの結果と製品の宣言(`uses`)から決める。到達に依る生成物(L2・タスクの章)が読む
 * (`GenerateContext.gates`)。未選択は「関門は無い」事実・採ったのに無い・壊れている・行を落としたは阻害・読込済みは関門の一覧。
 *
 * @param read ローダーで読んだ入力(`readGenerateInputsWithLoads` / `readEntryInputs`)
 * @param uses 製品が採ると宣言した種類
 */
export function gatesInputOf(read: GenerateInputsRead, uses: ProductUses): CatalogInput<readonly AuthGateDecl[]> {
  return mapCatalogInput(catalogInput(selectionOf(uses, 'auth'), read.authFlow), (flow) => flow.gates);
}

/**
 * ローダーで読んだ入力を並べた文脈(章の描き方・仕様の生テキスト・検証の結果・変異の目録はまだ載せない)。
 * 種類ごとの読み込みの結果が要らない呼び手(全部入りの `generate`・通し実行・テスト)の入口。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置
 * @returns 生成器へ渡す文脈の素(`completeGenerateContext` が完成させる)
 */
export function readGenerateInputs(repoRoot: string, roots: ProductRoots, layout: ProductLayout): GenerateInputs {
  return readGenerateInputsWithLoads(repoRoot, roots, layout).context;
}

/**
 * 読み込みの結果と製品の宣言(`uses`)から、種類ごとの入力の状態(未選択 / 阻害 / 読込済み)を決める。
 * **選択は `uses` で決め、ファイルの有無から推定しない**(`kernel/input-state.ts`)。読込済みは 0 件の空のカタログも含む。
 *
 * @param loads 種類ごとの読み込みの結果
 * @param uses 製品が採ると宣言した種類
 * @returns 全種類の入力の状態(`SPEC_KINDS` の順)
 */
export function inputStatesOf(loads: KindLoads, uses: ProductUses): readonly KindInput[] {
  return SPEC_KINDS.map((kind) => ({ kind, input: catalogInput(selectionOf(uses, kind), loads[kind]) }));
}
