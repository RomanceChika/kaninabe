/**
 * access_spec の `creates[].abuse`(濫用の歯止め)と `public: 理由`(未ログインに開く書き込みの受け入れ)の読み込みの単体テスト。
 *
 * 読み込みが閉じるのは形だけ(キー・型・`per` の字面・欄名の識別子)。値の意味(`max` が 1 以上か・鍵の欄の実在・鍵ごと ≤ 全体)は
 * R5 の仕事なので、ここでは「読めた値をそのまま持つ」ことと「書けない形は V1 で落とす」ことを固定する。
 */

import { describe, expect, it } from 'vitest';
import { parseAccessSpec } from '../../../lib/model/parse-access.js';
import { parseStateSpecs } from '../../../lib/model/parse-state.js';
import { expectWellFormed, findByMessage } from './_helpers.js';

const FILE = 'docs/specs/domain/inquiry/access.md';

/** abuse だけ差し替えられる最小の access_spec。 */
function accessWith(abuse: unknown, extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { doc_type: 'access_spec', entity: 'inquiry', reads: [], creates: [{ by: 'anonymous', abuse }], ...extra };
}

const FULL = {
  global_ceiling: { max: 30, per: '1 hour' },
  per_key: { column: 'sender_email', max: 5, per: '1 hour' },
  at: 'created_at',
};

describe('creates[].abuse の読み込み', () => {
  it('global_ceiling・per_key・at を字面のまま読む', () => {
    const result = parseAccessSpec(accessWith(FULL), FILE);

    expect(result.findings).toEqual([]);
    expect(result.value?.creates[0]?.abuse).toEqual({
      globalCeiling: { max: 30, per: '1 hour' },
      perKey: { column: 'sender_email', max: 5, per: '1 hour' },
      at: 'created_at',
      location: { file: FILE, pointer: 'creates.anonymous' },
    });
  });

  it('global_ceiling だけでも読める(per_key と at は任意)。複数形の単位も通る', () => {
    const result = parseAccessSpec(accessWith({ global_ceiling: { max: 100, per: '2 days' } }), FILE);

    expect(result.findings).toEqual([]);
    expect(result.value?.creates[0]?.abuse?.globalCeiling).toEqual({ max: 100, per: '2 days' });
    expect(result.value?.creates[0]?.abuse?.perKey).toBeUndefined();
    expect(result.value?.creates[0]?.abuse?.at).toBeUndefined();
  });

  it('global_ceiling が無い abuse は欠落のまま持つ(黙って補わない。R5-1 が止める)', () => {
    const result = parseAccessSpec(accessWith({ per_key: FULL.per_key }), FILE);

    expect(result.findings).toEqual([]);
    expect(result.value?.creates[0]?.abuse?.globalCeiling).toBeUndefined();
    expect(result.value?.creates[0]?.abuse?.perKey?.column).toBe('sender_email');
  });

  it('max の値の意味(0・負・小数)は読み込みでは問わない(R5-2 が見る)', () => {
    for (const max of [0, -3, 2.5]) {
      const result = parseAccessSpec(accessWith({ global_ceiling: { max, per: '1 hour' } }), FILE);

      expect(result.findings, String(max)).toEqual([]);
      expect(result.value?.creates[0]?.abuse?.globalCeiling?.max).toBe(max);
    }
  });

  it('abuse の無い creates は abuse を持たない', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'inquiry', reads: [], creates: [{ by: 'member' }] }, FILE);

    expect(result.value?.creates[0]?.abuse).toBeUndefined();
  });

  const INVALID: readonly { readonly title: string; readonly abuse: unknown; readonly message: string; readonly pointer: string }[] = [
    { title: 'abuse がマッピングでない', abuse: 'many', message: 'abuse はマッピングで書きます', pointer: 'creates[0].abuse' },
    { title: '知らないキー', abuse: { ...FULL, burst: 3 }, message: 'abuse に burst は書けません', pointer: 'creates[0].abuse.burst' },
    {
      title: 'global_ceiling に知らないキー',
      abuse: { global_ceiling: { max: 3, per: '1 hour', column: 'x' } },
      message: 'global_ceiling に column は書けません',
      pointer: 'creates[0].abuse.global_ceiling.column',
    },
    {
      title: 'global_ceiling.max が欠けている',
      abuse: { global_ceiling: { per: '1 hour' } },
      message: 'global_ceiling.max がありません',
      pointer: 'creates[0].abuse.global_ceiling.max',
    },
    {
      title: 'global_ceiling.max が数でない',
      abuse: { global_ceiling: { max: 'many', per: '1 hour' } },
      message: 'max は数値で書きます',
      pointer: 'creates[0].abuse.global_ceiling.max',
    },
    {
      title: 'global_ceiling.per が欠けている',
      abuse: { global_ceiling: { max: 3 } },
      message: 'per がありません',
      pointer: 'creates[0].abuse.global_ceiling.per',
    },
    {
      title: 'per が閉じた語でない(週)',
      abuse: { global_ceiling: { max: 3, per: '1 week' } },
      message: 'global_ceiling.per "1 week" は期間の幅の形ではありません',
      pointer: 'creates[0].abuse.global_ceiling.per',
    },
    {
      title: 'per に SQL の断片',
      abuse: { global_ceiling: { max: 3, per: "1 hour'; drop table x; --" } },
      message: '期間の幅の形ではありません',
      pointer: 'creates[0].abuse.global_ceiling.per',
    },
    {
      title: 'per が 0 件分の幅',
      abuse: { global_ceiling: { max: 3, per: '0 hour' } },
      message: '期間の幅の形ではありません',
      pointer: 'creates[0].abuse.global_ceiling.per',
    },
    {
      title: 'per_key.column が欠けている',
      abuse: { per_key: { max: 3, per: '1 hour' } },
      message: 'column',
      pointer: 'creates[0].abuse.per_key.column',
    },
    {
      title: 'per_key.column が識別子でない',
      abuse: { per_key: { column: 'Sender-Email', max: 3, per: '1 hour' } },
      message: 'per_key.column "Sender-Email" は欄名の形ではありません',
      pointer: 'creates[0].abuse.per_key.column',
    },
    {
      title: 'at が識別子でない',
      abuse: { ...FULL, at: 'created at' },
      message: 'at "created at" は欄名の形ではありません',
      pointer: 'creates[0].abuse.at',
    },
  ];

  for (const { title, abuse, message, pointer } of INVALID) {
    it(`書けない形は V1 で落とす: ${title}`, () => {
      const result = parseAccessSpec(accessWith(abuse), FILE);

      expectWellFormed(result.findings);
      const finding = findByMessage(result.findings, message);
      expect(finding.location.pointer).toBe(pointer);
    });
  }

  it('読めない天井は落とす(per が壊れた global_ceiling は持たない)', () => {
    const result = parseAccessSpec(accessWith({ ...FULL, global_ceiling: { max: 3, per: 'soon' } }), FILE);

    expect(result.value?.creates[0]?.abuse?.globalCeiling).toBeUndefined();
    expect(result.value?.creates[0]?.abuse?.perKey?.column).toBe('sender_email');
  });

  it('abuse は creates の要素にだけ書ける(writes / deletes に書けば知らないキー)', () => {
    const result = parseAccessSpec(
      accessWith(FULL, { writes: [{ by: 'anonymous', fields: ['note'], abuse: FULL }], deletes: [{ by: 'anonymous', abuse: FULL }] }),
      FILE,
    );

    expect(findByMessage(result.findings, 'writes の要素 に abuse は書けません').location.pointer).toBe('writes[0].abuse');
    expect(findByMessage(result.findings, 'deletes の要素 に abuse は書けません').location.pointer).toBe('deletes[0].abuse');
  });
});

describe('public: 理由 の読み込み', () => {
  it('writes と deletes の要素から理由をそのまま読む', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'inquiry',
        reads: [],
        writes: [{ by: 'anonymous', fields: ['note'], public: '送り主が直後に直せる' }],
        deletes: [{ by: 'anonymous', public: '送り主が取り下げられる' }],
      },
      FILE,
    );

    expect(result.findings).toEqual([]);
    expect(result.value?.writes[0]?.public).toBe('送り主が直後に直せる');
    expect(result.value?.deletes[0]?.public).toBe('送り主が取り下げられる');
  });

  it('空の理由は空のまま持つ(R5-5 が「理由が空」と止める。黙って捨てて「無い」と区別できなくしない)', () => {
    const result = parseAccessSpec(
      { doc_type: 'access_spec', entity: 'inquiry', reads: [], deletes: [{ by: 'anonymous', public: '  ' }] },
      FILE,
    );

    expect(result.findings).toEqual([]);
    expect(result.value?.deletes[0]?.public).toBe('  ');
  });

  it('理由が文字列でなければ V1', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'inquiry', reads: [], deletes: [{ by: 'anonymous', public: true }] }, FILE);

    expect(findByMessage(result.findings, 'public は文字列で書きます').location.pointer).toBe('deletes[0].public');
  });

  it('creates に public は書けない(作成は abuse で受ける)', () => {
    const result = parseAccessSpec(
      { doc_type: 'access_spec', entity: 'inquiry', reads: [], creates: [{ by: 'anonymous', public: '理由' }] },
      FILE,
    );

    expect(findByMessage(result.findings, 'creates の要素 に public は書けません').location.pointer).toBe('creates[0].public');
  });

  it('public の無い規則は public を持たない', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'inquiry', reads: [], deletes: [{ by: 'staff' }] }, FILE);

    expect(result.value?.deletes[0]?.public).toBeUndefined();
  });
});

describe('state_spec の events[].public', () => {
  const states = {
    doc_type: 'state_spec',
    state_machine: 'inquiry',
    states: [{ id: 'new' }, { id: 'closed' }],
    initial: 'new',
    final: ['closed'],
  };

  it('イベントの理由を読む', () => {
    const result = parseStateSpecs(
      { ...states, events: [{ id: 'withdraw', from: ['new'], to: 'closed', by: ['anonymous'], public: '送り主の取り下げ' }] },
      'docs/specs/domain/inquiry/states.md',
    );

    expect(result.findings).toEqual([]);
    expect(result.value?.[0]?.events[0]?.public).toBe('送り主の取り下げ');
  });

  it('public の無いイベントは持たない', () => {
    const result = parseStateSpecs({ ...states, events: [{ id: 'close', from: ['new'], to: 'closed', by: ['staff'] }] }, 'docs/specs/domain/inquiry/states.md');

    expect(result.value?.[0]?.events[0]?.public).toBeUndefined();
  });
});
