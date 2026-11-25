/**
 * テストケースの共通の語彙(`test_cases` の 1 件の形)。
 *
 * `test_cases` の形は仕様種(action_spec・query_spec・screen_spec・data_table・job …)をまたいで同じであり、
 * どの種類の型もこれを import する。**種類に属さない置き場**に置くのは、ある種類の型(`model/trace/types.ts` など)
 * の中に置くと「他の種類の型が action_spec の型を読む」形になり、型の依存が種類どうしの循環を作るためである。
 * ここは葉であり、`testcase/` の中の型だけの葉(`types-scan.ts`)と kernel の位置情報だけを import する
 * (種類のモデルを 1 つも知らない)。**層の語彙の入口**で、台帳の型(`TcRegistry` など)と、型を導く閉じた値域
 * (意味クラス `COVERAGE_CLASSES` ・仕様種の一覧 `SPEC_KIND_LIST` ・絞り込み `isCoverageClass`)もここに置く
 * (型と値域は同じものを 2 通りに書いたもので、離すと食い違う。関数らしい関数は持たない)。
 *
 * app/ の走査結果の型の実体は `types-scan.ts`、意味クラスの説明文(A7 の対処文)は `coverage.ts` にある。
 *
 * スキーマの正: docs/rules/process/backend/specification/standards/action-spec-writing.md
 */

import type { SourceLocation } from '../kernel/source-location.js';

// **語彙の入口**: 層の外の型だけを読む側(前段 `lib/model/**`・検証器・生成器の型注釈)と、閉じた値域(意味クラス・仕様種の一覧)を
// 読む前段のパースは、ここだけを読む。値の入口(`index.ts` = 台帳の組み立て・突合)を読むと、型だけの import でも値の実装が
// 閉包に入る(C24 の写し元の閉包が、テストケースの層のどこを触っても動く)。
export type { CallSite, EachTagRef, GuardEnvRef, HalfTagRef, TestAnnotation, TestBlockRef, TestScanResult } from './types-scan.js';

/** 意味クラスの値域(宣言順がメッセージの表示順になる)。 */
export const COVERAGE_CLASSES = [
  'success',
  'guard_unsatisfied',
  'invalid_from',
  'forbidden',
  'invariant',
  'conflict',
  'not_found',
  'other',
] as const;

/** テストケースが覆う意味クラス。 */
export type CoverageClass = (typeof COVERAGE_CLASSES)[number];

/** 文字列が意味クラスの値域に属するか(パース境界の絞り込みに使う)。 */
export function isCoverageClass(value: string): value is CoverageClass {
  return (COVERAGE_CLASSES as readonly string[]).includes(value);
}

/**
 * テストケースを宣言できる仕様の種類(値としての一覧)。
 *
 * 指摘の文面(「どの仕様の test_cases にも無い」)がここから導けるようにするため、
 * 型だけでなく値でも持つ。仕様種を増やすときはこの 1 行を直せば、
 * 台帳を引くすべての検査のメッセージが同時に追随する。
 */
export const SPEC_KIND_LIST = [
  'action_spec',
  'query_spec',
  'screen_spec',
  'data_table',
  'notification_spec',
  'job_spec',
  'auth_spec',
  'guarantee_spec',
  'external_spec',
  'usecase_spec',
] as const;

/** テストケースを宣言できる仕様の種類。 */
export type SpecKind = (typeof SPEC_KIND_LIST)[number];

/** テストケースの種別。閉じた集合。 */
export type TestCaseType = 'unit' | 'integration';

/**
 * `implementation` の `{パス}::{テスト名}` を分解したもの。
 *
 * 仕様種ごとのパーサーが作り、台帳(`testcase/registry.ts`)を通じて突合器へ渡る共通語彙。
 * 突合器は台帳のエントリ越しにこれを読むため、定義は 1 箇所(ここ)に置く。
 */
export interface TcImplRef {
  /** 書かれたままの文字列。メッセージに使う。 */
  readonly raw: string;
  /** リポジトリルートからのテストファイルパス(区切りは "/")。 */
  readonly file: string;
  /** テスト名(it / test の第 1 引数)。 */
  readonly testName: string;
}

/** `TcImplRef` の別名(テストケースの側から読むときの綴り)。 */
export type TestImplRef = TcImplRef;

/** action_spec の test_cases の 1 件(他の仕様種の `test_cases` も同じ形)。 */
export interface ActionTestCase {
  /** `TC-{AGGREGATE}-{EVENT}-{NNN}`。テスト側の `@tc` と突合するキー。 */
  readonly id: string;
  readonly type: TestCaseType;
  /** このケースが守っている仕様の ID(ドメインイベント ID / 不変条件 ID など)。 */
  readonly specIds: readonly string[];
  /**
   * このケースが覆う意味クラス(1 件で複数クラスを覆ってよい)。A7 の判定対象。
   *
   * プロパティ自体が無いのは「まだ宣言していない」ことを意味し、移行期の warning になる
   * (A7 は宣言されたものだけを数えるので、未宣言のケースは判定に寄与しない)。
   */
  readonly covers?: readonly CoverageClass[];
  /**
   * このケースが**どのロールとして**実行して成功したか(`covers` に success を持つケースのみ)。
   *
   * 宣言に並ぶロールが実装で解決されているかを見る唯一の口である。A 群も S 群も
   * 「宣言 → 実装の実在」は見るが、**実装が宣言のロールを解決しているか**は誰も見ていなかった
   * (実穴: `by` / `writes` に `staff` を並べたのに operation が 1 つも解決しておらず、
   * 「仕様上できることが実装では必ず forbidden」が 14 操作で緑のまま通っていた — E3 第3段)。
   * A7 が「宣言に並ぶロールごとに success のケースがあること」を要求する。
   */
  readonly byRole?: string;
  readonly implementation: TestImplRef;
  readonly location: SourceLocation;
}

/**
 * 欠番にした(廃止した)テストケース ID の宣言 1 件(action_spec の `retired:`)。
 *
 * A9 が「欠番の再利用」を検出するための入力。`buildTcRegistry` はこれと通常のエントリを
 * 突き合わせるだけで、`retired` 自体は `entries` / `duplicates()` には混ざらない
 * (A6 の orphan 判定・ofKind の母集合を汚さないため)。
 */
export interface RetiredTcId {
  readonly tcId: string;
  readonly location: SourceLocation;
}

/** 欠番にした ID が、後から test_cases に再利用されていた 1 件(A9 が報告する)。 */
export interface TcRetiredReuse {
  readonly tcId: string;
  /** 欠番にした(`retired:`)宣言の位置。 */
  readonly retiredAt: SourceLocation;
  /** 再利用してしまった実際の宣言(1 件以上)。 */
  readonly reusedBy: readonly TcRegistryEntry[];
}

/**
 * 台帳の 1 エントリ = 「ある仕様が、ある ID のテストケースを宣言した」という事実。
 *
 * 宣言の中身(`implementation` / `spec_ids`)まで載せるのは、仕様 ⇔ テストの突合(A6 / Q6)が
 * 仕様モデルへ戻らずに台帳だけで行えるようにするため。
 */
export interface TcRegistryEntry {
  /** テストケース ID(例: `TC-ENTRY-SUBMIT-001`)。テスト側の `@tc` と突き合わせるキー。 */
  readonly tcId: string;
  /** どの仕様種が宣言したか。 */
  readonly specKind: SpecKind;
  /** 宣言元の仕様 ID(例: `entry-submit-action` / `query-workshop-list`)。 */
  readonly specId: string;
  /** このケースが守っている仕様の ID(実在検査は各仕様種の検査が行う)。 */
  readonly specIds: readonly string[];
  /** 実装テストの参照(`{パス}::{テスト名}`)。 */
  readonly implementation: TcImplRef;
  /** 宣言のある位置(`test_cases` の該当行)。 */
  readonly location: SourceLocation;
  /** 宣言元の仕様ファイル(重複の反例で「先行した宣言」を示すのに使う)。 */
  readonly specFile: string;
}

/** 同じテストケース ID を宣言している 2 件以上のエントリ。 */
export interface TcDuplicate {
  readonly tcId: string;
  /** 宣言順。先頭が先に読み込まれた宣言。 */
  readonly entries: readonly TcRegistryEntry[];
}

/**
 * テストケース ID の台帳。
 *
 * 構築後は読み取り専用で、検査はこのインターフェース越しにのみ台帳を引く
 * (どの仕様種から来たエントリかを検査が個別に知らなくて済むようにするため)。
 */
export interface TcRegistry {
  /** 全エントリ(宣言順)。 */
  readonly entries: readonly TcRegistryEntry[];
  /**
   * その ID を宣言している仕様が 1 つでもあるか。
   *
   * @param tcId テストケース ID
   * @returns 宣言があれば true(orphan 判定はこれの否定)
   */
  has(tcId: string): boolean;
  /**
   * その ID を宣言しているエントリを引く。
   *
   * @param tcId テストケース ID
   * @returns 宣言順のエントリ(無ければ空)
   */
  find(tcId: string): readonly TcRegistryEntry[];
  /**
   * 指定した仕様種のエントリだけを取り出す。
   *
   * @param kind 仕様種
   * @returns その仕様種が宣言したエントリ(宣言順)
   */
  ofKind(kind: SpecKind): readonly TcRegistryEntry[];
  /**
   * 同じ ID が 2 回以上宣言されている箇所を集める(A9 の材料)。
   *
   * @returns 重複した ID ごとのエントリ群。重複が無ければ空
   */
  duplicates(): readonly TcDuplicate[];
  /**
   * 欠番にした(`retired:`)ID が、後から test_cases に再利用されていないかを見る(A9 の材料)。
   *
   * @returns 再利用が見つかった ID ごとの組。再利用が無ければ空
   */
  retiredReuses(): readonly TcRetiredReuse[];
}
