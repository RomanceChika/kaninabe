/**
 * ハンドブックの CSS 資材(render/book/book-assets.ts)のテスト。
 *
 * 対象の要求: 「tokens.css はトークン仕様からの写像(実装側の生成物と同じレンダラー)、
 * ui.css は実装 CSS のスコープ写し。どちらも wholeFile で、入力が無い部分は出さない」。
 */

import { describe, expect, it } from 'vitest';

import { bookAssetsGenerator, PARTS_DEMO_SCOPE } from '../../../../../lib/generate/render/book/book-assets.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';

describe('bookAssetsGenerator', () => {
  it('トークン仕様があれば docs/book/assets/tokens.css を wholeFile で生成する', () => {
    const sections = bookAssetsGenerator.generate(bookModel(), bookCtx());

    expect(bookAssetsGenerator.id).toBe('book-assets');
    const tokens = sections.find((section) => section.file === 'docs/book/assets/tokens.css');
    expect(tokens?.wholeFile).toBe(true);
    expect(tokens?.content).toContain(':root {');
    expect(tokens?.content).toContain('--color-ink: #111111;');
  });

  it('実装 CSS があれば docs/book/assets/ui.css をスコープ付きで生成する(globals が先)', () => {
    const ctx = {
      ...bookCtx(),
      book: { uiCss: '.card { padding: var(--space-6); }', globalsCss: 'body { color: var(--color-text); }' },
    };
    const sections = bookAssetsGenerator.generate(bookModel(), ctx);

    const ui = sections.find((section) => section.file === 'docs/book/assets/ui.css');
    expect(ui?.wholeFile).toBe(true);
    expect(ui?.content).toContain('AUTO-GENERATED');
    expect(ui?.content).toContain(`${PARTS_DEMO_SCOPE} {\n  color: var(--color-text);\n}`);
    expect(ui?.content).toContain(`${PARTS_DEMO_SCOPE} .card {\n  padding: var(--space-6);\n}`);
    expect(ui?.content.indexOf('color: var(--color-text)')).toBeLessThan(
      ui?.content.indexOf('.card') ?? -1,
    );
  });

  it('実装 CSS を読めていなければ ui.css は出さない(要約の文の写し・tokens.css だけ)', () => {
    const sections = bookAssetsGenerator.generate(bookModel(), bookCtx());

    expect(sections.map((section) => section.file)).toEqual([
      'docs/book/assets/summaries.json',
      'docs/book/assets/tokens.css',
    ]);
  });

  it('仕様の summary(章頭の 1 文・節の要約・段の場面)を、書かれているものだけ summaries.json に写す', () => {
    const model = bookModel();
    const workshop = model.aggregates.get('workshop')!;
    const [machine] = workshop.stateMachines;
    const written = {
      ...model,
      aggregates: new Map([
        ...model.aggregates,
        [
          'workshop',
          {
            ...workshop,
            entity: { ...workshop.entity!, summary: '章頭です。' },
            stateMachines: [{ ...machine!, summary: '節です。', stateSummaries: { [machine!.states[0]!]: '場面です。' } }],
          },
        ],
      ]),
    };
    const table = bookAssetsGenerator.generate(written, bookCtx()).find((section) => section.file === 'docs/book/assets/summaries.json');
    const parsed = JSON.parse(table?.content ?? '{}') as Record<string, Record<string, string>>;

    expect(table?.wholeFile).toBe(true);
    expect(parsed.entity).toEqual({ workshop: '章頭です。' });
    expect(parsed.machine).toEqual({ [machine!.machine]: '節です。' });
    expect(parsed.state).toEqual({ [`${machine!.machine}.${machine!.states[0]!}`]: '場面です。' });
  });

  it('トークン仕様も実装 CSS も無ければ、要約の文の写しだけを生成する(書かれた文が無ければ空の写し)', () => {
    const sections = bookAssetsGenerator.generate(bookModel(), GEN_CTX);

    expect(sections.map((section) => section.file)).toEqual(['docs/book/assets/summaries.json']);
    expect(JSON.parse(sections[0]?.content ?? '{}')).toEqual({ entity: {}, machine: {}, state: {}, example: {} });
  });

  it('ctx.book.brandIconSvg があれば docs/book/assets/brand-icon.svg を実装の写しとして生成する', () => {
    const ctx = { ...bookCtx(), book: { brandIconSvg: '<svg><path d="M0 0" /></svg>' } };

    const sections = bookAssetsGenerator.generate(bookModel(), ctx);

    const brandIcon = sections.find((section) => section.file === 'docs/book/assets/brand-icon.svg');
    expect(brandIcon?.wholeFile).toBe(true);
    expect(brandIcon?.content).toBe('<svg><path d="M0 0" /></svg>');
  });

  it('brandIconSvg が無ければ brand-icon.svg は出さない', () => {
    const sections = bookAssetsGenerator.generate(bookModel(), bookCtx());

    expect(sections.some((section) => section.file === 'docs/book/assets/brand-icon.svg')).toBe(false);
  });
});
