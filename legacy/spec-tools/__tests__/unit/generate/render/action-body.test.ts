import { describe, expect, it } from 'vitest';

import { actionBodyGenerator } from '../../../../lib/generate/render/action-body.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { ActionSpec } from '../../../../lib/model/trace/types.js';
import {
  accessSpec,
  aggregate,
  create,
  effect,
  entitySpec,
  event,
  field,
  machine,
  specModel,
  write,
} from '../../../helpers/model-builder.js';
import { actionSpec, testCase } from '../../../helpers/trace-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** action_spec を読み込み済みの文脈を作る。 */
function ctxWith(actions: readonly ActionSpec[]): GenerateContext {
  return { ...GEN_CTX, actions: { actions, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] } };
}

/** 遷移イベント submit を持つ entry 集約(ラベル・ガード・副作用つき)。 */
function entryModel() {
  return specModel([
    aggregate('entry', {
      entity: entitySpec('entry', {
        fields: [field('id', { kind: 'uuid' }, { auto: true, description: 'エントリーID' })],
      }),
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          stateLabels: { draft: '下書き', submitted: '提出済み' },
          events: [
            event('submit', {
              from: ['draft'],
              to: 'submitted',
              by: ['performer'],
              guard: 'workshop.state == accepting',
            }),
          ],
          effects: [effect('submit', ['notify_organizer_new_entry'])],
        }),
      ],
      access: accessSpec('entry', {
        creates: [create('member', 'workshop.state == accepting')],
        writes: [write('performer', ['title', 'note'], 'state == draft')],
      }),
    }),
  ]);
}

describe('actionBodyGenerator', () => {
  it('遷移アクションの宣言・前提と帰結・input・テストケースを表にする', () => {
    const action = actionSpec({
      handles: 'entry.submit',
      input: ['entry.id'],
      testCases: [
        testCase({
          id: 'TC-ENTRY-SUBMIT-001',
          covers: ['success'],
          specIds: ['entry.submit'],
          implementation: 'app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる',
        }),
      ],
    });

    const sections = actionBodyGenerator.generate(entryModel(), ctxWith([action]));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/actions/entry/submit.md');
    expect(sections[0]?.marker).toBe('action-body');

    const content = sections[0]?.content ?? '';
    expect(content).toContain('| handles | `entry.submit` |');
    expect(content).toContain('| 種別 | 状態遷移(state_spec: entry) |');
    expect(content).toContain('| 実行ロール（by） | performer |');
    // 前提と帰結は state_spec の 1 イベント分の引き写し(ラベル併記・guard はコード表示)
    expect(content).toContain(
      '| draft(下書き) | submitted(提出済み) | `workshop.state == accepting` | notify_organizer_new_entry |',
    );
    // input は entity_spec の定義の引き写し
    expect(content).toContain('| entry.id | uuid | —（行では必須） | auto=true | エントリーID |');
    // implementation はパス::テスト名なのでコードとして出す
    expect(content).toContain(
      '| TC-ENTRY-SUBMIT-001 | unit | success | — | entry.submit | `app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる` |',
    );
  });

  it('作成・編集の予約 ID は access_spec の規則を表にし、input: [] は明示の文で出す', () => {
    const model = entryModel();
    const createAction = actionSpec({ handles: 'entry.create', input: [] });
    const updateAction = actionSpec({ handles: 'entry.update', input: [] });

    const [createSection, updateSection] = actionBodyGenerator.generate(
      model,
      ctxWith([createAction, updateAction]),
    );

    const createContent = createSection?.content ?? '';
    expect(createContent).toContain('| 種別 | 作成(access_spec: entry の creates) |');
    expect(createContent).toContain('| member | `workshop.state == accepting` |');
    expect(createContent).toContain('この操作は入力を受けない');

    const updateContent = updateSection?.content ?? '';
    expect(updateContent).toContain('| 種別 | 編集(access_spec: entry の writes) |');
    expect(updateContent).toContain('| performer | title, note | `state == draft` |');
  });

  it('固有エラーがあるときだけ固有エラーの節を出し、エラー契約の行にも kind を併記する', () => {
    const base = actionSpec({ handles: 'entry.submit', input: [] });
    const action: ActionSpec = {
      ...base,
      errors: {
        inherits: 'common',
        additional: [
          { kind: 'external_unavailable', when: '決済ゲートウェイが応答しない', location: base.location },
        ],
      },
    };

    const content = actionBodyGenerator.generate(entryModel(), ctxWith([action]))[0]?.content ?? '';

    expect(content).toContain('| エラー契約 | common（共通 3 分類） + external_unavailable |');
    expect(content).toContain('### 固有エラー');
    expect(content).toContain('| external_unavailable | 決済ゲートウェイが応答しない |');

    const plain =
      actionBodyGenerator.generate(entryModel(), ctxWith([actionSpec({ handles: 'entry.submit' })]))[0]
        ?.content ?? '';
    expect(plain).not.toContain('### 固有エラー');
  });

  it('action_spec を読み込んでいない文脈では何も生成しない', () => {
    expect(actionBodyGenerator.generate(entryModel(), GEN_CTX)).toHaveLength(0);
  });
});
