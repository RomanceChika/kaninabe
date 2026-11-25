/**
 * 実行計画 + entity_spec → **一致の証明が置く world と組み合わせの設計図**
 * (`app/src/domain/generated/eq-worlds.ts`)の生成器(束 ⑳-5a)。
 *
 * ⑳-3 で RPC の本文が `by` とガードと期待状態を守るようになり、⑳-3b がその一致を `entry` の
 * 3 操作で差分テストした。残るのは**他の全操作**である —— 「同じ生成器から出ている」以上の
 * 証拠が無い。そこで操作ごとに「状態 × 実行者 × ロール配列 × ガード変数の境界値 × 入力」を
 * **全列挙**し、engine の判定と実 DB の結末を突き合わせるテストを生成する。
 *
 * この生成器が出すのは**world の形と組み合わせ**だけである。判定の材料(規則の表・ガードの
 * 変数・ロールの根拠)は実行計画(`operation-plans.ts`)が既に運んでいるので、ここが写すと
 * **期待と執行が同じ写し間違いを共有する**。実行する側は設計図で world を置き、実行計画で
 * engine を引き、実 DB で実行して比べる。
 *
 * world を宣言から作れない集約は**ここに出さない**(同じ判定を T11 が warning にする)。
 *
 * **保存点(複合 RPC)の節も同じファイルに出す**(束 ⑳-5a2)。1 操作は手順が 1 つの保存点に
 * すぎず(束 ⑰ 設計 §0)、行・実行者・軸の形はどちらも同じである —— 設計図を 2 ファイルに
 * 割ると、実行する側が「どちらの形か」を知るための分岐を持つことになる。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { EqOperation, EqWorld } from '@kaninabe/runtime/testing/equivalence/types';
import type { EqSaveWorld } from '@kaninabe/runtime/testing/save/types';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { type EqCatalogEntry, eqCatalog, type EqSaveCatalogEntry, eqSaveCatalog } from '../../world/index.js';
import { generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import {
  RUNTIME_TESTING_EQ_TYPES_MODULE,
  RUNTIME_TESTING_SAVE_TYPES_MODULE,
} from './runtime-modules.js';
import { EQ_TYPES } from './eq-world-types.js';
import { EQ_SAVE_TYPES } from './eq-save-world-types.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** 設計図の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'eq-worlds.ts');

/** 全操作の world と組み合わせを生成するジェネレーター。 */
export const eqWorldsGenerator: DocGenerator = {
  id: 'code-eq-worlds',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const entries = eqCatalog({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions,
      dataTables: ctx.dataTables,
      jobs: ctx.jobs,
    });
    if (entries.length === 0) return [];
    const worlds: Record<string, EqWorld> = {};
    for (const entry of entries) {
      if (entry.result.ok) worlds[entry.aggregate] = worldData(entry.result);
    }
    const saves = eqSaveCatalog({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions,
      dataTables: ctx.dataTables,
      usecases: ctx.usecases,
    });
    const saveWorlds: Record<string, EqSaveWorld> = {};
    for (const entry of saves) {
      if (entry.result.ok) saveWorlds[entry.key] = saveWorldData(entry.result);
    }
    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(worlds, saveWorlds, [...specFilesOf(entries), ...saveSpecFilesOf(saves, ctx.roots)]),
        wholeFile: true,
      },
    ];
  },
};

/**
 * 保存点 1 つぶんをリテラルに写す。
 *
 * 返り値は**ハーネスが持つ型**(`EqSaveWorld`)である —— 欄の名前や型をハーネス側で変えたとき、
 * 生成物の `satisfies` まで待たず**この組み立ての場所で**型エラーになる。
 */
function saveWorldData(result: Extract<EqSaveCatalogEntry['result'], { readonly ok: true }>): EqSaveWorld {
  const { world, cases } = result;
  return {
    usecase: world.usecase,
    save: world.save,
    label: cases.label,
    rpc: cases.rpc,
    actorTable: world.actorTable,
    tables: world.tables,
    actors: world.actors,
    rows: world.rows,
    steps: cases.steps,
    cleanup: cases.cleanup,
    expectedKeys: cases.expectedKeys,
    grid: {
      axes: cases.axes,
      actors: cases.actors,
      callers: cases.callers,
      decisionRepeats: cases.decisionRepeats,
      decisionInputs: cases.decisionInputs,
      decisionCount: cases.decisionCount,
      writeRepeats: cases.writeRepeats,
      writeInputs: cases.writeInputs,
      resends: cases.resends,
      writeCount: cases.writeCount,
      folded: cases.folded,
      foldedGuards: cases.foldedGuards,
    },
    resultTable: cases.resultTable,
    resultStateColumn: cases.resultStateColumn,
    resultState: cases.resultState,
    resultIdFrom: cases.resultIdFrom,
    resend: cases.resend,
    resendOp: cases.resendOp,
  };
}

/** 保存点の設計図の正になる仕様ファイル。 */
function saveSpecFilesOf(entries: readonly EqSaveCatalogEntry[], roots: ProductRoots): readonly string[] {
  return [
    ...new Set(
      entries
        .filter((entry) => entry.result.ok)
        .map((entry) => specPath(roots, `frontend/usecases/${entry.usecase.relPath}`)),
    ),
  ].sort();
}

/**
 * 集約 1 つぶんをリテラルに写す。
 *
 * 返り値は**ハーネスが持つ型**(`EqWorld`)である(欄の変更を組み立ての場所で捕るため。
 * `saveWorldData` と同じ理由)。
 */
function worldData(result: Extract<EqCatalogEntry['result'], { readonly ok: true }>): EqWorld {
  const world = result.world;
  return {
    aggregate: world.aggregate,
    table: world.table,
    actorTable: world.actorTable,
    actors: world.actors,
    rows: world.rows,
    records: world.records,
    operations: result.operations.map((operation): EqOperation => ({
      op: operation.op,
      label: operation.label,
      aggregate: operation.aggregate,
      kind: operation.kind,
      stateColumn: operation.stateColumn,
      states: operation.states,
      actors: operation.actors,
      arrays: operation.arrays,
      fields: operation.fields,
      axes: operation.axes,
      count: operation.count,
      folded: operation.folded,
      foldedGuards: operation.foldedGuards,
      enforcement: operation.enforcement,
      actorReads: operation.actorReads,
      inputs: operation.inputs,
      ...(Object.keys(operation.fresh).length > 0 ? { fresh: operation.fresh } : {}),
      ...(operation.crossTenant ? { crossTenant: true } : {}),
    })),
  };
}

/** その設計図の正になる仕様ファイル。 */
function specFilesOf(entries: readonly EqCatalogEntry[]): readonly string[] {
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.result.ok && entry.table !== undefined) files.add(entry.table.location.file);
  }
  return [...files].sort();
}

/** 設計図のファイル全体。 */
function renderFile(
  worlds: Readonly<Record<string, EqWorld>>,
  saves: Readonly<Record<string, EqSaveWorld>>,
  specFiles: readonly string[],
): string {
  return [
    generatedHeader([...new Set(specFiles)].sort()),
    '',
    // 形はハーネスが持つ(束 ①-d 手 2)。値を書くのに要る型だけを名前で引き、残りは再輸出する。
    `import type { EqWorld } from '${RUNTIME_TESTING_EQ_TYPES_MODULE}';`,
    `import type { EqSaveWorld } from '${RUNTIME_TESTING_SAVE_TYPES_MODULE}';`,
    '',
    ...EQ_TYPES,
    '',
    docComment([
      '集約ごとの world と組み合わせ(world を宣言から作れる集約だけ)。',
      '',
      '1 集約につき「その集約の操作が根拠にする役ごとの実行者 + どの役も立たない既定の実行者 +',
      '実行者の集約に行が無い人」を作り、実行者ごとに 1 系統の行を置く。実行する直前に対象の行を',
      '置き直し(状態とガード変数の境界値)、engine の判定と実 DB の結末を突き合わせる。',
      '',
      '**判定の材料はここに無い** —— 規則の表もガードの変数もロールの根拠も実行計画',
      '(`operation-plans.ts`)が運んでいる。設計図が写すと、期待と執行が同じ写し間違いを',
      '共有してしまう。',
      '',
      '**ここに無い集約は、world を宣言から作れないと判定された集約である**(執行点の条件が',
      'DSL 外・数の上限・状態依存・トリガが参照先を決める)。理由は verify の T11 が報告する。',
    ]),
    `export const eqWorlds = ${renderLiteral(worlds)} as const satisfies Readonly<Record<string, EqWorld>>;`,
    '',
    docComment(['一致の証明を生成した集約の全数(集約名順)。']),
    'export const eqAggregates: readonly string[] = Object.keys(eqWorlds);',
    '',
    ...EQ_SAVE_TYPES,
    '',
    docComment([
      '保存点ごとの world と組み合わせ(world を宣言から作れる保存点だけ)。',
      '',
      '鍵は実行計画(`usecase-plans.ts`)と同じ `{ユースケース名}.{保存点 ID}` である。',
      '**world に置くのは「読む集約」と「作る行が指す集約」と「動かすだけの集約」だけ**であり、',
      '保存点が作る集約の行は置かない —— それは保存点自身が作る。だから「行を宣言から置けない',
      '集約」を作る保存点でも、world は作れる。',
      '',
      '**判定の材料はここに無い** —— 規則の表もガードの変数もロールの根拠も実行計画',
      '(`usecase-plans.ts`)が運んでおり、期待は実行器の `decideStep` が手順の順に出す。',
      '',
      '**ここに無い保存点は、world を宣言から作れないと判定された保存点である**。理由は verify の',
      'T11 が warning で報告する。',
    ]),
    `export const eqSaveWorlds = ${renderLiteral(saves)} as const satisfies Readonly<Record<string, EqSaveWorld>>;`,
    '',
    docComment(['一致の証明を生成した保存点の全数(鍵の順)。']),
    'export const eqSaveKeys: readonly string[] = Object.keys(eqSaveWorlds);',
    '',
  ].join('\n');
}
