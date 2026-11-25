/**
 * 認証フローの関門(auth)が阻害のとき、到達に依る生成物が「確かめていない」と書く(入力の状態-g)。
 *
 * 以前は生成側が `auth` の関門を空にして探索し、**関門が読めない**構成でも「到達 0」「可視性: 無し」と断定した
 * (入れない画面にも入れると見積もる)。今は関門の入力の状態を文脈に載せ(`GenerateContext.gates`)、阻害なら
 * L2 の「到達」「着地」「可視性」の欄とタスクの章の「画面」「前提」の欄が「auth が阻害のため確かめていない」と書く。
 *
 * **阻害の構成だけが変わる**: 関門を読込済みで渡した文脈・渡さない文脈(従来の挙動)は、出力が 1 バイトも違わない。
 * 題材 stores(画面・認証フロー・ユースケースを持つ)の文脈で見る。
 */

import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';
import { blockedInput, UNSELECTED } from '../../helpers/verify-inputs.js';
import { loadSpecModel } from '../../../lib/model/loader.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { specPath } from '../../../lib/model/product/paths.js';
import { completeGenerateContext } from '../../../lib/generate/generate-context.js';
import { readGenerateInputs } from '../../../lib/generate/generate-inputs.js';
import { loadedGates } from '../../../lib/relations/screen-reachability/index.js';
import { buildL2SweepRows } from '../../../lib/generate/render/l2-sweep.js';
import { bookHtmlPage, pageText } from '../../helpers/book-html.js';
import type { GenerateContext } from '../../../lib/gen-kit/generator.js';
import type { AuthGateDecl } from '../../../lib/model/auth/types.js';
import type { CatalogInput } from '../../../lib/kernel/input-state.js';
import type { SpecModel } from '../../../lib/model/types.js';

const SAMPLE = path.join(import.meta.dirname, '../../fixtures/samples/stores');

let model: SpecModel;
let base: GenerateContext;

beforeAll(() => {
  const roots = loadProductRoots(SAMPLE).model.roots;
  if (roots === null) throw new Error('題材の product.md を読めません');
  const loaded = loadSpecModel(path.join(SAMPLE, specPath(roots, 'domain'))).model;
  if (loaded === null) throw new Error('題材のドメイン仕様を読めません');
  model = loaded;
  base = completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, TEST_LAYOUT, model, readGenerateInputs(SAMPLE, roots, TEST_LAYOUT), null, null);
});

/** 関門の入力の状態を差した文脈。 */
const withGates = (gates: CatalogInput<readonly AuthGateDecl[]>): GenerateContext => ({ ...base, gates });

/** L2 の「到達」「着地」「可視性」の欄(行の extra)を全部集める。 */
function extrasOf(ctx: GenerateContext): string[] {
  return buildL2SweepRows(model, ctx).flatMap((row) => row.extra ?? []);
}

/** タスクの章(HTML の本)の本文の字。 */
function usecasesPage(ctx: GenerateContext): string {
  return pageText(bookHtmlPage(model, ctx, 'usecases.html') ?? '');
}

/** 手引き(HTML の本)の本文の字。 */
function guidePage(ctx: GenerateContext): string {
  return pageText(bookHtmlPage(model, ctx, 'review-guide.html') ?? '');
}

describe('関門が阻害のとき', () => {
  /** 阻害の関門を差した文脈(`base` は beforeAll で組むので、使うときに作る)。 */
  const blockedCtx = (): GenerateContext => withGates(blockedInput('invalid'));

  it('L2 の「到達」「着地」「可視性」の欄が、空の関門で探索した値ではなく「確かめていない」を書く', () => {
    const extras = extrasOf(blockedCtx());

    expect(extras.length).toBeGreaterThan(0);
    for (const cell of extras) expect(cell).toMatch(/^(到達|着地|可視性)は auth が阻害のため確かめていない$/);
    expect(extras.some((cell) => cell === '到達は auth が阻害のため確かめていない')).toBe(true);
    expect(extras.some((cell) => cell === '着地は auth が阻害のため確かめていない')).toBe(true);
    expect(extras.some((cell) => cell === '可視性は auth が阻害のため確かめていない')).toBe(true);
  });

  it('タスクの章は「画面」「前提」の予算の実測を数字で書かず、未検証と書く', () => {
    const page = usecasesPage(blockedCtx());

    expect(page).toContain('未検証(到達は auth が阻害のため確かめていない)');
    expect(page).toContain('未検証(前提は auth が阻害のため確かめていない)');
    // 手数・概念・入力・確認は関門に依らないので、従来どおり数字で書く。
    expect(page).toMatch(/① 手数\(保存の回数\) \| \d+/);
  });

  it('手引きの「タスクから読む」節は、到達不能と断定せず未検証と書く', () => {
    const guide = guidePage(blockedCtx());

    expect(guide).toContain('(未検証。到達は auth が阻害のため確かめていない)');
    expect(guide).not.toContain('到達不能');
  });
});

describe('関門が阻害でないとき(全部入りの出力は変わらない)', () => {
  it('関門を渡さない文脈(従来)と、読込済みで渡した文脈・未選択で渡した文脈の出力は同じ。未選択は関門が無い事実なので「確かめていない」とは書かない', () => {
    const gates = base.auth?.flow?.gates ?? [];

    for (const ctx of [withGates(loadedGates(gates))]) {
      expect(extrasOf(ctx)).toEqual(extrasOf(base));
      expect(usecasesPage(ctx)).toBe(usecasesPage(base));
      expect(guidePage(ctx)).toBe(guidePage(base));
    }
    const unselected = withGates(UNSELECTED);
    expect(extrasOf(unselected).some((cell) => cell.includes('阻害'))).toBe(false);
    expect(usecasesPage(unselected)).not.toContain('auth が阻害のため');
  });

  it('読込済みの文脈の欄には、実際の到達・着地・可視性が書かれている(阻害の文言でない)', () => {
    const extras = extrasOf(base);

    expect(extras.some((cell) => cell.includes('→'))).toBe(true);
    expect(extras.every((cell) => !cell.includes('auth が阻害のため'))).toBe(true);
  });
});
