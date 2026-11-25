/**
 * 集約の章のライフサイクルの節(図 2 枚)・補足枠・隣の章のテスト。
 *
 * 図は同じ宣言から「ざっくり」と「くわしく」の 2 枚。本線から外す動き(第 2 の状態機械と
 * 横断する遷移)は補足枠に、この集約を参照して作成の操作を持つ別の集約は隣の章に、
 * いずれも宣言から導いて出す。
 */

import { describe, expect, it } from 'vitest';

import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';
import {
  accessSpec,
  aggregate,
  create,
  effect,
  entitySpec,
  event,
  field,
  machine,
  read,
  role,
  roleSpec,
  specModel,
} from '../../../../helpers/model-builder.js';
import { notification, notificationModel } from '../../../../helpers/notification-builder.js';
import { actionSpec } from '../../../../helpers/trace-builder.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';

/** 催し = 本線(5 状態から中止できる)と第 2 の状態機械(掲載)を持つ。申込は催しを参照して作成できる。 */
function world(): { model: ReturnType<typeof specModel>; ctx: GenerateContext } {
  const item = aggregate('item', {
    entity: entitySpec('item', {
      label: '催し',
      fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'item' })],
    }),
    stateMachines: [
      machine('item', {
        states: ['draft', 'accepting', 'closed', 'cancelled'],
        initial: 'draft',
        final: ['cancelled'],
        stateLabels: { draft: '下書き', accepting: '受付中', closed: '締切', cancelled: '中止' },
        events: [
          event('publish', { from: ['draft'], to: 'accepting', by: ['organizer'], label: '公開する' }),
          event('close', { from: ['accepting'], to: 'closed', by: ['system'], label: '締め切る' }),
          event('cancel', {
            from: ['draft', 'accepting', 'closed'],
            to: 'cancelled',
            by: ['organizer'],
            label: '中止する',
          }),
        ],
        effects: [effect('cancel', ['notify_cancelled'])],
      }),
      machine('item_publication', {
        states: ['hidden', 'shown', 'stale', 'gone'],
        initial: 'hidden',
        final: ['gone'],
        stateLabels: { hidden: '未掲載', shown: '掲載中', stale: '要再公開', gone: '取り下げ' },
        events: [
          event('show', { from: ['hidden'], to: 'shown', by: ['organizer'], label: '掲載する' }),
          event('withdraw', { from: ['hidden', 'shown', 'stale'], to: 'gone', by: ['system'], label: '取り下げる' }),
        ],
      }),
    ],
    access: accessSpec('item', { reads: [read('member', 'all')] }),
  });
  const entry = aggregate('entry', {
    entity: entitySpec('entry', {
      label: 'エントリー',
      fields: [field('item_id', { kind: 'ref', entity: 'item' }, { required: true })],
    }),
    access: accessSpec('entry', { creates: [create('member')] }),
  });
  // 参照しているが作成の操作を持たない集約は隣の章に出ない。
  const note = aggregate('note', {
    entity: entitySpec('note', { fields: [field('item_id', { kind: 'ref', entity: 'item' })] }),
    access: accessSpec('note', { reads: [read('member', 'all')] }),
  });
  const model = specModel(
    [item, entry, note],
    roleSpec([role('member'), role('anonymous'), role('system'), role('organizer', undefined, undefined, undefined, '世話役')]),
  );
  const ctx: GenerateContext = {
    ...GEN_CTX,
    notifications: notificationModel([notification('notify_cancelled', { summary: '中止を参加者に知らせる' })]),
    actions: {
      actions: [actionSpec({ handles: 'item.cancel', input: ['item.id'] })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
  };
  return { model, ctx };
}

/** 「隣の章」の節の字(次の節 `数の出どころ` の手前まで)。 */
function neighborSection(text: string): string {
  const start = text.indexOf('隣の章 — この章に無いもの');
  return text.slice(start, text.indexOf('数の出どころ', start));
}

function chapter(name: string): string {
  const { model, ctx } = world();
  const found = bookHtmlPage(model, ctx, `domain/${name}.html`);
  if (found === undefined) throw new Error(`${name} の章が生成されませんでした`);
  return pageText(found);
}

describe('ライフサイクルの節: 段のカード', () => {
  it('状態を段のカードにして並べ、各段に出る手(誰が・どこへ)を持つ', () => {
    const text = chapter('item');

    expect(text).toContain('ライフサイクルの 4 段');
    expect(text).toContain('出る手 2');
    expect(text).toContain('1draft下書き');
    expect(text).toContain('publish公開する\n誰が\n世話役\nどこへ\naccepting 受付中');
    expect(text).toContain('4cancelled中止');
    expect(text).toContain('終端。ここから先へ進む手は無い');
  });

  it('横断する遷移は図に線を引かず、「どの段からでも起こせる動き」の節がまとめて持つ', () => {
    const text = chapter('item');

    expect(text).toContain('横断する遷移 2 本');
    expect(text).toContain('どの段からでも起こせる動き。図には線を引かず、くわしくはここと遷移表が持つ');
    // 段のカードの「出る手」には横断する遷移を数えない(draft は publish と cancel で 2 手)。
    expect(text).toContain('中止するitem.cancel');
  });
});

describe('補足枠: 本線の外の動き', () => {
  it('横断する遷移を、誰が・いつ・どこへ・条件・通知・入力する欄のラベル行で出す', () => {
    const text = chapter('item');

    expect(text).toContain('補足枠 — 本線の外の動き');
    expect(text).toContain('本線は item の段の流れ');
    expect(text).toContain('中止するitem.cancel\n誰が\n世話役\nいつ\n3 つの状態から。下書き、受付中、締切\nどこへ\ncancelled 中止');
    expect(text).toContain('通知: notify_cancelled — 中止を参加者に知らせる');
    expect(text).toContain('入力する欄: なし(対象の id だけ)');
    // 操作の仕様を持たない遷移(別の入口から起きるもの)は、欄が無いのではなく仕様が無いと書く。
    expect(text).toContain('入力する欄: (操作の仕様なし)');
  });

  it('第 2 以降の状態機械は補足枠に、段・遷移表・マトリクスごと置く', () => {
    const text = chapter('item');
    const sidebox = text.slice(text.indexOf('補足枠 — 本線の外の動き'));

    expect(sidebox).toContain('item_publication もう 1 つの状態機械・4 段');
    expect(sidebox).toContain('item_publication.show(掲載する) | hidden(未掲載) | shown(掲載中)');
    expect(sidebox).toContain('状態＼イベント | show(掲載する) | withdraw(取り下げる)');
    // 本線の節には第 2 の機械の遷移表が無い。
    expect(text.slice(0, text.indexOf('補足枠 — 本線の外の動き'))).not.toContain('item_publication.show');
  });

  it('本線から外す動きが無い集約には補足枠を出さない', () => {
    expect(chapter('entry')).not.toContain('補足枠');
  });
});

describe('隣の章: この章に無いもの', () => {
  it('この集約を参照し、作成の操作を持つ別の集約だけを、原本へのリンクつきで出す', () => {
    const text = chapter('item');

    expect(text).toContain('隣の章 — この章に無いもの');
    expect(text).toContain('エントリー(entry) — 原本: 集約 entry(エントリー)');
    // 作成の操作を持たない note は出ない。
    expect(neighborSection(text)).toContain('エントリー');
    expect(neighborSection(text)).not.toContain('note');
  });

  it('参照されていない集約には隣の章を出さない', () => {
    expect(chapter('entry')).not.toContain('隣の章');
  });

  it('この集約のテーブル仕様に標識があれば、データの置き場の章の節へのリンクを 1 行出す(標識の無い表は出さない)', () => {
    const { model, ctx } = world();
    const table = (name: string, entity: string, file: string) =>
      ({ table: name, entity, relPath: file, location: { file }, functions: [], foreignKeys: [], checks: [], triggers: [], indexes: [], exclusions: [], testCases: [] }) as unknown as NonNullable<GenerateContext['dataTables']>['tables'][number];
    const withTables: GenerateContext = {
      ...ctx,
      dataTables: {
        available: true,
        tables: [
          table('items', 'item', 'docs/specs/backend/data/tables/items.md'),
          table('item_notes', 'item', 'docs/specs/backend/data/tables/item_notes.md'),
          table('entries', 'entry', 'docs/specs/backend/data/tables/entries.md'),
        ],
      } as NonNullable<GenerateContext['dataTables']>,
      specSources: new Map([
        ['docs/specs/backend/data/tables/items.md', '---\ndoc_type: data_table\n---\n\n索引を 1 本に絞った。\n'],
        ['docs/specs/backend/data/tables/item_notes.md', '---\ndoc_type: data_table\n---\n'],
        ['docs/specs/backend/data/tables/entries.md', '---\ndoc_type: data_table\n---\n\n別の集約の判断。\n'],
      ]),
    };
    const found = bookHtmlPage(model, withTables, 'domain/item.html');

    const text = pageText(found ?? '');
    const neighbors = neighborSection(text);
    expect(neighbors).toContain('テーブル仕様 items');
    expect(found).toContain('href="../data.html#items"');
    expect(neighbors).not.toContain('item_notes');
    expect(found).not.toContain('data.html#entries');
  });
});
