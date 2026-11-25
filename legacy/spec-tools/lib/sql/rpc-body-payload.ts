/**
 * 作成の**監査ログに載せる値**の組み立て。`rpc-body-shapes.ts` の作成の本文が呼ぶ。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef } from '../model/types.js';
import { sqlLiteral } from './guard-to-sql.js';
import type { RpcBodyFacts } from './rpc-facts.js';
import { paramOf, redactedPayload } from './rpc-parts.js';

/**
 * 作成の監査ログに載せる値。
 *
 * `p_values` を受ける形は入力そのものを(個人の欄を落として)載せる。1 欄ずつ受ける形は、
 * **入れた列と DB が決めた列**を組み立てる —— 実行者そのものが入る列は載せない
 * (`actor_id` に既に刻まれているため二度書かない)。
 *
 * **`redacted` は「呼び手が送ってきた値を落とした」印である。** したがって DB が決めた列
 * (`supplied_by: db`)が個人の欄なら、値を載せないだけでなく `redacted` にも載せない ——
 * 呼び手は送っていないからで、載せると監査ログが「送られたのに伏せた」と嘘をつく。
 */
export function createPayload(facts: RpcBodyFacts): string {
  const values = paramOf(facts.params, 'values');
  const supplied = facts.dbSuppliedColumns;
  if (values !== null) {
    const base = redactedPayload(values.name, facts.personalIn(facts.valueFields.map((field) => field.name)));
    return supplied.length === 0 ? base : `${base}\n            || ${rowObject(facts, supplied)}`;
  }
  // DB が決めた列は、入れた値(位置の指定 = `insert_at`。丸められうる)ではなく生まれた行から読む(fix25s)。
  const given = facts.insertColumns.filter(
    (column) => column.fromParam && !column.actor && column.name !== 'id' && !supplied.some((field) => field.name === column.name),
  );
  const pairs = [
    ...given.filter((column) => !facts.isPersonal(column.name)),
    ...supplied
      .filter((field) => !facts.isPersonal(field.name))
      .map((field) => ({ name: field.name, expression: `v_row.${field.name}` })),
  ];
  const personal = facts.personalIn(given.map((column) => column.name));
  return withRedacted(pairs.length === 0 ? "'{}'::jsonb" : buildObject(pairs), personal);
}

/** `jsonb_build_object(...)`(列名 → 式)。 */
function buildObject(pairs: readonly { readonly name: string; readonly expression: string }[]): string {
  return [
    'jsonb_build_object(',
    pairs.map((pair) => `            ${sqlLiteral(pair.name)}, ${pair.expression}`).join(',\n'),
    '        )',
  ].join('\n');
}

/**
 * DB が決めた列を、生まれた行から読み直す `jsonb_build_object(...)`。
 *
 * 個人の欄は**丸ごと落とす**(`redacted` にも載せない)—— 呼び手が送っていない値だからである。
 */
function rowObject(facts: RpcBodyFacts, fields: readonly FieldDef[]): string {
  const listed = fields.filter((field) => !facts.isPersonal(field.name));
  return buildObject(listed.map((field) => ({ name: field.name, expression: `v_row.${field.name}` })));
}

/** 個人の欄を「列名だけ」に落とした印を足す(値は載せない)。 */
function withRedacted(object: string, personal: readonly string[]): string {
  if (personal.length === 0) return object;
  return (
    `${object}\n            || jsonb_build_object('redacted', ` +
    `array[${personal.map(sqlLiteral).join(', ')}]::text[])`
  );
}
