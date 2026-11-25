/**
 * ガード式の日本語プリティプリンタ(決定的・LLM 不使用)。
 *
 * ガード式は仕様の正だが `workshop.state == accepting` のままではレビューで意味が読み取れない。
 * ここでは仕様に既にある情報(entity_spec の description / state_spec の label)だけを使って
 * 機械的に日本語へ写す。**辞書に無いものは ID のまま**にし、推測で言葉を足さない
 * (生成物が仕様より多くを主張しないため)。
 *
 * パースは GuardServices(GenerateContext 経由で注入)に任せ、
 * パースできない式は原文をそのまま返す(生成物を壊さない)。
 */

import { FORMAL_PARSE } from '../../guard/ast.js';
import type { CompareOp, CompareRhs, GuardExpr, Literal, PathRef } from '../../guard/ast.js';
import type { SpecModel } from '../../model/types.js';
import type { GenerateContext } from '../../gen-kit/generator.js';

/** 予約語 now の訳。 */
const NOW_JA = '現在時刻';

/** 予約語 actor.id の訳。 */
const ACTOR_SELF_JA = '実行者自身';

/** 比較演算子の記号表記。日本語文中で読めるよう数学記号に寄せる。 */
const OP_JA: Readonly<Record<string, string>> = {
  '==': '=',
  '!=': '≠',
  '<': '<',
  '<=': '≤',
  '>': '>',
  '>=': '≥',
};

/**
 * 日本語化に使う集約横断の辞書。すべて「仕様に書かれている言葉」だけを持つ。
 * 引けなかった項目は ID のまま出す。
 */
export interface GuardJaDict {
  /** フィールドパス(例 "workshop.entry_deadline")→ entity_spec の description。 */
  readonly fields: ReadonlyMap<string, string>;
  /** state 型フィールドのパス(例 "workshop.state")→ 接続先の状態機械名。 */
  readonly stateFields: ReadonlyMap<string, string>;
  /** "{機械}.{状態}"(例 "workshop.accepting")→ state_spec の label。 */
  readonly stateLabels: ReadonlyMap<string, string>;
  /** エンティティ名 → 日本語名。現状の仕様に定義箇所は無く、将来 label が入ったらここに入れる。 */
  readonly entities: ReadonlyMap<string, string>;
}

/**
 * SpecModel から日本語化辞書を組み立てる。
 *
 * - description は entity_spec のフィールド説明をそのまま使う(「(分)」などの補足も落とさない)
 * - 状態の label は state_spec の stateLabels
 *
 * @param model ドメイン仕様全体
 * @param entities エンティティ名 → 日本語名(任意。仕様側に定義箇所ができるまでは呼び出し側が渡す)
 */
export function buildGuardJaDict(
  model: SpecModel,
  entities: ReadonlyMap<string, string> = new Map(),
): GuardJaDict {
  const fields = new Map<string, string>();
  const stateFields = new Map<string, string>();
  const stateLabels = new Map<string, string>();

  for (const specs of model.aggregates.values()) {
    const entity = specs.entity;
    if (entity !== undefined) {
      for (const field of entity.fields) {
        const key = `${entity.entity}.${field.name}`;
        if (field.description !== undefined) fields.set(key, field.description);
        if (field.type.kind === 'state') stateFields.set(key, field.type.machine);
      }
    }
    for (const machine of specs.stateMachines) {
      for (const [state, label] of Object.entries(machine.stateLabels)) {
        stateLabels.set(`${machine.machine}.${state}`, label);
      }
    }
  }

  return { fields, stateFields, stateLabels, entities };
}

/**
 * ガード式を日本語に訳す。
 *
 * @param source ガード式の生文字列
 * @param ctx ガードサービス(パーサー)を持つ生成コンテキスト
 * @param dict 日本語化辞書
 * @param selfEntity ドット無しのパス(access_spec の when に書く `state == draft` など)が
 *   指すエンティティ名。省略するとドット無しパスは辞書を引かず素のまま出す
 * @returns 日本語化した式。パースできない場合は原文そのまま
 */
export function guardToJapanese(
  source: string,
  ctx: GenerateContext,
  dict: GuardJaDict,
  selfEntity?: string,
): string {
  // 訳すだけの口なので、不変条件の `formal`(`is null` を書ける唯一の場所)も読める側で開ける。
  const result = ctx.guards.parse(source, FORMAL_PARSE);
  const scope: Scope = selfEntity === undefined ? { dict } : { dict, selfEntity };
  return result.ok ? expr(result.expr, scope) : source;
}

/** 訳出中に持ち回る文脈。辞書と、ドット無しパスの補完先エンティティ。 */
interface Scope {
  readonly dict: GuardJaDict;
  readonly selfEntity?: string;
}

/** 式ノードを訳す。and/or は原文の結合順のまま並べる(文法上 or が and の子に来ないため曖昧にならない)。 */
function expr(node: GuardExpr, scope: Scope): string {
  switch (node.kind) {
    case 'and':
      return `${expr(node.left, scope)} かつ ${expr(node.right, scope)}`;
    case 'or':
      return `${expr(node.left, scope)} または ${expr(node.right, scope)}`;
    case 'not':
      // `not in` / `is not null` は、否定を外側に出さず 1 つの言い回しに畳む
      // (「… のいずれでもない」「… が空でない」)。
      if (node.operand.kind === 'in') {
        return inclusion(node.operand.path, node.operand.values, scope, false);
      }
      if (node.operand.kind === 'null') return emptiness(node.operand.path, scope, false);
      return `${expr(node.operand, scope)} でない`;
    case 'compare':
      return comparison(node.path, node.op, node.rhs, scope);
    case 'in':
      return inclusion(node.path, node.values, scope, true);
    case 'contains':
      return `${term(node.path, scope)} に ${term(node.ref, scope)} が含まれる`;
    case 'null':
      return emptiness(node.path, scope, true);
  }
}

/**
 * 「空かどうか」の訳。辞書は比較と同じく欄の description だけを引く。
 *
 * @param path 空かどうかを問う欄
 * @param scope 訳出の文脈
 * @param empty 真なら `is null`、偽なら `is not null`
 * @returns 「… が空である」「… が空でない」
 */
function emptiness(path: PathRef, scope: Scope, empty: boolean): string {
  return `${term(path, scope)} が${empty ? '空である' : '空でない'}`;
}

/** 比較。右辺がリテラルなら左辺のドメイン(state 型かどうか)に合わせて訳す。 */
function comparison(path: PathRef, op: CompareOp, rhs: CompareRhs, scope: Scope): string {
  const right = rhs.kind === 'path' ? term(rhs.path, scope) : value(rhs, path, scope);
  return `${term(path, scope)} ${OP_JA[op] ?? op} ${right}`;
}

/** in / not in。値は「A / B」で並べる。 */
function inclusion(
  path: PathRef,
  values: readonly Literal[],
  scope: Scope,
  positive: boolean,
): string {
  const list = values.map((literal) => value(literal, path, scope)).join(' / ');
  return `${term(path, scope)} が ${list} ${positive ? 'のいずれか' : 'のいずれでもない'}`;
}

/**
 * 辞書を引くキー。ドット無しのパスは selfEntity で補う
 * (access_spec の when は自エンティティのフィールドを裸で書くため)。
 */
function dictKey(path: PathRef, scope: Scope): string {
  const key = path.segments.join('.');
  if (path.segments.length > 1 || scope.selfEntity === undefined) return key;
  return `${scope.selfEntity}.${key}`;
}

/**
 * パス参照の訳。優先順位は
 * 予約語(now / actor)> description > state 型の既定訳(「{エンティティ}の状態」)> パスのまま。
 */
function term(path: PathRef, scope: Scope): string {
  const raw = path.segments.join('.');
  if (raw === 'now') return NOW_JA;
  if (path.segments[0] === 'actor') {
    return raw === 'actor.id' ? ACTOR_SELF_JA : `実行者の${path.segments.slice(1).join('.')}`;
  }

  const key = dictKey(path, scope);
  const description = scope.dict.fields.get(key);
  if (description !== undefined) return description;
  if (scope.dict.stateFields.has(key)) {
    const entity = key.split('.')[0] ?? key;
    return `${scope.dict.entities.get(entity) ?? entity}の状態`;
  }
  return raw;
}

/** リテラルの訳。左辺が state 型フィールドのときだけ状態 label に置き換える。 */
function value(literal: Literal, path: PathRef, scope: Scope): string {
  if (literal.kind === 'number') return String(literal.value);
  const machine = scope.dict.stateFields.get(dictKey(path, scope));
  if (machine === undefined) return literal.value;
  return scope.dict.stateLabels.get(`${machine}.${literal.value}`) ?? literal.value;
}
