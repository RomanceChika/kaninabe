/**
 * 読み取りクエリ仕様(query_spec)の型付きモデル。
 *
 * スキーマの正: docs/rules/process/backend/specification/standards/query-spec-writing.md
 *
 * query_spec は「どのロールが・どのエンティティを・どのスコープで読む経路か」を宣言する
 * 薄い仕様であり、可視性そのもの(誰に何が見えるか)の正は access_spec の `reads` にある。
 * Q 群の検証はすべて「この宣言がドメイン仕様と食い違っていないか」を問うものになる。
 */

import type { ReadScope, SourceLocation, SpecModel } from '../types.js';
import type { ActionTestCase, TestScanResult, TcRegistry } from '../../testcase/types.js';
import type { LintExceptionDecl } from '../parse-lint-exceptions.js';

/**
 * query_spec の test_cases 1 件。
 *
 * action_spec と同形式であり、`@tc` 突合(A6 / Q6)も同じ規則で行うため型を共有する。
 */
export type QueryTestCase = ActionTestCase;

/**
 * 実行時に外から渡す入力 1 件。
 *
 * 「どの催しの」「どのカーソルから」のような**実行のたびに変わる値**は params で受け、
 * filters からは `param.{name}` で参照する。型・制約は参照先(`ref`)のフィールド定義が正であり、
 * ここには書かない(PRIN-0007)。
 */
export interface QueryParam {
  /** パラメータ名(snake_case)。filters からは `param.{name}` で参照する。 */
  readonly name: string;
  /** 型の導出元となるフィールド(`{entity}.{field}`)。 */
  readonly ref: { readonly entity: string; readonly field: string; readonly raw: string };
  readonly location: SourceLocation;
}

/**
 * 返し方。`one` は 1 件(見つからなければ無し)、`many` は 0 件以上の列。
 * `paging` を書けるのは `many` のときだけである。
 */
export type QueryReturns = 'one' | 'many';

/** 絞り込み条件 1 本(ガード式と同じ文法の生文字列)。 */
export interface QueryFilter {
  /** 書かれたままの式(例: "state in [published, accepting]")。 */
  readonly source: string;
  readonly location: SourceLocation;
}

/**
 * 可視性を供給する関係ロールの指定(`via`)。
 *
 * `for` が「誰がこのクエリを実行するか(観客。グローバルロール)」を表すのに対し、
 * `via` は「その実行者のどの**関係**が行の可視性を供給しているか」を表す
 * (ログインしている資格で実行するが、行が見えるのは自分がその行の関係者だから —— `for` に既定ロール、
 * `via` にその関係のロールを書く)。
 *
 * 借用の条件は 3 つ(query-spec-writing.md §via)。
 * ① `via` のロールが `for` の各ロールを `implies` で(推移的に)含意していること
 * ② 借りられるのは関係スコープ(`own` / `context(...)`)だけで `all` は借りられないこと
 * ③ 暗黙の `implies` 歩きはせず、常に `via` の明示を要求すること
 */
export interface QueryVia {
  /** 可視性を供給する関係ロールの ID。 */
  readonly role: string;
  readonly location: SourceLocation;
}

/** 併読するエンティティ 1 件。 */
export interface QueryInclude {
  /** 併読するエンティティ名。 */
  readonly entity: string;
  /** そのエンティティを読むスコープ。include 先の access_spec の reads と一致すること(Q5)。 */
  readonly scopeUsed: ReadScope;
  /**
   * この併読の可視性を供給する関係ロール(任意)。
   * 省略時は `for` のロール自身の reads 宣言と突き合わせる(Q5)。
   */
  readonly via?: QueryVia;
  /**
   * 併読した行の絞り込み(任意)。文法・検査は source の filters と同じ(Q3 / Q4)。
   *
   * パスの起点は**併読先のエンティティ**であり、そこから見た context・`param.{name}` を参照できる。
   * 「可視性ではなく UX の取捨選択」という位置づけも source と同じ。
   */
  readonly filters: readonly QueryFilter[];
  /** 併読先から返すフィールド。source と同じく実在(Q1)と隠しフィールド(Q3)を検査する。 */
  readonly projection: readonly QueryProjectionField[];
  /** 併読した行の並び順(任意)。フィールドは併読先に実在すること(Q1)。 */
  readonly sort: readonly QuerySortKey[];
  /** 併読した行の件数上限(任意)。省略は「全件返す」。 */
  readonly limit?: number;
  readonly location: SourceLocation;
}

/** 並び順の方向。 */
export type SortDirection = 'asc' | 'desc';

/**
 * null の位置。省略時は Postgres の既定(asc は null を最後、desc は null を先頭)に委ねる。
 *
 * 根拠(確かめた一次資料): Postgres は「`NULLS FIRST` は `DESC` の既定・それ以外は `NULLS LAST`」
 * (https://www.postgresql.org/docs/current/queries-order.html)。いまの後段の API 層は `order` に
 * `nullsfirst` / `nullslast` を付けたときだけ `NULLS` 句を足す
 * (一次資料: https://docs.postgrest.org/en/stable/references/api/tables_views.html の Ordering。クライアント側も
 * `nullsFirst` が未指定なら修飾子を付けない)ので、省略時は Postgres の既定がそのまま効く。
 * API 層が違えば省略時の意味は変わりうる —— 後段の写像が「省略 = Postgres の既定」を守ること。
 *
 * nullable なフィールドで並べるとき、未設定行をどちらに回すかは業務判断であり、既定に
 * 黙って委ねると「並びが DB の既定次第で変わる」ことになる。書きたいときだけ明示する。
 */
export type NullsPosition = 'first' | 'last';

/** 並び順のキー 1 本。 */
export interface QuerySortKey {
  /** 並び替えに使うフィールド名(source のフィールド)。 */
  readonly field: string;
  readonly direction: SortDirection;
  /** null の位置(任意)。書かなければ Postgres の既定。 */
  readonly nulls?: NullsPosition;
  /** 書かれたままの文字列(例: "starts_at desc" / "order_index asc nulls_last")。 */
  readonly raw: string;
  readonly location: SourceLocation;
}

/**
 * ページングの方式。閉じた集合。
 * - `none`     … 全件返す(件数が業務上有界だと分かっている場合のみ)
 * - `limit(n)` … 先頭 n 件で打ち切る
 * - `cursor`   … カーソル方式で継続読みする
 */
export type QueryPaging =
  | { readonly kind: 'none' }
  | { readonly kind: 'limit'; readonly max: number }
  | { readonly kind: 'cursor' };

/**
 * `paging: none` が「なぜ有界か」の宣言(Q8)。語彙は閉じている。
 * - `window` … `via` のスコープ条件(binding)が対象を実行者 1 人分に絞るため有界(例: 自分の所有物)
 * - `parent` … 親集約 1 件の子行であり、親側の宣言(容量等)で有界(`reason` に 1 行で書く)
 */
export type QueryBoundedBy =
  | { readonly kind: 'window' }
  | { readonly kind: 'parent'; readonly aggregate: string; readonly reason: string };

/** 返すフィールド 1 件。 */
export interface QueryProjectionField {
  readonly name: string;
  readonly location: SourceLocation;
}

/** 1 つの query_spec ファイル(= 1 クエリ)。 */
export interface QuerySpec {
  /** `query-{name をケバブケースにしたもの}`(例: query-workshop-list)。 */
  readonly id: string;
  /** クエリ名(snake_case)。実装関数名 `{camelCase(name)}Query` の元。 */
  readonly name: string;
  /** このクエリを実行するロール(観客)。グローバルロールに限る(Q2)。 */
  readonly forRoles: readonly string[];
  /** 主エンティティ。entity_spec に実在すること(Q1)。 */
  readonly source: string;
  /** 使う読み取りスコープ。for(または via)の reads 宣言と一致すること(Q2)。 */
  readonly scopeUsed: ReadScope;
  /**
   * source の可視性を供給する関係ロール(任意)。
   * 省略時は `for` のロール自身の reads 宣言と突き合わせる(Q2)。
   * 宣言されているときは、隠しフィールドの判定(Q3)もこのロール基準で行う。
   */
  readonly via?: QueryVia;
  /** 実行時入力。filters から `param.{name}` で参照できる。 */
  readonly params: readonly QueryParam[];
  /** 返し方。`one` のときは paging を持たない。 */
  readonly returns: QueryReturns;
  readonly filters: readonly QueryFilter[];
  readonly includes: readonly QueryInclude[];
  readonly sort: readonly QuerySortKey[];
  /** ページング方式。`returns: one` のときは持たない。 */
  readonly paging?: QueryPaging;
  /** `paging: none` のときの有界性の根拠(Q8: `paging: none` なら必須)。 */
  readonly boundedBy?: QueryBoundedBy;
  /** 返すフィールド。entity_spec に実在し(Q1)、fields_hidden と衝突しないこと(Q3)。 */
  readonly projection: readonly QueryProjectionField[];
  readonly testCases: readonly QueryTestCase[];
  /**
   * ESLint 違反の理由つき受け入れ(任意。免除の一本化)。
   * `eslint-disable` はコードに書けないため、generate で導けない違反はここに宣言する
   * (対象は写像 `src/infrastructure/{source}/queries.ts`)。
   */
  readonly exceptions: readonly LintExceptionDecl[];
  /** specs/backend/queries からの相対パス(例: "workshop/list.md")。 */
  readonly relPath: string;
  readonly location: SourceLocation;
}

/** specs/backend/queries 全体。Q 群への入力の 1 つ。 */
export interface QuerySpecModel {
  /**
   * specs/backend/queries を読めたか。
   * false は「読み取り経路をまだ仕様化していない」を意味し、0 件(ディレクトリはあるが空)と区別する
   * (app/ の走査結果 TestScanResult と同じ流儀)。
   */
  readonly available: boolean;
  readonly queries: readonly QuerySpec[];
}

/** クエリ検証器(Q1〜Q7)への唯一の入力。 */
export interface QueryInput {
  readonly domain: SpecModel;
  readonly queries: QuerySpecModel;
  readonly tests: TestScanResult;
  /**
   * 全仕様種のテストケース ID 台帳(lib/testcase/registry.ts)。CLI が構築したものを受け取る。
   *
   * Q6 の `@tc` 突合はここから query_spec のエントリを引く。テストケース ID の一意性は
   * 仕様種をまたぐ性質なので query_spec の中だけでは見られず、台帳を見る A9 が担う。
   */
  readonly registry: TcRegistry;
}
