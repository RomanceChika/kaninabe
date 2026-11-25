/**
 * パーツ見本(render/book/parts-demo.ts)の事実のテスト。
 *
 * 対象の要求: 「実装 CSS のクラスをそのまま使う静的 HTML の見本を並べる。ラベルには
 * 部品名と CSS から読み取ったトークン名を出す。状態バッジは全状態機械の全状態を、
 * 文言は仕様の label・色は実装の対応(無ければ neutral)で描く。composes は
 * マークアップが両方のクラスを書く。ui.module.css にあるのに見本に無いクラスは列挙する。
 * 実装 CSS を読めなければプレースホルダ」。
 */

import { describe, expect, it } from 'vitest';

import { partsDemoFacts } from '../../../../../lib/generate/render/book/parts-demo.js';
import { bookModel } from '../../../../helpers/book-fixture.js';

/** ラベル読み取りが分かる最小の実装 CSS(実物の写しではなくテスト用)。 */
const UI_CSS = [
  '.card { padding: var(--space-6); border: var(--border-hairline) solid var(--color-border); }',
  '.badge { border-radius: var(--radius-pill); }',
  '.badgeInfo { background: var(--color-badge-info-bg); }',
].join('\n');

const BADGE_SOURCE = [
  `const WORKSHOP_TONE = {`,
  `  draft: 'neutral',`,
  `  accepting: 'info',`,
  `} as const satisfies Record<keyof typeof workshopStateLabels, Tone>;`,
].join('\n');

/** 見本の舞台の HTML を全部つないだもの。 */
function stages(facts: ReturnType<typeof partsDemoFacts>): string {
  return (facts?.samples ?? []).map((sample) => sample.stage).join('\n');
}

describe('partsDemoFacts', () => {
  it('実装 CSS が無ければ事実を返さない(章は読めなかったと言う)', () => {
    expect(partsDemoFacts(bookModel(), undefined)).toBeNull();
  });

  it('見本は実クラスのマークアップと、CSS から読み取ったトークンを持つ', () => {
    const facts = partsDemoFacts(bookModel(), { uiCss: UI_CSS, stateBadgeSource: BADGE_SOURCE });

    expect(stages(facts)).toContain('<section class="card">');
    const card = facts?.samples.find((sample) => sample.names.includes('.card'));
    expect(card?.tokens).toContain('--space-6');
  });

  it('状態バッジは全状態を仕様の label で出し、色は実装の対応(無い状態は neutral)を写す', () => {
    const facts = partsDemoFacts(bookModel(), { uiCss: UI_CSS, stateBadgeSource: BADGE_SOURCE });

    // bookModel の workshop 状態機械: draft(下書き)/ accepting(受付中)。
    expect(stages(facts)).toContain('<span class="badge badgeNeutral" title="workshop.draft → neutral">下書き</span>');
    expect(stages(facts)).toContain('<span class="badge badgeInfo" title="workshop.accepting → info">受付中</span>');
    const workshop = facts?.badges.find((badge) => badge.machine === 'workshop');
    expect(workshop?.states.find((state) => state.state === 'accepting')).toMatchObject({ label: '受付中', tone: 'info' });
  });

  it('実装の対応が読めない状態機械は neutral で描く(実装の実行時フォールバックと同じ)', () => {
    const facts = partsDemoFacts(bookModel(), { uiCss: UI_CSS });

    expect(stages(facts)).toContain('<span class="badge badgeNeutral" title="workshop.accepting → neutral">受付中</span>');
  });

  it('composes を継ぐクラスは、マークアップが両方のクラスを書く(tdNumeric → td)', () => {
    const text = stages(partsDemoFacts(bookModel(), { uiCss: UI_CSS }));

    expect(text).toContain('class="td tdNumeric"');
    expect(text).toContain('class="bar barSpaced barMuted"');
  });

  it('ui.module.css にあるのに見本に無いクラスを列挙する(実装と見本のズレの印)', () => {
    const facts = partsDemoFacts(bookModel(), { uiCss: `${UI_CSS}\n.brandNewThing { color: var(--color-text); }` });

    expect(facts?.uncovered).toContain('brandNewThing');
  });
});
