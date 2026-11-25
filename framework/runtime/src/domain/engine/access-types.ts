/**
 * `access_spec` 由来の規則表（creates / writes / deletes）の型契約。
 *
 * ここに置く型は「仕様YAML → 生成器 → `../generated/`」の出力形式そのものである
 * （`{entity}.creates.ts` / `{entity}.writes.ts` / `{entity}.deletes.ts`）。
 * 遷移テーブル（`./types.ts` の `MachineTable`）と違い、状態を持たないのが 3 つに共通する特徴で、
 * そのぶん拒否の分類も `role_forbidden` / `guard_unsatisfied` / `guard_unknown` の 3 つで足りる。
 *
 * 状態機械側の契約と分けているのは、この 3 つが「状態を変えない操作」という同じ性質を共有し、
 * まとめて読めることに意味があるためである（状態機械側の契約を扱う `./types.ts` に別の性質の型を混ぜない意味もある）。
 */

import type { GuardEnv, GuardExprData } from './guard-types';

/**
 * 作成規則1本（`access_spec` の `creates[]` の1行）。
 *
 * 遷移と違い from / to / effects を持たない。作成は状態を変える操作ではなく対象を生む操作であり、
 * 生まれた行の状態は `MachineTable.initial` が決める（規則側では指定しない）。
 */
export interface CreateRuleDef {
  /** 作成を許可するロールID。 */
  readonly by: string;
  /** 作成の前提条件（`creates[].when`）。省略は「無条件」。 */
  readonly guard?: GuardExprData;
  /** 元のガード式文字列（診断用）。 */
  readonly guardSource?: string;
  /**
   * この規則のもとで**実行者そのものと一致しなければならない**環境の変数（`{集約}.{欄}`。省略は「無し」）。
   *
   * 作成で行に入る実行者の参照の欄（持ち主・発行者・承認者など）を、規則ごとに縛る。`by` の段の一部であり、
   * 一致しなければその規則は実行者に当てはまらない（どの規則も当てはまらなければ `role_forbidden`）。
   * 環境の `actor.id` と、各変数の値が**どちらも文字列で等しい**ときだけ成立する（不明は不成立に倒す）。
   * 生成器が導出する（legacy/spec-tools/lib/usecase/actor-bound.ts。DB の作成 RPC も同じ導出を読む）。
   */
  readonly self?: readonly string[];
}

/** 1つのエンティティの作成規則。生成物 `../generated/{entity}.creates.ts` の形。 */
export interface CreateTable {
  readonly entity: string;
  /** 規則の並び。ここに現れないロールは作成できない（deny by default）。 */
  readonly rules: readonly CreateRuleDef[];
}

/** 作成可否の照会に必要な実行時の文脈。状態を持たない点だけが `FireContext` と違う。 */
export interface CreateContext {
  /**
   * 実行者が持つロールID。
   * バインディング解決はoperation側の責務であり、エンジンは渡された結果を照合するだけである。
   */
  readonly actorRoles: readonly string[];
  /** ガード評価に使う値。パス文字列 → 値。 */
  readonly env: GuardEnv;
}

/**
 * 作成が拒否された理由の分類。ARCH-BE-0013 のエラー3分類へ次のように写像する。
 *
 * | エンジンの reason | Server Action の分類 |
 * |---|---|
 * | `role_forbidden` | `forbidden` |
 * | `guard_unsatisfied` / `guard_unknown` | `guard_unsatisfied` |
 *
 * 遷移と違い `unknown_event` / `invalid_from` は存在しない（遷移元の状態が無いため）。
 */
export type CreateRejectionReason = 'role_forbidden' | 'guard_unsatisfied' | 'guard_unknown';

/** 作成の拒否。`reason` ごとに「なぜ落ちたか」を説明する診断情報を持つ。 */
export type CreateRejected =
  | {
      readonly allowed: false;
      readonly reason: 'role_forbidden';
      /** 作成してよいロール一覧（`creates[].by`）。 */
      readonly allowedRoles: readonly string[];
      /** 実行者が持っていたロール一覧。 */
      readonly actorRoles: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly reason: 'guard_unsatisfied';
      /** 実行者のロールに対応する規則のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
    }
  | {
      readonly allowed: false;
      readonly reason: 'guard_unknown';
      /** 実行者のロールに対応する規則のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
      /**
       * 評価に必要だが env から取り出せなかったパス一覧。
       * 空配列のときは「パスは揃っていたが型が合わなかった」ことを意味する。
       */
      readonly unresolvedPaths: readonly string[];
    };

/**
 * 削除規則1本（`access_spec` の `deletes[]` の1行）。
 *
 * `CreateRuleDef` と対称。削除は「対象を消す操作」であり、遷移のように to / effects を持たない。
 * `guard` は作成と違って**対象がすでに存在する**時点で評価されるため、対象自身の状態
 * （例: `state == draft`）も参照できる。
 */
export interface DeleteRuleDef {
  /** 削除を許可するロールID。 */
  readonly by: string;
  /** 削除の前提条件（`deletes[].when`）。省略は「無条件」。 */
  readonly guard?: GuardExprData;
  /** 元のガード式文字列（診断用）。 */
  readonly guardSource?: string;
}

/** 1つのエンティティの削除規則。生成物 `../generated/{entity}.deletes.ts` の形。 */
export interface DeleteTable {
  readonly entity: string;
  /** 規則の並び。ここに現れないロールは削除できない（deny by default）。 */
  readonly rules: readonly DeleteRuleDef[];
}

/** 削除可否の照会に必要な実行時の文脈。形は `CreateContext` と同じ。 */
export interface DeleteContext {
  /**
   * 実行者が対象に対して持つロールID。
   * バインディング解決はoperation側の責務であり、エンジンは渡された結果を照合するだけである。
   */
  readonly actorRoles: readonly string[];
  /** ガード評価に使う値。パス文字列 → 値。 */
  readonly env: GuardEnv;
}

/**
 * 削除が拒否された理由の分類。ARCH-BE-0013 のエラー3分類へ次のように写像する。
 *
 * | エンジンの reason | Server Action の分類 |
 * |---|---|
 * | `role_forbidden` | `forbidden` |
 * | `guard_unsatisfied` / `guard_unknown` | `guard_unsatisfied` |
 *
 * 作成と同じく `unknown_event` / `invalid_from` は存在しない（遷移ではないため）。
 */
export type DeleteRejectionReason = 'role_forbidden' | 'guard_unsatisfied' | 'guard_unknown';

/** 削除の拒否。`reason` ごとに「なぜ落ちたか」を説明する診断情報を持つ。 */
export type DeleteRejected =
  | {
      readonly allowed: false;
      readonly reason: 'role_forbidden';
      /** 削除してよいロール一覧（`deletes[].by`）。 */
      readonly allowedRoles: readonly string[];
      /** 実行者が持っていたロール一覧。 */
      readonly actorRoles: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly reason: 'guard_unsatisfied';
      /** 実行者のロールに対応する規則のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
    }
  | {
      readonly allowed: false;
      readonly reason: 'guard_unknown';
      /** 実行者のロールに対応する規則のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
      /**
       * 評価に必要だが env から取り出せなかったパス一覧。
       * 空配列のときは「パスは揃っていたが型が合わなかった」ことを意味する。
       */
      readonly unresolvedPaths: readonly string[];
    };

/**
 * 編集規則1本（`access_spec` の `writes[]` の1行）。
 *
 * 作成・削除と違い**どのフィールドを**まで含めて 1 本の規則になる。
 * ここに無い（ロール × フィールド）の組み合わせは編集できない（deny by default）。
 */
export interface WriteRuleDef {
  /** 編集を許可するロールID。 */
  readonly by: string;
  /** この規則が許可するフィールド名（`entity_spec` に実在する名前）。 */
  readonly fields: readonly string[];
  /** 編集の前提条件（`writes[].when`）。省略は「無条件」。 */
  readonly guard?: GuardExprData;
  /** 元のガード式文字列（診断用）。 */
  readonly guardSource?: string;
  /**
   * 編集の副作用（`writes[].effects`）。outbox ジョブの ID（`source: outbox`）。
   * `canWrite` が許可を返すときにそのまま添え、呼び出し側（update-fields テンプレート）が
   * RPC への `p_effects` に集める。宣言列が実際に変わったかどうかの判定は RPC 側が行う。
   */
  readonly effects?: readonly string[];
}

/** 1つのエンティティの編集規則。生成物 `../generated/{entity}.writes.ts` の形。 */
export interface WriteTable {
  readonly entity: string;
  /** 規則の並び。 */
  readonly rules: readonly WriteRuleDef[];
}

/** 編集可否の照会に必要な実行時の文脈。対象フィールドを持つ点だけが `DeleteContext` と違う。 */
export interface WriteContext {
  /** 更新しようとしているフィールド名。 */
  readonly field: string;
  /** 実行者が対象に対して持つロールID。 */
  readonly actorRoles: readonly string[];
  /** ガード評価に使う値。パス文字列 → 値。 */
  readonly env: GuardEnv;
}

/**
 * 編集が拒否された理由の分類。
 *
 * `role_forbidden` は「そのロールにそのフィールドを許す規則が 1 本も無い」を意味する。
 * ロールが違うのかフィールドが違うのかは区別しない（どちらも `forbidden` に写るため）。
 */
export type WriteRejectionReason = 'role_forbidden' | 'guard_unsatisfied' | 'guard_unknown';

/** 編集の拒否。形は `DeleteRejected` と同じ。 */
export type WriteRejected =
  | {
      readonly allowed: false;
      readonly reason: 'role_forbidden';
      /** そのフィールドを編集してよいロール一覧。 */
      readonly allowedRoles: readonly string[];
      /** 実行者が持っていたロール一覧。 */
      readonly actorRoles: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly reason: 'guard_unsatisfied';
      /** 実行者のロールに対応する規則のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
    }
  | {
      readonly allowed: false;
      readonly reason: 'guard_unknown';
      /** 実行者のロールに対応する規則のガード式文字列。生成物に無ければ undefined。 */
      readonly guardSource: string | undefined;
      /** 評価に必要だが env から取り出せなかったパス一覧。 */
      readonly unresolvedPaths: readonly string[];
    };
