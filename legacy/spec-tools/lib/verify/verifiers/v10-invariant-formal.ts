/**
 * V10(不変条件の執行)のうち、**formal ブロックの接地**を見る部分。
 *
 * ここが見るのは「不変条件の形式定義そのものが、実在する宣言の上に立っているか」である。
 *
 * - `cardinality.max` の親フィールド参照の実在
 * - `uniqueness` / `cardinality` / `exclusion` の `keys` がその集約のフィールドであること
 * - `exclusion` の `range`(期間の 2 フィールド)が実在し、時間軸の型であること
 * - `where` / `if` / `then` / `expr` のパース可能性と、そこに現れるパス・比較リテラルの接地
 * - `check`(行内制約)の充足性(恒偽 = 保存できない / 恒真 = 効いていない / **判定できなかった
 *   = 黙って通さない**。時間切れは warning・判定器の故障は error。文面は V9 と共有 ——
 *   satisfiability-findings.ts)
 *
 * 「誰が守るのか」(enforced_by)の検査は v10-invariant-enforcement.ts、共有の索引と
 * Finding ファクトリは v10-invariant-index.ts にある。Finding の verifier はすべて V10 である
 * (利用者から見れば 1 つの検査)。
 */

import type { SpecModel, InvariantDef, InvariantFormal } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext } from '../../check-api/contract.js';
import { FORMAL_PARSE, type DomainEnv } from '../../guard/ast.js';
import { ungroundedLiterals } from '../../guard/literal-grounding.js';
import { undecidedText } from '../satisfiability-findings.js';
import { resolveEntityPath } from '../../model/path-resolve.js';
import { DOTTED_REF_PATTERN, finding, type SpecIndex } from './v10-invariant-index.js';
import { checkExclusionRange } from './v10-invariant-exclusion.js';

/** cardinality の max が親フィールド参照(文字列)の場合、その実在を確かめる。 */
function checkCardinalityMax(
  invariant: InvariantDef,
  formal: InvariantFormal | undefined,
  index: SpecIndex,
): Finding | undefined {
  if (formal?.kind !== 'cardinality' || typeof formal.max !== 'string') return undefined;
  const matched = DOTTED_REF_PATTERN.exec(formal.max);
  if (matched === null) {
    return finding(
      invariant,
      `formal.max "${formal.max}" が数値でも "エンティティ名.フィールド名" 形式でもありません`,
      'max には数値リテラル、または親エンティティのフィールド参照(例: workshop.capacity)を書きます',
      { max: formal.max, expected_format: '{entity}.{field}' },
    );
  }
  const [, entityName = '', fieldName = ''] = matched;
  const fields = index.entityFields.get(entityName);
  if (fields === undefined) {
    return finding(
      invariant,
      `formal.max が参照するエンティティ ${entityName} は未定義です`,
      `entity.md に entity: ${entityName} を定義するか、max を実在するエンティティのフィールドへ直してください`,
      { max: formal.max, missing_entity: entityName },
    );
  }
  if (!fields.has(fieldName)) {
    return finding(
      invariant,
      `formal.max が参照するフィールド ${entityName}.${fieldName} は存在しません`,
      `${entityName} の fields に ${fieldName} を追加するか、max を実在するフィールドへ直してください`,
      { max: formal.max, entity: entityName, missing_field: fieldName },
    );
  }
  return undefined;
}

/**
 * `uniqueness` / `cardinality` の `keys`(ユニークキー・group-by キー)が、この不変条件を
 * 持つ集約のエンティティに実在するフィールドかを見る。
 *
 * 綴りが違っても以前は緑のまま通り、「存在しない列でユニークを宣言する」「腐った group-by キーで
 * 定員を数える」が検査をすり抜けていた(Cheers ストレステスト第 3 弾 §3)。
 *
 * @param aggregate 不変条件を持つ集約名(索引はエンティティ名でも集約名でも引ける)
 */
function checkFormalKeys(
  invariant: InvariantDef,
  formal: InvariantFormal | undefined,
  aggregate: string,
  index: SpecIndex,
): Finding[] {
  if (formal?.kind !== 'uniqueness' && formal?.kind !== 'cardinality' && formal?.kind !== 'exclusion') return [];
  const fields = index.entityFields.get(aggregate);
  if (fields === undefined) return [];

  const findings: Finding[] = [];
  for (const key of formal.keys) {
    if (fields.has(key)) continue;
    findings.push(
      finding(
        invariant,
        `formal.keys の ${key} は ${aggregate} のフィールドではありません`,
        `${aggregate} の fields に ${key} を追加するか、keys を実在するフィールド(${[...fields].join(', ')})へ直してください。` +
          'keys に書けるのはこの不変条件が属する集約のエンティティの、裸のフィールド名だけです',
        { keys: formal.keys.join(', '), missing_field: key, entity: aggregate },
      ),
    );
  }
  return findings;
}

/**
 * formal のガード式(expr / where / if / then)に現れるパスが解決できるかを見る。
 *
 * 解決規則はガード式と同じ(自エンティティのフィールド・entity_spec の `context` で辿れる
 * エンティティのフィールド・予約語)。`where` の綴り違いは「制約が誰にも掛からないまま緑」を
 * 生むため、参照の実在をここで落とす。
 *
 * @param aggregate 不変条件を持つ集約名(パス解決の起点)
 */
function checkFormalPaths(
  invariant: InvariantDef,
  model: SpecModel,
  aggregate: string,
  ctx: VerifyContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const [label, source] of formalExpressions(invariant.formal)) {
    const parsed = ctx.guards.parse(source, FORMAL_PARSE);
    if (!parsed.ok) continue;
    for (const path of ctx.guards.collectPaths(parsed.expr)) {
      const resolved = resolveEntityPath(model, aggregate, path, '不変条件の集約');
      if (resolved.kind !== 'error') continue;
      const text = path.segments.join('.');
      findings.push(
        finding(
          invariant,
          `formal.${label} が参照する ${text}: ${resolved.reason}`,
          `${aggregate} の entity_spec に参照先のフィールドを追加するか、context に参照元を宣言してください。` +
            '参照できるのは自エンティティのフィールド・context で解決できるエンティティのフィールド・actor / now だけです',
          { [label]: source, path: text },
        ),
      );
    }
  }
  return findings;
}

/**
 * formal に現れるガード式(expr / where / if / then)を「ラベル → 生文字列」で列挙する。
 *
 * @param formal 不変条件の形式定義(省略された不変条件では undefined)
 * @returns [ラベル, 式] の並び。式を持たない形式定義では空
 */
export function formalExpressions(formal: InvariantFormal | undefined): ReadonlyArray<readonly [string, string]> {
  if (formal === undefined) return [];
  if (formal.kind === 'check') return [['expr', formal.expr]];
  if (formal.kind === 'state_dependency') {
    return [
      ['if', formal.if],
      ['then', formal.then],
    ];
  }
  return formal.where === undefined ? [] : [['where', formal.where]];
}

/**
 * formal のガード式(expr / where / if / then)の比較リテラルが、左辺の値域に実在するかを見る。
 *
 * `where: entry.kind == audiense` は式としても型としても妥当なので、綴りを間違えると
 * **制約が誰にも掛からないまま緑**になる(パス解決だけでは捕まらない)。値域が閉じている
 * 左辺(state / enum / boolean)についてだけ判定できる。判定は lib/guard/literal-grounding.ts。
 *
 * @param env その集約から見た変数ドメイン
 */
function checkFormalLiterals(
  invariant: InvariantDef,
  env: DomainEnv,
  ctx: VerifyContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const [label, source] of formalExpressions(invariant.formal)) {
    const parsed = ctx.guards.parse(source, FORMAL_PARSE);
    if (!parsed.ok) continue;
    for (const literal of ungroundedLiterals(parsed.expr, env)) {
      findings.push(
        finding(
          invariant,
          `formal.${label} が ${literal.path} を ${literal.value} と比べています: ${literal.path} にその値はありません`,
          `${literal.path} が取り得るのは ${literal.allowed.join(' / ')} だけです。` +
            '綴りを直すか、値そのものを宣言(states / enum)に足してください。' +
            '値域に無い値と比べた条件は、制約が誰にも掛からないまま緑になります',
          { [label]: source, path: literal.path, value: literal.value },
        ),
      );
    }
  }
  return findings;
}

/**
 * 反例に witness(判定を実証する変数割当)を混ぜる。
 * 固定キーと衝突する割当は `witness.` を前置して両方を残す。
 */
function mergeWitness(
  base: Record<string, string>,
  witness: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (witness === undefined) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(witness)) {
    merged[key in base ? `witness.${key}` : key] = value;
  }
  return merged;
}

/**
 * kind: check(行内制約)の式が意味を成すかを見る。
 * 恒偽ならどのレコードも保存できず、恒真なら制約として効いていない。判定できなかった式は
 * 報告する(V9 と同じ扱い —— 黙って通すと見落としが緑のまま生き延びる)。
 * パース不能な式は checkFormalExpressions が、値域に無いリテラルを含む式は
 * checkFormalLiterals が報告するので、ここでは扱わない(同じ違反を二重に出さない)。
 */
function checkInlineConstraint(invariant: InvariantDef, env: DomainEnv, ctx: VerifyContext): Finding | undefined {
  if (invariant.formal?.kind !== 'check') return undefined;
  const expr = invariant.formal.expr;
  const parsed = ctx.guards.parse(expr, FORMAL_PARSE);
  if (!parsed.ok) return undefined;
  if (ungroundedLiterals(parsed.expr, env).length > 0) return undefined;

  const result = ctx.guards.satisfiability(parsed.expr, env);
  if (result.verdict === 'unsatisfiable') {
    return finding(
      invariant,
      `行内制約 "${expr}" が恒偽です(どのレコードも保存できなくなる)`,
      '矛盾する比較を取り除くか、意図した条件へ書き直してください。フィールドの取り得る値(enum・状態・min/max)と突き合わせて確認します',
      mergeWitness({ expr, satisfiability: 'unsatisfiable' }, result.witness),
    );
  }
  if (result.verdict === 'tautology') {
    return finding(
      invariant,
      `行内制約 "${expr}" が恒真です(書く意味がない)`,
      '常に成立する条件は制約として効いていません。意図した条件へ書き直すか、この不変条件ごと削除してください',
      mergeWitness({ expr, satisfiability: 'tautology' }, result.witness),
      'warning',
    );
  }
  if (result.verdict === 'unknown') {
    // 判定できなかった式を黙って通すと、恒偽・恒真の見落としが緑のまま生き延びる(V9 と同じ)。
    const text = undecidedText(`行内制約 "${expr}"`, result, { expr });
    return finding(invariant, text.message, text.suggestion, text.counterexample, text.severity);
  }
  return undefined;
}

/** formal 内のガード式がパース可能かを見る。 */
function checkFormalExpressions(invariant: InvariantDef, ctx: VerifyContext): Finding[] {
  const findings: Finding[] = [];
  for (const [label, source] of formalExpressions(invariant.formal)) {
    const parsed = ctx.guards.parse(source, FORMAL_PARSE);
    if (parsed.ok) continue;
    findings.push(
      finding(
        invariant,
        `formal.${label} "${source}" がガード式として解釈できません(${parsed.error.message})`,
        'ガード式の文法(path op literal / path in [...] / path contains ref、括弧・関数呼び出し不可)に合わせて書き直してください',
        { [label]: source, parse_error: parsed.error.message, offset: String(parsed.error.offset) },
      ),
    );
  }
  return findings;
}

/**
 * formal ブロック全体の接地を検査する。
 *
 * @param invariant 検査対象の不変条件
 * @param aggregate 不変条件を持つ集約名(パス解決・keys 判定の起点)
 * @param index モデルの索引
 * @param model ドメイン仕様全体(パス解決に使う)
 * @param env 行内制約の充足性判定に使う、その集約から見た変数ドメイン
 * @param ctx ガードサービス
 * @returns formal に関する Finding(健全なら空)
 */
export function checkFormal(
  invariant: InvariantDef,
  aggregate: string,
  index: SpecIndex,
  model: SpecModel,
  env: DomainEnv,
  ctx: VerifyContext,
): Finding[] {
  const findings: Finding[] = [];
  const maxFinding = checkCardinalityMax(invariant, invariant.formal, index);
  if (maxFinding !== undefined) findings.push(maxFinding);
  findings.push(...checkFormalKeys(invariant, invariant.formal, aggregate, index));
  findings.push(...checkExclusionRange(invariant, invariant.formal, aggregate, model));
  findings.push(...checkFormalExpressions(invariant, ctx));
  findings.push(...checkFormalPaths(invariant, model, aggregate, ctx));
  findings.push(...checkFormalLiterals(invariant, env, ctx));
  const inlineFinding = checkInlineConstraint(invariant, env, ctx);
  if (inlineFinding !== undefined) findings.push(inlineFinding);
  return findings;
}
