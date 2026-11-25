/**
 * HTML の本の集約の章(`html/aggregate-chapter.ts`)と、新しい形の章からの繋ぎ(`html/spec-chapter.ts`)のテスト。
 *
 * 節が 章頭 → 前提の語 → 凡例 → 上段 → 下段 → 数の出どころ の順で、目次も同じ順・本の中の繋ぎは `.html`(仕様の原本への繋ぎのほかに `.md` へ張らない)・
 * 章頭から新しい形の章へ戻れる・検証の結果に依る部分に印が付く・仕様の文字列(要約・公理の原文)が字として逃がされることを見る。
 */

import { describe, expect, it } from 'vitest';

import type { SpecModel } from '../../../../../lib/model/types.js';
import { domainChapter } from '../../../../../lib/generate/render/book/html/aggregate-chapter.js';
import { domainHref } from '../../../../../lib/generate/render/book/html/aggregate-env.js';
import { aggregateChapter } from '../../../../../lib/generate/render/book/html/spec-chapter.js';
import { bookLayout } from '../../../../../lib/generate/render/book/face-scope.js';
import { SPEC_LEAD } from '../../../../../lib/generate/render/book/spec-page.js';
import { text } from '../../../../../lib/generate/render/book/html/markup.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';

const HOSTILE = '<img src=x onerror=alert(1)>';

/** 催しの要約・段の場面・公理の原文を、敵意のある文字列に差し替えた仕様。 */
function hostileModel(): SpecModel {
  const model = bookModel();
  const workshop = model.aggregates.get('workshop');
  if (workshop?.entity === undefined || workshop.invariants === undefined) throw new Error('fixture');
  const [machine] = workshop.stateMachines;
  if (machine === undefined) throw new Error('fixture');
  const patched = {
    ...workshop,
    entity: { ...workshop.entity, summary: HOSTILE },
    stateMachines: [{ ...machine, summary: HOSTILE, stateSummaries: { draft: HOSTILE } }],
    invariants: { ...workshop.invariants, invariants: workshop.invariants.invariants.map((invariant) => ({ ...invariant, statement: HOSTILE })) },
  };
  return { ...model, aggregates: new Map([...model.aggregates, ['workshop', patched]]) };
}

describe('domainChapter', () => {
  const ctx = bookCtx();
  const model = bookModel();
  const chapter = domainChapter(model, ctx, 'workshop', () => undefined);

  it('章が組める(章を持つ集約だけ。知らない集約は null)', () => {
    expect(chapter).not.toBeNull();
    expect(domainChapter(model, ctx, 'nothing', () => undefined)).toBeNull();
  });

  it('節は 前提の語 → 凡例 → 上段 → 下段 → 数の出どころ の順で、目次も本文と同じ順', () => {
    const ids = (chapter?.headings ?? []).filter((heading) => heading.level === 2).map((heading) => heading.id);
    expect(ids.filter((id) => id !== 'terms')).toEqual(['legend', 'upper', 'lower', 'origin']);
    const positions = ids.map((id) => chapter?.body.indexOf(`<h2 id="${id}">`) ?? -1);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('上段の段は 流れ → 公理 → アクセスの宣言 → 受け入れ の順', () => {
    const ids = (chapter?.headings ?? []).filter((heading) => heading.level === 3).map((heading) => heading.id);
    const order = ['flow', 'axioms', 'access', 'changed', 'acceptance'];
    expect(ids).toEqual(order.filter((id) => ids.includes(id)));
    expect(ids).toEqual(expect.arrayContaining(['flow', 'axioms', 'access', 'acceptance']));
  });

  it('章頭から新しい形の章へ戻れる', () => {
    expect(chapter?.body).toContain('<a href="../spec/workshop.html">');
  });

  it('本の中の繋ぎは .md へ張らない(仕様の原本へ張るものを除く)', () => {
    const hrefs = [...(chapter?.body ?? '').matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(hrefs.filter((href) => /\.md(#|$)/.test(href) && !href.includes('specs/'))).toEqual([]);
    expect(hrefs).toContain('../review-guide.html');
  });

  it('検証の結果に依る部分(必読・受け入れの枚・凡例・受け入れの節)に印が付く', () => {
    const marked = (chapter?.body.match(/data-dep="verify"/g) ?? []).length;
    expect(marked).toBeGreaterThanOrEqual(6);
  });

  it('公理の行と原文の折りたたみ・状態の段が出る', () => {
    expect(chapter?.body).toContain('class="bf-axiom"');
    expect(chapter?.body).toContain('data-kind="orig"');
    expect(chapter?.body).toContain('class="bf-steps"');
  });

  it('下段は折りたたみ(導出)で、全遷移の mermaid は持たない', () => {
    expect(chapter?.body).toContain('data-kind="table"');
    expect(chapter?.body).not.toMatch(/mermaid|<PanZoom/);
  });

  it('仕様の文字列(要約・段の場面・公理の原文)は字として逃がされる', () => {
    const hostile = domainChapter(hostileModel(), ctx, 'workshop', () => undefined);
    expect(hostile?.body).not.toContain('<img');
    expect(hostile?.body).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });

  it('章の URL は Markdown 版と同じ規則の拡張子違い(畳まない構成では章の名前そのまま)', () => {
    const layout = bookLayout(model, ctx);
    expect(domainHref(layout, 'workshop')).toBe('./workshop.html');
    expect(domainHref(layout, 'workshop', '../domain/')).toBe('../domain/workshop.html');
  });
});

describe('新しい形の章の頭の 1 文', () => {
  const names = { role: (role: string) => text(role), field: (field: string) => field, entity: (entity: string) => entity };

  it('旧い集約の章への繋ぎを、その集約が載る章へのリンクにする', () => {
    const chapter = aggregateChapter('題', SPEC_LEAD, [], { aggregate: 'workshop', operations: [], reads: [] }, [], { ...names, domain: '../domain/workshop.html' });
    expect(chapter.body).toContain('<a href="../domain/workshop.html">旧い集約の章</a>');
  });

  it('繋ぎ先が渡されなければ字のまま(壊れたリンクを作らない)', () => {
    const chapter = aggregateChapter('題', SPEC_LEAD, [], { aggregate: 'workshop', operations: [], reads: [] }, [], names);
    expect(chapter.body).not.toContain('domain/');
    expect(chapter.body).toContain('旧い集約の章');
  });
});
