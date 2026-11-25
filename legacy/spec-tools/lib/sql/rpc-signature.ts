/**
 * **旧いオーバーロードを落とす** do ブロック(生成 SQL に共通の前置)。
 *
 * `create or replace function` は引数の型が 1 つでも変わると別の関数を作るので、放っておくと
 * 権限の付いた旧署名が呼べるまま DB に残る(migrations.md §生成 migration)。宣言した引数型の
 * 並びと**違う**同名の関数だけを落とすので、同じ SQL を 2 度流しても何も起きない。
 *
 * 定型 5 形(`rpc-body.ts`)・保存点の複合 RPC(`code-usecase-rpc.ts`)・受信の RPC
 * (`code-inbound-rpc.ts`)の 3 つが同じものを使う —— 束 ⑳-2 では 5 形にだけ入れていたため、
 * 複合 RPC の署名に引数を足した束 ⑳-3 で**旧 4 引数版が残り、位置引数で呼ぶ経路だけが古い本文に
 * 落ちる**という形が実測された(統合テストが反例)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { RPC_BODY_WORDS } from '../messages/messages.js';
import { sqlLiteral } from './guard-to-sql.js';

/**
 * 同名で引数型の並びが違う関数を落とす do ブロック。
 *
 * @param schema 関数の置き場(スキーマ名)
 * @param name 関数名
 * @param args 宣言した引数型の並び(`pg_catalog` の型名)
 * @returns SQL の行
 */
export function dropStaleOverloads(
  schema: string,
  name: string,
  args: readonly string[],
): readonly string[] {
  return [
    ...RPC_BODY_WORDS.dropStale.map((line) => `-- ${line}`),
    'do $drop$',
    'declare',
    '    v_signature text;',
    'begin',
    '    for v_signature in',
    '        select p.oid::regprocedure::text',
    '        from pg_proc p',
    '        join pg_namespace n on n.oid = p.pronamespace',
    `        where n.nspname = ${sqlLiteral(schema)}`,
    `          and p.proname = ${sqlLiteral(name)}`,
    `          and oidvectortypes(p.proargtypes) is distinct from ${sqlLiteral(args.join(', '))}`,
    '    loop',
    "        execute 'drop function ' || v_signature;",
    '    end loop;',
    'end;',
    '$drop$;',
  ];
}
