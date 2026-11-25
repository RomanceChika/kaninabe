/**
 * 後段(`Target`)の登録の契約 — 組み立ての根(CLI と通し実行)が選んだ後段が、**自分の検査と生成器をここへ登録する**。
 *
 * 後段 = 差し替えうる具体のスタック(設計メモ framework-modules §19・§20)。Postgres は固定の前提で、認証・API 層(プラットフォーム)・
 * Cron の登録(ホスト)・Web フレームワーク(アプリの枠)は差し替えうる。**コアは後段の名前を知らない** —— コアが持つのは
 * この契約の型と、選んだ後段の一覧を検査の束と生成器の一覧に合成する関数だけで、どの後段を選ぶか(値)は組み立ての根が決める
 * (`lib/targets/<後段>/**` を読んでよいのは根だけ。`lib/gates/lib-layers.ts` の `TARGET_BOUNDARIES`)。
 *
 * **後段を登録しない構成**でも検査と生成は動く。その後段が受け持つ検査は**未実施**と報告される(ホストの後段が無ければ J2 / J4・プラットフォームの後段が無ければ J3 など。`lib/job/target-checks.ts`)。
 *
 * 層: 検査の契約(check)と生成器の契約(emit)の両方を型として読むので、どちらにも属さず、専用の層 `contract` に置く
 * (`lib/gates/lib-layers.ts` の層の表。組み立ての `orch` ではない)。後段(target)はこの契約を読んで自分の値を作る。
 */

import { TARGET_ROLES, TARGET_ROLE_MULTIPLICITY, TARGET_ROLE_WORDS } from '../kernel/target-role.js';
import type { TargetRole } from '../kernel/target-role.js';
import type { DocGenerator } from '../gen-kit/generator.js';
import { JOB_CHECK_SLOTS } from '../job/target-checks.js';
import { unverifiedProblems, type TargetUnverified } from '../job/target-unverified.js';
import type { JobTargetRegistry, JobTargetVerifier, NotApplicableDeclarations } from '../job/target-checks.js';
import { H5_ID, type AuthConfigVerifier } from '../auth/platform-config.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { EMPTY_LAYOUT } from '../model/product/layout.js';
import { defenseProblems, type BrowserDefenseProfile } from './defense-contract.js';
import { layoutDefinitionProblems, layoutRootsProblems } from '../model/product/layout-definition.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** 後段の選択が製品の宣言から読む根(実装の木の有無と、生成物の置き場)。 */
export type SelectionRoots = Pick<ProductRoots, 'app' | 'generated'>;

/** 後段が登録できる検査(種類ごとの検査を並べる。いまはジョブ仕様の検査だけ)。 */
export type TargetVerifier = JobTargetVerifier;

/** 後段 1 つ。 */
export interface Target {
  /** 後段の名前(他の後段と重ならない。出力にそのまま出る)。 */
  readonly id: string;
  /** 後段の役割。 */
  readonly role: TargetRole;
  /** この後段が登録する検査(受け持たなければ空)。 */
  readonly verifiers: readonly TargetVerifier[];
  /** この後段が登録する生成器(受け持たなければ空)。 */
  readonly generators: readonly DocGenerator[];
  /** プラットフォームの設定(`role: platform` の後段だけが持つ。SQL を書く側が引数で受け取る)。 */
  readonly platform?: PlatformProfile;
  /** H5(サインインの方式と公開スキーマの突合)の本体(`role: platform` の後段だけが持つ。綴りはプラットフォームの語なのでコアは契約と ID だけ)。持たない後段を選ぶと H5 は未実施と報告される。 */
  readonly authConfig?: AuthConfigVerifier;
  /** 置き場の役割 → パスの値(`role: app_frame` の後段だけが持つ。コアは役割だけを知る。`lib/model/product/layout.ts`)。生成器・検査は配置を**引数で**受け取る。 */
  readonly layout?: ProductLayout;
  /** ブラウザ側の守り(app_frame の後段は必ず持つ。`defense-contract.ts`)。 */
  readonly browserDefense?: BrowserDefenseProfile;
  /**
   * この後段では**対象外**の口(ルール ID → 理由)。その役割の後段が受け持つ検査のうち、この後段では見る必要が無いもの
   * (例: ホストの頻度制約を持たないホストの J4)を、理由つきで宣言する。報告は「未実施」とは別の行(対象外)で、範囲サマリの
   * 「実行していません」の件数に数えない。口の表にある ID・自分の役割が受け持つ口・空でない理由だけが書け、
   * **対象外と宣言した口に検査も登録すれば契約の違反**(どちらが正か分からない)。
   */
  readonly notApplicable?: NotApplicableDeclarations;
  /** この後段が**毎回名指す未検証**(本番の設定など仕様から見えないもの。条件に当たるとき `R5: 未実施 — …` の 1 行。error でも warning でもない。`target-unverified.ts`)。 */
  readonly unverified?: readonly TargetUnverified[];
}

/**
 * 組み立ての根が選んだ後段(契約を確かめたもの)。`platform` は選んだ後段のうち `role: platform` の設定で、
 * SQL を書く側へ 1 回載せて配る(グローバルな「選択済みの設定」を返す口は作らない)。
 */
export interface TargetSelection {
  /** 選んだ後段(並びは生成器・検査の並びの順)。 */
  readonly targets: readonly Target[];
  /** `role: platform` の後段が持つ設定。 */
  readonly platform: PlatformProfile;
  /**
   * `role: app_frame` の後段が持つ置き場の配置。**アプリの枠の後段が無い構成は空の配置**(`EMPTY_LAYOUT`。どの役割も解決できない)で、
   * それが許されるのは実装の木を持たない製品だけである(実装の木を宣言する製品は、アプリの枠の後段がちょうど 1 つ要る — `selectTargetSet` が止める)。
   */
  readonly layout: ProductLayout;
}

/** 後段の選択の結果(契約を満たせば選択、満たさなければ理由)。 */
export type TargetSelectionResult =
  | { readonly ok: true; readonly selection: TargetSelection }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * 選んだ後段の一覧が契約を満たすかを確かめ、満たせば選択にする(throw しない)。契約:
 *   - 後段の名前は重ならない
 *   - 役割ごとの多重度(`TARGET_ROLE_MULTIPLICITY`): `platform` はちょうど 1 つ・`host` は高々 1 つ・`app_frame` は高々 1 つ
 *   - `role: platform` の後段は設定(`platform`)を持つ。ほかの役割の後段は設定を持たない
 *   - `role: app_frame` の後段は置き場の配置(`layout`)とブラウザ側の守り(`browserDefense`)を持ち、どちらも契約を満たす(`layoutDefinitionProblems`・`defenseProblems`)。ほかの役割は持たない
 *   - **製品が実装の木(`roots.app`)を宣言しているなら、アプリの枠の後段はちょうど 1 つ・宣言していないなら 0**(「実装の木はあるのに配置が空」の構成を作れない。
 *     生成が配置の無いまま黙って何も出さない経路を、選ぶ根の 1 回で閉じる)。さらに、製品が宣言した生成物の置き場(`roots.generated`)は配置の `source-root` の中にある
 *   - H5 の検査(`authConfig`)を持てるのは platform の後段だけで、ID は `H5`
 *   - 登録する検査の ID は口の表(`JOB_CHECK_SLOTS`)にあり、口の役割が後段の役割と同じである。1 つの口に登録できる検査は 1 本まで
 *   - 対象外の宣言(`notApplicable`)の ID は口の表にあり、口の役割が後段の役割と同じで、理由が空でない。宣言した口に検査も登録しない
 *   - 登録する生成器の ID は後段どうしで重ならない
 *   - **配置が持ち主として名指す生成器(`owners` の `generator`)は、組み立てた生成器の一覧(コアの生成器 + 選んだ後段の生成器)に実在する**(ホストを差し替えて
 *     生成器が登録されなくなったとき、配置の持ち主の宣言が宙に浮いたまま緑になる経路を、選ぶ根の 1 回で閉じる)
 *
 * @param targets 組み立ての根が選んだ後段
 * @param roots 製品が宣言した根(実装の木の有無・生成物の置き場)
 * @param coreGeneratorIds コアの生成器の ID(生成器の層はこの契約を読まないので、組み立ての根が渡す。選んだ後段の生成器はここで足す)
 */
export function selectTargetSet(targets: readonly Target[], roots: SelectionRoots, coreGeneratorIds: ReadonlySet<string>): TargetSelectionResult {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const target of targets) {
    if (names.has(target.id)) problems.push(`後段の名前 ${target.id} が重なっています`);
    names.add(target.id);
  }
  const platforms = targets.filter((target) => target.role === 'platform');
  for (const target of targets) {
    if (target.role !== 'platform' && target.platform !== undefined) {
      problems.push(`後段 ${target.id} は役割が ${target.role} なのに、プラットフォームの設定を持っています(設定を持てるのは platform の後段だけ)`);
    }
  }
  for (const target of targets) {
    if (target.authConfig === undefined) continue;
    if (target.role !== 'platform') problems.push(`後段 ${target.id} は役割が ${target.role} なのに、H5 の検査(authConfig)を持っています(持てるのは platform の後段だけ)`);
    if (target.authConfig.id !== H5_ID) problems.push(`後段 ${target.id} の authConfig の ID が ${target.authConfig.id} です(${H5_ID} と書く)`);
  }
  const selectedPlatform = platforms[0]?.platform;
  problems.push(...multiplicityProblems(targets), ...layoutProblems(targets), ...defenseProblems(targets), ...appDeclarationProblems(targets, roots));
  if (platforms.length === 1 && selectedPlatform === undefined) {
    problems.push(`後段 ${platforms[0]?.id ?? ''} は role: platform なのに、プラットフォームの設定(platform)がありません`);
  }
  problems.push(...slotProblems(targets), ...notApplicableProblems(targets), ...unverifiedProblems(targets), ...generatorProblems(targets), ...ownerGeneratorProblems(targets, coreGeneratorIds));
  if (problems.length > 0 || selectedPlatform === undefined) return { ok: false, problems };
  const layout = targets.find((target) => target.role === 'app_frame')?.layout ?? EMPTY_LAYOUT;
  return { ok: true, selection: { targets, platform: selectedPlatform, layout } };
}

/** 置き場の配置(`layout`)の持ち主と中身の違反。 */
function layoutProblems(targets: readonly Target[]): string[] {
  const problems: string[] = [];
  for (const target of targets) {
    if (target.role !== 'app_frame' && target.layout !== undefined) {
      problems.push(`後段 ${target.id} は役割が ${target.role} なのに、置き場の配置を持っています(配置を持てるのは app_frame の後段だけ)`);
    }
    if (target.role === 'app_frame') {
      if (target.layout === undefined) problems.push(`後段 ${target.id} は role: app_frame なのに、置き場の配置(layout)がありません`);
      else problems.push(...layoutDefinitionProblems(target.layout).map((problem) => `後段 ${target.id} の配置: ${problem}`));
    }
  }
  return problems;
}

/**
 * 製品の宣言(実装の木の有無・生成物の置き場)とアプリの枠の後段の食い違い。
 *
 * 実装の木を宣言するのにアプリの枠の後段が無ければ配置が空になり、置き場を決められない生成と検査が黙って何も出さない / 見ない形になる。
 * 逆に実装の木を宣言していないのにアプリの枠の後段があれば、配置の `product-root` が指す先が無い。どちらも使い方の誤りとして選択で止める。
 * `roots.generated`(生成物の総置き場)は、配置の `source-root` の中にあること(根の宣言と配置の二重の定義の食い違い)。
 */
function appDeclarationProblems(targets: readonly Target[], roots: SelectionRoots): string[] {
  const frames = targets.filter((target) => target.role === 'app_frame');
  if (roots.app === null) {
    return frames.map((target) => `製品が実装の木(roots.app)を宣言していないのに、アプリの枠の後段 ${target.id} が選ばれています(実装の木の無い製品は、アプリの枠の後段を選ばない)`);
  }
  // 2 つ以上は役割ごとの多重度(高々 1)が言う。ここは「実装の木があるのに 0」と、1 つのときの生成物の置き場だけ。
  if (frames.length === 0) {
    return [`製品が実装の木(roots.app: ${roots.app})を宣言しているので、アプリの枠の後段(role: app_frame)がちょうど 1 つ要ります(いま 0 つ)`];
  }
  const frame = frames.length === 1 ? frames[0] : undefined;
  if (frame?.layout === undefined) return [];
  // 配置の定義の検査は `layoutProblems` が見る(ここで重ねない)。ここは `roots.generated` が配置の `source-root` の中にあることだけ(パスを正規化して比べる)。
  return [...layoutRootsProblems(frame.layout, roots, `後段 ${frame.id} の配置の`)];
}

/** 役割ごとの多重度(`TARGET_ROLE_MULTIPLICITY`)の違反。 */
function multiplicityProblems(targets: readonly Target[]): string[] {
  const problems: string[] = [];
  for (const role of TARGET_ROLES) {
    const count = targets.filter((target) => target.role === role).length;
    const { min, max } = TARGET_ROLE_MULTIPLICITY[role];
    const subject = `${TARGET_ROLE_WORDS[role]}の後段(role: ${role})`;
    if (min === max && count !== min) problems.push(`${subject}はちょうど ${min} つ要ります(いま ${count} つ)`);
    else if (min !== max && count < min) problems.push(`${subject}は少なくとも ${min} つ要ります(いま ${count} つ)`);
    else if (min !== max && count > max) problems.push(`${subject}は高々 ${max} つです(いま ${count} つ)`);
  }
  return problems;
}

/** 対象外の宣言(`notApplicable`)と口の表・登録した検査の食い違い。 */
function notApplicableProblems(targets: readonly Target[]): string[] {
  const problems: string[] = [];
  for (const target of targets) {
    for (const [id, reason] of Object.entries(target.notApplicable ?? {})) {
      const slot = JOB_CHECK_SLOTS.find((candidate) => candidate.id === id);
      if (slot === undefined) {
        problems.push(`後段 ${target.id} が対象外と宣言した ${id} は、口の表(JOB_CHECK_SLOTS)にありません`);
        continue;
      }
      if (slot.role !== target.role) {
        problems.push(`後段 ${target.id}(role: ${target.role})が対象外と宣言した ${id} は、role: ${slot.role} の後段が受け持つ口です`);
      }
      if (reason.trim() === '') problems.push(`後段 ${target.id} の ${id} の対象外の宣言に、理由がありません(理由つきでだけ宣言できる)`);
      if (target.verifiers.some((verifier) => verifier.id === id)) {
        problems.push(`後段 ${target.id} は ${id} を対象外と宣言しているのに、同じ検査を登録しています(どちらかにする)`);
      }
    }
  }
  return problems;
}

/** 登録された検査と口の表の食い違い。 */
function slotProblems(targets: readonly Target[]): string[] {
  const problems: string[] = [];
  const taken = new Map<string, string>();
  for (const target of targets) {
    for (const verifier of target.verifiers) {
      const slot = JOB_CHECK_SLOTS.find((candidate) => candidate.id === verifier.id);
      if (slot === undefined) {
        problems.push(`後段 ${target.id} が登録した検査 ${verifier.id} は、口の表(JOB_CHECK_SLOTS)にありません`);
        continue;
      }
      if (slot.role !== target.role) {
        problems.push(`後段 ${target.id}(role: ${target.role})が登録した検査 ${verifier.id} は、role: ${slot.role} の後段が受け持つ口です`);
      }
      const holder = taken.get(verifier.id);
      if (holder !== undefined) problems.push(`検査 ${verifier.id} を後段 ${holder} と ${target.id} の両方が登録しています(1 つの口に登録できるのは 1 本)`);
      taken.set(verifier.id, target.id);
    }
  }
  return problems;
}

/** 生成器の ID の重なり。 */
function generatorProblems(targets: readonly Target[]): string[] {
  const problems: string[] = [];
  const holders = new Map<string, string>();
  for (const target of targets) {
    for (const generator of target.generators) {
      const holder = holders.get(generator.id);
      if (holder !== undefined) problems.push(`生成器 ${generator.id} を後段 ${holder} と ${target.id} の両方が登録しています`);
      holders.set(generator.id, target.id);
    }
  }
  return problems;
}

/** 配置が持ち主として名指す生成器が、組み立てた生成器の一覧(コア + 選んだ後段)に実在すること。 */
function ownerGeneratorProblems(targets: readonly Target[], coreGeneratorIds: ReadonlySet<string>): string[] {
  const known = new Set([...coreGeneratorIds, ...targetGenerators(targets).map((generator) => generator.id)]);
  const problems: string[] = [];
  for (const target of targets) {
    for (const [role, decl] of Object.entries(target.layout ?? {})) {
      for (const owner of decl?.owners ?? []) {
        if (owner.kind === 'generator' && !known.has(owner.id)) {
          problems.push(`後段 ${target.id} の配置の役割 ${role}: 持ち主の生成器 ${owner.id} が、組み立てた生成器の一覧(コアの生成器と選んだ後段の生成器)にありません`);
        }
      }
    }
  }
  return problems;
}

/**
 * 選んだ後段が登録した検査と、選んだ後段の名前・役割・対象外の宣言を集める(ジョブ仕様の検査の束ね役 `runJobVerification` へ渡す)。
 *
 * **検査の束ね役(`lib/verify/`)は後段の登録の契約を読まない**: 束ねの入力は、設定(`platform`)と、集めた登録(`jobTargets`)の
 * 2 つのデータだけである(後段の登録の契約は生成器の契約を読み、生成の側は検証の結果の報告を読むので、束ね役が契約を読むと
 * 検証 → 契約 → 生成 → 検証の循環ができる。構造テスト `target-boundary.test.ts` が `lib/verify/**` から契約への辺の 0 を固定する)。
 * 組み立ての根が `verifyInputsOf` で選択から作って渡す。
 *
 * @param targets 選んだ後段
 */
export function jobTargetsOf(targets: readonly Target[]): JobTargetRegistry {
  return {
    checks: targets.flatMap((target) => target.verifiers.map((check) => ({ role: target.role, check }))),
    targets: targets.map((target) => ({ id: target.id, role: target.role, notApplicable: target.notApplicable ?? {}, ...(target.unverified === undefined ? {} : { unverified: target.unverified }) })),
  };
}

/**
 * 選んだ後段が登録した生成器(後段の並び・後段の中の並びの順)。全部入りの生成器の一覧は、コアの生成器のあとにこれを足す。
 *
 * @param targets 選んだ後段
 */
export function targetGenerators(targets: readonly Target[]): readonly DocGenerator[] {
  return targets.flatMap((target) => target.generators);
}

/**
 * 検証の束ね(`runAllVerifications`)への、選んだ後段の渡し方(設定・後段の登録・置き場の配置)。
 *
 * @param selection 契約を確かめた後段の選択
 */
export function verifyInputsOf(selection: TargetSelection): {
  readonly platform: PlatformProfile;
  readonly jobTargets: JobTargetRegistry;
  readonly layout: ProductLayout;
  readonly authConfig: AuthConfigVerifier | null;
} {
  const authConfig = selection.targets.find((target) => target.role === 'platform')?.authConfig ?? null;
  return { platform: selection.platform, jobTargets: jobTargetsOf(selection.targets), layout: selection.layout, authConfig };
}
