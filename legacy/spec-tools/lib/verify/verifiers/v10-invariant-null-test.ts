/**
 * V10(不変条件の執行)のうち、**「空かどうか」を問える欄か**を見る部分(束 ㉒)。
 *
 * `is null` / `is not null` は不変条件の `formal` にだけ書ける語である(置き場の規則そのものは
 * パースの段で閉じている —— 設計: docs/design/null-literal-purchase.md)。ここが見るのは
 * **書ける場所に書かれた式の、左辺が空になりうる欄か**である。
 *
 * 空にならない欄(`required: true` / `auto` / `state(...)`)に書くと、
 *
 * - `x is null` は**決して成立しない**(条件が 1 行まるごと死ぬ)
 * - `x is not null` は**常に成立する**(制約として何も効かない)
 *
 * のどちらかになる。どちらも「書けるが、書いた条件が意図どおりに働かない」形であり、
 * 綴り違いのリテラル(V2 / checkFormalLiterals)と同じ族の誤りである。
 *
 * **severity は error である。この誤りを捕るのはここ 1 本しかない。**
 * `check` の充足性判定(checkInlineConstraint)は**この形を捕らない** —— 判定器は
 * 「空かどうか」を欄ごとの**自由な真偽値**として扱い、`required` を 1 度も見ないので、
 * `doc.title is null` は必須の欄でも `satisfiable` のままである(実測。`satisfiability-plan.ts`
 * が `null` 原子に順序制約も値域の制約も張らない)。恒偽と読めるのは
 * `x is null and x == v` のように**同じ式の中で矛盾している**ときだけである。
 *
 * error で止める理由はもう 1 つある。world の組み立て(`rls-world-empty.ts` →
 * `rls-world-rows.ts`)は `required` を見ずに「空にする欄」の供給を飛ばすので、必須の欄に
 * `is null` を書いた仕様は **NOT NULL 違反で落ちる world の設計図**を生む。警告のまま通すと、
 * それが 40 件の warning に紛れて生成まで届く。
 */

import type { GuardExpr, GuardServices } from '../../guard/ast.js';
import { FORMAL_PARSE } from '../../guard/ast.js';
import { canBeEmpty, type InvariantDef, type SpecModel } from '../../model/types.js';
import { resolveEntityPath } from '../../model/path-resolve.js';
import type { Finding } from '../../kernel/finding.js';
import { finding } from './v10-invariant-index.js';
import { formalExpressions } from './v10-invariant-formal.js';

/** 式に現れる `is null` の左辺パスを、出現順に(重複なく)集める。 */
function nullTestPaths(expr: GuardExpr): readonly string[] {
  const found = new Set<string>();
  const walk = (node: GuardExpr): void => {
    switch (node.kind) {
      case 'and':
      case 'or':
        walk(node.left);
        walk(node.right);
        return;
      case 'not':
        walk(node.operand);
        return;
      case 'null':
        found.add(node.path.segments.join('.'));
        return;
      default:
        return;
    }
  };
  walk(expr);
  return [...found];
}

/**
 * その欄が空になりうるか。
 *
 * 解決できないパス(綴り違い・context で辿れない)はここでは何も言わない ——
 * 参照の実在は checkFormalPaths が error で報告するので、同じ 1 つの誤りに 2 件出さない。
 *
 * @param model ドメイン仕様全体
 * @param aggregate 不変条件を持つ集約(パス解決の起点)
 * @param path 左辺のパス
 * @returns 空になりうるなら true。判断できなければ true(黙って警告しない側へ倒す)
 */
function emptiable(model: SpecModel, aggregate: string, path: string): boolean {
  const resolved = resolveEntityPath(model, aggregate, { segments: path.split('.') }, '不変条件の集約');
  if (resolved.kind !== 'field') return true;
  for (const specs of model.aggregates.values()) {
    const entity = specs.entity;
    if (entity?.entity !== resolved.entity) continue;
    const field = entity.fields.find((candidate) => candidate.name === resolved.field);
    return field === undefined || canBeEmpty(field);
  }
  return true;
}

/**
 * `formal` に書かれた「空かどうか」の左辺が、空になりうる欄かを検査する。
 *
 * @param invariant 検査対象の不変条件
 * @param model ドメイン仕様全体
 * @param aggregate 不変条件を持つ集約名(パス解決の起点)
 * @param guards ガード式のパースを担うサービス
 * @returns 空にならない欄を問うている箇所の Finding(健全なら空)
 */
export function checkNullTests(
  invariant: InvariantDef,
  model: SpecModel,
  aggregate: string,
  guards: GuardServices,
): Finding[] {
  const findings: Finding[] = [];
  for (const [label, source] of formalExpressions(invariant.formal)) {
    const parsed = guards.parse(source, FORMAL_PARSE);
    if (!parsed.ok) continue;
    for (const path of nullTestPaths(parsed.expr)) {
      if (emptiable(model, aggregate, path)) continue;
      findings.push(
        finding(
          invariant,
          `formal.${label} が ${path} の「空かどうか」を問うていますが、${path} は空にならない欄です`,
          `${path} を任意の欄にする(entity.md の required を外す)か、この条件を状態や値の比較で書き直してください。` +
            '空にならない欄では is null は決して成立せず、is not null は常に成立します(どちらも条件が意図どおりに働きません)',
          { [label]: source, path },
        ),
      );
    }
  }
  return findings;
}
