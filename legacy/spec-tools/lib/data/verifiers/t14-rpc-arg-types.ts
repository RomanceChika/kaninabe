/**
 * T14 **1 欄ずつ受ける引数の宣言型は、その列の型と一致する**。
 *
 * 定型 RPC の `args` は「pg_catalog の型名を仕様に写す」宣言であり、`rpc-signatures-parity` が
 * 実 DB の `pg_proc` と双方向に突き合わせている。ところが**宣言した型が入れる先の列の型と
 * 合っているか**は誰も見ていなかった —— `p_{欄}` の型を `text` と書いても、関数は作れるし
 * 署名の突合も緑のままである。
 *
 * 壊れるのは呼ぶ側と本文の 2 か所で、しかも**同じ宣言のずれが別々の症状で出る**:
 *
 * | どこ | 症状 |
 * |---|---|
 * | 本文 | `insert into … select …, p_starts_at, …` が `42804 column "starts_at" is of type timestamp with time zone but expression is of type text` で落ちる |
 * | 呼ぶ側 | 名前つき引数で呼ぶ経路は**列の型**で値を作るので、`42883 function …(p_starts_at => timestamp with time zone) does not exist`(署名が見つからない)になる |
 *
 * 実測は予約を作る個別引数の RPC である(束 ③-2 の 1 往復。`starts_at` / `ends_at` を
 * `text` と宣言していた)。**題材の製品の個別引数 RPC は日時・数値の列を 1 つも受けないので、
 * 題材の製品だけを見ていると一生見えない。**
 *
 * **キャストで埋めない。** 生成器(`sql-types.ts` の `columnExpression`)は型が違えば cast を
 * 出せるが、それは jsonb の `->>` が必ず text を返す経路のためのものである。個別引数のずれを
 * cast で黙らせると、**どの型のずれも黙って通る**ようになり、呼ぶ側の 42883 は直らない
 * (本文だけが直り、署名の食い違いは残る)。ずれは宣言の誤りとしてここで止める。
 *
 * **免除リストは無い。** 「ずれてよい集合」は空である —— 境界が ISO 8601 の字面であることは
 * **アプリの入口**(zod・フォーム)の規約であって、DB の関数の引数型の規約ではない
 * (datetime.md §境界。`timestamptz` の引数に ISO 8601 の文字列を渡すのは PostgREST と
 * pg のどちらの経路でも成り立つ)。
 *
 * 見るのは `kind: column` の引数だけである。意味が固定されている引数(`p_id` / `p_actor_id` /
 * `p_values` …)の型は役目そのものが決めており、そちらの形は T1 と署名の突合が見る。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { collectRpcFacts } from '../../sql/rpc-facts.js';
import { columnType } from '../../sql/sql-types.js';
import type { DataFunctionDecl, DataTableSpecModel, DataTableSpec } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T14';

/** 本文が定型に乗る形(T6 と同じ集合。composite はここでは見ない)。 */
const GENERATED_SHAPES = ['create', 'update', 'delete', 'transition'] as const;

/** 本文が定型に乗る形。 */
type GeneratedShape = (typeof GENERATED_SHAPES)[number];

/** その関数が本文を生成する形か(`kind: rpc` かつ定型)。 */
function generatedShapeOf(fn: DataFunctionDecl): GeneratedShape | null {
  if (fn.kind !== 'rpc') return null;
  return GENERATED_SHAPES.find((shape) => shape === fn.shape) ?? null;
}

/**
 * 全 data_table の定型 RPC について、1 欄ずつ受ける引数の型が列の型と一致するかを見る。
 *
 * @param domain 構築済みのドメイン仕様モデル(引数の役目を引くのに要る)
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyRpcArgTypes(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    for (const fn of table.functions) {
      const shape = generatedShapeOf(fn);
      if (shape === null) continue;
      findings.push(...checkArgs(fn, shape, table, domain, dataTables.tables));
    }
  }
  return findings;
}

/**
 * 関数 1 本の引数型を見る。
 *
 * 役目の引き当ては**本文の組み立てと同じ写像**(`collectRpcFacts`)を呼ぶ —— 引数名の規約を
 * 書き写すと、生成器と検査器が別々の読み方を持つことになる。組み立てが失敗する宣言
 * (役目が決まらない・条件先まで辿れない)は T6 が既に報告しているので、ここでは黙って飛ばす。
 *
 * @param fn 関数の宣言
 * @param shape 定型の形
 * @param table その関数の持ち場
 * @param domain ドメイン仕様
 * @param tables 全 data_table(条件にする集約の表名を引く)
 * @returns 違反のリスト
 */
function checkArgs(
  fn: DataFunctionDecl,
  shape: GeneratedShape,
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): Finding[] {
  const collected = collectRpcFacts({
    name: fn.name,
    params: fn.params,
    args: fn.args,
    shape,
    table,
    domain,
    tableOf: (entity) => tables.find((candidate) => candidate.entity === entity)?.table ?? null,
    actions: undefined,
  });
  if (!collected.ok) return [];
  const findings: Finding[] = [];
  for (const param of collected.facts.params) {
    if (param.role.kind !== 'column') continue;
    const expected = columnType(param.role.field.type);
    if (param.type === expected) continue;
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'error',
      message: `${fn.name} の引数 ${param.name} は ${param.type} と宣言されていますが、入れる先の列 ${table.table}.${param.role.field.name} は ${expected} です`,
      location: { ...table.location, pointer: `functions.${fn.name}.args` },
      suggestion:
        `args のその位置を "${expected}" に直す(列の型は entity_spec の ${param.role.field.name} から決まる)。` +
        '引数の型を列に合わせずに済ませる道は無い —— 本文は代入で落ち(42804)、名前つき引数で呼ぶ経路は署名が見つからない(42883)',
      counterexample: {
        function: fn.name,
        param: param.name,
        declared: param.type,
        column: `${table.table}.${param.role.field.name}`,
        expected,
      },
    });
  }
  return findings;
}
