/**
 * 不変条件の `formal` → **行の CHECK 制約の式**への写像(純関数)。
 *
 * `checks[]` の行が `invariant` だけを宣言しているとき、その条件式の正は invariant_spec に
 * ある。ここはそれを DDL に反映する写像であり、反映できない式については**反映できない理由**を
 * 名前で返す(生成器は throw しない。理由を報告するのは T16)。
 *
 * ## 意味の正は `guardToSql` である
 *
 * 写せるかどうかの判定は**翻訳器に聞く** —— `guardToSql` を同じ写像で呼び、`ok: false`
 * (呼び側の写像が足りない / TS の評価器が常に不明にするので断った)ならそのまま理由になる。
 * 判定を 2 か所に書くと、片方だけが直る。
 *
 * ## それでも字面は自分で作る
 *
 * 突合(`ddl-parity`)も冪等の判定(`ddl-migration.ts` の定義一致ガード)も、
 * `pg_get_constraintdef` の出力と**文字列で**比べる。`guardToSql` が返すのは「流せる SQL」
 * であって Postgres の正準表記ではないので、印字は自分で持つ —— **その印字器は
 * `check-printer.ts` にある**(ここが持つのは「写せるか / 写せないならなぜか」の判定、あちらが持つのは字面である)。
 * 字面の実測は `__tests__/unit/sql/check-expression.test.ts`。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr, PathRef } from '../guard/ast.js';
import { pathKey } from '../guard/atoms.js';
import { collectPaths } from '../guard/services.js';
import { valueKindOfFieldType } from '../model/field-values.js';
import type { EntitySpec, FieldDef, InvariantDef, SpecModel } from '../model/types.js';
import { formalExpr } from '../model/formal-expr.js';
import { guardToSql } from './guard-to-sql.js';
import { renderCheck } from './check-printer.js';

/**
 * 列に付ける別名(既定は無し)。
 *
 * 行の CHECK は 1 行の中にいるので**別名は付かない** —— そこが既定である。別名が要るのは
 * **トリガの本文**に同じ式を置くときだけで、plpgsql では裸の列名が解決しない(`new.{列}` /
 * `{別名}.{列}` と書く)。字面が変わるのはここだけなので、`pg_get_constraintdef` と
 * 突き合わせる側(`prove:checks` / `ddl-parity`)は既定のまま呼ぶ。
 */
export interface CheckExpressionOptions {
  readonly alias?: string;
  /**
   * 式が読んでよい**もう 1 つの集約**(別の集約の欄との一致を、結合したトリガの本文で見るとき)。
   *
   * 行の CHECK は 1 行しか見られないので、これを渡すのはトリガの本文だけである(`ddl-cross-check-body.ts` は 1 つ、
   * 参照の欄が指す行を読む条件 `ddl-ref-check-body.ts` は 1 つ以上。T16 は渡さない = 別の集約の欄を含む式は「CHECK に写せない」と
   * 報告され続ける)。相手の欄には `alias` とは別の別名が付く。
   */
  readonly related?: { readonly entity: EntitySpec; readonly alias: string } | readonly { readonly entity: EntitySpec; readonly alias: string }[];
  /**
   * `state_dependency` を `not (前提) or (帰結)` と読んで写すか(既定は写さない = 行の CHECK には置けない。参照の欄が指す行を読む
   * トリガの本文だけが渡す。fix25s)。
   */
  readonly implication?: boolean;
}

/** 写像の結果(写せたら正準表記の式、写せなければ理由)。 */
export type CheckExpressionResult =
  | { readonly ok: true; readonly expression: string }
  | { readonly ok: false; readonly reason: string };

/** 予約語 `now` の正規化キー。 */
const NOW_KEY = 'now';

/**
 * 不変条件 1 本を、その表の CHECK 制約の式に写す。
 *
 * @param invariantId 由来の不変条件 ID(`checks[].invariant`)
 * @param entity その表の集約(列の正。参照してよい欄はここにあるものだけ)
 * @param domain ドメイン仕様(不変条件を引く)
 * @param options 列に付ける別名(トリガの本文に置くときだけ)
 * @returns 正準表記の式、または写せない理由
 */
export function checkExpressionOf(
  invariantId: string,
  entity: EntitySpec,
  domain: SpecModel,
  options: CheckExpressionOptions = {},
): CheckExpressionResult {
  const invariant = findInvariant(invariantId, domain);
  if (invariant === null) return { ok: false, reason: `不変条件 ${invariantId} は実在しません` };
  const formal = invariant.formal;
  if (formal === undefined) {
    return { ok: false, reason: 'formal がありません(条件式が仕様のどこにも無いので反映できません)' };
  }
  const implied = formal.kind === 'state_dependency' && options.implication === true;
  if (formal.kind !== 'check' && !implied) {
    return {
      ok: false,
      reason:
        `formal.type: ${formal.kind} は行の CHECK に写せません` +
        '(uniqueness は一意索引・exclusion は排他制約・cardinality と state_dependency はトリガが執行点です)',
    };
  }
  const parsed = formalExpr(formal);
  if (!parsed.ok) return { ok: false, reason: `formal.expr をパースできません(${parsed.error.message})` };
  const own = fieldIndex(entity, aggregateOf(entity, domain));
  const relateds = options.related === undefined ? [] : Array.isArray(options.related) ? options.related : [options.related as { readonly entity: EntitySpec; readonly alias: string }];
  const relatedAlias = new Map<string, string>();
  for (const related of relateds) {
    for (const key of fieldIndex(related.entity, aggregateOf(related.entity, domain)).keys()) relatedAlias.set(key, related.alias);
  }
  const relatedFields = relateds.length === 0 ? null : new Map(relateds.flatMap((related) => [...fieldIndex(related.entity, aggregateOf(related.entity, domain))]));
  const fields: ReadonlyMap<string, FieldDef> =
    relatedFields === null ? own : new Map([...relatedFields, ...own]);
  const grounded = groundingProblem(parsed.expr, fields);
  if (grounded !== null) return { ok: false, reason: grounded };
  const translated = guardToSql(parsed.expr, {
    column: (path) => (fields.get(pathKey(path)) === undefined ? null : lastSegment(path)),
    valueKind: (path) => {
      const field = fields.get(pathKey(path));
      return field === undefined ? null : valueKindOfFieldType(field.type);
    },
  });
  if (!translated.ok) {
    const problems = [...translated.unresolved, ...translated.rejected];
    return { ok: false, reason: `SQL に写せません(${problems.join(' / ')})` };
  }
  const literal = literalProblem(parsed.expr, fields);
  if (literal !== null) return { ok: false, reason: literal };
  const aliasOf =
    relatedFields === null
      ? options.alias
      : (key: string): string | undefined => (own.has(key) ? options.alias : relatedAlias.get(key));
  return { ok: true, expression: `COALESCE(${renderCheck(parsed.expr, fields, aliasOf)}, false)` };
}

/** 不変条件 1 本を引く(どの集約に住んでいるかは問わない)。 */
function findInvariant(id: string, domain: SpecModel): InvariantDef | null {
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (invariant.id === id) return invariant;
    }
  }
  return null;
}

/**
 * **その集約自身の**ディレクトリ名(entity_spec を持つ集約を引き当てる)。
 *
 * 不変条件が住む集約ではない。**そこを取り違えると、別の集約を指すパスが自分の列に
 * 化ける** —— `child.tenant_id == parent.tenant_id` を `parents` の表で写したとき、
 * 「不変条件が住む集約」(= `child`)を綴りの別名に入れてしまうと `child.tenant_id` が
 * `parents.tenant_id` に解決し、**列を自分自身と比べる恒真の CHECK** が生まれる
 * (`prove:checks` の実測で見つかった)。
 */
function aggregateOf(entity: EntitySpec, domain: SpecModel): string {
  for (const [aggregate, specs] of domain.aggregates) {
    if (specs.entity?.entity === entity.entity) return aggregate;
  }
  return entity.entity;
}

/**
 * その式が参照してよい欄の索引(`{集約名}.{欄}` → 欄)。
 *
 * 鍵に集約ディレクトリ名とエンティティ名の**両方**を入れるのは、`formal` が書くのが
 * どちらの綴りでもよいからである(`findEntitySpec` と同じ規則)。**どちらもその集約自身の
 * 綴りでなければならない**(`aggregateOf` の docstring)。
 */
function fieldIndex(entity: EntitySpec, aggregate: string): ReadonlyMap<string, FieldDef> {
  const names = new Set<string>([entity.entity, aggregate]);
  const index = new Map<string, FieldDef>();
  for (const field of entity.fields) {
    for (const name of names) index.set(`${name}.${field.name}`, field);
  }
  return index;
}

/** パスの末尾(= 列名)。 */
function lastSegment(path: PathRef): string {
  return path.segments[path.segments.length - 1] ?? '';
}

/**
 * 行の CHECK に**置けない参照**があればその理由(無ければ null)。
 *
 * 行の CHECK が見られるのはその 1 行だけである。別集約の欄は結合しないと読めず、
 * `now` は不変(IMMUTABLE)ではないので Postgres 自身が制約に置かせない。
 *
 * **この判定はトリガの本文の生成(`ddl-check-triggers.ts`)とも共有している**ので、理由の字面は
 * 「トリガなら書ける」と読める書き方にしない —— トリガの本文も同じ判定で反映されず、そのときは
 * T17 が `handwritten` を要求する(束 ㉖ の独立レビュー D4′)。
 */
function groundingProblem(expr: GuardExpr, fields: ReadonlyMap<string, FieldDef>): string | null {
  if (hasContains(expr)) {
    return 'contains(集合の参照)は行の CHECK に写せません(集合の解決は呼び側が与えるものです)';
  }
  for (const path of collectPaths(expr)) {
    const key = pathKey(path);
    if (key === NOW_KEY) {
      return (
        'now を参照しています(行の CHECK に書けるのは不変な式だけです。' +
        'トリガの本文もこの判定を共有するので反映されません —— 執行点は手書きになります)'
      );
    }
    if (fields.has(key)) continue;
    const root = path.segments[0] ?? '';
    return `${key} はこの表の欄ではありません(行の CHECK は 1 行しか見られないので、別の集約 ${root} の欄は読めません)`;
  }
  return null;
}

/** 式のどこかに `contains` があるか。 */
function hasContains(expr: GuardExpr): boolean {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return hasContains(expr.left) || hasContains(expr.right);
    case 'not':
      return hasContains(expr.operand);
    case 'contains':
      return true;
    default:
      return false;
  }
}

/**
 * **リテラルの字面を先に決められない比較**があればその理由(無ければ null)。
 *
 * 日時・日付の欄にリテラルを書くと、Postgres は正準表記へ書き換えたうえに**サーバーの
 * TimeZone 設定に依る**形で印字する(`'2026-01-01T00:00:00Z'` → `'2026-01-01 00:00:00+00'`)。
 * 字面で突き合わせる以上、こちらが先に決められない値を生成物に置くわけにはいかない ——
 * 欄どうしの比較(`a < b`)は cast が付かないので書ける。
 */
function literalProblem(expr: GuardExpr, fields: ReadonlyMap<string, FieldDef>): string | null {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return literalProblem(expr.left, fields) ?? literalProblem(expr.right, fields);
    case 'not':
      return literalProblem(expr.operand, fields);
    case 'compare':
      return expr.rhs.kind === 'path' ? null : temporalLiteral(expr.path, fields);
    case 'in':
      return temporalLiteral(expr.path, fields);
    default:
      return null;
  }
}

/** 日時・日付の欄をリテラルと比べていたらその理由。 */
function temporalLiteral(path: PathRef, fields: ReadonlyMap<string, FieldDef>): string | null {
  const kind = fields.get(pathKey(path))?.type.kind;
  if (kind !== 'date' && kind !== 'datetime') return null;
  return (
    `${pathKey(path)} を日時のリテラルと比べています` +
    '(DB がリテラルを正準表記へ書き換えるので、生成物の字面を先に決められません。欄どうしの比較なら書けます)'
  );
}
