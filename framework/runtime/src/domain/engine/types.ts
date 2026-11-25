/**
 * 汎用状態機械エンジンの型契約。
 *
 * ここに置く型は「仕様YAML → 生成器 → `../generated/`」の出力形式そのものである。
 * エンジンは表を持たず、この形のデータを解釈するだけの純粋関数に徹する（ADR-0004）。
 * 生成器と手書きテーブル（テスト用）の双方がこの契約に従う。
 *
 * **許可の結果（`FireAllowed` / `FireDecision`）だけはここに無く `./machine.ts` にある。**
 * 許可はブランド付きの「証明」であり、判定を下す場所以外では組み立てられないようにするため、
 * ブランドを持つモジュール（`canFire` のあるモジュール）に型ごと同居させている。
 *
 * ガード式の基礎型は `./guard-types.ts`、`access_spec` 由来の規則表（creates / writes / deletes）の
 * 契約は `./access-types.ts` にある。生成物・呼び出し側はこのモジュール 1 つを見れば足りるよう、
 * どちらもここから再エクスポートしている。
 */

import type { GuardEnv, GuardExprData } from './guard-types';

export type { GuardEnv, GuardExprData, GuardValue } from './guard-types';
export type {
  CreateContext,
  CreateRejected,
  CreateRejectionReason,
  CreateRuleDef,
  CreateTable,
  DeleteContext,
  DeleteRejected,
  DeleteRejectionReason,
  DeleteRuleDef,
  DeleteTable,
  WriteContext,
  WriteRejected,
  WriteRejectionReason,
  WriteRuleDef,
  WriteTable,
} from './access-types';

/** 遷移1本の定義。状態機械の1行（イベント × from群 → to）に対応する。 */
export interface TransitionDef {
  readonly event: string;
  readonly from: readonly string[];
  readonly to: string;
  readonly by: readonly string[];
  readonly guard?: GuardExprData;
  /** 元のガード式文字列(エラーメッセージ・ログ用) */
  readonly guardSource?: string;
  /**
   * `from` に無い状態でこのイベントが禁止される理由（`state_spec` の `otherwise_forbidden`）。
   *
   * 拒否の理由文を**仕様から返す**ための唯一の出どころである（server-actions.md「戻り値の型」）。
   * 実装がこの文言を組み立ててはならない（PRIN-0008）。仕様に書かれていなければ undefined。
   */
  readonly otherwiseForbidden?: string;
  readonly effects: readonly string[];
}

/** 1つの集約の状態機械。生成物 `../generated/{machine}.transitions.ts` の形。 */
export interface MachineTable {
  readonly machine: string;
  readonly states: readonly string[];
  readonly initial: string;
  readonly final: readonly string[];
  readonly transitions: readonly TransitionDef[];
}

/** エンジンへの照会に必要な実行時の文脈。 */
export interface FireContext {
  /** 対象集約の現在の状態ID。 */
  readonly state: string;
  /**
   * 実行者が対象集約に対して持つロールID。
   * 文脈依存ロール（対象の列と実行者を突き合わせて決まるロール）の**バインディング解決は operation 側の責務**であり、
   * エンジンはここに渡された結果を受け取るだけで、解決には関与しない。
   */
  readonly actorRoles: readonly string[];
  /** ガード評価に使う値。パス文字列 → 値。 */
  readonly env: GuardEnv;
}

/**
 * 拒否理由の分類。ARCH-BE-0013 のエラー3分類へ次のように写像する。
 *
 * | エンジンの reason | Server Action の分類 |
 * |---|---|
 * | `unknown_event` / `invalid_from` / `guard_unsatisfied` / `guard_unknown` | `guard_unsatisfied` |
 * | `role_forbidden` | `forbidden` |
 *
 * `invariant_violated` はエンジンの守備範囲外（永続化時に検出される）。
 */
export type FireRejectionReason =
  | 'unknown_event'
  | 'invalid_from'
  | 'role_forbidden'
  | 'guard_unsatisfied'
  | 'guard_unknown';

/** すべての拒否に共通する診断情報。 */
interface FireRejectedBase {
  readonly allowed: false;
  /** 照会されたイベントID。 */
  readonly event: string;
  /** 照会時の現在状態。 */
  readonly state: string;
}

/** 拒否の結果。`reason` ごとに「なぜ落ちたか」を説明する診断情報を持つ。 */
export type FireRejected =
  | (FireRejectedBase & {
      readonly reason: 'unknown_event';
      /** この状態機械が知っているイベントID一覧（表の出現順・重複なし）。 */
      readonly knownEvents: readonly string[];
    })
  | (FireRejectedBase & {
      readonly reason: 'invalid_from';
      /** このイベントが発火しうる状態の一覧。 */
      readonly expectedFrom: readonly string[];
      /**
       * 仕様が書いた禁止の理由（`state_spec` の `otherwise_forbidden`）。
       *
       * これがこの拒否の「なぜ」であり、呼び出し側はこれをそのまま `ActionError.reason` に載せる
       * （`../action-error.ts`）。仕様に理由が書かれていなければ undefined。
       * `unknown_event` にこの情報は無い（イベント自体が仕様に無いのだから理由文も存在しない）。
       */
      readonly otherwiseForbidden: string | undefined;
    })
  | (FireRejectedBase & {
      readonly reason: 'role_forbidden';
      /** この遷移を実行してよいロール一覧（`by`）。 */
      readonly allowedRoles: readonly string[];
      /** 実行者が持っていたロール一覧。 */
      readonly actorRoles: readonly string[];
    })
  | (FireRejectedBase & {
      readonly reason: 'guard_unsatisfied';
      /** 元のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
    })
  | (FireRejectedBase & {
      readonly reason: 'guard_unknown';
      /** 元のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
      /**
       * 評価に必要だが env から取り出せなかったパス一覧。
       * 空配列のときは「パスは揃っていたが型が合わなかった」ことを意味する。
       */
      readonly unresolvedPaths: readonly string[];
    });
