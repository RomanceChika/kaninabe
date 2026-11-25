/**
 * 画面の到達(関係の層 `relations/screen-reachability`)の入力が使えなかったことの報告(S13・S16・Y3・Y5)。
 *
 * 画面の到達の値は、画面の入力の状態(未選択 / 阻害 / 読込済み)を `gaps` で返す。それを読む検査は 4 本ある:
 * S13(状態 × ロールの到達)・S16(保存点の宣言と起点からの到達)・Y3(ユースケースの start からの到達)・
 * Y5(導出した「通る画面」と「前提」の予算)。ほかに、**画面の阻害だけ**に依る検査が 1 本ある: Y1(`start` が実在する画面か)。**関門(auth)の阻害だけ**に依る検査が 2 本ある: S14(状態の可視性。見える画面は入れる画面で決まる)・
 * S15(遷移後の着地の「入れるロール」。状態を弾くかは関門に依らず従来どおり)。画面(と認証フローの関門)が使えないとき、これらは**判定を出さず**(使えない入力から「届く / 届かない」を
 * 導くと見ていないものを見たと報告する)、見ていないことを A13 / T2 と同じ形の行で言う
 * (`check-run-report.ts` の `describeGapNotes`)。**画面の読み込みの error は前段(S0・P2)が 1 回だけ出す**ので、
 * ここは進捗の行であって Finding ではない(二重に数えない)。
 *
 * 画面が読み込めていれば(0 枚の読込済みも)`gaps` は空で、行は出ず、4 本の判定は従来どおり。
 */

import { availableLoad, catalogInput, mapCatalogInput, type CatalogInput } from '../kernel/input-state.js';
import type { Finding } from '../kernel/finding.js';
import type { AuthGateDecl, AuthSpecModel } from '../model/auth/types.js';
import type { ProductUses } from '../model/product/uses.js';
import { selectionOf } from '../model/product/uses.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { SpecModel } from '../model/types.js';
import { deriveScreenReachability, type ReachabilityGap } from '../relations/screen-reachability/index.js';
import { describeGapNotes, type GapDependent } from './check-run-report.js';
import type { ProgressLog } from './group-contract.js';

/** 画面の到達の値を読む検査 1 本(ID・画面が使えないと見ていないこと・ユースケース仕様が要るか)。 */
export interface ReachabilityDependent extends GapDependent {
  /**
   * 検査が S 群の中の 1 本か。そうなら **S 群が実行されているとき(画面の置き場があるとき)だけ**行を出す(S 群が丸ごと飛んでいるときは、
   * 群自体の「スキップしました」の行がすでに言う。同じ原因を 2 行で数えない)。画面が阻害でも置き場があって S 群が走るときは言う。
   */
  readonly needsScreensGroup: boolean;
  /**
   * 判定の母集合がユースケース仕様(保存点・ユースケースの手順)か。そうなら**ユースケース仕様が読み込めているときだけ**
   * 行を出す(読めていなければ、画面が使えなくても母集合が無く、見ていないものは無い。群自体の「スキップしました」の行が言う)。
   */
  readonly needsUsecases: boolean;
  /**
   * この検査が依る入力(省略は画面・関門のどちらの欠けにも依る)。関門の欠けだけに依る検査(S14・S15)は `['auth']`
   * (画面が使えないときは、画面を前提にする群の側が従来どおり動く)。画面の欠けだけに依る検査(Y1)は `['screens']`。
   */
  readonly gapInputs?: readonly ReachabilityGap['input'][];
}

/** 画面の到達の値(と、画面の実在)を読む検査(ID と、画面が使えないと見ていないこと)。 */
export const REACHABILITY_DEPENDENTS: readonly ReachabilityDependent[] = [
  { id: 'S7', needsScreensGroup: true, needsUsecases: false, gapInputs: ['auth'], consequence: '関門のある画面の generateMetadata が関門の中にあるかは見ていません(実ルートの突合は見ています)' },
  { id: 'S13', needsScreensGroup: true, needsUsecases: false, consequence: '状態 × ロールの到達(人が起こせる遷移に届く画面があるか)は見ていません' },
  { id: 'S14', needsScreensGroup: true, needsUsecases: false, gapInputs: ['auth'], consequence: '各状態の実体を見られる画面があるか(入れる画面は関門で決まる)は見ていません(unseen_states の宣言が実在する状態かは実行済み)' },
  { id: 'S15', needsScreensGroup: true, needsUsecases: false, gapInputs: ['auth'], consequence: '遷移後の行き先に by のロールが入れるか(関門で決まる。状態を弾くかの判定は実行済み)は見ていません' },
  { id: 'S16', needsScreensGroup: true, needsUsecases: true, consequence: '保存点の宣言(usecases)と、起点からの到達は見ていません' },
  { id: 'Y1', needsScreensGroup: false, needsUsecases: true, gapInputs: ['screens'], consequence: 'ユースケースの start が実在する画面かは見ていません(actor・手順・done・accept の参照先は実行済み)' },
  { id: 'Y3', needsScreensGroup: false, needsUsecases: true, consequence: 'ユースケースの start から各手順を出す画面への到達は見ていません' },
  { id: 'Y5', needsScreensGroup: false, needsUsecases: true, consequence: '通る画面の数(画面の予算)と、start に入る関門の数(前提の予算)は数えていません' },
];

/** 画面の入力(読み込みの結果)。 */
export interface ScreensForReachability {
  readonly domain: SpecModel;
  /** 読み込んだ画面のモデル(置き場が無ければ `available: false`)。 */
  readonly screens: ScreenSpecModel;
  /** 画面の読み込みの診断(**全体へは読み込んだ側が足している**。ここでは入力の状態を決めるだけに使う)。 */
  readonly loadFindings: readonly Finding[];
  /** 画面の読み込みで、モデルへ入れずに捨てた仕様・宣言の数(0 なら、読み込みの error が残っていてもモデルは欠けていない)。 */
  readonly dropped: number;
  readonly uses: ProductUses;
  readonly auth: AuthSpecModel;
  /** 認証フロー仕様の読み込みの診断(**全体へは読み込んだ側が足している**。ここでは入力の状態を決めるだけに使う)。 */
  readonly authLoadFindings: readonly Finding[];
  /** 認証フロー仕様の読み込みで、モデルへ入れずに捨てた行の数(0 なら、読み込みの error が残っていても関門は欠けていない)。 */
  readonly authDropped: number;
}

/**
 * 認証フローの関門(`gates`)の入力の状態。製品が `auth` を採っているか(`uses`)と、読み込みの結果から決める。
 * 未選択は「関門は無い」という事実。採ったのに無い・読めない・読めずに捨てた行がある(読み込みの error が残っていても、
 * 行を落としていなければ読込済み)は阻害で、関門が分からないまま到達を決めると、入れない画面にも入れると広く見積もってしまう。
 *
 * @param uses 製品が採る種類
 * @param auth 読み込んだ認証フロー仕様
 * @param loadFindings 認証フロー仕様の読み込みの診断
 * @param dropped 認証フロー仕様の読み込みで捨てた行の数
 */
export function gatesInputOf(
  uses: ProductUses,
  auth: AuthSpecModel,
  loadFindings: readonly Finding[],
  dropped: number,
): CatalogInput<readonly AuthGateDecl[]> {
  const flow = catalogInput(selectionOf(uses, 'auth'), { model: { available: auth.available, catalog: auth.flow }, findings: loadFindings, dropped });
  return mapCatalogInput(flow, (spec) => spec.gates);
}

/**
 * 画面の到達の入力のうち、使えなかったもの。製品が `screens` を採っているか(`uses`)と、読み込みの結果から決める。
 * 読めずに捨てた画面・宣言がある画面は阻害(欠けたモデルで到達を決めると「見た」と誤って報告する)。読み込みの error が残っていても、
 * 仕様を落としていなければ(id の不一致など)読込済み。
 *
 * @returns 使えなかった入力(空 = 使える。0 枚の読込済みも空)
 */
export function reachabilityGapsOf(input: ScreensForReachability): readonly ReachabilityGap[] {
  const screens = catalogInput(selectionOf(input.uses, 'screens'), availableLoad(input.screens, input.loadFindings, input.dropped));
  return deriveScreenReachability({ domain: input.domain, screens, gates: gatesInputOf(input.uses, input.auth, input.authLoadFindings, input.authDropped) }).gaps;
}

/**
 * 使えなかった入力を、読む検査ごとの行にして実行ログへ残す(使えるなら何も言わない)。
 * ユースケース仕様を母集合に持つ検査(S16・Y3・Y5)は、ユースケース仕様が読み込めているときだけ言う。
 * S 群の中の検査(S13・S16)は、S 群が実行されているとき(画面の置き場があるとき)だけ言う(群が飛んでいれば、群の行が言う)。
 *
 * @param gaps 画面の到達の `gaps`
 * @param models 読み込んだ画面とユースケース仕様(読み込めたか = `available`)
 * @param log 実行ログ
 */
export function logReachabilityGaps(
  gaps: readonly ReachabilityGap[],
  models: { readonly usecases: UsecaseSpecModel; readonly screens: ScreenSpecModel },
  log: ProgressLog,
): void {
  const dependents = REACHABILITY_DEPENDENTS.filter(
    (dependent) => (models.usecases.available || !dependent.needsUsecases) && (models.screens.available || !dependent.needsScreensGroup),
  );
  for (const dependent of dependents) {
    const mine = gaps.filter((gap) => dependent.gapInputs === undefined || dependent.gapInputs.includes(gap.input));
    for (const note of describeGapNotes(mine, [dependent])) log(note);
  }
}
