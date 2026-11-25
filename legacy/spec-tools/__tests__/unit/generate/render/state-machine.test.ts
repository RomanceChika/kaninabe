import { describe, expect, it } from 'vitest';

import { stateMachineGenerator } from '../../../../lib/generate/render/state-machine.js';
import type { GeneratedSection } from '../../../../lib/gen-kit/generator.js';
import type { SpecModel, StateMachineSpec } from '../../../../lib/model/types.js';
import {
  aggregate,
  effect,
  event,
  forbidden,
  machine,
  modelWithMachine,
  specModel,
} from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** マーカー名で引ける形にする(セクションの順序は別途アサートする)。 */
function sectionsByMarker(model: SpecModel): Map<string, GeneratedSection> {
  return new Map(stateMachineGenerator.generate(model, GEN_CTX).map((s) => [s.marker ?? '', s]));
}

function contentOf(model: SpecModel, marker: string): string {
  const section = sectionsByMarker(model).get(marker);
  if (section === undefined) throw new Error(`マーカー ${marker} のセクションがありません`);
  return section.content;
}

/** entry 相当の状態機械(guard / final / effects / otherwise_forbidden をすべて含む)。 */
function entryMachine(): StateMachineSpec {
  return machine('entry', {
    states: ['draft', 'submitted', 'accepted', 'rejected', 'withdrawn'],
    initial: 'draft',
    final: ['rejected', 'withdrawn'],
    events: [
      event('submit', {
        from: ['draft'],
        to: 'submitted',
        by: ['performer'],
        guard: 'workshop.state == accepting',
        otherwiseForbidden: '提出は下書きからのみ',
      }),
      event('accept', {
        from: ['submitted'],
        to: 'accepted',
        by: ['organizer'],
        otherwiseForbidden: '受理判断は提出済みに対してのみ行う',
      }),
      event('withdraw', {
        from: ['submitted', 'accepted'],
        to: 'withdrawn',
        by: ['performer', 'organizer'],
        guard: 'workshop.state != program_published',
        otherwiseForbidden: '下書きの取下げは削除で行う',
      }),
    ],
    effects: [
      effect('submit', ['notify_organizer_new_entry']),
      effect('withdraw', ['notify_organizer_withdrawn']),
    ],
  });
}

describe('stateMachineGenerator: セクションの割り当て', () => {
  it('states.md 1 ファイルにつき 3 マーカー分のセクションを返す', () => {
    const sections = stateMachineGenerator.generate(modelWithMachine(entryMachine()), GEN_CTX);

    expect(stateMachineGenerator.id).toBe('state-machine');
    expect(sections.map((s) => s.marker)).toEqual([
      'state-diagram',
      'transition-table',
      'state-event-matrix',
    ]);
    expect(new Set(sections.map((s) => s.file))).toEqual(
      new Set(['docs/specs/domain/entry/states.md']),
    );
  });

  it('状態機械が 1 つも無いモデルではセクションを返さない', () => {
    expect(stateMachineGenerator.generate(specModel([aggregate('entry')]), GEN_CTX)).toEqual([]);
  });
});

describe('stateMachineGenerator: 状態遷移図(state-diagram)', () => {
  it('初期状態・遷移・終了状態を stateDiagram-v2 の行として出す', () => {
    const diagram = contentOf(modelWithMachine(entryMachine()), 'state-diagram');

    expect(diagram).toBe(
      [
        '```mermaid',
        'stateDiagram-v2',
        '    [*] --> draft',
        '    draft --> submitted: submit (performer)',
        '    submitted --> accepted: accept (organizer)',
        '    submitted --> withdrawn: withdraw (performer, organizer)',
        '    accepted --> withdrawn: withdraw (performer, organizer)',
        '    rejected --> [*]',
        '    withdrawn --> [*]',
        '```',
      ].join('\n'),
    );
  });

  it('遷移ラベルに guard を含めない(条件は遷移表に委ねる)', () => {
    const diagram = contentOf(modelWithMachine(entryMachine()), 'state-diagram');

    expect(diagram).not.toContain('workshop.state');
    expect(diagram).not.toContain('/');
  });

  it('どの遷移にも現れない状態を宣言行として残す', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted', 'orphan'],
        initial: 'draft',
        events: [event('submit', { from: ['draft'], to: 'submitted' })],
      }),
    );

    const lines = contentOf(model, 'state-diagram').split('\n');

    expect(lines).toContain('    orphan');
  });
});

describe('stateMachineGenerator: 遷移表(transition-table)', () => {
  it('イベント 1 つにつき 1 行を出し、ID は machine.event 形式にする', () => {
    const lines = contentOf(modelWithMachine(entryMachine()), 'transition-table').split('\n');

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('| イベントID | from | to | by | guard | 書き留める時刻 | effects |');
    expect(lines[1]).toBe('| --- | --- | --- | --- | --- | --- | --- |');
    expect(lines[2]).toBe(
      '| entry.submit | draft | submitted | performer | `workshop.state == accepting` | — | notify_organizer_new_entry |',
    );
  });

  it('from が複数の遷移は 1 行にまとめ、by も列挙する', () => {
    const lines = contentOf(modelWithMachine(entryMachine()), 'transition-table').split('\n');

    expect(lines[4]).toBe(
      '| entry.withdraw | submitted, accepted | withdrawn | performer, organizer | `workshop.state != program_published` | — | notify_organizer_withdrawn |',
    );
  });

  it('guard と effects が無い遷移は — で埋める', () => {
    const lines = contentOf(modelWithMachine(entryMachine()), 'transition-table').split('\n');

    expect(lines[3]).toBe('| entry.accept | submitted | accepted | organizer | — | — | — |');
  });

  it('effects の on は machine.event 形式でもイベントに結び付ける', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted'],
        initial: 'draft',
        events: [event('submit', { from: ['draft'], to: 'submitted', by: ['performer'] })],
        effects: [effect('entry.submit', ['notify_a', 'notify_b'])],
      }),
    );

    const lines = contentOf(model, 'transition-table').split('\n');

    expect(lines[2]).toBe('| entry.submit | draft | submitted | performer | — | — | notify_a, notify_b |');
  });
});

describe('stateMachineGenerator: マトリクス(state-event-matrix)', () => {
  it('全状態 × 全イベントのマスを展開し、暗黙の禁止を ✗(o) で見せる', () => {
    const matrix = contentOf(modelWithMachine(entryMachine()), 'state-event-matrix');
    const lines = matrix.split('\n');

    expect(lines[0]).toBe('| 状態＼イベント | submit | accept | withdraw |');
    expect(lines[1]).toBe('| --- | --- | --- | --- |');
    expect(lines[2]).toBe('| draft | ✓→submitted | ✗(o) | ✗(o) |');
    expect(lines[3]).toBe('| submitted | ✗(o) | ✓→accepted | ✓→withdrawn |');
    expect(lines[4]).toBe('| accepted | ✗(o) | ✗(o) | ✓→withdrawn |');
    expect(lines[5]).toBe('| rejected | ✗(o) | ✗(o) | ✗(o) |');
    expect(lines[6]).toBe('| withdrawn | ✗(o) | ✗(o) | ✗(o) |');
  });

  it('otherwise_forbidden の理由をイベントIDつきで脚注に並べる', () => {
    const matrix = contentOf(modelWithMachine(entryMachine()), 'state-event-matrix');

    expect(matrix).toContain('凡例: `✓→{to}`');
    expect(matrix).toContain(
      '- o: from に無い状態の包括禁止(otherwise_forbidden)。イベントごとの理由は次のとおり。',
    );
    expect(matrix).toContain('    - submit: 提出は下書きからのみ');
    expect(matrix).toContain('    - accept: 受理判断は提出済みに対してのみ行う');
    expect(matrix).toContain('    - withdraw: 下書きの取下げは削除で行う');
    expect(matrix).not.toContain('- f1:');
    expect(matrix).not.toContain('- ?:');
  });

  it('明示的な forbidden は脚注番号つきの ✗(fN) にする', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted', 'accepted'],
        initial: 'draft',
        events: [
          event('revise', {
            from: ['submitted'],
            to: 'draft',
            by: ['performer'],
            otherwiseForbidden: '包括理由',
          }),
        ],
        forbidden: [
          forbidden('revise', ['draft'], '下書きは修正ではなく編集で直す'),
          forbidden('revise', ['accepted'], '受理後の修正はプログラムに影響する'),
        ],
      }),
    );

    const lines = contentOf(model, 'state-event-matrix').split('\n');
    const matrix = contentOf(model, 'state-event-matrix');

    expect(lines[2]).toBe('| draft | ✗(f1) |');
    expect(lines[3]).toBe('| submitted | ✓→draft |');
    expect(lines[4]).toBe('| accepted | ✗(f2) |');
    expect(matrix).toContain('- f1: 下書きは修正ではなく編集で直す');
    expect(matrix).toContain('- f2: 受理後の修正はプログラムに影響する');
    expect(matrix.split('\n\n')[0]).not.toContain('✗(o)');
    expect(matrix).not.toContain('- o:');
  });

  it('使われていない forbidden ブロックには脚注番号を振らない', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted'],
        initial: 'draft',
        events: [
          event('submit', { from: ['draft'], to: 'submitted', otherwiseForbidden: '包括理由' }),
        ],
        forbidden: [
          forbidden('unknown_event', ['draft'], '存在しないイベントの禁止'),
          forbidden('submit', ['submitted'], '提出済みの再提出は新規エントリー'),
        ],
      }),
    );

    const matrix = contentOf(model, 'state-event-matrix');

    expect(matrix).toContain('| submitted | ✗(f1) |');
    expect(matrix).toContain('- f1: 提出済みの再提出は新規エントリー');
    expect(matrix).not.toContain('- f2:');
  });

  it('理由の無いマス(V3 違反)は ✗(?) と注意書きで可視化する', () => {
    const model = modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted'],
        initial: 'draft',
        events: [event('submit', { from: ['draft'], to: 'submitted' })],
      }),
    );

    const matrix = contentOf(model, 'state-event-matrix');

    expect(matrix).toContain('| submitted | ✗(?) |');
    expect(matrix).toContain('- ?: 禁止理由が書かれていません');
  });
});

describe('stateMachineGenerator: 日本語 label の併記', () => {
  /** 一部の状態・イベントにだけ label がある機械(label 無しの経路も同時に確認する)。 */
  function labelledModel(): SpecModel {
    return modelWithMachine(
      machine('entry', {
        states: ['draft', 'submitted', 'archived'],
        initial: 'draft',
        stateLabels: { draft: '下書き', submitted: '提出済み' },
        events: [
          event('submit', {
            from: ['draft'],
            to: 'submitted',
            by: ['performer'],
            label: '提出',
            otherwiseForbidden: '提出は下書きからのみ',
          }),
          event('archive', {
            from: ['submitted'],
            to: 'archived',
            by: ['organizer'],
            otherwiseForbidden: '保管は提出済みのみ',
          }),
        ],
      }),
    );
  }

  it('図では label のある状態を宣言行で日本語表示し、遷移ラベルも日本語にする', () => {
    const lines = contentOf(labelledModel(), 'state-diagram').split('\n');

    expect(lines).toContain('    draft: 下書き (draft)');
    expect(lines).toContain('    submitted: 提出済み (submitted)');
    expect(lines).toContain('    draft --> submitted: 提出 (performer)');
    expect(lines).toContain('    submitted --> archived: archive (organizer)');
    expect(lines).not.toContain('    archived');
  });

  it('遷移表は ID を残したまま ID(label) で併記する', () => {
    const lines = contentOf(labelledModel(), 'transition-table').split('\n');

    expect(lines[2]).toBe(
      '| entry.submit(提出) | draft(下書き) | submitted(提出済み) | performer | — | — | — |',
    );
    expect(lines[3]).toBe('| entry.archive | submitted(提出済み) | archived | organizer | — | — | — |');
  });

  it('マトリクスの行見出し・列見出し・脚注にも label を併記する', () => {
    const matrix = contentOf(labelledModel(), 'state-event-matrix');
    const lines = matrix.split('\n');

    expect(lines[0]).toBe('| 状態＼イベント | submit(提出) | archive |');
    expect(lines[2]).toBe('| draft(下書き) | ✓→submitted | ✗(o) |');
    expect(lines[4]).toBe('| archived | ✗(o) | ✗(o) |');
    expect(matrix).toContain('    - submit(提出): 提出は下書きからのみ');
    expect(matrix).toContain('    - archive: 保管は提出済みのみ');
  });

  it('label が無い機械の出力は従来どおり ID だけになる', () => {
    const table = contentOf(modelWithMachine(entryMachine()), 'transition-table');
    const diagram = contentOf(modelWithMachine(entryMachine()), 'state-diagram');

    expect(table).toContain('| entry.submit | draft | submitted |');
    expect(diagram).not.toContain(': 下書き');
  });
});

describe('stateMachineGenerator: 複数状態機械(machines 形式)', () => {
  const file = 'docs/specs/domain/post/states.md';

  function orthogonalMachines(): StateMachineSpec[] {
    const review: StateMachineSpec = {
      ...machine('review', {
        states: ['pending', 'approved'],
        initial: 'pending',
        events: [
          event('approve', {
            from: ['pending'],
            to: 'approved',
            by: ['organizer'],
            otherwiseForbidden: '承認は審査中のみ',
          }),
        ],
      }),
      location: { file },
    };
    const visibility: StateMachineSpec = {
      ...machine('visibility', {
        states: ['hidden', 'visible'],
        initial: 'hidden',
        events: [
          event('show', {
            from: ['hidden'],
            to: 'visible',
            by: ['organizer'],
            otherwiseForbidden: '公開は非公開状態からのみ',
          }),
        ],
      }),
      location: { file },
    };
    return [review, visibility];
  }

  function orthogonalModel(): SpecModel {
    return specModel([aggregate('post', { stateMachines: orthogonalMachines() })]);
  }

  it('マーカーは 1 組のまま、機械ごとに H3 見出しを付けて連結する', () => {
    const sections = stateMachineGenerator.generate(orthogonalModel(), GEN_CTX);

    expect(sections).toHaveLength(3);
    expect(sections.every((s) => s.file === file)).toBe(true);

    const diagram = sections[0]?.content ?? '';
    expect(diagram.indexOf('### review')).toBe(0);
    expect(diagram).toContain('### visibility');
    expect(diagram.indexOf('### review')).toBeLessThan(diagram.indexOf('### visibility'));
    expect(diagram.split('```mermaid')).toHaveLength(3);
  });

  it('遷移表・マトリクスも機械ごとの見出しつきで 1 セクションにまとまる', () => {
    const model = orthogonalModel();

    const table = contentOf(model, 'transition-table');
    expect(table).toContain('### review');
    expect(table).toContain('| review.approve | pending | approved | organizer | — | — |');
    expect(table).toContain('| visibility.show | hidden | visible | organizer | — | — |');

    const matrix = contentOf(model, 'state-event-matrix');
    expect(matrix).toContain('| 状態＼イベント | approve |');
    expect(matrix).toContain('| 状態＼イベント | show |');
    expect(matrix).toContain('    - approve: 承認は審査中のみ');
  });

  it('別ファイルの状態機械は別セクションになる', () => {
    const model = specModel([
      aggregate('entry', { stateMachines: [entryMachine()] }),
      aggregate('post', { stateMachines: orthogonalMachines() }),
    ]);

    const sections = stateMachineGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(6);
    expect(sections.map((s) => s.file)).toEqual([
      'docs/specs/domain/entry/states.md',
      'docs/specs/domain/entry/states.md',
      'docs/specs/domain/entry/states.md',
      file,
      file,
      file,
    ]);
    expect(sections[0]?.content).not.toContain('###');
  });
});
