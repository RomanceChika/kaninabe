import type { GuardExprData } from '@kaninabe/runtime/engine';

/**
 * RLS の挙動テストの**world の設計図の型**。
 *
 * 値(どの表にどの行を置き、どのロールがどう立つか)は**製品の生成物**が運び、**形はここだけが
 * 持つ** —— 集約名・ロール名・列名は 1 つも現れない。生成物(`rls-worlds.ts`)はこのファイルから
 * **型を再輸出する**(束 ①-d 手 2)ので、宣言は 1 か所である —— 実行する側は今までどおり生成物から
 * 型を引ける。生成物が読める境界は `runtime-testing` の要素として宣言されており、**テストの軸の
 * ファイルからだけ**許されている(本番コードが引くと `boundaries/dependencies` が赤にする)。
 *
 * 散文の正: docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md §RLS
 */

/** world の行に入れられる値。 */
export type RlsValue = string | number | boolean;

/** 束縛が見る場所(どの集約のどの列を実行者と比べるか)。 */
export interface RlsWorldBinding {
  readonly entity: string;
  readonly column: string;
  /** その列が実行者の集合なら true(`contains actor.id`)。 */
  readonly many: boolean;
}

/** ロール 1 つの根拠。オラクルは「この実行者はこのロールで立つか」をここから判定する。 */
export interface RlsWorldRole {
  readonly id: string;
  readonly anonymous: boolean;
  /** RLS をバイパスする内部実行ロールか(ポリシーも grant も持たない)。 */
  readonly system: boolean;
  /** 実行者の集約に行があれば必ず立つか(kind: authenticated_default)。 */
  readonly authenticatedDefault: boolean;
  /** 実行者自身の行の欄が根拠(または既定のログインロールの条件)なら、その欄名。 */
  readonly claimField: string | null;
  /**
   * `claimField` が state / enum の欄のときの、立つ値の集合(ADR-0018)。boolean の欄なら持たない。
   * 既定のログインロールでは「行がある」に **AND** で課される条件になる。
   */
  readonly claimValues?: readonly string[];
  readonly binding: RlsWorldBinding | null;
  readonly implies: readonly string[];
}

/**
 * 境界(`reads[].filters`)1 本。
 *
 * `via` は対象の行から境界の列を持つ行へ辿る**参照列**の並び(根から順)。自集約の列なら空で、
 * 親の列(`{集約}.{列}`)なら 1〜2 本である。オラクルは実 DB から読み直した行でこの鎖を 1 段ずつ辿る ——
 * 祖先の表(`ancestry`)を引かないのは、ポリシーが辿るのと**同じ列**で辿らないと、同じ集約の別の行
 * (束縛のために分けた別人の行)を取り違えるからである。
 */
export interface RlsWorldFilter {
  readonly field: string;
  readonly actorField: string;
  readonly via: readonly string[];
}

/** 読み取り規則 1 本(access_spec の reads の写し)。 */
export interface RlsWorldRead {
  readonly by: string;
  readonly scope: 'own' | 'all' | 'none' | 'context';
  readonly filters: readonly RlsWorldFilter[];
  /** 行の状態で絞る条件(reads[].when)。オラクルがエンジンの評価器に掛ける。 */
  readonly when: GuardExprData | null;
}

/** world の実行者 1 人。 */
export interface RlsWorldActor {
  readonly key: string;
  readonly role: string;
  readonly anonymous: boolean;
  /** その実行者の集約の行の名前(未ログイン、または行を持たない人なら null)。 */
  readonly row: string | null;
  /**
   * この人が条件を満たさないロール(ADR-0018)。根拠(束縛など)は成立しているが、このロールの行の条件
   * (既定のログインロールの条件・含意の先の条件)だけを満たさない。通常の実行者は持たない。
   */
  readonly unmet?: string;
}

/** world の行 1 つ。 */
export interface RlsWorldRow {
  readonly key: string;
  readonly table: string;
  readonly entity: string;
  /** そのまま入れる列。 */
  readonly values: Readonly<Record<string, RlsValue>>;
  /** 列 → 参照する行の名前。 */
  readonly refs: Readonly<Record<string, string>>;
  /** 実行者自身の行なら、その実行者の名前。 */
  readonly actor: string | null;
  /** 集約 → その行の名前(自分と、参照を遡って届く全部)。 */
  readonly ancestry: Readonly<Record<string, string>>;
}

/** 表 1 枚ぶんの world。 */
export interface RlsWorld {
  readonly table: string;
  readonly entity: string;
  /** 実行者の集約の物理テーブル名。 */
  readonly actorTable: string;
  readonly actors: readonly RlsWorldActor[];
  /** 挿入順の行(参照先が先。循環の 1 辺だけが後ろ向きに残る)。 */
  readonly rows: readonly RlsWorldRow[];
  /** 検査の的になる行(実行者ごとに 1 つ)。 */
  readonly targets: readonly string[];
  /** 読み取りの宣言(access_spec の reads の写し)。期待はここから計算される。 */
  readonly reads: readonly RlsWorldRead[];
}
