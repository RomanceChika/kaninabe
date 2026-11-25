/**
 * T16 の警告が出た**理由の区分**(`Finding.reason` に載せる閉じた語)と、その判定。
 *
 * T16 の警告には理由の違うものが混ざる。拡張候補の台帳(`lib/extension`)は「仕組みが組めないもの」と
 * 「製品が直せるもの」を分けて数えたいので、読む側が反例の欄から推定するのではなく、**検査が理由を明示の欄で
 * 載せる**(`Finding.reason`)。語の意味はここが正で、絞りの鍵(`extension/scope.ts`)はこの語を読む。
 *
 * 純関数と定数だけ。**アプリの語彙は 1 語も持たない。**
 */

import { parseFormalGuard } from '../guard/parser.js';
import { collectPaths } from '../guard/services.js';
import { SATISFIABLE_FORMALS } from '../world/index.js';

/** T16 の警告の理由(値は `Finding.reason` にそのまま入る)。 */
export const T16_REASONS = {
  /** 宣言した執行点が実在せず、その条件の形式定義が DSL の写像の外(数の上限・状態依存・形式定義なし)で、執行点はトリガである。 */
  triggerFormalInexpressible: 'trigger_formal_inexpressible',
  /**
   * 宣言した執行点が実在せず、執行点はトリガで、形式定義は `check` だが式が**自集約以外の集約の欄**を参照する
   * (行の CHECK に写せない。写像の外ではなく「別の集約の欄との一致」という 1 つの形)。
   */
  crossAggregateCheck: 'cross_aggregate_check',
  /** 宣言した執行点が実在しない(上のどの理由にも当たらない = 写せる形式定義なのに宣言していない・トリガ以外の執行点)。 */
  enforcementUndeclared: 'enforcement_undeclared',
  /** 行の CHECK の式を DDL に反映できない。 */
  checkNotReflected: 'check_not_reflected',
} as const;

/**
 * T17 の警告の理由(値は `Finding.reason` にそのまま入る。点検 21 回目 C21-4)。
 *
 * トリガが不変条件を名指すのに、宣言の条件をトリガの本文と照らせない(`sql/trigger-condition-words.ts`)理由である。
 * 拡張候補の台帳は「形式定義が DSL の外 = 仕組みが読めない」(`conditionNoFormal`。不変条件が理由 `formal_outside` を宣言したものだけ)を宿題として数え、
 * それ以外(不変条件が無い・一意や排他に名指した・式が読めない・語も列も無い)は製品が直せる側として未分類に落とす。
 */
export const T17_REASONS = {
  /** トリガが名指した不変条件が見つからない。 */
  conditionMissingInvariant: 'trigger_condition_missing_invariant',
  /** 名指した不変条件が形式定義を持たず、DSL の外である理由を宣言している(`formal_outside`。拡張候補の宿題)。 */
  conditionNoFormal: 'trigger_condition_no_formal',
  /** 名指した不変条件が形式定義も、DSL の外である理由(`formal_outside`)も持たない(書けるのに書いていないと区別できない。点検 22 回目 C22-3)。 */
  conditionFormalMissing: 'trigger_condition_formal_missing',
  /** 形式定義の種類が語に割れない(一意・排他。執行点は索引・排他制約のはず)。 */
  conditionKindOutside: 'trigger_condition_kind_outside',
  /** 形式定義の式が読めない。 */
  conditionUnparsable: 'trigger_condition_unparsable',
  /** 形式定義から語も列も出ない(照らせるものが 1 つも無い)。 */
  conditionNoWords: 'trigger_condition_no_words',
} as const;

/**
 * 実在しない執行点の警告の理由を決める。
 *
 * 形式定義が行内比較・一意・排他(T8 / T11 と同じ軸 `SATISFIABLE_FORMALS`)に写せないトリガは仕組みが組めない側、
 * `check` なのに式が別の集約の欄を見るトリガは「別の集約の欄との一致」の側、
 * 写せるのに宣言が無いもの・トリガ以外の執行点は製品が直せる側である。
 *
 * @param kind 執行点の種類(`enforced_by` の `kind`)
 * @param formal 不変条件の形式定義の種別(形式定義が無ければ空文字)
 * @param crossesAggregates 形式定義の式が自集約以外の集約の欄を参照するか(`referencesOtherAggregate`)
 * @param outsideDeclared 形式定義が無いとき、DSL の外である理由(`formal_outside`)を宣言しているか(点検 22 回目 C22-3。
 *   宣言の無い「形式定義なし」は書けるのに書いていないと区別できないので、製品が直せる側に倒す)
 * @returns 理由の語
 */
export function groundingReasonOf(kind: string, formal: string, crossesAggregates: boolean, outsideDeclared: boolean): string {
  if (kind !== 'trigger') return T16_REASONS.enforcementUndeclared;
  if (formal === '' && !outsideDeclared) return T16_REASONS.enforcementUndeclared;
  if (formal === 'check' && crossesAggregates) return T16_REASONS.crossAggregateCheck;
  const inexpressible = !SATISFIABLE_FORMALS.some((satisfiable) => satisfiable === formal);
  return inexpressible ? T16_REASONS.triggerFormalInexpressible : T16_REASONS.enforcementUndeclared;
}

/**
 * 形式定義(`check`)の式が、自集約以外の集約の欄を参照しているか。
 *
 * 欄の根(パスの先頭の語)が自集約の名前(集約ディレクトリ名・エンティティ名)の外にあれば、別の集約の欄を
 * 見ている。ただし**語が 2 つ以上のパス(`{集約}.{欄}`)だけ**を数える —— `now` のような 1 語のパスや、集約名の
 * 付かない裸の欄(`closed_on > opened_on`)は「別の集約の欄」ではなく、予約語か書き間違い(欄の実在は別の検査が
 * 止める)である。式をパースできなければ false(読めない式は別の検査が止める)。
 *
 * @param expr 形式定義の式(生文字列)
 * @param ownNames 自集約を指す綴りの集合(集約ディレクトリ名とエンティティ名)
 * @returns 別の集約の欄を 1 つでも参照していれば true
 */
export function referencesOtherAggregate(expr: string, ownNames: ReadonlySet<string>): boolean {
  const parsed = parseFormalGuard(expr);
  if (!parsed.ok) return false;
  return collectPaths(parsed.expr).some(
    (path) => path.segments.length >= 2 && !ownNames.has(path.segments[0] ?? ''),
  );
}
