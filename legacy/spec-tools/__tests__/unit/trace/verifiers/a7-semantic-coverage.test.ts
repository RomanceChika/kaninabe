/**
 * A7(意味的カバレッジ)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md §A7 の導出規則の表 —
 * 遷移 / creates / deletes / writes ごとに、どの条件でどの意味クラスが必要になるか。
 */

import { describe, expect, it } from 'vitest';
import { semanticCoverageVerifier } from '../../../../lib/trace/verifiers/a7-semantic-coverage.js';
import type { Finding } from '../../../../lib/kernel/finding.js';
import type { CoverageClass } from '../../../../lib/testcase/types.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  event,
  invariant,
  invariantSpec,
  loc,
  machine,
  role,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec, testCase, traceInput } from '../../../helpers/trace-builder.js';

/** 人間ロール 3 種 + system。forbidden の導出に使う。 */
const ROLES = [role('anonymous'), role('member'), role('performer'), role('system')];

/**
 * entry.submit を持つドメイン。既定は
 * guard 付き・from が全状態を覆わない・performer だけが起こせる遷移。
 */
function transitionDomain(
  init: { guard?: string; from?: readonly string[]; by?: readonly string[]; invariants?: ReturnType<typeof invariantSpec> } = {},
) {
  return specModel({
    roles: ROLES,
    aggregates: [
      aggregate({
        name: 'entry',
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [
              event({
                id: 'submit',
                from: init.from ?? ['draft'],
                to: 'submitted',
                by: init.by ?? ['performer'],
                ...(init.guard === undefined ? {} : { guard: init.guard }),
              }),
            ],
          }),
        ],
        ...(init.invariants === undefined ? {} : { invariants: init.invariants }),
      }),
    ],
  });
}

/** covers を宣言した 1 件のテストケースだけを持つ action_spec。 */
function action(handles: string, covers: readonly CoverageClass[]) {
  return actionSpec({
    handles,
    testCases: [
      testCase({ id: 'TC-X-Y-001', implementation: 'app/x.test.ts::名前', covers }),
    ],
  });
}

/**
 * 意味クラスの過不足だけを取り出す。
 *
 * A7 は意味クラスとロール(by_role)の 2 種類の Finding を出すので、クラスを見るテストでは
 * ロール側を落としてから比べる(反例のキーで見分ける)。
 */
function classFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.counterexample?.['missing'] !== undefined);
}

/** 検証して、足りないと言われた意味クラスだけを取り出す。 */
function missing(domainModel: ReturnType<typeof specModel>, handles: string, covers: readonly CoverageClass[]) {
  const findings = semanticCoverageVerifier.verify(
    traceInput({ domain: domainModel, actions: [action(handles, covers)] }),
  );
  return classFindings(findings).map((f) => f.counterexample?.['missing']);
}

/** 遷移が要求するクラスをすべて宣言した covers(既定のドメイン用)。 */
const FULL_TRANSITION: readonly CoverageClass[] = [
  'success',
  'conflict',
  'guard_unsatisfied',
  'invalid_from',
  'forbidden',
];

describe('A7 意味的カバレッジ', () => {
  it('必要クラスをすべて宣言していれば通る', () => {
    const domainModel = transitionDomain({ guard: 'workshop.state == accepting' });

    expect(missing(domainModel, 'entry.submit', FULL_TRANSITION)).toEqual([]);
  });

  it('必要クラスが 1 つ足りなければ、そのクラスごとに違反になる', () => {
    const domainModel = transitionDomain({ guard: 'workshop.state == accepting' });

    const findings = classFindings(
      semanticCoverageVerifier.verify(
        traceInput({
          domain: domainModel,
          actions: [action('entry.submit', ['success', 'conflict', 'invalid_from', 'forbidden'])],
        }),
      ),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A7');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('guard_unsatisfied');
    expect(findings[0]?.location.pointer).toBe('test_cases');
    expect(findings[0]?.counterexample).toMatchObject({ handles: 'entry.submit', missing: 'guard_unsatisfied' });
  });

  it('遷移は success と conflict を無条件に要求する', () => {
    const domainModel = transitionDomain({ from: ['draft', 'submitted'], by: ROLES.map((r) => r.id) });

    expect(missing(domainModel, 'entry.submit', [])).toEqual(['success', 'conflict']);
  });

  it('guard があれば guard_unsatisfied を要求する', () => {
    const domainModel = transitionDomain({ guard: 'workshop.state == accepting' });

    expect(missing(domainModel, 'entry.submit', FULL_TRANSITION.filter((c) => c !== 'guard_unsatisfied'))).toEqual([
      'guard_unsatisfied',
    ]);
  });

  it('境界: guard が無ければ guard_unsatisfied は要求しない', () => {
    expect(missing(transitionDomain(), 'entry.submit', ['success', 'conflict', 'invalid_from', 'forbidden'])).toEqual([]);
  });

  it('from が全状態を覆っていなければ invalid_from を要求する', () => {
    const domainModel = transitionDomain();

    expect(missing(domainModel, 'entry.submit', ['success', 'conflict', 'forbidden'])).toEqual(['invalid_from']);
  });

  it('境界: from が全状態を覆っていれば invalid_from は要求しない', () => {
    const domainModel = transitionDomain({ from: ['draft', 'submitted'] });

    expect(missing(domainModel, 'entry.submit', ['success', 'conflict', 'forbidden'])).toEqual([]);
  });

  it('by に含まれない人間ロールがあれば forbidden を要求する', () => {
    const domainModel = transitionDomain({ from: ['draft', 'submitted'] });

    expect(missing(domainModel, 'entry.submit', ['success', 'conflict'])).toEqual(['forbidden']);
  });

  it('境界: 全人間ロールが実行できるなら forbidden は要求しない(system は数えない)', () => {
    const domainModel = transitionDomain({
      from: ['draft', 'submitted'],
      by: ['anonymous', 'member', 'performer'],
    });

    expect(missing(domainModel, 'entry.submit', ['success', 'conflict'])).toEqual([]);
  });

  it('そのイベントを enforced_by: guard に持つ不変条件があれば invariant を要求する', () => {
    const domainModel = transitionDomain({
      from: ['draft', 'submitted'],
      by: ROLES.map((r) => r.id),
      invariants: invariantSpec([
        invariant({ id: 'INV-ENTRY-001', enforcedBy: [{ kind: 'guard', ref: 'entry.submit', location: loc() }] }),
      ]),
    });

    expect(missing(domainModel, 'entry.submit', ['success', 'conflict'])).toEqual(['invariant']);
  });

  it('境界: 別のイベントを執行点にする不変条件では invariant を要求しない', () => {
    const domainModel = transitionDomain({
      from: ['draft', 'submitted'],
      by: ROLES.map((r) => r.id),
      invariants: invariantSpec([
        invariant({ id: 'INV-ENTRY-001', enforcedBy: [{ kind: 'guard', ref: 'entry.withdraw', location: loc() }] }),
      ]),
    });

    expect(missing(domainModel, 'entry.submit', ['success', 'conflict'])).toEqual([]);
  });

  it('creates は success / forbidden を要求し、conflict と invalid_from は要求しない', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [aggregate({ name: 'entry', access: accessSpec('entry', { creates: [createRule('member')] }) })],
    });

    expect(missing(domainModel, 'entry.create', [])).toEqual(['success', 'forbidden']);
  });

  it('creates に when があれば guard_unsatisfied を要求する', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          access: accessSpec('entry', { creates: [createRule('member', 'workshop.state == accepting')] }),
        }),
      ],
    });

    // `when` があるなら判断は親の状態に対して下されており、書き込みまでに動けば 0 行になる
    // ——「拒否される条件がある」と「判断が古びうる」が同じ 1 つの宣言から出る（E6 第1段）。
    expect(missing(domainModel, 'entry.create', ['success', 'forbidden'])).toEqual([
      'conflict',
      'guard_unsatisfied',
    ]);
  });

  it('creates は DB 制約・トリガーで執行される不変条件があれば invariant を要求する', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          access: accessSpec('entry', { creates: [createRule('member')] }),
          invariants: invariantSpec([
            invariant({
              id: 'INV-ENTRY-001',
              entities: ['entry'],
              enforcedBy: [{ kind: 'db_constraint', ref: 'entries_active_unique', location: loc() }],
            }),
          ]),
        }),
      ],
    });

    expect(missing(domainModel, 'entry.create', ['success', 'forbidden'])).toEqual(['invariant']);
  });

  it('境界: 執行点が application だけの不変条件では creates に invariant を要求しない', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          access: accessSpec('entry', { creates: [createRule('member')] }),
          invariants: invariantSpec([
            invariant({
              id: 'INV-ENTRY-001',
              entities: ['entry'],
              enforcedBy: [{ kind: 'application', ref: 'entrySchema', location: loc() }],
            }),
          ]),
        }),
      ],
    });

    expect(missing(domainModel, 'entry.create', ['success', 'forbidden'])).toEqual([]);
  });

  it('creates: 許可ロールが implies の閉包で全人間ロールを覆っていれば forbidden を要求しない', () => {
    // anonymous と member だけを creates.by に並べても、staff implies member なので
    // staff にも拒否の反例が作れない(inquiry.create と同じ形)。
    const domainModel = specModel({
      roles: [role('anonymous'), role('member'), role('staff', undefined, ['member']), role('system')],
      aggregates: [
        aggregate({
          name: 'inquiry',
          access: accessSpec('inquiry', { creates: [createRule('anonymous'), createRule('member')] }),
        }),
      ],
    });

    expect(missing(domainModel, 'inquiry.create', ['success'])).toEqual([]);
  });

  it('境界: creates で implies が覆いきれない人間ロールが残っていれば forbidden を要求する', () => {
    const domainModel = specModel({
      roles: [role('anonymous'), role('member'), role('staff', undefined, ['member']), role('system')],
      aggregates: [
        aggregate({
          name: 'inquiry',
          access: accessSpec('inquiry', { creates: [createRule('member')] }),
        }),
      ],
    });

    expect(missing(domainModel, 'inquiry.create', ['success'])).toEqual(['forbidden']);
  });

  it('deletes は conflict と not_found も要求する', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [aggregate({ name: 'entry', access: accessSpec('entry', { deletes: [deleteRule('performer')] }) })],
    });

    expect(missing(domainModel, 'entry.delete', ['success', 'forbidden'])).toEqual(['conflict', 'not_found']);
  });

  it('境界: writes(update)は conflict を要求するが not_found は要求しない', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({ name: 'entry', access: accessSpec('entry', { writes: [writeRule('performer', ['note'])] }) }),
      ],
    });

    expect(missing(domainModel, 'entry.update', ['success', 'forbidden'])).toEqual(['conflict']);
  });

  // --- involves(別集約を数える不変条件の義務の全域化。今日見つかった穴の一般化) ---

  it('involves にそのエンティティを挙げる不変条件があれば、その集約の delete に invariant を要求する', () => {
    // entry が持つ不変条件(例: INV-ENTRY-008)が involves: [piece] を挙げていれば、
    // piece.delete(piece 自身の DB 制約は無い)にも invariant の義務が配られる。
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([
            invariant({ id: 'INV-ENTRY-008', entities: ['entry', 'piece'], involves: ['piece'] }),
          ]),
        }),
        aggregate({ name: 'piece', access: accessSpec('piece', { deletes: [deleteRule('performer')] }) }),
      ],
    });

    expect(missing(domainModel, 'piece.delete', ['success', 'forbidden', 'conflict', 'not_found'])).toEqual([
      'invariant',
    ]);
  });

  it('境界: involves を書かなければ、別集約の delete に invariant は配られない', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([invariant({ id: 'INV-ENTRY-008', entities: ['entry', 'piece'] })]),
        }),
        aggregate({ name: 'piece', access: accessSpec('piece', { deletes: [deleteRule('performer')] }) }),
      ],
    });

    expect(missing(domainModel, 'piece.delete', ['success', 'forbidden', 'conflict', 'not_found'])).toEqual([]);
  });

  it('involves にそのエンティティを挙げる不変条件があれば、その集約の create にも invariant を要求する', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([
            invariant({ id: 'INV-ENTRY-008', entities: ['entry', 'piece'], involves: ['piece'] }),
          ]),
        }),
        aggregate({ name: 'piece', access: accessSpec('piece', { creates: [createRule('performer')] }) }),
      ],
    });

    expect(missing(domainModel, 'piece.create', ['success', 'forbidden'])).toEqual(['invariant']);
  });

  it('involves にそのエンティティを挙げる不変条件があれば、その集約の全遷移にも invariant を要求する', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([
            invariant({
              id: 'INV-ENTRY-008',
              entities: ['entry', 'entry_participant'],
              involves: ['entry_participant'],
            }),
          ]),
        }),
        aggregate({
          name: 'entry_participant',
          stateMachines: [
            machine({
              machine: 'participant_link',
              states: ['unresolved', 'linked'],
              events: [event({ id: 'link', from: ['unresolved'], to: 'linked', by: ['performer'] })],
            }),
          ],
        }),
      ],
    });

    expect(
      missing(domainModel, 'participant_link.link', ['success', 'conflict', 'forbidden', 'invalid_from']),
    ).toEqual(['invariant']);
  });

  it('境界: 別集約の delete が自集約の DB 制約由来の invariant を既に要求していれば、involves は重ねて要求しない', () => {
    // 同じ cls を 2 回積んでも判定(必要クラス ⊆ 宣言済み covers)は変わらない —
    // 1 件の invariant テストケースが両方の理由を満たす。反例のメッセージが重複しないことを確かめる。
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([
            invariant({ id: 'INV-ENTRY-008', entities: ['entry', 'piece'], involves: ['piece'] }),
          ]),
        }),
        aggregate({
          name: 'piece',
          access: accessSpec('piece', { creates: [createRule('performer')] }),
          invariants: invariantSpec([
            invariant({
              id: 'INV-PIECE-001',
              entities: ['piece'],
              enforcedBy: [{ kind: 'db_constraint', ref: 'pieces_order_unique', location: loc() }],
            }),
          ]),
        }),
      ],
    });

    const findings = classFindings(
      semanticCoverageVerifier.verify(
        traceInput({ domain: domainModel, actions: [action('piece.create', ['success', 'forbidden'])] }),
      ),
    );

    expect(findings.filter((f) => f.counterexample?.['missing'] === 'invariant')).toHaveLength(1);
  });

  it('編集: writes の fields に触れない不変条件は invariant を要求しない', () => {
    // entry の不変条件は state と組(workshop_id / performer_id)に効く。連絡事項を書き換えても
    // 破れないので、宿題は増えない（題材の製品の entry.update がまさにこの形）。
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          access: accessSpec('entry', { writes: [writeRule('performer', ['note'])] }),
          invariants: invariantSpec([
            invariant({
              id: 'INV-ENTRY-001',
              entities: ['entry'],
              formal: {
                kind: 'uniqueness',
                keys: ['workshop_id', 'performer_id'],
                where: 'entry.state not in [rejected, withdrawn]',
              },
              enforcedBy: [{ kind: 'db_constraint', ref: 'entries_active_unique', location: loc('x') }],
            }),
          ]),
        }),
      ],
    });

    expect(missing(domainModel, 'entry.update', ['success', 'forbidden', 'conflict'])).toEqual([]);
  });

  it('編集: writes の fields に触れる不変条件があれば invariant を要求する', () => {
    // 1 行の中のフィールド間の関係（check）は、その片方を書き換えるだけで破れる
    // （題材の製品の workshop.update × INV-WORKSHOP-001）。
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'workshop',
          access: accessSpec('workshop', {
            writes: [writeRule('organizer', ['starts_at', 'entry_deadline'])],
          }),
          invariants: invariantSpec([
            invariant({
              id: 'INV-WORKSHOP-001',
              entities: ['workshop'],
              formal: { kind: 'check', expr: 'workshop.entry_deadline < workshop.starts_at' },
              enforcedBy: [
                { kind: 'db_constraint', ref: 'workshops_deadline_before_start', location: loc('x') },
              ],
            }),
          ]),
        }),
      ],
    });

    expect(missing(domainModel, 'workshop.update', ['success', 'forbidden', 'conflict'])).toEqual([
      'invariant',
    ]);
  });

  it('編集: 交わりの判定は集約をまたぐ（相手側のテーブルの制約でも要求する）', () => {
    // 催しの定員を下げると、申込み側の件数制約（max: workshop.capacity）に触れる。
    // 執行点は entries のトリガーだが、破りうるのは workshop の編集である。
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'workshop',
          access: accessSpec('workshop', { writes: [writeRule('organizer', ['capacity'])] }),
        }),
        aggregate({
          name: 'entry',
          access: accessSpec('entry', {}),
          invariants: invariantSpec([
            invariant({
              id: 'INV-ENTRY-002',
              entities: ['entry', 'workshop'],
              formal: {
                kind: 'cardinality',
                keys: ['workshop_id'],
                max: 'workshop.capacity',
                where: 'entry.state in [submitted, accepted]',
              },
              enforcedBy: [{ kind: 'trigger', ref: 'check_entry_capacity', location: loc('x') }],
            }),
          ]),
        }),
      ],
    });

    expect(missing(domainModel, 'workshop.update', ['success', 'forbidden', 'conflict'])).toEqual([
      'invariant',
    ]);
  });

  it('必要でないクラスを宣言していても問題にしない', () => {
    const domainModel = transitionDomain({ from: ['draft', 'submitted'], by: ROLES.map((r) => r.id) });

    expect(missing(domainModel, 'entry.submit', ['success', 'conflict', 'other', 'not_found'])).toEqual([]);
  });

  it('covers を宣言していないケースは判定に寄与しない', () => {
    const domainModel = transitionDomain({ from: ['draft', 'submitted'], by: ROLES.map((r) => r.id) });
    const spec = actionSpec({
      handles: 'entry.submit',
      testCases: [
        testCase({ id: 'TC-X-Y-001', implementation: 'app/x.test.ts::名前', covers: ['success'] }),
        testCase({ id: 'TC-X-Y-002', implementation: 'app/x.test.ts::競合' }),
      ],
    });

    const findings = semanticCoverageVerifier.verify(traceInput({ domain: domainModel, actions: [spec] }));

    expect(classFindings(findings).map((f) => f.counterexample?.['missing'])).toEqual(['conflict']);
  });

  it('境界: handles がドメイン仕様に接地していなければ何も言わない(A1 の担当)', () => {
    expect(missing(transitionDomain(), 'entry.approve', [])).toEqual([]);
    expect(missing(transitionDomain(), 'entry.create', [])).toEqual([]);
  });

  it('Finding は 3 点セットを持ち、宣言済みクラスを反例に載せる', () => {
    const domainModel = transitionDomain({ from: ['draft', 'submitted'], by: ROLES.map((r) => r.id) });

    const findings = classFindings(
      semanticCoverageVerifier.verify(
        traceInput({ domain: domainModel, actions: [action('entry.submit', ['success'])] }),
      ),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).not.toBe('');
    expect(findings[0]?.suggestion).toContain('covers に conflict を書く');
    expect(findings[0]?.location.file).not.toBe('');
    expect(findings[0]?.counterexample?.['declared']).toBe('success');
  });
});

describe('A7 ロールの義務(by_role)', () => {
  /** `by` に並ぶロールごとに success のケースがあるかだけを取り出す。 */
  function roleFindings(domainModel: ReturnType<typeof specModel>, spec: ReturnType<typeof actionSpec>) {
    return semanticCoverageVerifier
      .verify(traceInput({ domain: domainModel, actions: [spec] }))
      .filter((finding) => finding.counterexample?.['missing'] === undefined);
  }

  /** 遷移の by に performer と staff が並ぶドメイン(代理の口を持つ形)。 */
  function delegated() {
    return transitionDomain({ from: ['draft', 'submitted'], by: ['performer', 'staff'] });
  }

  it('by に並ぶロールごとに success のケースが要る', () => {
    const spec = actionSpec({
      handles: 'entry.submit',
      testCases: [
        testCase({
          id: 'TC-X-Y-001',
          implementation: 'app/x.test.ts::本人',
          covers: ['success'],
          byRole: 'performer',
        }),
        testCase({ id: 'TC-X-Y-002', implementation: 'app/x.test.ts::競合', covers: ['conflict'] }),
      ],
    });

    const findings = roleFindings(delegated(), spec);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('staff');
    expect(findings[0]?.counterexample).toMatchObject({ missing_role: 'staff', declared: 'performer' });
  });

  it('全ロールに success のケースがあれば通る', () => {
    const spec = actionSpec({
      handles: 'entry.submit',
      testCases: [
        testCase({ id: 'TC-X-Y-001', implementation: 'app/x.test.ts::本人', covers: ['success'], byRole: 'performer' }),
        testCase({ id: 'TC-X-Y-002', implementation: 'app/x.test.ts::代理', covers: ['success'], byRole: 'staff' }),
        testCase({ id: 'TC-X-Y-003', implementation: 'app/x.test.ts::競合', covers: ['conflict'] }),
      ],
    });

    expect(roleFindings(delegated(), spec)).toEqual([]);
  });

  it('success を覆っていない by_role は数えない(拒否のケースでは義務を満たせない)', () => {
    const spec = actionSpec({
      handles: 'entry.submit',
      testCases: [
        testCase({ id: 'TC-X-Y-001', implementation: 'app/x.test.ts::本人', covers: ['success'], byRole: 'performer' }),
        testCase({ id: 'TC-X-Y-002', implementation: 'app/x.test.ts::拒否', covers: ['forbidden'], byRole: 'staff' }),
      ],
    });

    expect(roleFindings(delegated(), spec).map((f) => f.counterexample?.['missing_role'])).toEqual(['staff']);
  });

  it('宣言に無いロールを指定する by_role は余分として落ちる', () => {
    const spec = actionSpec({
      handles: 'entry.submit',
      testCases: [
        testCase({ id: 'TC-X-Y-001', implementation: 'app/x.test.ts::本人', covers: ['success'], byRole: 'performer' }),
        testCase({ id: 'TC-X-Y-002', implementation: 'app/x.test.ts::綴り違い', covers: ['success'], byRole: 'staffs' }),
      ],
    });

    const findings = roleFindings(transitionDomain({ from: ['draft', 'submitted'], by: ['performer'] }), spec);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ by_role: 'staffs' });
  });

  it('system は義務にしない(内部実行の経路は A10 が別に見る)', () => {
    const spec = actionSpec({
      handles: 'entry.submit',
      testCases: [
        testCase({ id: 'TC-X-Y-001', implementation: 'app/x.test.ts::本人', covers: ['success'], byRole: 'performer' }),
      ],
    });

    const domainModel = transitionDomain({ from: ['draft', 'submitted'], by: ['performer', 'system'] });

    expect(roleFindings(domainModel, spec)).toEqual([]);
  });

  it('creates / writes / deletes の by も同じ義務を生む', () => {
    const domainModel = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'entry',
          access: accessSpec('entry', { creates: [createRule('member'), createRule('performer')] }),
        }),
      ],
    });
    const spec = actionSpec({
      handles: 'entry.create',
      testCases: [
        testCase({ id: 'TC-X-Y-001', implementation: 'app/x.test.ts::メンバー', covers: ['success'], byRole: 'member' }),
      ],
    });

    expect(roleFindings(domainModel, spec).map((f) => f.counterexample?.['missing_role'])).toEqual(['performer']);
  });
});
