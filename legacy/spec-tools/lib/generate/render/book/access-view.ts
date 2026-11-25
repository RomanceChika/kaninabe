/**
 * 「誰に見えるか」の表現を 1 か所に置く共有部品。
 *
 * 可視性(access_spec の `reads` / `fields_hidden`)は、各集約の章(その集約だけ)と
 * 「誰に何が見えるか」の章(全集約の横断)の両方に出る。言い回し・⚠ の付け方・
 * 依存 query の逆引きが 2 か所で食い違うと読み手が混乱するため、ここに 1 つだけ持つ。
 *
 * `system`(内部実行)は RLS をバイパスし常に全件読めるため、可視性の一覧からは外す
 * (期待 RLS ポリシー表 code-rls-expectations.ts と同じ扱い)。
 */

import type { AccessSpec, ReadScope, SpecModel } from '../../../model/types.js';
import { systemRoleId } from '../../../model/role-hierarchy.js';
import type { QuerySpecModel } from '../../../model/query/types.js';

/** RLS をバイパスする内部実行ロール(role_spec の `kind: system`)。可視性の一覧から外す。 */
export function bypassRole(model: SpecModel): string | undefined {
  return systemRoleId(model.roles.roles);
}

/**
 * scope: all の行に付ける目印。
 * 「全件見せる」はスコープ設計の中で唯一データ露出が一段跳ね上がる宣言なので、
 * 読み物の中でもこの印の場所で判断できるようにする(機械はこの宣言の是非を判定できない)。
 */
export const WIDE_READ_MARK = '⚠';

/** ⚠ の意味(表と一緒に出す定型文)。 */
export const WIDE_READ_NOTE =
  `${WIDE_READ_MARK} = そのロールなら**全レコード**(公開前のものも含む)が見える宣言。` +
  '「このロールに、このデータを、本当に全件見せてよいか」をここで判断する。' +
  '内部実行の system は RLS をバイパスする(常に全件)ため一覧から外している。';

/** スコープ → 日本語の説明。scope: all には ⚠ を付ける。 */
export function scopeJa(scope: ReadScope): string {
  switch (scope.kind) {
    case 'own':
      return '自分のものだけ(own)';
    case 'all':
      return `全件(all) ${WIDE_READ_MARK}`;
    case 'none':
      return '見えない(none)';
    case 'context':
      return `紐づく ${scope.entity} のものだけ(context(${scope.entity}))`;
  }
}

/** そのロールから隠されるフィールドの一覧(カンマ区切り。無ければ空文字)。 */
export function hiddenFieldsFor(access: AccessSpec, role: string): string {
  return access.fieldsHidden
    .filter((rule) => rule.from.includes(role))
    .map((rule) => rule.field)
    .join(', ');
}

/** 「エンティティ × ロール」の宣言 1 行を指すキー。 */
export function readKey(entity: string, role: string): string {
  return `${entity} ${role}`;
}

/**
 * 各 `reads` 宣言に依存している query_spec を逆引きする。
 *
 * 依存の供給元は「`via` があればそのロール、無ければ `for` の各ロール」である
 * (`via` は借用の宣言であり、行を見せているのはそちらのロールだから)。source と includes の
 * 両方を数える。ある宣言を狭めたときに**どの読み取り経路が壊れるか**を、この逆引きで先に見る。
 *
 * @param model 読み込み済みの query_spec(未読なら空の索引を返す)
 * @returns 「エンティティ × ロール」→ そこに乗っているクエリ名
 */
export function dependentQueries(model: QuerySpecModel | undefined): ReadonlyMap<string, string[]> {
  const index = new Map<string, string[]>();
  if (model === undefined || !model.available) return index;
  const add = (entity: string, role: string, name: string): void => {
    const key = readKey(entity, role);
    const names = index.get(key) ?? [];
    if (!names.includes(name)) names.push(name);
    index.set(key, names);
  };
  for (const query of model.queries) {
    const roles = query.via === undefined ? query.forRoles : [query.via.role];
    for (const role of roles) add(query.source, role, query.name);
    for (const include of query.includes) {
      const viaRoles = include.via === undefined ? query.forRoles : [include.via.role];
      for (const role of viaRoles) add(include.entity, role, query.name);
    }
  }
  return index;
}

/** ロール ID → 日本語名。label の無いロールはキーを持たない。 */
export function roleLabels(model: SpecModel): Map<string, string> {
  const labels = new Map<string, string>();
  for (const role of model.roles.roles) {
    if (role.label !== undefined && role.label.trim().length > 0) labels.set(role.id, role.label);
  }
  return labels;
}
