/**
 * ガード式の AST と、検証器がガード評価に使うサービスのインターフェース。
 *
 * 文法の正: docs/rules/process/common/specification/standards/domain-spec-writing.md
 *   expr    := clause ( ("and" | "or") clause )*
 *   clause  := [ "not" ] atom
 *   atom    := path op (literal | path) | path ["not"] "in" [literals] | path "contains" path
 *            | path "is" ["not"] "null"
 *   優先順位: not > and > or(左結合)。括弧なし。
 *   比較の右辺はリテラルまたはパス(例: entry.performer_id == actor.id / now >= workshop.open_at)。
 *
 * **`is null` / `is not null` を書けるのは不変条件の `formal` だけである**(束 ㉒。
 * 設計: docs/design/null-literal-purchase.md)。パーサーは既定でこの原子を断り、
 * `formal` を読む口だけが `allowNullTest` を立てて受け取る。
 *
 * 実装(パーサー・充足性判定)は guard/ 配下の別モジュール。検証器は
 * このファイルの型と GuardServices インターフェースにのみ依存する(DI)。
 */

/** パス参照。例: workshop.state → { segments: ["workshop", "state"] }。予約語 now は { segments: ["now"] }。 */
export interface PathRef {
  readonly segments: readonly string[];
}

/** 比較演算子。 */
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

/** リテラル。YAML 上は裸のトークン。数値に見えれば number、それ以外は識別子/文字列として扱う。 */
export type Literal =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'symbol'; readonly value: string };

/**
 * 比較の右辺。リテラルまたはパス参照。
 * パス右辺の例: binding の actor.id、時間窓の workshop.open_at。
 * ドット無しの裸トークンは、識別子としてはリテラル(enum値等)と区別できないため、
 * パーサーは「ドットを含む or 予約語(actor/now)」をパス、それ以外をリテラルとして解釈する。
 */
export type CompareRhs = Literal | { readonly kind: 'path'; readonly path: PathRef };

/** ガード式 AST。判別可能ユニオン。 */
export type GuardExpr =
  | { readonly kind: 'and'; readonly left: GuardExpr; readonly right: GuardExpr }
  | { readonly kind: 'or'; readonly left: GuardExpr; readonly right: GuardExpr }
  | { readonly kind: 'not'; readonly operand: GuardExpr }
  | { readonly kind: 'compare'; readonly path: PathRef; readonly op: CompareOp; readonly rhs: CompareRhs }
  | { readonly kind: 'in'; readonly path: PathRef; readonly values: readonly Literal[] }
  | { readonly kind: 'contains'; readonly path: PathRef; readonly ref: PathRef }
  /**
   * `path is null`(その欄に値が無い)。**全域な真偽値**であり、決して「不明」にならない。
   *
   * `path is not null` は `not` に包んだ形で返る(`not in` と同じ扱い)—— こうすると
   * 2 つの綴りが**同じ原子の否定**になり、`x is null and x is not null` が矛盾として読める。
   */
  | { readonly kind: 'null'; readonly path: PathRef };

/** パース失敗の詳細。位置はソース文字列内のオフセット。length は該当トークンの長さ(下線表示用)。 */
export interface GuardParseError {
  readonly message: string;
  readonly offset: number;
  readonly length?: number;
}

/**
 * パースの口の開け方。
 *
 * `allowNullTest` を立てた口だけが `path is [not] null` を受け取る。既定(省略時)は false で
 * あり、**新しく増えた式の置き場は自動的に閉じている側に入る** —— 開いている場所を数える
 * 免除リストを持たないための既定である。
 */
export interface GuardParseOptions {
  /** `is null` / `is not null` を受け取るか(不変条件の `formal` を読む口だけ true)。 */
  readonly allowNullTest?: boolean;
}

/**
 * 不変条件の `formal` を読む口の開け方。
 *
 * **閉じているのは「宣言を検査する口」である。** ガード・`when`・`binding`・`filters` を
 * 検査する口が既定(閉)のままなら、そこに `is null` と書いた仕様はパースの段で error に
 * なる —— 置き場の規則はそこ 1 か所で守られる。式を**読むだけ**の口(参照の列挙・日本語化・
 * world の組み立て)は `formal` の式も読めなければ黙って取りこぼすので、ここを渡して開ける。
 */
export const FORMAL_PARSE: GuardParseOptions = { allowNullTest: true };

/** パース結果。例外を投げず Result 型で返す(検証器が Finding に変換しやすいように)。 */
export type GuardParseResult =
  | { readonly ok: true; readonly expr: GuardExpr }
  | { readonly ok: false; readonly error: GuardParseError };

/**
 * 充足性判定に使う変数ドメインの宣言。
 * パス(文字列表現: "workshop.state")→ そのパスが取り得る値の集合。
 * - enum/state/boolean: 有限集合(全列挙)
 * - integer/decimal/datetime/now: 順序付き値(リテラル比較のみなので区間推論で判定)
 * - ref/uuid: 等号比較のみの不透明値
 */
export type VariableDomain =
  | { readonly kind: 'finite'; readonly values: readonly string[] }
  /** discrete=true は整数など離散な順序値。`n > 1 and n < 2` を恒偽と判定できる。省略時は連続扱い。 */
  | { readonly kind: 'ordered'; readonly discrete?: boolean }
  | { readonly kind: 'opaque' };

/** パス文字列("a.b.c" 形式)→ ドメインのマップ。 */
export type DomainEnv = ReadonlyMap<string, VariableDomain>;

/** 充足性判定の結果。unknown は v1 の判定能力を超えるケース(保守的に「不明」を返す)。 */
export type Satisfiability = 'satisfiable' | 'unsatisfiable' | 'tautology' | 'unknown';

/**
 * 充足性判定の詳細結果。witness は verdict を実証する変数割当
 * (satisfiable なら真にする割当、tautology 以外で偽にできるならその割当は不要)。
 * Finding の反例出力(例: state=submitted, workshop.state=accepting)に使う。
 */
export interface SatResult {
  readonly verdict: Satisfiability;
  readonly witness?: Readonly<Record<string, string>>;
  /**
   * **判定器そのものが壊れた**理由(既製品の判定器だけが立てる欄)。
   *
   * `unknown` には 2 つの意味がありうる —— 「時間内に答えられなかった」(式が難しい)と
   * 「判定器が動かなかった」(起動できない・写像を拒まれた = 写像のバグ)である。前者は
   * warning でよいが、後者を前者と見分けのつかない形で出すと**診断が丸ごと嘘になり、検査の範囲が静かに縮む**
   * (判定器が 1 件も解けていなくても verify が緑で終わる)。ここが立っている `unknown` は
   * 後者であり、V9 / V10 は **error** で報告する。自作の列挙器はここを立てない。
   */
  readonly failure?: string;
}

/**
 * **有界到達性の問い 1 件**(V21)。鍵は `{集約}.{機械}.{state|event}.{id}`。
 *
 * 問いは 2 種類しかない —— 「その状態に至る実行列があるか」(`kind: 'state'`)と、
 * 「その遷移が起こせる瞬間へ至る実行列があるか」(`kind: 'event'`)である。
 */
export interface ReachProblem {
  /** 表の鍵(`entry.entry.state.confirmed`)。 */
  readonly key: string;
  /** その機械を持つ集約。 */
  readonly aggregate: string;
  /** 状態機械の名前。 */
  readonly machine: string;
  /** 状態を問うのか、遷移が起こせる瞬間を問うのか。 */
  readonly kind: 'state' | 'event';
  /** 状態 ID もしくはイベント ID。 */
  readonly id: string;
}

/**
 * 有界到達性の判定結果。
 *
 * `reachable` は**保証ではない**(世界は実行列を多めに認める写しなので偽陽性側)。
 * 報告に値するのは `unreachable`(K 手以内に無い)と `unknown`(判定できなかった)だけである。
 */
export interface ReachResult {
  readonly verdict: 'reachable' | 'unreachable' | 'unknown';
  /**
   * `unknown` の理由。`no-solver` = 答えの表がそもそも無い(判定器を通していない)。
   * `timeout` = 判定器が時間内に答えなかった。**黙って「ある」に畳まない**ための欄である。
   */
  readonly reason?: 'no-solver' | 'timeout';
  /** **判定器そのものが壊れた**理由(`SatResult.failure` と同じ意味。立っていれば error)。 */
  readonly failure?: string;
  /** 展開した手数 K(答えの表を引けたときだけ)。 */
  readonly bound?: number;
  /** K が上限で打ち切られたか(打ち切りなら「無い」は K 手以内の話に留まる)。 */
  readonly truncated?: boolean;
  /** 世界に入れた機械(`{集約}.{機械}`)。 */
  readonly machines?: readonly string[];
}

/** 共存判定の詳細結果。coexists=true のとき witness は両式を同時に真にする割当。 */
export interface CoexistResult {
  readonly coexists: boolean;
  readonly witness?: Readonly<Record<string, string>>;
}

/**
 * 検証器がガード式に対して行える操作。VerifyContext 経由で注入される(具象を直接 import しない)。
 */
export interface GuardServices {
  /**
   * 生文字列をパースする。
   *
   * @param source 式の生文字列
   * @param options 口の開け方(省略すると `is null` を断る)
   */
  parse(source: string, options?: GuardParseOptions): GuardParseResult;

  /** 式に現れる全パスを列挙する(参照整合チェック V2 用)。比較右辺・contains右辺のパスも含む。 */
  collectPaths(expr: GuardExpr): PathRef[];

  /**
   * 式の充足可能性を判定する(V9 用)。
   * env に無いパスの扱いは用法依存: 順序演算子(< <= > >=)の文脈では ordered、
   * 等号文脈では opaque とみなす(明示的に opaque と宣言されたパスへの順序比較は unknown)。
   */
  satisfiability(expr: GuardExpr, env: DomainEnv): SatResult;

  /**
   * 2 つの式が同時に成立し得るか(V8 決定性チェック用)。
   * どちらかが省略(undefined = 常に真)の場合も扱えるよう、undefined を許容する。
   * 判定不能(unknown)のときは coexists=true(見逃しより過検出に倒す)。
   */
  canCoexist(a: GuardExpr | undefined, b: GuardExpr | undefined, env: DomainEnv): CoexistResult;

  /**
   * 有界到達性を答える(V21 用)。
   *
   * 判定は既製品(Z3)が下し、ここは**解き終わった答えの表を引くだけ**である。表を通して
   * いない文脈(単体テスト・生成の前検査)では `{ verdict: 'unknown', reason: 'no-solver' }`
   * を返す —— 「判定していない」を「到達できる」に畳むと、検査の範囲が静かに縮む。
   */
  boundedReachability(problem: ReachProblem): ReachResult;
}
