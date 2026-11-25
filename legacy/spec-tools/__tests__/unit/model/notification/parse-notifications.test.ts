/**
 * N0(通知カタログのスキーマ適合)のユニットテスト。
 *
 * 規約網羅(notification-spec-writing.md §共通形式・§1 行が宣言すること):
 *   - 正しいカタログが読めること
 *   - id が notification-catalog 固定であること
 *   - 通知 ID が notify_ 接頭辞のスネークケースであること・重複しないこと
 *   - **4 軸の値が、同じファイルが宣言した語彙に閉じていること**(語彙は体系側に持たない)
 *   - trigger がフレームワーク固定の値域にあること
 *   - vocabulary の欠落・空・語の重複が落ちること
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseNotificationCatalog } from '../../../../lib/model/notification/parse-notifications.js';

/** 最小の語彙(テストごとに上書きする)。 */
const VOCABULARY = {
  medium: [{ id: 'discord', label: 'Discord' }],
  audience: [
    { id: 'staff_channel', recipient: { kind: 'role', role: 'staff' } },
    { id: 'member_dm', recipient: { kind: 'self', subject_key: 'member_id' } },
  ],
  mention: [{ id: 'none' }],
};

/** 1 行分の正しい通知宣言。 */
const ROW = {
  id: 'notify_staff_member_left',
  medium: 'discord',
  audience: 'staff_channel',
  mention: 'none',
  trigger: 'auto',
  summary: 'メンバーが退会したことを運営スタッフに知らせる',
};

/** フロントマター相当のマッピングを組み立てる。 */
function frontmatter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'notification_spec',
    scope: 'backend',
    id: 'notification-catalog',
    vocabulary: VOCABULARY,
    notifications: [ROW],
    test_cases: [
      {
        id: 'TC-NOTIFICATION-CATALOG-001',
        type: 'unit',
        covers: ['success'],
        spec_ids: ['notification-catalog'],
        implementation:
          'app/src/operation/__tests__/jobs/notification-catalog.test.ts::カタログとハンドラの突合',
      },
    ],
    ...overrides,
  };
}

/** パースして (カタログ, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  const reporter = new SpecReporter('docs/specs/backend/notifications.md');
  return parseNotificationCatalog(data, reporter);
}

describe('N0: 通知カタログのパース', () => {
  it('正しいカタログを読める', () => {
    const { value, findings } = parse(frontmatter());

    expect(findings).toEqual([]);
    expect(value?.notifications).toHaveLength(1);
    expect(value?.notifications[0]?.audience).toBe('staff_channel');
    expect(value?.vocabulary.medium[0]?.label).toBe('Discord');
  });

  it('id が notification-catalog でなければエラー', () => {
    const { findings } = parse(frontmatter({ id: 'notifications' }));

    expect(findings.some((f) => f.message.includes('カタログの id ではありません'))).toBe(true);
  });

  it('通知 ID が notify_ で始まらなければエラー', () => {
    const { value, findings } = parse(frontmatter({ notifications: [{ ...ROW, id: 'announce_program' }] }));

    expect(findings.some((f) => f.message.includes('notify_'))).toBe(true);
    expect(value?.notifications).toEqual([]);
  });

  it('通知 ID の重複はエラー', () => {
    const { value, findings } = parse(frontmatter({ notifications: [ROW, ROW] }));

    expect(findings.some((f) => f.message.includes('重複'))).toBe(true);
    expect(value?.notifications).toHaveLength(1);
  });

  it('宣言されていない audience はエラー(語彙の閉世界)', () => {
    const { value, findings } = parse(
      frontmatter({ notifications: [{ ...ROW, audience: 'everyone_everywhere' }] }),
    );

    expect(findings.some((f) => f.message.includes('vocabulary.audience に宣言されていません'))).toBe(true);
    expect(value?.notifications).toEqual([]);
  });

  it('語彙に足せば同じ値が通る(語彙は仕様側が決める)', () => {
    const { findings } = parse(
      frontmatter({
        vocabulary: {
          ...VOCABULARY,
          audience: [
            ...VOCABULARY.audience,
            { id: 'everyone_everywhere', recipient: { kind: 'channel' } },
          ],
        },
        notifications: [{ ...ROW, audience: 'everyone_everywhere' }],
      }),
    );

    expect(findings).toEqual([]);
  });

  it('audience の語に recipient が無ければエラー', () => {
    const { findings } = parse(
      frontmatter({ vocabulary: { ...VOCABULARY, audience: [{ id: 'staff_channel' }] } }),
    );

    expect(findings.some((f) => f.message.includes('recipient がありません'))).toBe(true);
  });

  it('recipient.kind が値域の外ならエラー', () => {
    const { findings } = parse(
      frontmatter({
        vocabulary: {
          ...VOCABULARY,
          audience: [{ id: 'staff_channel', recipient: { kind: 'ghost' } }],
        },
      }),
    );

    expect(findings.some((f) => f.message.includes('recipient.kind ghost は値域'))).toBe(true);
  });

  it('recipient.kind: role は role が無ければエラー', () => {
    const { findings } = parse(
      frontmatter({
        vocabulary: {
          ...VOCABULARY,
          audience: [{ id: 'staff_channel', recipient: { kind: 'role' } }],
        },
      }),
    );

    expect(findings.some((f) => f.message.includes('role がありません'))).toBe(true);
  });

  it('trigger: schedule(時刻で起きる走査が emits で積む)は値域にある', () => {
    const { value, findings } = parse(frontmatter({ notifications: [{ ...ROW, trigger: 'schedule' }] }));

    expect(findings).toEqual([]);
    expect(value?.notifications[0]?.trigger).toBe('schedule');
  });

  it('trigger が値域に無ければエラー', () => {
    const { findings } = parse(frontmatter({ notifications: [{ ...ROW, trigger: 'semi_auto' }] }));

    expect(findings.some((f) => f.message.includes('値域'))).toBe(true);
  });

  it('vocabulary が無ければエラー', () => {
    const { findings } = parse(frontmatter({ vocabulary: undefined }));

    expect(findings.some((f) => f.message.includes('vocabulary がありません'))).toBe(true);
  });

  it('語彙の軸が空ならエラー', () => {
    const { findings } = parse(frontmatter({ vocabulary: { ...VOCABULARY, mention: [] } }));

    expect(findings.some((f) => f.message.includes('vocabulary.mention が空です'))).toBe(true);
  });

  it('語彙の語が重複していればエラー', () => {
    const { findings } = parse(
      frontmatter({ vocabulary: { ...VOCABULARY, mention: [{ id: 'none' }, { id: 'none' }] } }),
    );

    expect(findings.some((f) => f.message.includes('mention の語 none が重複'))).toBe(true);
  });

  it('summary が無ければ行ごと落ちる', () => {
    const { value, findings } = parse(
      frontmatter({ notifications: [{ ...ROW, summary: undefined }] }),
    );

    expect(findings.some((f) => f.message.includes('summary'))).toBe(true);
    expect(value?.notifications).toEqual([]);
  });

  describe('本人を名指すメンション(mentions_person / person_from)', () => {
    /** 本人を名指す語と、チャンネル宛の語を足した語彙。 */
    const PERSON_VOCABULARY = {
      ...VOCABULARY,
      audience: [
        ...VOCABULARY.audience,
        { id: 'contact_channel', recipient: { kind: 'channel' }, allows_person_mention: true },
        { id: 'public_channel', recipient: { kind: 'channel' } },
      ],
      mention: [{ id: 'none' }, { id: 'person', label: '本人', mentions_person: true }],
    };
    const PERSON_ROW = { ...ROW, audience: 'contact_channel', mention: 'person', person_from: 'entry.owner_id' };

    it('語を選んだ行は person_from を {集約}.{欄} で読める', () => {
      const { value, findings } = parse(
        frontmatter({ vocabulary: PERSON_VOCABULARY, notifications: [PERSON_ROW] }),
      );

      expect(findings).toEqual([]);
      expect(value?.notifications[0]?.personFrom).toEqual({ entity: 'entry', field: 'owner_id' });
      expect(value?.vocabulary.mention[1]?.mentionsPerson).toBe(true);
      expect(value?.vocabulary.mention[0]?.mentionsPerson).toBeUndefined();
    });

    it('本人を名指す語の行に person_from が無ければ行ごと落ちる', () => {
      const { value, findings } = parse(
        frontmatter({ vocabulary: PERSON_VOCABULARY, notifications: [{ ...PERSON_ROW, person_from: undefined }] }),
      );

      expect(findings.some((f) => f.message.includes('person_from がありません'))).toBe(true);
      expect(value?.notifications).toEqual([]);
    });

    it('本人を名指さない語の行に person_from を書けば落ちる', () => {
      const { value, findings } = parse(
        frontmatter({ vocabulary: PERSON_VOCABULARY, notifications: [{ ...ROW, person_from: 'entry.owner_id' }] }),
      );

      expect(findings.some((f) => f.message.includes('person_from は書けません'))).toBe(true);
      expect(value?.notifications).toEqual([]);
    });

    it('trigger: manual の行は本人を名指す mention を選べない(人が送る通知に本人の出どころを機械が読む経路が無い)', () => {
      const { value, findings } = parse(
        frontmatter({ vocabulary: PERSON_VOCABULARY, notifications: [{ ...PERSON_ROW, trigger: 'manual' }] }),
      );

      expect(findings.some((f) => f.message.includes('trigger: manual なので本人を名指す mention は選べません'))).toBe(true);
      expect(value?.notifications).toEqual([]);
    });

    it('person_from が {集約}.{欄} の形でなければ落ちる', () => {
      const { findings } = parse(
        frontmatter({ vocabulary: PERSON_VOCABULARY, notifications: [{ ...PERSON_ROW, person_from: 'owner_id' }] }),
      );

      expect(findings.some((f) => f.message.includes('の形ではありません'))).toBe(true);
    });

    it('本人を名指せる宛先は allows_person_mention を宣言した語だけ(宣言の無いチャンネル宛・ロール宛・本人宛は落ちる)', () => {
      const audiences = ['public_channel', 'staff_channel', 'member_dm'];

      for (const audience of audiences) {
        const { value, findings } = parse(
          frontmatter({ vocabulary: PERSON_VOCABULARY, notifications: [{ ...PERSON_ROW, audience }] }),
        );

        expect(findings.some((f) => f.message.includes('本人を名指せる宛先ではありません'))).toBe(true);
        expect(value?.notifications).toEqual([]);
      }
    });

    it('allows_person_mention を宣言できるのはチャンネル宛の語だけ(ロール宛・本人宛の語は落ちる)', () => {
      const { findings } = parse(
        frontmatter({
          vocabulary: {
            ...PERSON_VOCABULARY,
            audience: [{ id: 'staff_channel', recipient: { kind: 'role', role: 'staff' }, allows_person_mention: true }],
          },
          notifications: [],
        }),
      );

      expect(findings.some((f) => f.message.includes('allows_person_mention を宣言できません'))).toBe(true);
    });

    it('allows_person_mention は audience の語だけが書ける', () => {
      const { findings } = parse(
        frontmatter({ vocabulary: { ...VOCABULARY, mention: [{ id: 'none', allows_person_mention: true }] } }),
      );

      expect(findings.some((f) => f.message.includes('allows_person_mention は書けません'))).toBe(true);
    });

    it('mentions_person は mention の語だけが書ける', () => {
      const { findings } = parse(
        frontmatter({
          vocabulary: { ...VOCABULARY, medium: [{ id: 'discord', mentions_person: true }] },
        }),
      );

      expect(findings.some((f) => f.message.includes('mentions_person は書けません'))).toBe(true);
    });

    it('mentions_person が true / false でなければ落ちる', () => {
      const { findings } = parse(
        frontmatter({ vocabulary: { ...VOCABULARY, mention: [{ id: 'none', mentions_person: 'yes' }] } }),
      );

      expect(findings.some((f) => f.message.includes('true / false で書きます'))).toBe(true);
    });
  });
});
