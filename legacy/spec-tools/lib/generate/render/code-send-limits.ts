/**
 * data_table の `functions[].send_limit`(送信の上限)の生成器。
 *
 * 正: ARCH-SP-BE-0001 §送信の上限。出すのは 2 種類で、どちらも同じ宣言から同じ関数(`sql/send-limit.ts`)で作る。
 *
 * | 出力 | 置き場 | 読み手 |
 * |---|---|---|
 * | 関数の migration(数え・advisory lock・拒否・積む) | `functions[].migration` | 実 DB。本文の md5 は data-table-parity、掴む順は lock-order-parity |
 * | 期待の表(関数ごとの語・種別・鍵・上限と、掴む鍵の順) | `send-limit-expectations.ts` | 製品の語の表(拒否の語の閉じた表)と、実 DB の挙動の見張り(send-limit-parity) |
 *
 * 拒否の語を製品が手で書き写さないのは、DB の語と製品の表が別々に増えると「表の外の語は制限の拒否として読まない」が
 * 黙って新しい上限を競合に倒すからである(17 回目に手書きの写しを作った)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../../model/types.js';
import type { DataFunctionDecl, DataTableSpec } from '../../model/data/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, docComment, generatedFile, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { migrationPath } from '../../model/product/paths.js';
import { buildSendLimitMigration, sendLimitLockKeys, sendLimitSignature, sendLimitWords } from '../../sql/send-limit.js';

/** 期待の表の名前(`*-expectations.ts` = 凍結の関所の対象)。 */
export const SEND_LIMIT_EXPECTATIONS_FILE = 'send-limit-expectations.ts';

/** 送信の上限の関数 1 本と、それを持つ表。 */
interface Owned {
  readonly table: DataTableSpec;
  readonly fn: DataFunctionDecl;
}

/** 生成できる送信の上限(宣言が読めて、書き出し先がある)。 */
function sendLimitsOf(tables: readonly DataTableSpec[]): readonly Owned[] {
  return [...tables]
    .sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0))
    .flatMap((table) => table.functions.filter((fn) => fn.kind === 'send_limit' && fn.sendLimit !== undefined).map((fn) => ({ table, fn })));
}

/** 関数 1 本の期待(製品と見張りが読む形)。 */
function expectationOf(fn: DataFunctionDecl): LiteralValue {
  const decl = fn.sendLimit;
  if (decl === undefined) return null;
  const signature = sendLimitSignature(decl);
  return {
    event: decl.event,
    args: [...signature.args],
    params: [...signature.params],
    types: [...decl.types],
    keys: decl.keys.map((key) => ({
      name: key.name,
      blocked: key.blocked === undefined ? null : { table: key.blocked.table, column: key.blocked.column, values: [...key.blocked.values], word: key.blocked.word },
      unit: key.unit === undefined ? null : key.unit.via.map((hop) => ({ table: hop.table, column: hop.column, to: hop.to })),
    })),
    payload: [...decl.payload],
    limits: decl.limits.map((limit) => ({ word: limit.word, key: limit.key, max: limit.max, per: limit.per })),
    words: sendLimitWords(decl).map((entry) => ({ word: entry.word, timed: entry.timed })),
    locks: sendLimitLockKeys(fn.name, decl).map((lock) => lock.prefix),
  };
}

/** 期待の表のファイル全体。 */
function renderExpectations(owned: readonly Owned[]): string {
  const byName: Record<string, LiteralValue> = {};
  for (const { fn } of owned) byName[fn.name] = expectationOf(fn);
  const wordLines = owned.map(({ fn }) => {
    const words = fn.sendLimit === undefined ? [] : sendLimitWords(fn.sendLimit).map((entry) => `'${entry.word}'`);
    return `  readonly ${fn.name}: ${words.length === 0 ? 'never' : words.join(' | ')};`;
  });
  return [
    generatedHeader([...new Set(owned.map(({ table }) => table.location.file))]),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment(['送信の上限 1 本の期待(data_table の `functions[].send_limit` の写し。ARCH-SP-BE-0001 §送信の上限)。']),
    'export interface SendLimitExpectation {',
    '  /** 拒否の本文の操作 ID(`usecase_guard:{event}`)。 */',
    '  readonly event: string;',
    '  /** 引数の型と名前(種別・鍵・payload の欄の順)。 */',
    '  readonly args: readonly string[];',
    '  readonly params: readonly string[];',
    '  /** 数える種別と積んでよい種別(同じ 1 つの並び)。 */',
    '  readonly types: readonly string[];',
    '  /** 数える単位(payload の鍵)と、送れない状態の宣言。 */',
    '  readonly keys: readonly {',
    '    readonly name: string;',
    '    readonly blocked: { readonly table: string; readonly column: string; readonly values: readonly string[]; readonly word: string } | null;',
    '    /** 数える単位の辿り方(null = 鍵の値ごと = 実行者ごと。宣言すれば参照の列を順に辿った先ごと)。 */',
    '    readonly unit: readonly { readonly table: string; readonly column: string; readonly to: string }[] | null;',
    '  }[];',
    '  /** 鍵のほかに payload に載せる欄。 */',
    '  readonly payload: readonly string[];',
    '  /** 上限(宣言の順が拒否の理由を選ぶ順)。 */',
    '  readonly limits: readonly { readonly word: string; readonly key: string; readonly max: number; readonly per: string }[];',
    '  /** 拒否の語の全部(本文が上げる順)と、次に送れる時刻を持つか。 */',
    '  readonly words: readonly { readonly word: string; readonly timed: boolean }[];',
    '  /** advisory lock の鍵の接頭辞(取る順 = 字面のバイト順)。 */',
    '  readonly locks: readonly string[];',
    '}',
    '',
    docComment(['送信の上限の関数ごとの拒否の語(UC412 の detail。製品の語の閉じた表の型。並びは `sendLimitExpectations` の `words`)。']),
    'export interface SendLimitWords {',
    ...wordLines,
    '}',
    '',
    docComment(['送信の上限の全部(関数名 → 期待)。キーの集合が実 DB に在るべき送信の上限の関数の完全集合である。']),
    'export const sendLimitExpectations: Readonly<Record<keyof SendLimitWords, SendLimitExpectation>> =',
    `  ${frozen(renderLiteral(byName, 1))};`,
    '',
  ].join('\n');
}

/** 全 data_table の送信の上限から、関数の migration と期待の表を書き出すジェネレーター。 */
export const sendLimitsGenerator: DocGenerator = {
  id: 'code-send-limits',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const dataTables = ctx.dataTables;
    if (dataTables === undefined || !dataTables.available || dataTables.tables.length === 0) return [];
    const owned = sendLimitsOf(dataTables.tables);
    const migrations = owned.flatMap(({ table, fn }): GeneratedSection[] =>
      fn.migration === undefined || fn.sendLimit === undefined
        ? []
        : [{ file: migrationPath(ctx.roots, fn.migration), content: buildSendLimitMigration({ fn, decl: fn.sendLimit, specFiles: [table.location.file] }), wholeFile: true }],
    );
    return [...migrations, { file: generatedFile(ctx.roots, SEND_LIMIT_EXPECTATIONS_FILE), content: renderExpectations(owned), wholeFile: true }];
  },
};
