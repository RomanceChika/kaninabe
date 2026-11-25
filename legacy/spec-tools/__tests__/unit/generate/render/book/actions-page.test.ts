/**
 * 「誰が何を実行できるか(操作)」の章(HTML の本。render/book/html/actions-chapter.ts)のテスト。
 *
 * wholeFile 出力・集約ごとの節・by に system を含む操作の表示・
 * 「入口の無い操作」節(理由つき / 0 件の 1 行)を検める。
 * 行データの組み立て(actions-view.ts)自体は index 側と共有するため、
 * ここでは章の骨格(節の切り方・列の並び)だけを見る。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { bookHtmlFiles, pageText } from '../../../../helpers/book-html.js';
import {
  accessSpec,
  aggregate,
  create,
  entitySpec,
  event,
  field,
  machine,
  specModel,
  write,
} from '../../../../helpers/model-builder.js';
import { actionSpec, unhandled } from '../../../../helpers/trace-builder.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';

/** workshop(状態遷移 + 作成 + 編集)/ member(作成のみ)の 2 集約。 */
function fixtureModel() {
  const workshop = aggregate('workshop', {
    entity: entitySpec('workshop', { label: '催し' }),
    stateMachines: [
      machine('workshop', {
        states: ['draft', 'accepting'],
        initial: 'draft',
        stateLabels: { draft: '下書き', accepting: '受付中' },
        events: [
          event('publish', { from: ['draft'], to: 'accepting', by: ['organizer'], label: '公開する' }),
          event('close', {
            from: ['accepting'],
            to: 'draft',
            by: ['organizer', 'system'],
            label: '締める',
          }),
        ],
      }),
    ],
    access: accessSpec('workshop', {
      creates: [create('organizer')],
      writes: [write('organizer', ['title'])],
    }),
  });
  const member = aggregate('member', {
    entity: entitySpec('member', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }),
    access: accessSpec('member', { creates: [create('staff')] }),
  });
  return specModel([workshop, member]);
}

/** 生成の文脈。unhandled は呼び出し側が差し替える。 */
function ctxWith(unhandledDecls: ReturnType<typeof unhandled>[] = []) {
  return {
    ...GEN_CTX,
    actions: {
      actions: [
        actionSpec({ handles: 'workshop.publish', input: ['workshop.id'] }),
        actionSpec({ handles: 'workshop.close', input: ['workshop.id'] }),
        actionSpec({ handles: 'workshop.create', input: ['workshop.title'] }),
        actionSpec({ handles: 'member.create', input: ['member.id'] }),
      ],
      unhandled: unhandledDecls,
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
  };
}

function content(ctx = ctxWith()): string {
  const page = bookHtmlFiles(fixtureModel(), ctx).get('docs/book/actions.html');
  if (page === undefined) throw new Error('ページが生成されませんでした');
  return pageText(page);
}

describe('操作の章(HTML): 出力先と骨格', () => {
  it('docs/book/actions.html をファイル全体(wholeFile)で生成する', () => {
    const sections = bookHtmlGenerator.generate(fixtureModel(), ctxWith()).filter((section) => section.file === 'docs/book/actions.html');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('action_spec を読めていない環境では何も生成しない', () => {
    expect(bookHtmlFiles(fixtureModel(), GEN_CTX).has('docs/book/actions.html')).toBe(false);
  });
});

describe('操作の章(HTML): 集約ごとの節', () => {
  it('集約ごとに ## の節を切り、操作を 1 行 1 操作の表にする', () => {
    const text = content();

    expect(text).toContain('集約 workshop(催し)操作 3 本');
    expect(text).toContain('集約 member操作 1 本');
    // 集約ごとの操作の表は折りたたみで、件数は表の行の数。
    expect(text).toMatch(/workshop の操作3/);
    // 状態遷移: from → to(state_spec の label 付き)とイベント label を併記する。
    expect(text).toContain('workshop.publish | draft(下書き) → accepting(受付中)(公開する) | organizer');
    // 作成 / 編集の表記(access_spec からの日本語)。
    expect(text).toContain('workshop.create | 作成 | organizer');
  });

  it('by に system を含む操作も落とさず出す', () => {
    const text = content();

    expect(text).toContain('workshop.close | accepting(受付中) → draft(下書き)(締める) | organizer, system');
  });
});

describe('操作の章(HTML): 入口の無い操作', () => {
  it('unhandled が有れば理由つきの表になる', () => {
    const text = content(ctxWith([unhandled('workshop.reopen', '未整備のため')]));

    expect(text).toMatch(/入口の無い操作1/);
    expect(text).toContain('workshop.reopen | 未整備のため');
  });

  it('unhandled が 0 件なら空の折りたたみを作らず、範囲に「入口の無い操作 0 件」と言う', () => {
    const text = content(ctxWith([]));

    expect(text).not.toMatch(/入口の無い操作[1-9]/);
    expect(text).toContain('入口の無い操作 0 件');
  });
});
