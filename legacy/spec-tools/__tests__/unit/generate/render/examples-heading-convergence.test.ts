/**
 * 「書き方の例」章が引く保証台帳の見出しは、**1 回の generate で揃う**ことの固定。
 *
 * 見出しの綴りは `guarantee-headings.ts` の定数 1 つで、台帳の本文を出す生成器と章の目録の両方が参照する。
 * ただし章が抜粋を引くディスクの本文は前回の生成結果なので、見出しを変えた回は新しい見出しを持たない。
 * そこで章は、この回の生成結果を当てた本文(`examples-page-overlay.ts`)から引く。
 *
 * ここでは定数を変えた状態(`vi.mock`)で、
 *   - 1 回の生成で章が落ちず、新しい見出しの節を抜粋すること
 *   - その結果を書いたあとの 2 回目が同じ内容になり、鮮度の検査(`check`)が古いと言わないこと
 * を、使い捨ての置き場に対して本物の適用器(`applyGeneratedSections`)で確かめる。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { applyGeneratedSections } from '../../../../lib/generate/apply-sections.js';
import { writableTreesOf } from '../../../../lib/generate/write-gate.js';
import type { FileSection } from '../../../../lib/generate/apply-sections.js';
import type { DocGenerator } from '../../../../lib/gen-kit/generator.js';
import { guaranteeBodyGenerator } from '../../../../lib/generate/render/guarantee-body.js';
import { generatedFileTexts } from '../../../../lib/generate/render/book/examples-page-overlay.js';
import { exampleCategoriesRest } from '../../../../lib/generate/render/book/examples-page-catalog-rest.js';
import { resolveExamples } from '../../../../lib/generate/render/book/examples-page-render.js';
import type { ExampleCategory } from '../../../../lib/generate/render/book/examples-page-types.js';
import { specPath } from '../../../../lib/model/product/paths.js';
import { guarantee, guaranteeModel } from '../../../helpers/guarantee-builder.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

// 見出しの定数を、台帳に今書いてあるものとは別の綴りにする(本番の定数を書き換えずに「見出しを直した回」を作る)。
vi.mock('../../../../lib/generate/render/guarantee-headings.js', () => ({
  GUARANTEE_TABLE_HEADING: '保証の全数(見出しを直した後の綴り)',
}));

const OLD_HEADING = '保証の全数(直す前の綴り)';
const NEW_HEADING = '保証の全数(見出しを直した後の綴り)';
const GUARANTEES_FILE = specPath(TEST_ROOTS, 'backend/guarantees.md');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** 前回の生成結果(古い見出し)が書かれた使い捨ての置き場。 */
function repoWithOldHeading(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'examples-heading-'));
  scratch.push(root);
  mkdirSync(path.dirname(path.join(root, GUARANTEES_FILE)), { recursive: true });
  writeFileSync(
    path.join(root, GUARANTEES_FILE),
    ['# 保証台帳', '', '<!-- AUTO-GENERATED:guarantee-body -->', `### ${OLD_HEADING}`, '', '| 古い表 |', '<!-- /AUTO-GENERATED:guarantee-body -->', ''].join('\n'),
  );
  return root;
}

/** 目録のうち、保証台帳の表を抜粋する最初の 1 手だけ(2 手目はコードの印で、使い捨ての置き場には無い)。 */
function guaranteeLedgerCategory(): ExampleCategory {
  const category = exampleCategoriesRest(TEST_ROOTS, TEST_LAYOUT).find((entry) => entry.title.startsWith('保証の見張りテスト'));
  const example = category?.examples[0];
  if (category === undefined || example === undefined) throw new Error('目録に保証の見張りテストの節が無い');
  return { ...category, examples: [{ ...example, steps: example.steps.slice(0, 1) }] };
}

const model = guaranteeModel([guarantee('rows_by_rls', { label: '見えてはいけない行は返らない' })]);
const ctxOf = (root: string) => ({ guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guarantees: model, repoRoot: root });

/** 1 回ぶんの generate(台帳の本文と章を出し、`check` か書き込みで適用する)。 */
function generateOnce(root: string, check: boolean): { readonly chapter: string; readonly stale: readonly string[] } {
  const ctx = ctxOf(root);
  const chapter = JSON.stringify(resolveExamples([guaranteeLedgerCategory()], root, [], generatedFileTexts(specModel([]), ctx)));
  const byFile = new Map<string, FileSection[]>();
  byFile.set(GUARANTEES_FILE, [...guaranteeBodyGenerator.generate(specModel([]), ctx)]);
  const result = applyGeneratedSections(byFile, root, { check, trees: writableTreesOf(TEST_ROOTS, { ownFrameworkTree: false }) });
  return { chapter, stale: result.stale };
}

describe('保証台帳の見出しを直した回: generate は 1 回で揃う', () => {
  it('ディスクだけを読むと、新しい見出しを見失って章の生成が落ちる(直す前の挙動)', () => {
    const root = repoWithOldHeading();

    expect(() => resolveExamples([guaranteeLedgerCategory()], root, [])).toThrow(NEW_HEADING);
  });

  it('この回の生成結果を当てると、1 回目で落ちず、新しい見出しの節を抜粋する', () => {
    const root = repoWithOldHeading();

    const first = generateOnce(root, false);

    expect(first.chapter).toContain(`### ${NEW_HEADING}`);
    expect(first.chapter).not.toContain(OLD_HEADING);
    expect(readFileSync(path.join(root, GUARANTEES_FILE), 'utf-8')).toContain(`### ${NEW_HEADING}`);
  });

  it('1 回書いたあとの 2 回目は同じ章になり、鮮度の検査が古いと言わない', () => {
    const root = repoWithOldHeading();

    const first = generateOnce(root, false);
    const second = generateOnce(root, true);

    expect(second.chapter).toBe(first.chapter);
    expect(second.stale).toEqual([]);
  });
});

describe('generatedFileTexts: 重ねるのは、本文とマーカーがあるときだけ', () => {
  it('リポジトリの起点が無ければ空', () => {
    const { repoRoot: _unused, ...withoutRoot } = ctxOf('/nowhere');

    expect(generatedFileTexts(specModel([]), withoutRoot).size).toBe(0);
  });

  it('台帳のファイルが無ければ飛ばす(生成器は何も書かないので、重ねるものも無い)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'examples-heading-'));
    scratch.push(root);

    expect(generatedFileTexts(specModel([]), ctxOf(root)).size).toBe(0);
  });

  it('マーカーの無い本文は重ねない', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'examples-heading-'));
    scratch.push(root);
    mkdirSync(path.dirname(path.join(root, GUARANTEES_FILE)), { recursive: true });
    writeFileSync(path.join(root, GUARANTEES_FILE), '# マーカーが無い\n');

    expect(generatedFileTexts(specModel([]), ctxOf(root)).size).toBe(0);
  });

  it('ファイル全体を出す生成器(マーカーが無い節)は重ねない', () => {
    const root = repoWithOldHeading();
    const wholeFile: DocGenerator = {
      id: 'whole-file',
      generate: () => [{ file: GUARANTEES_FILE, content: '全体', wholeFile: true }],
    };

    expect(generatedFileTexts(specModel([]), ctxOf(root), [wholeFile]).size).toBe(0);
  });
});
