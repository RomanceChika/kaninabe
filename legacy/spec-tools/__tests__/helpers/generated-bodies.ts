/**
 * 生成テスト 3 種とハーネスのアダプタの**本文**(生成器の出力)を、置き場の配置を指定して集めるテスト用の道具。
 *
 * 本文の相対 import(`layout-body-imports.ts` の表)を、表の自己確認ではなく**生成器の出力**と突き合わせるために使う。
 * 題材は 6 題材の 1 つ(実装の木を宣言し、実 DB で実行する 3 種の生成テストが出る)。
 */

import path from 'node:path';
import { completeGenerateContext } from '../../lib/generate/generate-context.js';
import { readGenerateInputs } from '../../lib/generate/generate-inputs.js';
import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import { eqSaveTestsGenerator } from '../../lib/generate/render/code-eq-save-tests.js';
import { equivalenceTestsGenerator } from '../../lib/generate/render/code-equivalence-tests.js';
import { harnessAdapterSections } from '../../lib/generate/render/code-harness-adapters.js';
import { rlsBehaviourTestsGenerator } from '../../lib/generate/render/code-rls-behaviour-tests.js';
import { loadSpecModel } from '../../lib/model/loader.js';
import { sourceRootPath } from '../../lib/model/product/layout.js';
import type { ProductLayout, LayoutRole } from '../../lib/model/product/layout.js';
import { loadProductRoots } from '../../lib/model/product/loader.js';
import { specPath } from '../../lib/model/product/paths.js';
import { TEST_PLATFORM } from './platform.js';

/** 本文を書く役割ごとにまとめた生成物 1 本。 */
export interface GeneratedBody {
  /** 本文を書く役割(相対の起点)。 */
  readonly role: LayoutRole;
  /** 書く先(製品の根からの相対。置き場の配置が決める)。 */
  readonly file: string;
  /** 本文。 */
  readonly content: string;
}

/** 題材(6 題材の 1 つ)の置き場。 */
const SAMPLE = path.join(import.meta.dirname, '../fixtures/samples/library');

/** 題材の生成の文脈を、指定した配置で作る。 */
function contextOf(layout: ProductLayout): { readonly ctx: GenerateContext; readonly model: NonNullable<ReturnType<typeof loadSpecModel>['model']> } {
  const declared = loadProductRoots(SAMPLE).model.roots;
  if (declared === null) throw new Error('題材の product.md を読めません');
  // 生成物の総置き場は製品の宣言が決める。配置のソースの根の外にあるなら(別の綴りの配置)、その配置のソースの根の下へ合わせる。
  const source = sourceRootPath(layout, declared);
  const roots = source === null || declared.generated.startsWith(`${source}/`) ? declared : { ...declared, generated: `${source}/domain/generated` };
  const model = loadSpecModel(path.join(SAMPLE, specPath(roots, 'domain'))).model;
  if (model === null) throw new Error('題材のドメイン仕様を読めません');
  const inputs = readGenerateInputs(SAMPLE, roots, layout);
  return { ctx: completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, layout, model, inputs, null, null), model };
}

/** アダプタの名前から、置き場の役割(保存点の一致の証明が使うアダプタは配線の層)を引く。 */
function adapterRoleOf(file: string): LayoutRole {
  return path.basename(file).startsWith('eq-save-') ? 'save-harness-adapter' : 'harness-adapter';
}

/**
 * 生成テスト 3 種(eq / rls / eq-save)とアダプタ 6 本の本文を、指定した配置で集める。
 *
 * @param layout 置き場の配置
 * @returns 役割・書く先・本文(アダプタは宣言順)
 */
export function generatedBodies(layout: ProductLayout): readonly GeneratedBody[] {
  const { ctx, model } = contextOf(layout);
  const tests: readonly (readonly [LayoutRole, typeof equivalenceTestsGenerator])[] = [
    ['eq-test', equivalenceTestsGenerator],
    ['rls-test', rlsBehaviourTestsGenerator],
    ['eq-save-test', eqSaveTestsGenerator],
  ];
  return [
    ...tests.flatMap(([role, generator]) => generator.generate(model, ctx).map((section) => ({ role, file: section.file, content: section.content }))),
    ...harnessAdapterSections(ctx.roots, ctx.layout).map((section) => ({ role: adapterRoleOf(section.file), file: section.file, content: section.content })),
  ];
}
