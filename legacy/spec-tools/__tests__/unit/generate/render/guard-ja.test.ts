import { describe, expect, it } from 'vitest';

import {
  buildGuardJaDict,
  guardToJapanese,
  type GuardJaDict,
} from '../../../../lib/generate/render/guard-ja.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { aggregate, entitySpec, field, machine, specModel } from '../../../helpers/model-builder.js';

/** description / stateLabels / state 型フィールドを一通り持つモデル。 */
function dictModel(): SpecModel {
  const workshop = aggregate('workshop', {
    entity: entitySpec('workshop', {
      fields: [
        field('state', { kind: 'state', machine: 'workshop' }),
        field('entry_deadline', { kind: 'datetime' }, { description: 'エントリー締切日時' }),
        field('starts_at', { kind: 'datetime' }, { description: '開演日時' }),
        field('organizer_ids', { kind: 'string' }, { description: '世話役一覧' }),
      ],
    }),
    stateMachines: [
      machine('workshop', {
        states: ['draft', 'accepting', 'closed', 'program_published'],
        initial: 'draft',
        stateLabels: {
          draft: '下書き',
          accepting: '受付中',
          closed: '締切済',
          program_published: 'プログラム確定',
        },
      }),
    ],
  });

  const entry = aggregate('entry', {
    entity: entitySpec('entry', {
      fields: [
        field('state', { kind: 'state', machine: 'entry' }),
        field('duration_min', { kind: 'integer' }, { description: '発表時間(分)' }),
      ],
    }),
    stateMachines: [
      machine('entry', {
        states: ['draft', 'withdrawn', 'rejected'],
        initial: 'draft',
        stateLabels: { withdrawn: '取下げ', rejected: '却下' },
      }),
    ],
  });

  const member = aggregate('member', {
    entity: entitySpec('member', {
      fields: [field('id', { kind: 'uuid' }, { description: 'メンバーID' })],
    }),
  });

  return specModel([workshop, entry, member]);
}

const DICT: GuardJaDict = buildGuardJaDict(
  dictModel(),
  new Map([
    ['workshop', '催し'],
    ['entry', 'エントリー'],
  ]),
);

function ja(source: string, dict: GuardJaDict = DICT): string {
  return guardToJapanese(source, GEN_CTX, dict);
}

describe('buildGuardJaDict', () => {
  it('entity_spec の description と state_spec の label を集約横断で集める', () => {
    expect(DICT.fields.get('workshop.entry_deadline')).toBe('エントリー締切日時');
    expect(DICT.fields.get('entry.duration_min')).toBe('発表時間(分)');
    expect(DICT.stateFields.get('workshop.state')).toBe('workshop');
    expect(DICT.stateLabels.get('workshop.accepting')).toBe('受付中');
    expect(DICT.stateLabels.get('entry.withdrawn')).toBe('取下げ');
  });

  it('description の無いフィールドは辞書に入れない(推測しない)', () => {
    expect(DICT.fields.has('workshop.state')).toBe(false);
  });
});

describe('guardToJapanese: 比較', () => {
  it('state 型フィールドは「{エンティティ}の状態」、値は label にする', () => {
    expect(ja('workshop.state == accepting')).toBe('催しの状態 = 受付中');
  });

  it('!= は ≠、>= は ≥ にする', () => {
    expect(ja('workshop.state != program_published')).toBe('催しの状態 ≠ プログラム確定');
    expect(ja('now >= workshop.entry_deadline')).toBe('現在時刻 ≥ エントリー締切日時');
    expect(ja('now < workshop.starts_at')).toBe('現在時刻 < 開演日時');
  });

  it('actor.id は「実行者自身」にする', () => {
    expect(ja('member.id == actor.id')).toBe('メンバーID = 実行者自身');
  });

  it('contains は「〜に〜が含まれる」にする', () => {
    expect(ja('workshop.organizer_ids contains actor.id')).toBe('世話役一覧 に 実行者自身 が含まれる');
  });

  it('数値リテラルはそのまま出す', () => {
    expect(ja('entry.duration_min <= 30')).toBe('発表時間(分) ≤ 30');
  });
});

describe('guardToJapanese: in / 論理演算', () => {
  it('in は「いずれか」、not in は「いずれでもない」にする', () => {
    expect(ja('workshop.state in [accepting, closed]')).toBe(
      '催しの状態 が 受付中 / 締切済 のいずれか',
    );
    expect(ja('entry.state not in [withdrawn, rejected]')).toBe(
      'エントリーの状態 が 取下げ / 却下 のいずれでもない',
    );
  });

  it('and / or / not をそれぞれ かつ / または / でない にする', () => {
    expect(ja('workshop.state == accepting and now < workshop.starts_at')).toBe(
      '催しの状態 = 受付中 かつ 現在時刻 < 開演日時',
    );
    expect(ja('workshop.state == closed or workshop.state == accepting')).toBe(
      '催しの状態 = 締切済 または 催しの状態 = 受付中',
    );
    expect(ja('not workshop.state == accepting')).toBe('催しの状態 = 受付中 でない');
  });
});

describe('guardToJapanese: 辞書に無いもの・壊れた式', () => {
  it('辞書に無いフィールド・状態値は ID のまま出す', () => {
    expect(ja('unknown.field == some_value')).toBe('unknown.field = some_value');
  });

  it('エンティティの日本語名が無ければ ID のまま「{ID}の状態」にする', () => {
    const dict = buildGuardJaDict(dictModel());

    expect(ja('workshop.state == accepting', dict)).toBe('workshopの状態 = 受付中');
  });

  it('label の無い状態値は状態 ID のまま出す', () => {
    expect(ja('entry.state == draft')).toBe('エントリーの状態 = draft');
  });

  it('パースできない式は原文をそのまま返す(生成物を壊さない)', () => {
    expect(ja('workshop.state ==')).toBe('workshop.state ==');
    expect(ja('!!!')).toBe('!!!');
  });
});
