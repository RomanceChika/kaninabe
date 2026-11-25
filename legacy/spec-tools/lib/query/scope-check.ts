/**
 * 「あるロールが、あるエンティティを、宣言どおりのスコープで読めるか」の検査。
 *
 * Q2(source の scope_used)と Q5(includes の scope_used)は同じ問いを別の対象に対して
 * 行うため、判定と指摘の文面をここに 1 箇所だけ置く。
 * 検査の正は query-spec-writing.md の Q2 / Q5。
 *
 * 突き合わせ先は 2 通りある。
 * - `via` が無い … `for` のロール自身の `reads` 宣言(従来どおり)
 * - `via` がある … `via` に書かれた関係ロールの宣言を**借りる**(query-spec-writing.md §via)。
 *   借用は 3 条件を満たすときだけ成立し、満たさないものはすべて違反として指摘する。
 */

import type { AccessSpec, ReadScope, SourceLocation, SpecModel } from '../model/types.js';
import { impliedRoles } from '../model/role-hierarchy.js';
import { makeFinding, type Finding } from '../kernel/finding.js';
import type { QueryVia } from '../model/query/types.js';
import {
  findReadRule,
  hasRole,
  isContextRole,
  listRoleIds,
  sameScope,
  scopeText,
} from '../semantics/domain-lookup.js';

/** checkRoleScope の引数。 */
export interface RoleScopeCheck {
  /** 指摘に付ける検証器 ID("Q2" / "Q5")。 */
  readonly verifier: string;
  readonly domain: SpecModel;
  /** 対象エンティティの access_spec。 */
  readonly access: AccessSpec;
  /** 検査するロール ID(`for` の 1 つ)。 */
  readonly role: string;
  /** 可視性を供給する関係ロール(宣言されていれば)。 */
  readonly via?: QueryVia;
  /** query_spec が宣言したスコープ。 */
  readonly scopeUsed: ReadScope;
  /** 対象エンティティ名(メッセージ用)。 */
  readonly entity: string;
  /** 宣言のキー名(メッセージ用。"scope_used" / "includes.{entity}.scope_used")。 */
  readonly label: string;
  /** 指摘の位置。 */
  readonly location: SourceLocation;
  /** クエリ名(反例用)。 */
  readonly query: string;
}

/**
 * 1 ロール分のスコープ整合を検査する。
 *
 * `via` が無いときに見るのは 4 つ。① ロールが roles.md に実在するか ② そのエンティティの
 * `reads` に宣言があるか ③ その宣言が `none`(読めない)でないか ④ 宣言が `scope_used` と
 * 一致するか。`via` があるときは ②〜④ を借用の規則(checkBorrowed)に差し替える。
 *
 * @param check 検査対象と指摘の材料
 * @returns 違反のリスト。整合していれば空
 */
export function checkRoleScope(check: RoleScopeCheck): Finding[] {
  const { role, location, query } = check;
  if (!hasRole(check.domain, role)) {
    return [
      makeFinding(check.verifier, {
        message: `for のロール ${role} は roles.md にありません`,
        location,
        suggestion:
          `roles.md の roles に ${role} を追加するか、既存のロール(${listRoleIds(check.domain).join(', ')})へ直す`,
        counterexample: { query, role },
      }),
    ];
  }
  return check.via === undefined ? checkDirect(check) : checkBorrowed(check, check.via);
}

/** `via` が無い場合 — for のロール自身の宣言と突き合わせる。 */
function checkDirect(check: RoleScopeCheck): Finding[] {
  const { role, entity, label, location, query } = check;
  const rule = findReadRule(check.access, role);
  if (rule === null) {
    return [
      makeFinding(check.verifier, {
        message: `${entity} の access_spec にロール ${role} の reads 宣言がありません`,
        location,
        suggestion:
          `specs/domain/${entity}/access.md の reads に "- by: ${role}" と scope を追加する` +
          '(reads は全ロールについて明示必須)',
        counterexample: { query, role, entity },
      }),
    ];
  }

  if (rule.scope.kind === 'none') {
    return [
      makeFinding(check.verifier, {
        message: `ロール ${role} は ${entity} を読めません(reads の scope が none)`,
        location,
        suggestion:
          `${role} 自身では読めないので、可視性を供給する関係ロールを via に書く` +
          `(例: via: {関係ロール})。関係ではなく ${role} 全員に見せてよいなら ` +
          `specs/domain/${entity}/access.md の reads を先に直す(可視性の正は access_spec)`,
        counterexample: { query, role, entity, scope: 'none' },
      }),
    ];
  }

  if (sameScope(rule.scope, check.scopeUsed)) return [];
  return [
    makeFinding(check.verifier, {
      message: `${label} が ${role} の reads 宣言と一致しません`,
      location,
      suggestion:
        `${label} を ${scopeText(rule.scope)} に直すか、可視性を供給する関係ロールを via に書く。` +
        'スコープの違うロールを 1 本のクエリに混ぜない(別のクエリに分ける)',
      counterexample: {
        query,
        role,
        entity,
        declared: scopeText(rule.scope),
        used: scopeText(check.scopeUsed),
      },
    }),
  ];
}

/**
 * `via` がある場合 — 関係ロールの宣言を借りられるかを検査する。
 *
 * 借用の条件(query-spec-writing.md §via):
 * ⓪ `via` が文脈依存ロール(`binding` を持つ)であること — 借りるのは「関係」であり、
 *    グローバルロールの宣言は誰にとっても同じなので借用の対象にならない。
 * ① `via` が `for` のロールを `implies` で(推移的に)含意していること
 *    — 含意が無ければ「実行者が必ずその関係を持つ」と言えず、借用の前提が崩れる。
 * ② 借りられるのは関係スコープ(`own` / `context(...)`)だけで、`all` は借りられないこと
 *    — `all` を借りられると「誰に全件見せているか」が for からも via からも読めなくなる。
 * ③ 借用が実際に必要であること — `for` のロール自身の宣言で足りる場合に `via` を書くと、
 *    宣言したスコープ条件より実際に返る集合が広くなり(健全性 M2 の「一致」が崩れる)、
 *    隠しフィールドの判定(Q3)の基準まで via 側にずれる。
 */
function checkBorrowed(check: RoleScopeCheck, via: QueryVia): Finding[] {
  const { role, entity, label, query, scopeUsed } = check;
  const location = via.location;
  const fail = (message: string, suggestion: string, extra: Record<string, string> = {}): Finding[] => [
    makeFinding(check.verifier, {
      message,
      location,
      suggestion,
      counterexample: { query, via: via.role, role, entity, ...extra },
    }),
  ];

  if (!hasRole(check.domain, via.role)) {
    return fail(
      `via のロール ${via.role} は roles.md にありません`,
      `roles.md の roles に ${via.role} を追加するか、既存のロール(${listRoleIds(check.domain).join(', ')})へ直す`,
    );
  }
  if (!isContextRole(check.domain, via.role)) {
    return fail(
      `via の ${via.role} は文脈依存ロールではありません(roles.md に binding がない)`,
      `via に書けるのは binding を持つロール(対象の行との関係で成立するロール)だけである。` +
        `${via.role} 全員に見せてよいなら via を消して reads の ${role} を直す`,
    );
  }
  if (via.role === role) {
    return fail(
      `via と for に同じロール ${role} が書かれています`,
      `for には観客(グローバルロール)を書き、via には関係ロールを書く。` +
        `${role} が implies で含意するロール(例: member)を for にする`,
    );
  }
  if (!impliedRoles(check.domain.roles.roles, via.role).has(role)) {
    return fail(
      `via の ${via.role} は for の ${role} を含意していません(implies)`,
      `roles.md の ${via.role} に "implies: [${role}]" を足す(その関係を持つ主体が必ず ${role} でもあるなら)。` +
        `そうでないなら for を ${via.role} が含意するロールに直す`,
    );
  }

  const direct = findReadRule(check.access, role);
  if (direct !== null && direct.scope.kind !== 'none' && sameScope(direct.scope, scopeUsed)) {
    return fail(
      `via ${via.role} は不要です(${role} 自身の reads 宣言が ${label} を満たしています)`,
      `via の行を削除する。via は「for のロール自身では読めない行を、関係によって読む」ときだけ書く` +
        '(不要な via は fields_hidden の判定基準まで via 側にずらしてしまう)',
      { declared: scopeText(direct.scope), used: scopeText(scopeUsed) },
    );
  }

  const rule = findReadRule(check.access, via.role);
  if (rule === null || rule.scope.kind === 'none') {
    return fail(
      `via の ${via.role} は ${entity} を読めません(reads の宣言が ${rule === null ? '無い' : 'none'})`,
      `specs/domain/${entity}/access.md の reads に ${via.role} の宣言を書く` +
        '(可視性の正は access_spec であり、query_spec はそれを借りるだけ)',
    );
  }
  if (rule.scope.kind === 'all') {
    return fail(
      `via では all を借りられません(${via.role} の ${entity} の reads は all)`,
      `${role} 自身に見せてよいなら reads の ${role} を直して via を消す。` +
        '借りられるのは関係スコープ(own / context(...))だけで、all を借用可能にすると' +
        '「誰に全件見せているか」が宣言から読めなくなる',
      { declared: 'all', used: scopeText(scopeUsed) },
    );
  }
  if (sameScope(rule.scope, scopeUsed)) return [];
  return fail(
    `${label} が via(${via.role})の reads 宣言と一致しません`,
    `${label} を ${scopeText(rule.scope)} に直すか、via を別の関係ロールに直す`,
    { declared: scopeText(rule.scope), used: scopeText(scopeUsed) },
  );
}
