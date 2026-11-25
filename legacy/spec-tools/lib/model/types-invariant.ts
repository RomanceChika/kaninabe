/**
 * invariant_spec(docs/specs/domain/{aggregate}/invariants.md)の型。
 *
 * 不変条件と、それをどこで執行するかの宣言。V10 の入力になる。
 * 入口は types.ts(ファサード)。スキーマの正:
 * docs/rules/process/common/specification/standards/domain-spec-writing.md
 */

import type { SourceLocation } from './types-common.js';
import type { GlobalKeyAccept } from './parse-global-key.js';

/**
 * 不変条件の形式定義。閉じた集合(check / uniqueness / exclusion / cardinality / state_dependency)。
 *
 * `exclusion` は「鍵が一致する行どうしで**期間が重なってはいけない**」を表す
 * (束 ⑲-2b)。`uniqueness` は鍵の**一致**までしか表せず、重なりの判定は執行点(DB の
 * 排他制約)の側だけが持つ状態になっていた —— 宣言と執行が食い違ったまま緑になる形である。
 */
export type InvariantFormal =
  | {
      /** 1 レコード内で常に成り立つ条件(行内制約)。例: "workshop.entry_deadline < workshop.starts_at" */
      readonly kind: 'check';
      /** ガード式(生文字列)。自エンティティのフィールド間の比較。集計は書けない。 */
      readonly expr: string;
    }
  | {
      readonly kind: 'uniqueness';
      readonly keys: readonly string[];
      /** 鍵が境界の列を持たず全体で一意が正しいことの受け入れ(鍵の列と理由。V26。任意)。 */
      readonly globalKey?: GlobalKeyAccept;
      /** 限定条件(ガード式の生文字列)。関連エンティティの状態参照可。 */
      readonly where?: string;
    }
  | {
      /**
       * 鍵が一致する行どうしで期間が重なってはいけない(排他)。
       *
       * 実体は Postgres の排他制約(`exclude using gist`)である。区間の端の扱いは
       * **半開区間 `[start, end)` に固定**する(規約: ARCH-SP-BE-0001 §排他制約)——
       * 「前の予約の終了時刻 = 次の予約の開始時刻」が重なりにならない側であり、
       * 宣言ごとに端の扱いが違うと statement の日本語と執行が静かにずれる。
       */
      readonly kind: 'exclusion';
      /** 一致していなければ重なってよい鍵(例: [room_id])。1 つ以上。 */
      readonly keys: readonly string[];
      /** 鍵が境界の列を持たず全体で排他が正しいことの受け入れ(鍵の列と理由。V26。任意)。 */
      readonly globalKey?: GlobalKeyAccept;
      /** 期間を表す 2 つのフィールド(開始, 終了)。この順で固定。 */
      readonly range: readonly [string, string];
      /** 限定条件(ガード式の生文字列)。例: 取消の行は対象外。 */
      readonly where?: string;
    }
  | {
      readonly kind: 'cardinality';
      /** group-by キー。例: [event_id, gender] */
      readonly keys: readonly string[];
      /** 鍵が境界の列を持たず全体で数えるのが正しいことの受け入れ(鍵の列と理由。V26。任意)。 */
      readonly globalKey?: GlobalKeyAccept;
      /** 上限。数値リテラルまたは親フィールド参照(例: "workshop.capacity") */
      readonly max: number | string;
      readonly where?: string;
    }
  | {
      readonly kind: 'state_dependency';
      /** 前提(ガード式)。例: "workshop.state == program_published" */
      readonly if: string;
      /** 帰結(ガード式)。例: "entry.state in [accepted, withdrawn]" */
      readonly then: string;
    };

/** 執行点の宣言。V10 が「宣言があること」と ref の妥当性を検証する。 */
export interface EnforcementDef {
  readonly kind: 'db_constraint' | 'trigger' | 'guard' | 'application';
  /** 執行の実体を指す参照。guard なら "machine.event"、db_constraint なら制約名。 */
  readonly ref: string;
  readonly location: SourceLocation;
}

/** 1 つの不変条件。 */
export interface InvariantDef {
  readonly id: string;
  /** 人間可読の宣言文 */
  readonly statement: string;
  readonly entities: readonly string[];
  /**
   * この不変条件が数えている/参照している**別集約**の一覧(任意)。
   *
   * `entities` が「この不変条件に関与するエンティティ」全般を指すのに対し、`involves` は
   * そのうち**この不変条件が住む集約以外**を明示する狭い宣言である。A7(意味的カバレッジ)は
   * ここに挙がった集約の create / delete / 全遷移に `covers: invariant` の義務を配る
   * (action-spec-writing.md §A7 involves 拡張)。書かなければ従来どおり、義務はこの不変条件が
   * 住む集約自身にしか配られない — 「別集約を数える不変条件は、子集約の create / delete に
   * 義務を配れない」という仕組みの穴(NOTES 2026-09-04)を、この宣言の有無で塞ぐ。
   */
  readonly involves?: readonly string[];
  /**
   * 形式定義。集計を含む制約(DSLの守備範囲外)は formal を省略してよい —
   * その場合は enforcedBy に application(または trigger)の宣言が必須(V10 が検証)。
   */
  readonly formal?: InvariantFormal;
  /**
   * 形式定義を書かない理由(`formal_outside`。点検 22 回目 C22-3)。形式定義の型(行内比較・一意・排他・件数の上限・状態依存)で
   * 言えない条件だけが持つ(遷移の時点の条件・下限の件数・単調性・3 段の参照など)。トリガがこの不変条件を名指すとき、
   * 照らせない警告(T17)と実在しない執行点の警告(T16)は、**この理由を書いた不変条件だけ**を拡張候補の宿題に数える。書かなければ
   * 「書けるのに書いていない」と同じ扱い(製品の側で直す = 未分類で赤)。`formal` と同時には書けない。
   */
  readonly formalOutside?: string;
  readonly enforcedBy: readonly EnforcementDef[];
  readonly location: SourceLocation;
}

/** invariants.md。集約ごとに 0..1 個。 */
export interface InvariantSpec {
  readonly invariants: readonly InvariantDef[];
  readonly location: SourceLocation;
}
