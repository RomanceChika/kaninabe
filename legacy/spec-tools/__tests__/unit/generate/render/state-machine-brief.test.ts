/**
 * 状態機械の図 2 枚(ざっくり / くわしく)と、横断する遷移の選び方のテスト。
 *
 * 図は同じ宣言から 2 枚出る。ざっくりは段と誰が進めるかだけ、くわしくは状態の英字 id・
 * イベント名・誰が。横断する遷移(どの段からでも起こせる動き)は宣言から導き、
 * 図ではラベルを外して遷移表に任せる。
 */

import { describe, expect, it } from 'vitest';

import {
  crossingEvents,
  crossingNote,
  renderStateDiagram,
  renderStateDiagramBrief,
} from '../../../../lib/generate/render/state-machine-mermaid.js';
import { event, machine } from '../../../helpers/model-builder.js';

/** 催しに似た 5 状態 + 終端 2 つ。中止だけが 5 状態から出る。 */
const workshopLike = machine('workshop', {
  states: ['draft', 'accepting', 'closed', 'confirmed', 'finished', 'cancelled'],
  initial: 'draft',
  final: ['finished', 'cancelled'],
  stateLabels: {
    draft: '下書き',
    accepting: '受付中',
    closed: '締切',
    confirmed: '確定',
    finished: '終了',
    cancelled: '中止',
  },
  events: [
    event('publish', { from: ['draft'], to: 'accepting', by: ['organizer', 'staff'], label: '公開する' }),
    event('close', { from: ['accepting'], to: 'closed', by: ['system'], label: '締め切る' }),
    event('confirm', { from: ['closed'], to: 'confirmed', by: ['organizer'], label: '確定する' }),
    event('finish', { from: ['confirmed'], to: 'finished', by: ['organizer'], label: '終える' }),
    event('cancel', {
      from: ['draft', 'accepting', 'closed', 'confirmed'],
      to: 'cancelled',
      by: ['organizer'],
      label: '中止する',
    }),
  ],
});

const ROLE_LABELS = new Map([
  ['organizer', '世話役'],
  ['staff', '運営'],
  ['system', 'システム'],
]);

describe('crossingEvents: 横断する遷移の選び方', () => {
  it('3 状態以上から出て、かつ最終でない状態の過半から出る遷移は横断とみなす', () => {
    expect(crossingEvents(workshopLike).map((e) => e.id)).toEqual(['cancel']);
  });

  it('2 状態から出る遷移は、小さな状態機械で過半を満たしても横断ではない(以前は半分以上で横断に入り、矢印の大半がラベルを失った)', () => {
    const small = machine('m', {
      states: ['a', 'b', 'c', 'd', 'gone'],
      initial: 'a',
      final: ['gone'],
      events: [
        event('go', { from: ['a'], to: 'b' }),
        event('drop', { from: ['a', 'b'], to: 'gone' }),
        event('leave', { from: ['a', 'b', 'c'], to: 'gone' }),
        event('next', { from: ['c'], to: 'd' }),
      ],
    });

    // 4 状態のうち drop は 2 状態(過半を満たすが 3 状態に届かない)、leave は 3 状態で過半。
    expect(crossingEvents(small).map((e) => e.id)).toEqual(['leave']);
  });

  it('3 状態以上から出ても、最終でない状態の過半(ちょうど半分を含まない)に届かなければ、横断ではない', () => {
    const wide = machine('m', {
      states: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      initial: 'a',
      events: [
        event('three', { from: ['a', 'b', 'c'], to: 'h' }),
        event('half', { from: ['a', 'b', 'c', 'd'], to: 'h' }),
        event('majority', { from: ['a', 'b', 'c', 'd', 'e'], to: 'h' }),
      ],
    });

    // 8 状態(最終なし)の過半は 5 以上。4 状態(ちょうど半分)は含まない。
    expect(crossingEvents(wide).map((e) => e.id)).toEqual(['majority']);
  });

  it('1 状態からだけ出る遷移は、横断ではない', () => {
    const tiny = machine('m', {
      states: ['a', 'b'],
      initial: 'a',
      events: [event('link', { from: ['a'], to: 'b' }), event('unlink', { from: ['b'], to: 'a' })],
    });

    expect(crossingEvents(tiny)).toEqual([]);
    expect(crossingNote(tiny)).toBeNull();
  });
});

describe('renderStateDiagramBrief: ざっくりの図', () => {
  const text = renderStateDiagramBrief(workshopLike, ROLE_LABELS);

  it('節点は日本語名だけ(英字 id を括弧で併記しない)で、矢印はロールの日本語名だけを付ける', () => {
    expect(text).toContain('    draft: 下書き\n');
    expect(text).not.toContain('(draft)');
    expect(text).toContain('draft --> accepting: 世話役、運営');
    expect(text).toContain('accepting --> closed: システム');
    // イベント名は出さない(段と誰が、だけ)。
    expect(text).not.toContain('公開する');
  });

  it('横断する遷移の矢印はラベルを外す(状態の数だけ生える)', () => {
    expect(text).toContain('    draft --> cancelled\n');
    expect(text).toContain('    confirmed --> cancelled\n');
    expect(text).not.toContain('--> cancelled:');
  });

  it('同じ 2 状態を同じ人が結ぶ矢印は 1 本にまとめる', () => {
    const doubled = machine('m', {
      states: ['a', 'b'],
      initial: 'a',
      events: [
        event('x', { from: ['a'], to: 'b', by: ['organizer'] }),
        event('y', { from: ['a'], to: 'b', by: ['organizer'] }),
      ],
    });
    const lines = renderStateDiagramBrief(doubled, ROLE_LABELS).split('\n');

    expect(lines.filter((line) => line.includes('a --> b'))).toHaveLength(1);
  });
});

describe('crossingNote と、くわしい図の横断ラベル', () => {
  it('ラベルの無い矢印の本数と、横断する遷移の名前を注に出す', () => {
    expect(crossingNote(workshopLike)).toBe(
      'ラベルの無い矢印 4 本は、横断する遷移「中止する」を表す。' +
        'どの矢印がどのイベントかは、補足枠の「横断する遷移」を見る。誰が、どの状態から、どんな条件で動かせるかも、補足枠と遷移表にある。',
    );
  });

  it('くわしい図は既定では従来どおり全矢印にラベルを付け、指定したときだけ横断のラベルを外す', () => {
    expect(renderStateDiagram(workshopLike)).toContain('draft --> cancelled: 中止する (organizer)');

    const omitted = renderStateDiagram(workshopLike, { omitCrossingLabels: true });
    expect(omitted).toContain('draft --> cancelled\n');
    // 節点の英字 id とイベント名・誰がは残る(ざっくりとの違い)。
    expect(omitted).toContain('draft: 下書き (draft)');
    expect(omitted).toContain('draft --> accepting: 公開する (organizer, staff)');
  });

  it('くわしい図にロールの日本語名を渡すと、矢印のロールが日本語名になる(無いロールは ID のまま)', () => {
    const labels = new Map([
      ['organizer', '世話役'],
      ['staff', '運営スタッフ'],
    ]);
    const diagram = renderStateDiagram(workshopLike, { omitCrossingLabels: true, roleLabels: labels });
    expect(diagram).toContain('draft --> accepting: 公開する (世話役、運営スタッフ)');
    expect(diagram).toContain('accepting --> closed: 締め切る (system)');
  });
});
