/**
 * 拡張候補の台帳(`extension-candidates.md`)のモデル型。
 *
 * 警告(`npm run verify` の warning)は 2 つに分けて管理する。ユーザーの言葉(2026-10-03 午後)は
 * 「警告の中にも管理の仕方を分けた方がいい。仕組みを拡張すれば吸収すべき問題か、仕組みは変えるべきでない
 * が警告になる例外か。同じ扱いだと後々ややこしい」。台帳は前者 —— **仕組みの宿題** —— の全数である。
 * 1 行が 1 つの拡張候補で、どの検査の警告がその候補に当たるか(`rules`)を宣言する。
 *
 * **後者(仕組みは変えるべきでない例外)の口はこの台帳に作らない。** 当たるものが 0 件で、作るなら
 * 検査ごとの既存の受け入れの形(`ux:` / `unseen_states` / `handwritten:` など)に揃える。1 本の汎用の
 * 理由欄にすると、免除リストになる。どちらの候補にも当たらない警告は**未分類**として数える。
 *
 * 書き方と検査の正: enforcement-matrix.md の W5 と、台帳そのものの冒頭の説明。
 */

import type { SourceLocation } from '../types.js';

/**
 * 拡張候補の状態(値域)。
 *
 *   - `open` … 拡張するかもしれない(まだ決めていない・まだ作っていない)
 *   - `decided` … 拡張すると決めた(まだ作っていない)
 *   - `done` … 拡張した。この候補に当たる警告は 1 件も残らない(残っていれば W5 が error にする)
 */
export const EXTENSION_STATUSES = ['open', 'decided', 'done'] as const;

/** 拡張候補の状態。 */
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

/**
 * 候補が当たる警告を、検査 ID より細かく絞る鍵(値域。閉じた語)。
 *
 *   - `framework_tables` … 仕組みが所有する表(`FRAMEWORK_TABLES`)に関する警告だけ(T2)
 *   - `trigger_formal_inexpressible` … 執行点が**トリガ**で、その不変条件の形式定義が DSL の写像の外(数の上限・状態依存・
 *     形式定義なし)のために、本文を作れず実在しない警告だけ(T16)。**形式定義が書けるのに執行点を宣言していない**
 *     (製品の側で直せる)警告は含まない
 *   - `trigger_cross_aggregate` … 執行点が**トリガ**で、不変条件の形式定義は `check` だが式が**自集約以外の集約の欄**
 *     を参照する(行の CHECK に写せない)ために本文を作れず、実在しない警告だけ(T16)
 *   - `compute_child_set` … `computes` の材料として**子の行の集合**(明細の総和など)を宣言したが、実行計画が積む
 *     語彙が無く届かない警告だけ(A19。宣言が 1 つも無い警告は含まない)
 *   - `trigger_condition_inexpressible` … トリガが名指す不変条件の形式定義が無い(DSL の外。不変条件が理由 `formal_outside` を
 *     宣言したものだけ。点検 22 回目 C22-3)ために、宣言の条件を本文と照らせない警告だけ(T17。点検 21 回目 C21-4)。名指した不変条件が無い・一意や排他を名指した・式が読めないなど製品の側で直せる警告は含まない
 *
 * 絞りを書かない候補は、検査 ID の全体に当たる。語の意味と絞り方の正は `scope.ts`。
 */
export const EXTENSION_SCOPES = [
  'framework_tables',
  'trigger_formal_inexpressible',
  'trigger_cross_aggregate',
  'compute_child_set',
  'trigger_condition_inexpressible',
] as const;

/** 候補の絞りの鍵。 */
export type ExtensionScope = (typeof EXTENSION_SCOPES)[number];

/** 台帳の 1 行(拡張候補 1 件)。 */
export interface ExtensionCandidate {
  /** 候補の識別子(`X-` 接頭辞のケバブケース。台帳の中で一意)。 */
  readonly id: string;
  /** 何が書けない・組めないか(1 文)。 */
  readonly statement: string;
  /** この候補に当たる検査の ID(その検査の警告は、この候補の宿題として数える。`scope` があれば絞った分だけ)。 */
  readonly rules: readonly string[];
  /** 当たる警告を `rules` の検査の中でさらに絞る鍵。書かなければ検査 ID の全体に当たる。 */
  readonly scope?: ExtensionScope;
  /** 状態。 */
  readonly status: ExtensionStatus;
  /** 起票した日(`YYYY-MM-DD`)。 */
  readonly since: string;
  /** 経緯の置き場(BACKLOG の行・拡張トリアージの文書など。人が辿るための 1 行)。 */
  readonly ref: string;
  /** 台帳の中の位置。 */
  readonly location: SourceLocation;
}

/** 台帳全体。 */
export interface ExtensionLedger {
  readonly candidates: readonly ExtensionCandidate[];
  readonly location: SourceLocation;
}

/** 台帳のモデル(ファイルが読めない環境でも壊れない形)。 */
export interface ExtensionLedgerModel {
  /** ファイルがあったか。無ければ警告はすべて未分類になる。 */
  readonly available: boolean;
  /** 読めた台帳。スキーマが壊れていれば null。 */
  readonly ledger: ExtensionLedger | null;
}
