/**
 * data_table の**掴みの宣言**の期待の表(`lock-expectations.ts`)の生成器。点検 19 回目 A19-3 / A19-4 / O19-2。
 *
 * | 期待 | 出どころ | 読み手 |
 * |---|---|---|
 * | 写し元(`triggerCopySources`) | `triggers[].copies_from`(写し元の列が個人列かどうかも添える) | `lock-order-parity`: 個人列を写すトリガを発火させる関数が写し元の行を先に掴んでいるか |
 * | 紐づけの関所(`refuseErasedKeys`) | `foreign_keys[].refuse_erased`(`freezes_personal` があれば凍らせる自表の個人列も) | `erased-link-parity`: その列・個人列を書く関数が関所(指す行の掴みと、同じ値を見て断る拒否の語)を持つか。画面の拒否の語の閉じた表(`refusalWordText`) |
 * | advisory lock の鍵(`advisoryLockKeys`) | 送信の上限の鍵・未ログインの作成の天井の鍵・`triggers[].advisory` | `lock-order-parity`: 宣言の外の鍵は赤・鍵は字面のバイト順 |
 * | 作成の後に書き換わらない参照の列(`fixedReferenceColumns`) | 編集・遷移・トリガ・外部キーの宣言から(`sql/lock-premises.ts`) | `lock-order-parity`: 書き込みの確かめの等式を先掴みの時点の行に当てはめてよい列(判定の前提)。この列を作成の後に書き換える関数は赤 |
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../../model/types.js';
import type { DataTableSpec } from '../../model/data/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, docComment, generatedFile, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { ceilingPlanOf } from '../../model/data/ceiling-plan.js';
import { refCounterpartDeclsOf } from '../../model/data/ref-check-shape.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import { sendLimitLockKeys } from '../../sql/send-limit.js';
import { fixedReferenceColumnsOf } from '../../sql/lock-premises.js';

/** 期待の表の名前(`*-expectations.ts` = 凍結の関所の対象)。 */
export const LOCK_EXPECTATIONS_FILE = 'lock-expectations.ts';

/** バイト順の比較。 */
function byBytes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 表の個人列(entity_spec の `personal`。表に entity が無ければ空)。 */
function personalOf(tables: readonly DataTableSpec[], table: string, model: SpecModel): ReadonlySet<string> {
  const entity = tables.find((candidate) => candidate.table === table)?.entity;
  if (entity === undefined) return new Set();
  return new Set((findEntityFields(model, entity) ?? []).filter((field) => field.personal).map((field) => field.name));
}

/**
 * advisory lock の鍵の接頭辞の全部(バイト順)。
 *
 * @param tables 全 data_table
 * @param model ドメイン仕様(天井の計画を引く)
 * @returns 鍵の接頭辞
 */
export function advisoryLockKeysOf(tables: readonly DataTableSpec[], model: SpecModel): readonly string[] {
  const keys = new Set<string>();
  for (const table of tables) {
    for (const fn of table.functions) {
      if (fn.kind === 'send_limit' && fn.sendLimit !== undefined) for (const lock of sendLimitLockKeys(fn.name, fn.sendLimit)) keys.add(lock.prefix);
    }
    const ceiling = ceilingPlanOf(table, model);
    if (ceiling !== null) keys.add(ceiling.lockKey);
    // 参照の欄が指す行を読む条件の相手の端の鍵も同じ口(`model/data/ref-check-shape.ts`。fix25s)。
    for (const trigger of [...table.triggers, ...refCounterpartDeclsOf(table, model, tables).triggers]) for (const key of trigger.advisory ?? []) keys.add(key);
  }
  return [...keys].sort(byBytes);
}

/** ファイル全体。 */
function renderFile(tables: readonly DataTableSpec[], model: SpecModel): string {
  const sorted = [...tables].sort((a, b) => byBytes(a.table, b.table));
  const copies: LiteralValue[] = sorted.flatMap((table) =>
    table.triggers.flatMap((trigger) =>
      (trigger.copiesFrom ?? []).map((copy) => ({
        table: table.table,
        trigger: trigger.name,
        column: copy.column,
        fromTable: copy.fromTable,
        fromColumn: copy.fromColumn,
        match: { ...copy.match },
        personal: personalOf(tables, copy.fromTable, model).has(copy.fromColumn),
      })),
    ),
  );
  const refusals: LiteralValue[] = sorted.flatMap((table) =>
    table.foreignKeys.flatMap((key) =>
      key.refuseErased === undefined
        ? []
        : [
            {
              table: table.table,
              column: key.column,
              references: key.references,
              markColumn: key.refuseErased.column,
              values: [...key.refuseErased.values],
              word: key.refuseErased.word,
              message: key.refuseErased.message,
              ...(key.refuseErased.freezesPersonal === undefined
                ? {}
                : {
                    freezes: {
                      word: key.refuseErased.freezesPersonal.word,
                      message: key.refuseErased.freezesPersonal.message,
                      columns: [...personalOf(tables, table.table, model)],
                    },
                  }),
            },
          ],
    ),
  );
  return [
    generatedHeader(tables.map((table) => table.location.file)),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment(['トリガが供給する列の写し元 1 つ(data_table の `triggers[].copies_from` の写し)。']),
    'export interface CopySourceExpectation {',
    '  readonly table: string;',
    '  readonly trigger: string;',
    '  readonly column: string;',
    '  readonly fromTable: string;',
    '  readonly fromColumn: string;',
    '  /** 写し元の列 → 自表の列。 */',
    '  readonly match: Readonly<Record<string, string>>;',
    '  /** 写し元の列が個人列か(消去と写しの作成を 1 本ずつに並べる対象)。 */',
    '  readonly personal: boolean;',
    '}',
    '',
    docComment(['消去された行への紐づけの関所 1 つ(data_table の `foreign_keys[].refuse_erased` の写し)。']),
    'export interface RefuseErasedExpectation {',
    '  readonly table: string;',
    '  readonly column: string;',
    '  readonly references: string;',
    '  readonly markColumn: string;',
    '  readonly values: readonly string[];',
    '  /** 拒否の語(UC412 の detail)。 */',
    '  readonly word: string;',
    '  /** 拒否の語の画面の文言(仕様の宣言の写し)。 */',
    '  readonly message: string;',
    '  /** 指したままの行の個人列の凍結(`freezes_personal`。凍らせる列は自表の個人列の全部)。 */',
    '  readonly freezes?: { readonly word: string; readonly message: string; readonly columns: readonly string[] };',
    '}',
    '',
    docComment(['写し元の全部(表 → トリガの順)。']),
    `export const triggerCopySources: readonly CopySourceExpectation[] = ${frozen(renderLiteral(copies))};`,
    '',
    docComment(['紐づけの関所の全部。']),
    `export const refuseErasedKeys: readonly RefuseErasedExpectation[] = ${frozen(renderLiteral(refusals))};`,
    '',
    docComment(['作成の後に書き換わらない参照の列(表 → 列。掴む順の判定の前提。宣言から決める: `sql/lock-premises.ts`)。']),
    'export interface FixedReferenceColumnsExpectation {',
    '  readonly table: string;',
    '  readonly columns: readonly string[];',
    '}',
    '',
    docComment(['作成の後に書き換わらない参照の列の全部(表名のバイト順)。']),
    `export const fixedReferenceColumns: readonly FixedReferenceColumnsExpectation[] = ${frozen(renderLiteral(fixedReferenceColumnsOf(tables, model).map((entry) => ({ table: entry.table, columns: [...entry.columns] }))))};`,
    '',
    docComment(['宣言された advisory lock の鍵の接頭辞の全部(バイト順 = 取る順)。この外の鍵を取る本文は掴む順の走査が赤にする。']),
    `export const advisoryLockKeys: readonly string[] = ${frozen(renderLiteral([...advisoryLockKeysOf(tables, model)]))};`,
    '',
  ].join('\n');
}

/** 全 data_table の掴みの宣言から期待の表を書き出すジェネレーター。 */
export const lockExpectationsGenerator: DocGenerator = {
  id: 'code-lock-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const dataTables = ctx.dataTables;
    if (dataTables === undefined || !dataTables.available || dataTables.tables.length === 0) return [];
    return [{ file: generatedFile(ctx.roots, LOCK_EXPECTATIONS_FILE), content: renderFile(dataTables.tables, model), wholeFile: true }];
  },
};
