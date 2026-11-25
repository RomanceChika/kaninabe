/**
 * ガード式の AST → SQL 述語への翻訳(純関数)。
 *
 * 同じ 1 つの式を、TS の評価器(`app/src/domain/engine/guard.ts`)と DB の両方が読む。
 * **意味の正は TS の評価器**であり、ここはその意味を SQL に写す側である —— 食い違いは
 * 差分テスト(`legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts`。fast-check で
 * 式と環境を振り、実 DB の `select <述語>` と突き合わせる)が反例で示す。
 *
 * ## 不明(NULL)の扱い
 *
 * TS の評価器は**3 値論理**である: 値が無い・型が食い違う・`contains` が未解決なら `'unknown'`
 * を返し、`and` / `or` / `not` は Kleene の規則で伝播し、最後に `canFire` が「不明 → 不成立」と
 * 決める。SQL の NULL 論理はこの Kleene 論理そのものなので、**原子はそのまま訳し、式全体を
 * 1 回だけ `coalesce(…, false)` で閉じる**のが正しい写しになる(`totalPredicate`)。
 *
 * 原子ごとに `coalesce` すると `not` の下で意味が変わる —— `not (x == 1)` で `x` が NULL の
 * とき、TS は不明 → 不成立(偽)だが、原子を先に偽へ潰すと `not false` = 真になり、**DB だけが
 * 通す**。束 ⑳-1 の差分テストはこの反例を最初に出した。
 *
 * **`x is null` はこの規約の下でそのまま訳せる**(束 ㉒)—— NULL を返さない述語なので、
 * 式全体が `coalesce` に包まれても意味が変わらない。演算子としては値の種別を選ばない
 * (どの `ValueKind` の欄でも書ける)ので断る理由も無い。なお `is null` を書けるのは
 * 不変条件の `formal` だけであり、`formal` の式は DDL に反映されない(`checks[]` が `rule` を
 * 書いたときだけ CHECK が出る)ため、**この経路はいまのところ通らない**。それでも写せる
 * ようにしておくのは、翻訳器が式の文法に対して全域であるためである。
 *
 * ## 列参照は呼び側が与える
 *
 * どの表のどの別名の、どの列に落ちるかは呼ぶ文脈(RPC の本文 / RLS のポリシー)ごとに違う。
 * この束では写像を関数として受け取り、ここでは予約語 `now` だけを自分で解決する。
 * 呼び側が返す字面は**必ず括弧で包む** —— `case … end` や `x or y` のような primary でない式が
 * 返っても `(A op B)` の結合が壊れないようにするためで、`contains` の解決と同じ扱いにする。
 *
 * ## 照合順序と、書けるが常に不成立の式は**翻訳器が引き受ける**
 *
 * 呼び側は列の**種別**(`valueKind`)も宣言する。翻訳器がそれを使うのは 2 つだけである。
 *
 * - **text の順序比較には `collate "C"` を必ず付ける**。TS の評価器は JS の文字列比較
 *   (コード単位順)で順序を決めるので、DB 既定の照合順序(大小文字・記号を無視する)のままでは
 *   割れる。呼び側の作法にすると与え忘れを誰も見ないので、ここで機械的に付ける(束 ⑳-1b)。
 * - **TS が常に不明にする組み合わせは翻訳しない**(`ok: false` の `rejected`)。boolean の欄への
 *   `in` / 順序比較、uuid・ref の欄への順序比較がそれで、SQL に写すと**DB だけが通す / DB だけが
 *   落ちる**。仕様の側で書けなくするのは V2(`lib/guard/comparison-typing.ts`)であり、
 *   ここはその意味を写さないことで二重に閉じる。
 */

import { sqlStringLiteral } from '../kernel/safe-text.js';
import type { CompareOp, CompareRhs, GuardExpr, Literal, PathRef } from '../guard/ast.js';
import type { ValueKind } from '../model/field-values.js';
import { pathKey } from '../guard/atoms.js';

/**
 * 予約語 `now`(現在時刻)の既定の SQL(トランザクションの開始時刻)。
 *
 * RPC の本文は `bindings.now` で**行ロックの後に取った 1 つの時刻**(`v_now`)を与える ——
 * ロック待ちが締切をまたいだとき、開始時刻のままだと期限切れの後に通ってしまう。
 */
const NOW_SQL = 'now()';

/** ガード式の比較演算子 → SQL の演算子。 */
const SQL_COMPARE_OPS: Readonly<Record<CompareOp, string>> = {
  '==': '=',
  '!=': '<>',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

/**
 * SQL の文字列リテラル(単引用符のエスケープ込み)。
 *
 * enum 値・状態名・ISO 日時のいずれも、型の無い文字列リテラルとして書けば Postgres が
 * 左辺の型に解決する(`state = 'draft'` / `flag = 'true'` / `open_at <= '2026-01-01T00:00:00Z'`)。
 *
 * @param value 生の値
 * @returns 単引用符で囲んだ SQL リテラル
 */
export function sqlLiteral(value: string): string {
  return sqlStringLiteral(value);
}

/** 順序比較の演算子(等値と `in` を除いたもの)。 */
const ORDER_OPS: ReadonlySet<CompareOp> = new Set<CompareOp>(['<', '<=', '>', '>=']);

/** 被演算子 1 つを訳すときの「どの演算に使うか」。値の種別との組み合わせで断る判断に使う。 */
type GuardSqlOp = CompareOp | 'in' | 'is null';

/** その演算が順序比較か(`in` / `is null` は順序を使わない)。 */
function isOrderOp(op: GuardSqlOp): boolean {
  return op !== 'in' && op !== 'is null' && ORDER_OPS.has(op);
}

/** 予約語 `now` の正規化キー。 */
const NOW_KEY = 'now';

/** 文字列の順序を TS(JS のコード単位順)に合わせる照合順序。 */
const CODE_POINT_COLLATION = 'collate "C"';

/**
 * 翻訳が要求する外部の解決(列参照・値の種別・集合メンバーシップ)。
 *
 * どれも**呼び側が与える**。自集約の欄は行の別名の列(`entries.state`)、外部集約の欄は
 * 引数か join した別名の列になり、どちらに落ちるかは呼ぶ文脈が決める。
 */
export interface GuardSqlBindings {
  /**
   * 予約語 `now` を訳す SQL の式(省略すると `now()` = トランザクションの開始時刻)。
   *
   * RPC の本文は行ロックを取った**後**の時刻の変数を与える。ポリシーや CHECK は省略する。
   */
  readonly now?: string;
  /**
   * パス(`{entity}.{field}` / `actor.id` など)→ SQL の式。
   *
   * 戻り値は翻訳器が括弧で包むので、primary でない式(`case … end` 等)を返してもよい。
   *
   * @param path 式に現れたパス(予約語 `now` はここには来ない)
   * @returns SQL の式。写せなければ `null`
   */
  column(path: PathRef): string | null;
  /**
   * パス → その欄の**値の種別**。
   *
   * 順序比較のときに `collate "C"` を付けるか、そもそも翻訳を断るかがこれで決まる。
   * 分からない(`null`)なら**写さない** —— 種別を知らないまま順序比較を実行すると、
   * 照合順序の違いを誰も見ないまま DB だけが別の判定を下す。
   *
   * @param path 式に現れたパス(予約語 `now` はここには来ない)
   * @returns 値の種別。分からなければ `null`
   */
  valueKind(path: PathRef): ValueKind | null;
  /**
   * `path contains ref`(集合メンバーシップ)→ 真偽を返す SQL の式。
   *
   * TS 側は operation が解決済みの boolean を env に載せる契約なので(`containsKey`)、
   * SQL 側も同じく「呼び側が形を知っている」。宣言しなければ `contains` は写せない。
   *
   * @param path 集合側のパス
   * @param ref 要素側のパス
   * @returns SQL の式。写せなければ `null`
   */
  contains?(path: PathRef, ref: PathRef): string | null;
}

/**
 * 翻訳できなかったときの結果(ガード式・ロールに共通)。
 *
 * 2 つを分けて返すのは、直し方が違うからである —— `unresolved` は**呼び側の写像**が足りない
 * (⑳-3 で列写像を足す)、`rejected` は**仕様の式そのもの**が誤っている(V2 が同じ組を
 * error で止める)。1 本の配列に混ぜると、生成が止まった理由が読めなくなる。
 */
export interface SqlTranslationFailure {
  readonly ok: false;
  /** 呼び側の写像が解決できなかったパス・`contains`。 */
  readonly unresolved: readonly string[];
  /** TS の評価器が常に不明にするので翻訳を断った原子(理由つき)。 */
  readonly rejected: readonly string[];
}

/** 翻訳の結果。写せなかったものは名前で返す(生成器は throw しない)。 */
export type GuardSqlResult = { readonly ok: true; readonly sql: string } | SqlTranslationFailure;

/**
 * 3 値の SQL 述語を「不明 → 不成立」の 2 値に閉じる。
 *
 * `where` 句は NULL を偽として扱うので置かなくても行は同じだが、拒否の分類(⑳-3 で
 * `by` の述語とガードの述語を別々に見る)には**全域な真偽**が要る。
 *
 * @param sql 3 値の述語
 * @returns NULL を偽に畳んだ述語
 */
export function totalPredicate(sql: string): string {
  return `coalesce(${sql}, false)`;
}

/** 翻訳の途中経過(写せなかったもの・断ったものを積む)。 */
interface Translation {
  readonly bindings: GuardSqlBindings;
  readonly unresolved: string[];
  readonly rejected: string[];
}

/**
 * ガード式を SQL の述語に翻訳する。
 *
 * @param expr パース済みのガード式
 * @param bindings 列参照・値の種別・`contains` の解決
 * @returns 全域(NULL を返さない)な SQL 述語。写せない / 断ったものがあれば `ok: false`
 */
export function guardToSql(expr: GuardExpr, bindings: GuardSqlBindings): GuardSqlResult {
  const state: Translation = { bindings, unresolved: [], rejected: [] };
  const inner = renderExpr(expr, state);
  const { unresolved, rejected } = state;
  if (unresolved.length > 0 || rejected.length > 0) return { ok: false, unresolved, rejected };
  return { ok: true, sql: totalPredicate(inner) };
}

/** 式を再帰的に字面にする。写せないものは `state` に積む(戻り値は捨てられる)。 */
function renderExpr(expr: GuardExpr, state: Translation): string {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return `(${renderExpr(expr.left, state)} ${expr.kind} ${renderExpr(expr.right, state)})`;
    case 'not':
      return `(not ${renderExpr(expr.operand, state)})`;
    case 'compare':
      return (
        `(${renderOperand(expr.path, expr.op, state)} ${SQL_COMPARE_OPS[expr.op]} ` +
        `${renderRhs(expr.rhs, expr.op, state)})`
      );
    case 'in':
      return `(${renderOperand(expr.path, 'in', state)} in (${expr.values.map(renderLiteral).join(', ')}))`;
    case 'contains':
      return `(${renderContains(expr.path, expr.ref, state)})`;
    case 'null':
      return `(${renderOperand(expr.path, 'is null', state)} is null)`;
  }
}

/**
 * 比較の被演算子 1 つ。予約語 `now` だけはここが解決し、それ以外は呼び側の写像に委ねる。
 *
 * 順序比較のときだけ種別が効く —— text なら照合順序を固定し、boolean / uuid・ref なら断る。
 */
function renderOperand(path: PathRef, op: GuardSqlOp, state: Translation): string {
  const key = pathKey(path);
  if (key === NOW_KEY) return state.bindings.now ?? NOW_SQL;
  const column = state.bindings.column(path);
  const kind = state.bindings.valueKind(path);
  if (column === null || kind === null) {
    state.unresolved.push(key);
    return 'null';
  }
  const reason = rejectReason(kind, op);
  if (reason !== null) {
    state.rejected.push(`${key} ${op}: ${reason}`);
    return 'null';
  }
  if (isOrderOp(op) && kind === 'text') {
    return `(${column} ${CODE_POINT_COLLATION})`;
  }
  return `(${column})`;
}

/**
 * その種別の欄をその演算子で比べると、TS の評価器が**常に不明**にするか。
 *
 * @param kind 欄の値の種別
 * @param op 演算子
 * @returns 断る理由。翻訳してよければ `null`
 */
function rejectReason(kind: ValueKind, op: GuardSqlOp): string | null {
  if (kind === 'boolean' && (op === 'in' || isOrderOp(op))) {
    return 'boolean の欄は == / != でしか比べられません(TS の評価器は常に不明 = 不成立にします)';
  }
  if (kind === 'opaque' && isOrderOp(op)) {
    return 'uuid / ref の欄は順序で比べられません(SQL にも照合順序がありません)';
  }
  return null;
}

/** 比較の右辺(リテラルまたはパス)。 */
function renderRhs(rhs: CompareRhs, op: CompareOp, state: Translation): string {
  return rhs.kind === 'path' ? renderOperand(rhs.path, op, state) : renderLiteral(rhs);
}

/** `contains` を呼び側の解決に委ねる。 */
function renderContains(path: PathRef, ref: PathRef, state: Translation): string {
  const resolved = state.bindings.contains?.(path, ref) ?? null;
  if (resolved === null) {
    state.unresolved.push(`${pathKey(path)} contains ${pathKey(ref)}`);
    return 'null';
  }
  return resolved;
}

/** リテラル(数値はそのまま、それ以外は文字列リテラル)。 */
function renderLiteral(literal: Literal): string {
  return literal.kind === 'number' ? String(literal.value) : sqlLiteral(literal.value);
}
