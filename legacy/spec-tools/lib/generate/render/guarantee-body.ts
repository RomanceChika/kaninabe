/**
 * 保証台帳(docs/specs/backend/guarantees.md)の本文ブロックの生成器。
 *
 * YAML フロントマターが正であり、本文はその展開にすぎない(生成は情報を足さない)。
 * 出すのは 3 つ — **保証の全数**(執行者・状態・見張りテスト込み)・**未執行の理由**
 * (`status: planned` だけを抜いた表。Z2 の warning と同じ母集合)・**テストケース**。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { GuaranteeCatalogSpec } from '../../model/guarantee/types.js';
import { cell, markdownTable, withLabel } from '../../gen-kit/state-machine-table.js';
import { GUARANTEE_TABLE_HEADING } from './guarantee-headings.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { FRAMEWORK_GUARANTEES_FILE } from '../../io/framework-paths.js';
import { frameworkLedgerOf } from '../framework-ledger-context.js';

/** 差し込み先(リポジトリルート相対)。 */
export function guaranteesFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/guarantees.md');
}

/** 執行者の表示名を引く。 */
function enforcerLabels(catalog: GuaranteeCatalogSpec): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const term of catalog.vocabulary.enforcer) {
    if (term.label !== undefined) labels.set(term.id, term.label);
  }
  return labels;
}

/** 保証の全数(1 行 = 保証 1 件)。 */
function guaranteeSection(catalog: GuaranteeCatalogSpec): string {
  const labels = enforcerLabels(catalog);
  const rows = catalog.guarantees.map((decl) => [
    cell(`\`${decl.id}\``),
    cell(decl.label),
    cell(decl.enforcedBy.map((id) => withLabel(id, labels.get(id))).join(', ')),
    cell(decl.status),
    cell((decl.canaries ?? []).map((id) => `\`${id}\``).join(', ') || '—'),
    cell(decl.summary),
  ]);
  return [
    `### ${GUARANTEE_TABLE_HEADING}`,
    '',
    markdownTable(['保証 ID', '何が起こりえないか', '執行者', '状態', '見張りテスト', 'summary'], rows),
  ].join('\n');
}

/** `status: planned` だけを抜いた理由の表(Z2 の warning と同じ母集合)。 */
function plannedSection(catalog: GuaranteeCatalogSpec): string {
  const planned = catalog.guarantees.filter((decl) => decl.status === 'planned');
  if (planned.length === 0) {
    return '### まだ執行されていない保証\n\n無し(すべて enforced)。';
  }
  const rows = planned.map((decl) => [cell(`\`${decl.id}\``), cell(decl.label), cell(decl.plannedReason ?? '')]);
  return [
    `### まだ執行されていない保証(${planned.length} 件。\`npm run verify\` の Z2 が毎回 warning を出す)`,
    '',
    markdownTable(['保証 ID', '何が起こりえないか', '理由'], rows),
  ].join('\n');
}

/** テストケースの台帳。 */
function testCaseSection(catalog: GuaranteeCatalogSpec): string {
  const rows = catalog.testCases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    cell((testCase.covers ?? []).join(', ')),
    cell(testCase.specIds.join(', ')),
    cell(`\`${testCase.implementation.raw}\``),
  ]);
  return [
    '### テストケース',
    '',
    markdownTable(['ID', 'type', 'covers', 'spec_ids', 'implementation'], rows),
  ].join('\n');
}

/** 本文ブロックの中身(製品の台帳も仕組みの台帳も同じ形)。 */
function bodyContent(catalog: GuaranteeCatalogSpec): string {
  return [guaranteeSection(catalog), plannedSection(catalog), testCaseSection(catalog)].join('\n\n');
}

/**
 * 保証台帳の本文ブロックを生成するジェネレーター。
 * 出力は guarantees.md の `guarantee-body` マーカー 1 か所。
 */
export const guaranteeBodyGenerator: DocGenerator = {
  id: 'guarantee-body',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.guarantees?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [{ file: guaranteesFile(ctx.roots), marker: 'guarantee-body', content: bodyContent(catalog) }];
  },
};

/**
 * 仕組みの保証台帳(`framework/guarantees.md`)の本文ブロックを生成するジェネレーター(製品の台帳と同じ本文を、台帳ごとの書き先へ)。
 *
 * 書くのは**仕組みの台帳が自分の木にあるとき**だけ(別の製品の木を生成するとき、道具の木の台帳へ書き込まない)。
 * 台帳を読めなかった(阻害)ときは何も出さず、書き先の本文は前のまま残る —— 読めなかったことは章の表が名指しし、
 * 検証(Z3)が error で言う。生成器は投げない。
 */
export const frameworkGuaranteeBodyGenerator: DocGenerator = {
  id: 'framework-guarantee-body',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const input = frameworkLedgerOf(ctx);
    if (input === undefined || !input.ownTree || input.load.state !== 'loaded') return [];
    const catalog = input.load.model.catalog;
    if (catalog === null) return [];
    return [{ file: FRAMEWORK_GUARANTEES_FILE, marker: 'guarantee-body', content: bodyContent(catalog) }];
  },
};
