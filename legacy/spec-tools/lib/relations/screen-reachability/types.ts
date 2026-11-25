/**
 * 「どの画面に、だれが、どこから届くか」の中間表現(関係の層の 2 つ目の住人)の型。
 *
 * 画面の到達は**画面(screen_spec)と、起点を与える側(entry_point・ユースケースの `start`)の関係**である。
 * 画面の検査(S13 = どこかの入口から届くか・S16 = ユースケースの start から届くか)・L2 網羅台帳(生成)・
 * ユースケースの導出(Y3 と「通る画面」の数え)は、同じ探索を**起点だけ変えて**問う。以前は探索が `lib/screen/` と
 * `lib/usecase/` に別々に居て、互いを読み合っていた(種類のディレクトリの相互依存)。ここでは
 *
 *   - 入力(`ReachabilityInput`)= ドメイン・画面の入力の状態・auth_spec の関門の入力の状態
 *   - 問い(`ReachStart` + ロール / 遷移)= 起点の違いは**引数**
 *   - 結果(`ScreenReach` / `StateRoleReach`)= 型つきの値
 *
 * を名前のついた型にして、探索の実装を 1 つにする(設計メモ framework-modules §7 の教訓 1)。
 * 型だけのファイルで、読むのは前段・kernel と事実の層の型だけである。
 */

import type { GuardServices } from '../../guard/ast.js';
import type { BlockedReason, CatalogInput } from '../../kernel/input-state.js';
import type { AuthGateDecl } from '../../model/auth/types.js';
import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import type { SpecModel } from '../../model/types.js';
import type { EventEntry } from '../../semantics/domain-index.js';

/**
 * 探索の起点(**開始点の違いはここだけ**)。
 *
 * - `entry-points`: 画面仕様の `entry_point` 全部(「そのロールがどこかの入口から届くか」。S13 / L2)
 * - `screen`: 特定の 1 画面(「このユースケースが宣言した `start` から届くか」。Y3 / S16 / 通る画面の数え。
 *   `start` が `entry_point` である必要はない)
 */
export type ReachStart =
  | { readonly kind: 'entry-points' }
  | { readonly kind: 'screen'; readonly id: string };

/**
 * 探索の結果 1 件。問い(ロール・起点)を添えて返す。
 *
 * `screenIds` は起点自身を含む。起点が実在しない / ロールが入れない場合は**空**(起点に届かない = 何にも届かない)。
 * 辺は `navigations` のうち `on` が `{イベント ID}.success` でないものだけ(`.success` は操作の**結果**として
 * 着く画面で、押す前から行けるとは言えない)。途中の画面もロールが入れるものだけを通る。
 */
export interface ScreenReach {
  readonly role: string;
  readonly start: ReachStart;
  /** 辿り着ける画面 id の集合。 */
  readonly screenIds: ReadonlySet<string>;
}

/** (state, role) 1 組の到達結果。 */
export interface StateRoleReach {
  readonly role: string;
  readonly state: string;
  /** 満たす画面(複数あり得るが、見つかった最初の 1 枚を代表として持つ)。無ければ `undefined`。 */
  readonly screen: ScreenSpec | undefined;
}

/** 導出に使えなかった入力の名前。 */
export type ReachabilityInputName = 'screens' | 'auth';

/**
 * 導出に使えなかった入力 1 件(未選択 = 製品が採っていない / 阻害 = 採ったのに渡せない)。
 * 使えなかった入力の分は**空として探索する**(画面は 0 枚・関門は 0 本)。理由は呼び手が報告に載せる。
 *
 * **関門(auth)の未選択は載らない**(採っていなければ関門は無い —— 事実)。阻害は載る(関門が分からないまま
 * 探索すると、入れない画面にも入れると見積もってしまう。見積もりを広げたまま判定を出さない)。
 */
export type ReachabilityGap =
  | { readonly input: ReachabilityInputName; readonly state: 'unselected' }
  | { readonly input: ReachabilityInputName; readonly state: 'blocked'; readonly reason: BlockedReason };

/** 導出への入力。 */
export interface ReachabilityInput {
  readonly domain: SpecModel;
  /** 画面の入力の状態(未選択 / 阻害 / 読込済み。0 件の読込済みは阻害ではない)。 */
  readonly screens: CatalogInput<ScreenSpecModel>;
  /**
   * auth_spec の `gates` の入力の状態(未選択 = 関門は無い事実 / 阻害 = 関門が分からない / 読込済み。関門が 0 本の読込済みもある)。
   * 阻害のときは関門を空として探索し、使えなかったことを `gaps` で返す。
   */
  readonly gates: CatalogInput<readonly AuthGateDecl[]>;
}

/**
 * 画面の到達の判定(入口 1 本の結果)。検査・生成・ユースケースの導出が**同じ値**から問う。
 *
 * 判定の規則は 1 つずつで、再実装しない: 入れるか(`canEnter`)・起点から届くか(`reach`)・操作を出す画面(`exposedBy`)・
 * 状態 × ロールの到達(`stateRoleReach`)。
 */
export interface ScreenReachability {
  /** 使えなかった入力(0 件 = 全部使った)。使えなかった画面の分は空として扱う。 */
  readonly gaps: readonly ReachabilityGap[];
  /**
   * 指定したロールがその画面に入れるか。3 つの関門をすべて満たすことを求める。
   * - `for`(ロール階層まで見て交差する。S4 と同じ判定)
   * - `requires_auth`(true の画面には匿名ロールが入れない)
   * - `role_gate`(gates 側の宣言する 1 ロールに一致しないと入れない。H4 と同じ規則)
   */
  canEnter(screen: ScreenSpec, role: string): boolean;
  /** ロール `role` が、起点 `start` から辿って届く画面。 */
  reach(role: string, start: ReachStart): ScreenReach;
  /**
   * 画面が発火すると宣言した操作の正規化 ID → その画面のリスト(S10 と同じ正規化規則)。
   * 作るのは最初に読んだときの 1 回だけ。
   */
  readonly exposedBy: ReadonlyMap<string, readonly ScreenSpec[]>;
  /**
   * 遷移 `entry` の人間が実行できる (state, role) の組それぞれについて、届く画面を探す。
   * 満たす条件は screen-spec-writing.md の S13(a)〜(d) と同じ: 画面が遷移を発火する・ロールが入れる・
   * precondition が状態を弾かない・ロールの入口画面から届く。状態フィールドを引けない機械は空配列。
   *
   * @param guards ガード式の共有サービス(precondition の記号評価に使う)
   * @param entry 対象の遷移(集約・機械・イベントの組)
   */
  stateRoleReach(guards: GuardServices, entry: EventEntry): readonly StateRoleReach[];
}
