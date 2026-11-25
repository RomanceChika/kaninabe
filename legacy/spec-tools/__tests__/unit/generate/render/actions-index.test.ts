/**
 * 操作の索引(specs/backend/actions/README.md の actions-index ブロック)の生成器のテスト。
 *
 * 差し込み先・0 件時の表記に加え、**索引の表がハンドブックの章(HTML の本の操作の章 book/html/actions-chapter.ts)と
 * 同じ操作の集合を持つこと**を検める — 両者は actions-view.ts の同じ行データから組み立てる
 * (2 か所で別々に集計すると集合がずれる、という穴を塞ぐための突合)。
 */

import { describe, expect, it } from 'vitest';

import { actionsIndexGenerator } from '../../../../lib/generate/render/actions-index.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import { accessSpec, aggregate, create, entitySpec, event, machine, specModel } from '../../../helpers/model-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

function fixtureModel() {
  const workshop = aggregate('workshop', {
    entity: entitySpec('workshop'),
    stateMachines: [
      machine('workshop', {
        states: ['draft', 'accepting'],
        initial: 'draft',
        events: [event('publish', { from: ['draft'], to: 'accepting', by: ['organizer'] })],
      }),
    ],
  });
  const member = aggregate('member', {
    entity: entitySpec('member'),
    access: accessSpec('member', { creates: [create('staff')] }),
  });
  return specModel([workshop, member]);
}

function ctxWith(actions: ReturnType<typeof actionSpec>[]) {
  return {
    ...GEN_CTX,
    actions: { actions, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
  };
}

describe('actionsIndexGenerator: 出力先', () => {
  it('specs/backend/actions/README.md の actions-index マーカーに差し込む', () => {
    const ctx = ctxWith([actionSpec({ handles: 'workshop.publish' })]);
    const [section] = actionsIndexGenerator.generate(fixtureModel(), ctx);

    expect(actionsIndexGenerator.id).toBe('actions-index');
    expect(section?.file).toBe('docs/specs/backend/actions/README.md');
    expect(section?.marker).toBe('actions-index');
  });

  it('action_spec を読めていない環境では何も生成しない', () => {
    expect(actionsIndexGenerator.generate(fixtureModel(), GEN_CTX)).toEqual([]);
  });

  it('置き場はあるが 0 件なら「まだ無い」と書く', () => {
    const [section] = actionsIndexGenerator.generate(fixtureModel(), ctxWith([]));

    expect(section?.content).toContain('まだ action_spec はありません');
  });
});

describe('actionsIndexGenerator: 索引の中身', () => {
  it('操作 ID・誰が実行できるか・仕様ファイルへの相対リンクを 1 行に並べる', () => {
    const ctx = ctxWith([actionSpec({ handles: 'member.create', relPath: 'member/create.md' })]);
    const [section] = actionsIndexGenerator.generate(fixtureModel(), ctx);

    expect(section?.content).toContain(
      '| `member.create` | staff | [member/create.md](./member/create.md) |',
    );
  });
});

describe('actionsIndexGenerator ⇔ HTML の本の操作の章: 操作の集合が一致する', () => {
  it('索引の表に載る操作 ID の集合は、ハンドブックの章に載る集合と同じになる', () => {
    const actions = [
      actionSpec({ handles: 'workshop.publish' }),
      actionSpec({ handles: 'member.create', relPath: 'member/create.md' }),
    ];
    const ctx = ctxWith(actions);
    const model = fixtureModel();

    const [indexSection] = actionsIndexGenerator.generate(model, ctx);
    const [bookSection] = bookChapterSections(model, ctx, 'actions.html');
    const indexIds = [...(indexSection?.content.matchAll(/\| `([a-z_.]+)` \|/g) ?? [])].map((m) => m[1]);
    const bookIds = [...pageText(bookSection?.content ?? '').matchAll(/^([a-z_]+\.[a-z_]+) \|/gm)].map((m) => m[1]);

    expect(indexIds.sort()).toEqual(['workshop.publish', 'member.create'].sort());
    expect(indexIds.sort()).toEqual([...bookIds].sort());
  });
});
