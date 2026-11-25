/**
 * data_table の `functions`(`kind: rpc`)→ RPC の署名の表(`app/src/domain/generated/rpc-signatures.ts`)
 * の生成器。
 *
 * ## 正の所在(束 ⑯b → ⑯c で訂正)
 *
 * RPC の引数の**順と型**は data_table の `args` が正であり(ARCH-SP-BE-0001 §書き込み RPC の形、
 * data-table-parity / rpc-parity が実 DB の `pg_proc` と突き合わせる)、**引数名**は同じ宣言の
 * `params` が正である。ここは**二重の正を作らない** —— この生成物はどちらの写しでもある。
 *
 * それでも生成物を分けて持つ理由は、data-table-expectations.ts が「表ごと」に束ねた形
 * (`{ table: { functions: [...] } }`)であるのに対し、署名だけを引きたい呼び出し側
 * (T 群の署名突合・複合 RPC の生成 = 束 ⑯c)には「RPC 名で引ける閉世界」のほうが
 * 素直だからである。**両方とも同じ `DataTableSpecModel` から作るので、内容が食い違うことは
 * 構造的にありえない**(生成のたびに同じ入力から作り直す。手書きの重複を持たない)。
 *
 * ⑯b は「引数名は migration の SQL にしかないので持たない」としていたが、**複合 RPC の生成に
 * 引数の意味が要る**ため ⑯c で撤回した。名前は仕様に載せたうえで実 DB の `pg_proc.proargnames`
 * と双方向に突き合わせる(rpc-signatures-parity)ので、二重管理ではなく**突合された単一の正**になる。
 *
 * **保存点の複合 RPC(生成物)もこの表に載る。** 呼び出し側から見れば同じ 1 本の RPC であり、
 * data_table に手で宣言しない代わりに、生成器が usecase_spec から同じ形を導く(composite.ts)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import { usecaseCompositeFunctions } from '../../usecase/composite.js';
import { inboundRpcFunctions } from '../../inbound/inbound-functions.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 署名表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'rpc-signatures.ts');

/**
 * 全 data_table の `kind: rpc` から RPC の署名表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/rpc-signatures.ts`(全テーブルで 1 ファイル・全体生成)。
 */
export const rpcSignaturesGenerator: DocGenerator = {
  id: 'code-rpc-signatures',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const tables = ctx.dataTables?.tables ?? [];
    if (tables.length === 0) return [];

    const byName: Record<string, LiteralValue> = {};
    for (const table of tables) {
      for (const fn of table.functions) {
        if (fn.kind !== 'rpc') continue;
        byName[fn.name] = {
          table: table.table,
          shape: fn.shape ?? 'composite',
          // 定型 4 形は `setof public.{表}` を返す(本文は rpc-body.ts)。定型に乗らない RPC は戻り値の形を
          // 宣言する(パーサーが必須にするので、省略を行の列とみなして埋めることは無い)。
          returns: fn.returns ?? 'rows',
          args: [...fn.args],
          params: [...fn.params],
        };
      }
    }
    // 複合 RPC(保存点の生成物)も同じ表に載せる —— 呼び出し側から見れば同じ 1 本の RPC である。
    const composites = [
      ...usecaseCompositeFunctions({
        domain: model,
        actions: ctx.actions ?? null,
        dataTables: ctx.dataTables,
        usecases: ctx.usecases,
      }),
      ...inboundRpcFunctions({ domain: model, dataTables: ctx.dataTables, external: ctx.external, roots: ctx.roots }),
    ];
    for (const composite of composites) {
      byName[composite.fn.name] = {
        table: composite.table,
        shape: 'composite',
        // 生成した複合 RPC(保存点・受信)は jsonb を 1 つ返す(code-usecase-rpc.ts / code-inbound-rpc.ts)。
        returns: 'document',
        args: [...composite.fn.args],
        params: [...composite.fn.params],
      };
    }
    if (Object.keys(byName).length === 0) return [];

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(byName, tables.map((table) => table.location.file)),
        wholeFile: true,
      },
    ];
  },
};

/** 署名表のファイル全体を組み立てる。 */
function renderFile(byName: Readonly<Record<string, LiteralValue>>, specFiles: readonly string[]): string {
  return [
    generatedHeader(specFiles),
    '',
    docComment([
      'RPC 1 本の署名(引数の順・型・名前)。正は data_table の `functions[].args` / `params` であり、',
      'ここはその写しである(束 ⑯c で引数名を仕様に載せた ―― 複合 RPC の生成が名前から',
      '「その引数に何を渡すか」を決めるため。名前の正しさは pg_proc.proargnames との突合が守る)。',
    ]),
    'export interface RpcSignature {',
    '  /** 帰属する表(この関数の持ち場)。 */',
    '  readonly table: string;',
    '  /** 書き込み RPC の形。composite は 5 形の定型に乗らない。 */',
    "  readonly shape: 'transition' | 'create' | 'update' | 'delete' | 'composite';",
    '  /**',
    '   * 戻り値の形。`rows` = `setof` の行の列(定型 4 形と、行を返すと宣言した RPC)/ `scalar` = 行でも文書でもない単一の値',
    '   * (宣言した RPC)/ `document` = jsonb 1 つ(生成した複合 RPC)。',
    '   * 接続の方式(PostgREST は JSON を返し、直結のドライバは列を返す)が結果を同じ形に読むための宣言。',
    '   */',
    "  readonly returns: 'rows' | 'scalar' | 'document';",
    '  /** 引数型の並び(pg_catalog の型名。例: uuid, text, jsonb, "text[]")。 */',
    '  readonly args: readonly string[];',
    '  /** 引数名の並び(`args` と同じ順)。実 DB の pg_proc.proargnames と突合される。 */',
    '  readonly params: readonly string[];',
    '}',
    '',
    docComment([
      'RPC 名 → 署名。全 data_table の `kind: rpc` の和集合が閉世界(この表に無い RPC が',
      '実 DB にあれば data-table-parity が落とす)。',
      '',
      '`data_table` の `functions[].args` の写しである(束 ⑯b。二重の正にしないため、',
      'この生成物と data-table-expectations.ts は同じ `DataTableSpecModel` から作る)。',
    ]),
    `export const rpcSignatures = ${renderLiteral(byName)} as const satisfies Readonly<
  Record<string, RpcSignature>
>;`,
    '',
    docComment(['RPC 名の閉世界。']),
    'export type RpcName = keyof typeof rpcSignatures;',
    '',
  ].join('\n');
}
