/**
 * V2 のうち、**読み取り規則(`access_spec` の `reads`)の 2 つの口の接地**を見る部分。
 *
 * `v2-reference-integrity.ts` は参照の整合を、ここは読み取り規則の接地を見る
 * (Finding の verifier はどちらも V2 である)。
 *
 * 見るのは 2 つの口で、**軸が直交していること**がそのまま検査になっている。
 *
 * | 口 | 何を答えるか | ここが見るもの |
 * |---|---|---|
 * | `filters` | 実行者の側の境界(テナント) | 左辺の列が実在し(親の列なら `context` で届き)、右辺の `actor.{欄}` がセッションに載り、両辺の値の種別が同じこと |
 * | `when` | 対象の行の側の判定(状態) | **実行者が現れないこと**(現れたら `filters` の役である)と、**自集約の状態の欄を比べていること** |
 *
 * 式そのものの接地(パスが解決できるか・比較の型が合うか)は `checkExpr` が両方に当てる ——
 * ここが足すのは「その口に書いてよい形か」の 2 点だけである。
 *
 * ## なぜ `when` は「自集約の状態の欄」に閉じているのか(束 §14)
 *
 * `when` を宣言した表の RLS 挙動テストは、**その条件を偽にする行**を world に置いて「返らないこと」を
 * 実行する。その行を決められるのは、条件が**自集約の状態の欄**で書かれているときだけである
 * (状態機械の宣言に状態の全数があるので、偽になる状態を選べる)。時刻(`now`)の比較や親の欄・
 * enum の欄で書かれた条件は**ポリシーだけが生えて、挙動テストが丸ごと消える** —— world を作れない
 * 理由が warning 1 行で既存の T8 の中に埋まるので、**書けなくするほうが姿に合う**
 * (「落ちる検査を設計できない拡張は、書けるようになるだけで守られない」)。
 *
 * 開けるのは、world の側が別の欄でも反例を決められるようになったときである。
 */

import type { GuardExpr } from '../../guard/ast.js';
import type { AccessSpec, EntitySpec, FieldDef, ReadFilter, SourceLocation, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext } from '../../check-api/contract.js';
import { actorFields } from '../../model/path-resolve.js';
import { valueKindOfFieldType } from '../../model/field-values.js';
import type { ReadFilterProblem } from '../../model/read-filter-path.js';
import { readFilterPath, resolveReadFilter } from '../../model/read-filter-path.js';
import { refError as error } from './v2-paths.js';

/** 実行者を指す予約語のルート。 */
const ACTOR_ROOT = 'actor';

/** 現在時刻を指す予約語(`when` には書けない)。 */
const NOW_ROOT = 'now';

/** 状態を決められる比較の演算子(`truthUnder` が読める形と同じ)。 */
const STATE_OPS: readonly string[] = ['==', '!='];

/**
 * `reads[].when`(行の状態で見え方を絞る条件)に**実行者が現れない**ことを見る。
 *
 * 2 つの口が同じことを言えると、同じ境界を `filters` で書いた仕様と `when` で書いた仕様が
 * 生まれ、生成されるポリシーの字面も、境界の見張りテスト(T4)が要求する宣言も変わる ——
 * 「どちらで書いてもよい」は**宣言の正が 2 つある**ということである。したがって実行者の側は
 * `filters` に閉じ、`when` は対象の行の側だけを見る(束 §14)。
 *
 * パースできない式はここでは黙る —— 同じ式を `checkExpr` が既に error で報告している。
 *
 * @param source `when` の生文字列
 * @param owner 誰の宣言か(メッセージの主語)
 * @param location 宣言の位置
 * @param ctx ガード式の解析
 * @returns 違反のリスト(0 件または 1 件)
 */
export function checkReadWhenActor(
  source: string,
  owner: string,
  location: SourceLocation,
  ctx: VerifyContext,
): Finding[] {
  const parsed = ctx.guards.parse(source);
  if (!parsed.ok) return [];
  const actorPaths = ctx.guards
    .collectPaths(parsed.expr)
    .filter((path) => path.segments[0] === ACTOR_ROOT)
    .map((path) => path.segments.join('.'));
  if (actorPaths.length === 0) return [];
  return [
    error(
      `${owner}の when が ${actorPaths.join(' / ')} を参照しています`,
      location,
      '実行者の属性で行を狭めるのは filters の役です(filters: { {列}: actor.{欄} })。' +
        'when に書けるのは対象の行の欄と、context で辿れる親の欄だけ —— ' +
        '同じ境界を 2 つの口で書けると、宣言の正が 2 つになります。',
      { owner, when: source, actor_paths: actorPaths.join(', ') },
    ),
  ];
}

/**
 * `reads[].when` が**自集約の状態の欄**を比べていることを見る(束 §14)。
 *
 * 見るのは 2 つで、どちらも「world が反例の行を決められるか」に直結している。
 *
 * - 時刻(`now`)が現れない —— 時刻は状態ではないので、偽にする行を宣言から選べない。
 * - 自集約の状態の欄を `==` / `!=` / `in` で比べる原子が 1 つ以上ある —— 状態機械の宣言に
 *   状態の全数があるので、偽になる状態を選べる。
 *
 * パースできない式はここでは黙る(`checkExpr` が既に error で報告している)。
 *
 * @param source `when` の生文字列
 * @param owner 誰の宣言か(メッセージの主語)
 * @param entity その集約の entity_spec(状態の欄を引く)
 * @param location 宣言の位置
 * @param ctx ガード式の解析
 * @returns 違反のリスト
 */
export function checkReadWhenShape(
  source: string,
  owner: string,
  entity: EntitySpec | undefined,
  location: SourceLocation,
  ctx: VerifyContext,
): Finding[] {
  const parsed = ctx.guards.parse(source);
  if (!parsed.ok) return [];
  const stateFields = (entity?.fields ?? [])
    .filter((field) => field.type.kind === 'state')
    .map((field) => field.name);
  if (ctx.guards.collectPaths(parsed.expr).some((path) => path.segments[0] === NOW_ROOT)) {
    return [unfalsifiable(owner, source, stateFields, location, 'now')];
  }
  if (comparesState(parsed.expr, entity?.entity ?? '', stateFields)) return [];
  return [unfalsifiable(owner, source, stateFields, location, 'state')];
}

/** 反例の行を決められない条件 1 件。 */
function unfalsifiable(
  owner: string,
  source: string,
  stateFields: readonly string[],
  location: SourceLocation,
  kind: 'now' | 'state',
): Finding {
  const reason =
    kind === 'now'
      ? 'when で時刻(now)は比べられません'
      : 'when は自集約の状態の欄を == / != / in で比べなければなりません';
  return error(
    `${owner}の when "${source}" から「見えない行」を決められません(${reason})`,
    location,
    '可視性の条件は、その条件を**偽にする行**を world に置いて「返らないこと」を実行する' +
      '(そうしないと、条件を落としたポリシーでも挙動テストが緑になる)。偽にする行を宣言から' +
      `選べるのは自集約の状態の欄だけである${
        stateFields.length === 0
          ? '(この集約は状態の欄を持たないので、可視性を状態で絞ることはできない)'
          : `(この集約では ${stateFields.join(' / ')})`
      }。時刻や enum の欄で絞りたいなら、状態機械で表すか、その経路の query_spec の filters で受ける`,
    { owner, when: source, state_fields: stateFields.join(', ') },
  );
}

/** その式が自集約の状態の欄を `==` / `!=` / `in` で比べているか。 */
function comparesState(expr: GuardExpr, entity: string, stateFields: readonly string[]): boolean {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return comparesState(expr.left, entity, stateFields) || comparesState(expr.right, entity, stateFields);
    case 'not':
      return comparesState(expr.operand, entity, stateFields);
    case 'compare':
      return STATE_OPS.includes(expr.op) && isStateField(expr.path.segments, entity, stateFields);
    case 'in':
      return isStateField(expr.path.segments, entity, stateFields);
    default:
      return false;
  }
}

/** `{自集約}.{状態の欄}` か、裸の `{状態の欄}` か。 */
function isStateField(
  segments: readonly string[],
  entity: string,
  stateFields: readonly string[],
): boolean {
  if (segments.length === 1) return stateFields.includes(segments[0] ?? '');
  if (segments.length !== 2) return false;
  return segments[0] === entity && stateFields.includes(segments[1] ?? '');
}

/**
 * `reads[].filters`(実行者の属性で狭める条件)の接地を見る。
 *
 * どれが欠けても宣言が空手形になる。
 *   - 左辺の列が**実在する**こと(綴り違いの列で絞った気になるのを防ぐ)。親の列(`{集約}.{列}`)なら、
 *     その親へ `context` で**届く**こと(`binding` / `when` と同じ探索・同じ 2 段の上限。生成器も同じ道を辿る)
 *   - 右辺の `actor.{欄}` が**セッションに載る欄**であること(`session: true`)。実行計画の先読みは
 *     セッションの写しから引く(DB の判定は写しではなく実行者の行を読む —— `public.actor_{欄}()`)
 *   - 左辺の列と実行者の欄の**値の種別が同じ**であること。RLS は実行者の行の値をそのまま列と比べるので、
 *     種別が違えば migration が当たらないか、暗黙の変換で別の値どうしを比べる
 *
 * これがテナント境界の宣言の唯一の接地点である —— ここが緩いと「会社を跨がない」と書いたのに
 * 生成される RLS のポリシー名にもスコープ条件にも何も現れない、という最悪の形になる(束 ⑲-2a)。
 *
 * @param model ドメイン仕様(列とセッションの欄を引く)
 * @param access その集約のアクセス宣言
 * @returns 違反のリスト
 */
export function checkReadFilters(model: SpecModel, access: AccessSpec): Finding[] {
  const sessionFields = actorFields(model);
  return access.reads.flatMap((rule) =>
    (rule.filters ?? []).flatMap((filter) => {
      const findings: Finding[] = [];
      const left = readFilterPath(filter);
      const resolution = resolveReadFilter(model, access.entity, filter);
      if (!resolution.ok && findEntitySpecOf(model, access.entity) !== null) {
        findings.push(unresolvedFilter(access, rule.by, rule.location, left, resolution.problem));
      }
      if (!sessionFields.has(filter.actorField)) {
        findings.push(
          error(
            `${access.entity} の reads(by: ${rule.by})の filters が actor.${filter.actorField} を参照していますが、` +
              'その欄は session: true を宣言していません',
            rule.location,
            `実行者の集約の ${filter.actorField} に session: true を付けるか、` +
              `session: true を宣言済みの欄(${[...sessionFields].join(' / ')})で絞ってください。` +
              '実行計画の先読みはセッションの写しから実行者の属性を引きます(DB の判定は実行者の行を読みます)。',
            { entity: access.entity, by: rule.by, actor_field: filter.actorField },
          ),
        );
      } else if (resolution.ok) {
        findings.push(...kindMismatch(model, access, rule.by, rule.location, { left, filter, column: resolution.resolved.field }));
      }
      return findings;
    }),
  );
}

/** 左辺を解決できない理由ごとの文面。 */
const UNRESOLVED_REASON: Readonly<Record<ReadFilterProblem, string>> = {
  unknown_entity: 'その集約はありません',
  unreachable: 'その集約へ context で届きません(context に宣言が無い・3 段以上・経路が 2 通りある・自集約の別名で書いている)',
  unknown_field: 'その列はありません',
};

/** 左辺を解決できない 1 件。 */
function unresolvedFilter(
  access: AccessSpec,
  by: string,
  location: SourceLocation,
  left: string,
  problem: ReadFilterProblem,
): Finding {
  return error(
    `${access.entity} の reads(by: ${by})の filters が ${left} で絞っていますが、${UNRESOLVED_REASON[problem]}`,
    location,
    `左辺は ${access.entity} の列(裸の {列})か、context で 2 段まで辿れる親の列({集約}.{列})にしてください。` +
      '親へ届く道は entity_spec の context: が決めます(binding / when と同じ語彙)。' +
      'それより遠い祖先の列で絞るなら、その列を写しの列として近くの集約に持たせてください。',
    { entity: access.entity, by, field: left, problem },
  );
}

/** 境界の左辺と実行者の欄の、値の種別の食い違い(0 件または 1 件)。 */
function kindMismatch(
  model: SpecModel,
  access: AccessSpec,
  by: string,
  location: SourceLocation,
  pair: { readonly left: string; readonly filter: ReadFilter; readonly column: FieldDef },
): Finding[] {
  const actor = actorFieldDef(model, pair.filter.actorField);
  if (actor === null) return [];
  const columnKind = valueKindOfFieldType(pair.column.type);
  const actorKind = valueKindOfFieldType(actor.type);
  if (columnKind === actorKind) return [];
  return [
    error(
      `${access.entity} の reads(by: ${by})の filters は ${pair.left}(${columnKind})を ` +
        `actor.${pair.filter.actorField}(${actorKind})と比べていますが、値の種別が違います`,
      location,
      '境界の列と実行者の欄を同じ種別の型にしてください(参照どうし・文字列どうしなど)。' +
        'RLS は実行者の行の値をそのまま列と比べるので、種別が違うと migration が当たらないか、別の値どうしを比べます。',
      { entity: access.entity, by, field: pair.left, actor_field: pair.filter.actorField, column_kind: columnKind, actor_kind: actorKind },
    ),
  ];
}

/** 実行者の集約の欄(`session: true` の集約。`id` は対象外)。 */
function actorFieldDef(model: SpecModel, name: string): FieldDef | null {
  for (const specs of model.aggregates.values()) {
    const fields = specs.entity?.fields ?? [];
    if (!fields.some((field) => field.session)) continue;
    return fields.find((field) => field.name === name) ?? null;
  }
  return null;
}

/** エンティティ名(または集約名)から entity_spec を引く。 */
function findEntitySpecOf(model: SpecModel, entity: string): EntitySpec | null {
  for (const [aggregate, specs] of model.aggregates) {
    const spec = specs.entity;
    if (spec === undefined) continue;
    if (spec.entity === entity || aggregate === entity) return spec;
  }
  return null;
}
