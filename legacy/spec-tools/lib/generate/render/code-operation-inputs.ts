/**
 * action_spec の `input` → **単発の操作の入力スキーマ**(`app/src/domain/generated/operation-inputs.ts`)。
 *
 * **制約は 1 つも再宣言しない。** 欄は生成済みの `{entity}InputSchema` / `{entity}RowSchema` から
 * `.pick` で借りるだけであり、entity_spec が正であることは変わらない(PRIN-0001 / PRIN-0007)。
 * 実行者が供給する欄(`p_actor_id` 由来)と `supplied_by: db` の欄は解決器が入力から外しているので、
 * ここにも現れない —— クライアントから渡された実行者 ID を信用しない(PRIN-0009)。例外は表の `derives` が `mode: insert_at` で埋める
 * 末尾の番号の欄で、作成の入力に任意で現れ、行のスキーマから `.partial()` で借りる(振り分けは `create-input-pick.ts`。fix25s)。
 *
 * ## 形ごとに借りる先が違う
 *
 * | 形 | 借りる先 | なぜ |
 * |---|---|---|
 * | 作成 | `{entity}InputSchema`(`id` / `state` を含まない)の欄を `z.strictObject` で閉じる | 生まれる行の値。識別子は採番される |
 * | 遷移・削除 | `{entity}RowSchema` の `id` + 追加の入力欄 | 対象を指すだけ(`id` は作成入力に無い) |
 * | 編集 | `{entity}RowSchema` の `id` + 変更集合(`partial`) | 「空にする」を表すには `nullable` が要る(作成入力の `optional` では消せない) |
 *
 * **どの形も閉世界**(宣言に無い鍵は `unrecognized_keys` で断る。点検 25 回目 O25-2)。遷移・削除・編集は行のスキーマ(`strictObject`)から
 * 借りるので閉じている。作成の `{entity}InputSchema` は開世界(`z.object`。フォームの部品が欄を借りる)なので、借りた欄の `shape` を
 * `z.strictObject` で包み直す —— 開いたままだと、作成の口から外した欄(`supplied_by: db` に移した発表順)を送る古い呼び手の鍵が黙って剥がされる。
 *
 * 編集だけ「変更が 1 つも無い呼び出し」を弾く —— 何も起きない要求は送った側から見て成功とも
 * 失敗とも読めない(定型の実行器も同じ規則で数える。二段で塞ぐ)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltOperation } from '../../usecase/operation-plan.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';
import { generatedFile, docComment, generatedHeader, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { INPUT_ERRORS } from '../../messages/messages.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';
import { RUNTIME_FORM_CHANGES_MODULE } from './runtime-modules.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import { createPickSpreads, splitCreateKeys } from './create-input-pick.js';

/** 出力先(1 ファイルに全操作ぶん)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'operation-inputs.ts');

/** 「変更が 1 つも無い」を弾くときの指摘の宛先(`_template` の定型と同じ 1 語)。 */
const EMPTY_CHANGES_FIELD = 'changes';

/**
 * 全 action_spec から単発の操作の入力スキーマを生成するジェネレーター。
 * 出力は `app/src/domain/generated/operation-inputs.ts`(ファイル全体)。
 */
export const operationInputsGenerator: DocGenerator = {
  id: 'code-operation-inputs',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const built = buildOperationPlans({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions,
      dataTables: ctx.dataTables,
      jobs: ctx.jobs,
    });
    if (built.operations.length === 0) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(built.operations, ctx.roots, model), wholeFile: true }];
  },
};

/** その操作の入力欄(手順は 1 つなので 1 手順ぶん)。 */
function inputKeysOf(operation: BuiltOperation): readonly string[] {
  return operation.facts.steps[0]?.inputKeys ?? [];
}

/** その操作の形(手順は 1 つ)。 */
function kindOf(operation: BuiltOperation): string {
  return operation.plan.steps[0]?.kind ?? 'create';
}

/** その操作の集約のエンティティ名(export 名の材料)。 */
function entityOf(operation: BuiltOperation): string {
  return operation.plan.steps[0]?.entity ?? '';
}

/**
 * 生成 zod スキーマの置き場(`{集約}.schema.ts`)。
 *
 * **集約ディレクトリ名とエンティティ名は一致しないことがある**(`program` の entity は
 * `program_item`)。ファイル名は集約、export 名はエンティティで決まる(`code-zod.ts`)。
 */
function schemaModuleOf(operation: BuiltOperation): string {
  return operation.plan.steps[0]?.aggregate ?? '';
}

/** ファイル全体を組み立てる。 */
function renderFile(operations: readonly BuiltOperation[], roots: ProductRoots, model: SpecModel): string {
  const specFiles = [...new Set(operations.map((op) => specPath(roots, `backend/actions/${op.plan.usecase.relPath}`)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const needsChangeCheck = operations.some((operation) => kindOf(operation) === 'update');
  const entries = operations.map(
    (operation) => `  ${tsString(operation.op)}: ${schemaExpression(operation, model)},`,
  );
  // zod を使うのは作成の閉世界の包み(`z.strictObject`)だけ(あとは生成スキーマから借りる)。使わない import は lint が落とす。
  const needsZod = entries.some((entry) => entry.includes('z.'));
  return [
    generatedHeader(specFiles),
    '',
    ...(needsZod ? ["import { z } from 'zod';"] : []),
    ...(needsChangeCheck ? [`import { hasAnyChange } from '${RUNTIME_FORM_CHANGES_MODULE}';`] : []),
    ...schemaImports(operations, model),
    '',
    docComment([
      '単発の操作の入力スキーマ(操作 ID → zod)。',
      '',
      '**Server Action と画面フォームはここを共有する**(server-actions.md)。画面が事前に',
      '検証していてもサーバー側の検証は省略しない —— クライアントの検証は UX であり関門ではない',
      '(PRIN-0009)。',
      '',
      '**ここに無い操作は実行計画が導出できなかったものである**(一覧は verify の A15)。',
    ]),
    `export const operationInputSchemas = {\n${entries.join('\n')}\n} as const;`,
    '',
    docComment(['入力スキーマを持つ操作 ID の値域。']),
    'export type OperationInputKey = keyof typeof operationInputSchemas;',
    '',
  ].join('\n');
}

/** 借りる生成スキーマの import 行(重複なし・名前順)。 */
function schemaImports(operations: readonly BuiltOperation[], model: SpecModel): readonly string[] {
  const lines = new Set<string>();
  for (const operation of operations) {
    const camel = toCamelCase(entityOf(operation));
    const kind = kindOf(operation);
    const extra = inputKeysOf(operation).filter((key) => key !== 'id');
    // 入力を 1 つも受けない作成(値はすべて DB と実行者が決める)は、借りる先が無い。
    const names = new Set<string>(kind === 'create' && extra.length === 0 ? [] : []);
    if (kind === 'create') {
      const split = createSplit(operation, model);
      if (split.given.length > 0) names.add(`${camel}InputSchema`);
      if (split.positional.length > 0) names.add(`${camel}RowSchema`);
    } else names.add(`${camel}RowSchema`);
    // 遷移・削除で追加の入力欄がある操作だけ、その欄を作成入力スキーマから借りる。
    if (extra.length > 0 && (kind === 'transition' || kind === 'delete')) names.add(`${camel}InputSchema`);
    if (names.size === 0) continue;
    lines.add(`import { ${[...names].sort().join(', ')} } from './${schemaModuleOf(operation)}.schema';`);
  }
  // 同じ集約に 2 種類の import 行ができうるので、集約ごとに名前をまとめ直す。
  return mergeImports([...lines]);
}

/** 同じモジュールへの import 行を 1 本にまとめる。 */
function mergeImports(lines: readonly string[]): readonly string[] {
  const byModule = new Map<string, Set<string>>();
  for (const line of lines) {
    const match = /^import \{ (.+) \} from '(.+)';$/.exec(line);
    if (match === null) continue;
    const names = byModule.get(match[2] ?? '') ?? new Set<string>();
    for (const name of (match[1] ?? '').split(', ')) names.add(name);
    byModule.set(match[2] ?? '', names);
  }
  return [...byModule.entries()]
    .map(([module, names]) => `import { ${[...names].sort().join(', ')} } from '${module}';`)
    .sort((a, b) => a.localeCompare(b));
}

/** 作成の入力欄の振り分け(作成入力の部品から借りる欄 / 行のスキーマから任意で借りる位置の欄。`create-input-pick.ts`)。 */
function createSplit(operation: BuiltOperation, model: SpecModel): ReturnType<typeof splitCreateKeys> {
  return splitCreateKeys(inputKeysOf(operation), findEntityFields(model, entityOf(operation)) ?? []);
}

/** 操作 1 つのスキーマ式。 */
function schemaExpression(operation: BuiltOperation, model: SpecModel): string {
  const camel = toCamelCase(entityOf(operation));
  const keys = inputKeysOf(operation);
  const others = keys.filter((key) => key !== 'id');
  if (kindOf(operation) === 'create') {
    const split = createSplit(operation, model);
    if (split.positional.length > 0) return `z.strictObject({ ${createPickSpreads(entityOf(operation), split).join(', ')} })`;
    return others.length === 0 ? 'z.strictObject({})' : `z.strictObject(${pick(`${camel}InputSchema`, others)}.shape)`;
  }
  const id = pick(`${camel}RowSchema`, ['id']);
  if (kindOf(operation) === 'update') {
    const changes = `${pick(`${camel}RowSchema`, others)}.partial()`;
    return (
      `${id}.extend(${changes}.shape).refine(hasAnyChange, {\n` +
      `    error: ${tsString(INPUT_ERRORS.noFieldSelected())},\n` +
      `    path: [${tsString(EMPTY_CHANGES_FIELD)}],\n` +
      '  })'
    );
  }
  if (others.length === 0) return id;
  return `${id}.extend(${pick(`${camel}InputSchema`, others)}.shape)`;
}

/** `.pick({ a: true, b: true })`(欄が無ければ空の閉じたオブジェクトスキーマ)。 */
function pick(schema: string, keys: readonly string[]): string {
  if (keys.length === 0) return 'z.strictObject({})';
  return `${schema}.pick({ ${keys.map((key) => `${key}: true`).join(', ')} })`;
}
