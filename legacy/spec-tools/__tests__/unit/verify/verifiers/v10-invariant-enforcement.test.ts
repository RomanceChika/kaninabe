/**
 * V10(不変条件の執行)の規約網羅テスト。
 * 対象の要求: enforced_by が 1 つ以上ある / kind: guard の ref が実在する /
 * cardinality の max(親フィールド参照)が実在する / formal のガード式がパースできる /
 * formal を持たない不変条件は application・trigger での執行宣言が必須。
 */

import { describe, expect, it } from 'vitest';
import { invariantEnforcementVerifier } from '../../../../lib/verify/verifiers/v10-invariant-enforcement.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import type { EnforcementDef, InvariantFormal } from '../../../../lib/model/types.js';
import type { ApplicationRefs } from '../../../../lib/check-api/contract.js';
import {
  aggregate,
  entitySpec,
  event,
  field,
  invariant,
  invariantSpec,
  loc,
  machine,
  specModel,
  stubContext,
} from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

/** 執行点宣言のショートハンド。 */
/** 実装走査の結果(export された名前と、呼び出し口がある名前)。 */
function refs(exported: readonly string[], referenced: readonly string[]): ApplicationRefs {
  return { exportedNames: new Set(exported), referencedNames: new Set(referenced) };
}

function enforcement(kind: EnforcementDef['kind'], ref: string): EnforcementDef {
  return { kind, ref, location: loc() };
}

/** entry(状態機械 + invariant)と workshop(capacity を持つ親)を含むモデル。formal は省略可。 */
function model(init: {
  formal?: InvariantFormal;
  enforcedBy?: readonly EnforcementDef[];
  /** entry.submit のガード式(C-9 の関与判定に使う)。 */
  submitGuard?: string;
  /** involves の接地テスト用(実在しない集約名を渡すとエラーになることを見る)。 */
  involves?: readonly string[];
  /** entities の接地テスト用(省略時は住む集約 entry)。 */
  entities?: readonly string[];
}) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec(
          'entry',
          [
            field('workshop_id', { kind: 'ref', entity: 'workshop' }),
            field('performer_id', { kind: 'ref', entity: 'member' }),
            field('duration_min', { kind: 'integer' }),
            field('entry_deadline', { kind: 'datetime' }),
            field('starts_at', { kind: 'datetime' }),
            field('state', { kind: 'state', machine: 'entry' }),
          ],
          { workshop: 'entry.workshop_id' },
        ),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [
              event({
                id: 'submit',
                from: ['draft'],
                to: 'submitted',
                ...(init.submitGuard === undefined ? {} : { guard: init.submitGuard }),
              }),
            ],
          }),
        ],
        invariants: invariantSpec([
          invariant({
            id: 'INV-ENTRY-001',
            entities: init.entities ?? ['entry'],
            ...(init.formal === undefined ? {} : { formal: init.formal }),
            ...(init.enforcedBy === undefined ? {} : { enforcedBy: init.enforcedBy }),
            ...(init.involves === undefined ? {} : { involves: init.involves }),
          }),
        ]),
      }),
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [field('capacity', { kind: 'integer' })]),
      }),
    ],
  });
}

const uniqueness: InvariantFormal = { kind: 'uniqueness', keys: ['workshop_id', 'performer_id'] };

describe('invariantEnforcementVerifier', () => {
  it('enforced_by が空ならエラーにする', () => {
    const { ctx } = stubContext({});

    const findings = invariantEnforcementVerifier.verify(model({ formal: uniqueness }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V10');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('INV-ENTRY-001');
    expect(findings[0]?.message).toContain('enforced_by がありません');
    expect(findings[0]?.location.pointer).toBe('invariants.INV-ENTRY-001');
    expect(findings[0]?.suggestion.length).toBeGreaterThan(0);
    expect(findings[0]?.counterexample).toMatchObject({ enforced_by: '(空)' });
  });

  it('enforced_by が 1 つあれば通る(境界)', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: uniqueness,
      enforcedBy: [enforcement('db_constraint', 'entries_active_unique')],
    });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('kind: guard の ref が machine.event 形式でなければエラー', () => {
    const { ctx } = stubContext({});
    const target = model({ formal: uniqueness, enforcedBy: [enforcement('guard', 'submit')] });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('形式ではありません');
    expect(findings[0]?.counterexample).toMatchObject({ ref: 'submit' });
  });

  it('kind: guard の ref が存在しないイベントを指せばエラー', () => {
    const { ctx } = stubContext({});
    const target = model({ formal: uniqueness, enforcedBy: [enforcement('guard', 'entry.approve')] });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ machine: 'entry', missing_event: 'approve' });
  });

  it('kind: guard の ref が存在しない状態機械を指せばエラー', () => {
    const { ctx } = stubContext({});
    const target = model({ formal: uniqueness, enforcedBy: [enforcement('guard', 'ticket.submit')] });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ missing_machine: 'ticket' });
  });

  it('実在するイベントを指す kind: guard は通る', () => {
    const { ctx } = stubContext({});
    const target = model({ formal: uniqueness, enforcedBy: [enforcement('guard', 'entry.submit')] });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('guard 以外の kind の ref は形式チェックの対象外(境界)', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: uniqueness,
      enforcedBy: [enforcement('application', 'assertEntryUnique'), enforcement('trigger', 'trg_entry')],
    });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('cardinality の max が数値なら参照チェックしない(境界)', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'cardinality', keys: ['workshop_id'], max: 5 },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('cardinality の max が実在する親フィールド参照なら通る', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'cardinality', keys: ['workshop_id'], max: 'workshop.capacity' },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('cardinality の max が存在しないフィールドを指せばエラー', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'cardinality', keys: ['workshop_id'], max: 'workshop.seat_limit' },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({
      entity: 'workshop',
      missing_field: 'seat_limit',
    });
  });

  it('cardinality の max が存在しないエンティティを指せばエラー', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'cardinality', keys: ['workshop_id'], max: 'venue.capacity' },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ missing_entity: 'venue' });
  });

  it('where 句がパースできなければエラー', () => {
    const where = 'state not-in [withdrawn]';
    const { ctx } = stubContext({ unparsable: { [where]: '演算子が不正です' } });
    const target = model({
      formal: { kind: 'uniqueness', keys: ['workshop_id'], where },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('formal.where');
    expect(findings[0]?.counterexample).toMatchObject({ parse_error: '演算子が不正です' });
  });

  it('state_dependency の if / then をどちらもパース検査する', () => {
    const { ctx } = stubContext({
      unparsable: { 'workshop.state = published': '=', 'entry.state ??': '?' },
    });
    const target = model({
      formal: { kind: 'state_dependency', if: 'workshop.state = published', then: 'entry.state ??' },
      enforcedBy: [enforcement('application', 'f')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.message.includes('formal.if'))).toContain(true);
    expect(findings.map((finding) => finding.message.includes('formal.then'))).toContain(true);
  });

  it('where が存在しないフィールドを参照すればエラー', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'uniqueness', keys: ['workshop_id'], where: 'entry.stage not in [withdrawn]' },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('formal.where');
    expect(findings[0]?.counterexample).toMatchObject({ path: 'entry.stage' });
  });

  it('formal の式に 3 段以上のパスがあればエラー', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'check', expr: 'entry.starts_at.bogus > now' },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('entry の context に starts_at がありません');
    expect(findings[0]?.counterexample).toMatchObject({ path: 'entry.starts_at.bogus' });
  });

  // リテラルの接地は AST を見て決まるので、この 3 件だけは本物のガードサービスを注入する
  // (スタブの AST は生文字列を包んだだけで、比較の左辺が変数ドメインに接地しない)。
  describe('formal の比較リテラルの接地', () => {
    const REAL_CTX = { guards: createGuardServices(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

    it('宣言済みの状態と比べる where は通る', () => {
      const target = model({
        formal: { kind: 'uniqueness', keys: ['workshop_id'], where: 'entry.state not in [draft]' },
        enforcedBy: [enforcement('db_constraint', 'c')],
      });

      expect(invariantEnforcementVerifier.verify(target, REAL_CTX)).toEqual([]);
    });

    it('状態機械に無い状態と比べる where をエラーにする', () => {
      const target = model({
        formal: { kind: 'uniqueness', keys: ['workshop_id'], where: 'entry.state not in [drafft]' },
        enforcedBy: [enforcement('db_constraint', 'c')],
      });

      const findings = invariantEnforcementVerifier.verify(target, REAL_CTX);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V10');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('entry.state を drafft と比べています');
      expect(findings[0]?.suggestion).toContain('draft / submitted');
      expect(findings[0]?.counterexample).toMatchObject({ path: 'entry.state', value: 'drafft' });
    });

    it('kind: check の expr でも見る(恒偽判定は二重に出さない)', () => {
      const target = model({
        formal: { kind: 'check', expr: 'entry.state == publik' },
        enforcedBy: [enforcement('db_constraint', 'c')],
      });

      const findings = invariantEnforcementVerifier.verify(target, REAL_CTX);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('formal.expr');
      expect(findings[0]?.message).toContain('publik');
    });
  });

  it('exclusion の range が時間軸でないフィールドならエラー(範囲型に畳めない)', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'exclusion', keys: ['workshop_id'], range: ['starts_at', 'duration_min'] },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ field: 'duration_min', type: 'integer' });
  });

  it('exclusion の range が実在しないフィールドならエラー', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'exclusion', keys: ['workshop_id'], range: ['starts_at', 'ends_at'] },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings.some((finding) => finding.message.includes('ends_at'))).toBe(true);
  });

  it('exclusion の keys と range が実在すれば違反なし', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'exclusion', keys: ['workshop_id'], range: ['entry_deadline', 'starts_at'] },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('uniqueness の keys が存在しないフィールドならエラー', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'uniqueness', keys: ['workshop_id', 'perfomer_id'] },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ missing_field: 'perfomer_id' });
  });

  it('cardinality の keys が存在しないフィールドならエラー', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'cardinality', keys: ['event_id'], max: 5 },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ missing_field: 'event_id' });
  });

  it('formal が無くても application の執行宣言があれば通る', () => {
    const { ctx } = stubContext({});
    const target = model({ enforcedBy: [enforcement('application', 'assertTotalDurationFits')] });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('formal が無く trigger の執行宣言があれば通る(境界)', () => {
    const { ctx } = stubContext({});
    const target = model({ enforcedBy: [enforcement('trigger', 'trg_entry_total_duration')] });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  // db_constraint はトリガーと同じ層の執行なので、実体として認める(E6 第1段で追加)。
  it('formal が無くても db_constraint があれば通る', () => {
    const { ctx } = stubContext({});
    const target = model({ enforcedBy: [enforcement('db_constraint', 'workshops_venue_id_fkey')] });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('formal が無く guard しか無ければエラー', () => {
    const { ctx } = stubContext({});
    const target = model({ enforcedBy: [enforcement('guard', 'entry.submit')] });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('application / trigger / db_constraint');
    expect(findings[0]?.suggestion.length).toBeGreaterThan(0);
    expect(findings[0]?.counterexample).toMatchObject({
      formal: '(なし)',
      enforced_by_kinds: 'guard',
    });
  });

  it('formal も enforced_by も無い場合は enforced_by 不足のみを報告する(境界)', () => {
    const { ctx } = stubContext({});

    const findings = invariantEnforcementVerifier.verify(model({}), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('enforced_by がありません');
  });

  it('kind: check の expr が充足可能なら通る', () => {
    const { ctx } = stubContext({});
    const target = model({
      formal: { kind: 'check', expr: 'entry_deadline < starts_at' },
      enforcedBy: [enforcement('db_constraint', 'entries_deadline_check')],
    });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  it('kind: check の expr が恒偽ならエラー', () => {
    const expr = 'duration_min > 30 and duration_min < 10';
    const { ctx } = stubContext({ satisfiability: { [expr]: 'unsatisfiable' } });
    const target = model({
      formal: { kind: 'check', expr },
      enforcedBy: [enforcement('db_constraint', 'entries_duration_check')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V10');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('恒偽');
    expect(findings[0]?.message).toContain('どのレコードも保存できなくなる');
    expect(findings[0]?.location.pointer).toBe('invariants.INV-ENTRY-001');
    expect(findings[0]?.suggestion.length).toBeGreaterThan(0);
    expect(findings[0]?.counterexample).toMatchObject({ expr, satisfiability: 'unsatisfiable' });
  });

  it('kind: check の expr が恒真なら warning', () => {
    const expr = 'duration_min >= 1';
    const { ctx } = stubContext({
      satisfiability: { [expr]: { verdict: 'tautology', witness: { duration_min: '1' } } },
    });
    const target = model({
      formal: { kind: 'check', expr },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('恒真');
    expect(findings[0]?.counterexample).toMatchObject({ satisfiability: 'tautology', duration_min: '1' });
  });

  it('kind: check の expr がパースできなければパースエラーのみ報告する(境界)', () => {
    const expr = 'entry_deadline <<< starts_at';
    const { ctx, guards } = stubContext({
      unparsable: { [expr]: '演算子が不正です' },
      satisfiability: { [expr]: 'unsatisfiable' },
    });
    const target = model({
      formal: { kind: 'check', expr },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    const findings = invariantEnforcementVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('formal.expr');
    expect(findings[0]?.counterexample).toMatchObject({ parse_error: '演算子が不正です' });
    expect(guards.satisfiabilityCalls).toEqual([]);
  });

  it('kind: check の判定には自集約の変数ドメイン(裸のフィールド名)を渡す', () => {
    const expr = 'duration_min < 30';
    const { ctx, guards } = stubContext({});
    const target = model({
      formal: { kind: 'check', expr },
      enforcedBy: [enforcement('db_constraint', 'c')],
    });

    invariantEnforcementVerifier.verify(target, ctx);

    expect(guards.satisfiabilityCalls).toHaveLength(1);
    expect(guards.satisfiabilityCalls[0]?.env.get('duration_min')).toEqual({
      kind: 'ordered',
      discrete: true,
    });
  });

  describe('kind: guard の執行点が不変条件に触れているか(下限の検査)', () => {
    const check: InvariantFormal = {
      kind: 'check',
      expr: 'entry.entry_deadline < entry.starts_at',
    };

    it('関与フィールドがガードに現れれば通る', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: check,
        enforcedBy: [enforcement('guard', 'entry.submit')],
        submitGuard: 'entry.entry_deadline > now',
      });

      expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
    });

    it('関与フィールドが 1 つも現れないガードを執行点に挙げていれば警告', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: check,
        enforcedBy: [enforcement('guard', 'entry.submit')],
        submitGuard: 'workshop.capacity > 0',
      });

      const findings = invariantEnforcementVerifier.verify(target, ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V10');
      expect(findings[0]?.severity).toBe('warning');
      expect(findings[0]?.message).toContain('1 つも現れません');
      expect(findings[0]?.counterexample).toMatchObject({
        ref: 'entry.submit',
        // レポーターの `, ` 区切りと混ざらないよう [a | b] で囲む。
        involved_fields: '[entry.entry_deadline | entry.starts_at]',
        guard: 'workshop.capacity > 0',
      });
    });

    it('ガードを持たないイベントを執行点に挙げていれば警告(境界)', () => {
      const { ctx } = stubContext({});
      const target = model({ formal: check, enforcedBy: [enforcement('guard', 'entry.submit')] });

      const findings = invariantEnforcementVerifier.verify(target, ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe('warning');
      expect(findings[0]?.counterexample).toMatchObject({ guard: '(なし)' });
    });

    it('uniqueness / cardinality は適用範囲外(集計はガード式で表せない)', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: { kind: 'uniqueness', keys: ['workshop_id'], where: 'entry.state not in [draft]' },
        enforcedBy: [enforcement('guard', 'entry.submit')],
        submitGuard: 'workshop.capacity > 0',
      });

      expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
    });

    it('state_dependency も適用対象にする', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: { kind: 'state_dependency', if: 'entry.starts_at > now', then: 'entry.duration_min > 0' },
        enforcedBy: [enforcement('guard', 'entry.submit')],
        submitGuard: 'workshop.capacity > 0',
      });

      const findings = invariantEnforcementVerifier.verify(target, ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe('warning');
    });
  });

  it('invariants を持たない集約は何も報告しない(境界)', () => {
    const { ctx } = stubContext({});
    const target = specModel({ aggregates: [aggregate({ name: 'entry' })] });

    expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
  });

  describe('involves の接地', () => {
    it('存在しない集約名を involves に書くとエラーになる', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('db_constraint', 'entries_active_unique')],
        involves: ['piece'],
      });

      const findings = invariantEnforcementVerifier.verify(target, ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V10');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('involves の piece は未定義の集約です');
      expect(findings[0]?.counterexample).toMatchObject({ missing_entity: 'piece' });
    });

    it('境界: involves が実在する集約名なら通る(workshop は model() が定義する)', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('db_constraint', 'entries_active_unique')],
        involves: ['workshop'],
      });

      expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
    });

    it('存在しない集約名を entities に書くとエラーになる(A7 の義務の配り先から黙って外れる)', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('db_constraint', 'entries_active_unique')],
        entities: ['entry', 'concrt'],
      });

      const findings = invariantEnforcementVerifier.verify(target, ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('entities の concrt は未定義の集約です');
      expect(findings[0]?.counterexample).toMatchObject({ missing_entity: 'concrt' });
    });

    it('境界: involves を書かなければ何も見ない', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('db_constraint', 'entries_active_unique')],
      });

      expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
    });
  });

  describe('kind: application の ref 実在(実装の export 名の集合との突合)', () => {
    it('ctx.applicationRefs に無い ref はエラーにする(綴り違い・リネーム後の消し忘れ)', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('application', 'calculateSlotFee')],
      });

      const findings = invariantEnforcementVerifier.verify(target, {
        ...ctx,
        // "calculateSlotFee" は含めない
        applicationRefs: refs(['calculateWorkshopFees'], ['calculateWorkshopFees']),
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V10');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('calculateSlotFee');
      expect(findings[0]?.message).toContain('実在しません');
      expect(findings[0]?.counterexample).toMatchObject({ ref: 'calculateSlotFee' });
    });

    it('境界: ctx.applicationRefs にある ref なら通る', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('application', 'calculateSlotFee')],
      });

      const findings = invariantEnforcementVerifier.verify(target, {
        ...ctx,
        applicationRefs: refs(
          ['calculateSlotFee', 'calculateWorkshopFees'],
          ['calculateSlotFee', 'calculateWorkshopFees'],
        ),
      });

      expect(findings).toEqual([]);
    });

    it('境界: ctx.applicationRefs を省略した構成(app/ を走査できない)では何も見ない', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('application', 'anyNameAtAll')],
      });

      expect(invariantEnforcementVerifier.verify(target, ctx)).toEqual([]);
    });
  });

  describe('kind: application の ref の呼び出し口(export は残り、呼ぶ側だけが消える形)', () => {
    it('export はあるが誰からも呼ばれていない ref はエラーにする', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('application', 'assertStaffNotEmpty')],
      });

      const findings = invariantEnforcementVerifier.verify(target, {
        ...ctx,
        // 宣言はあるが、どのソースからも触れられていない(単体テストは走査の対象外)。
        applicationRefs: refs(['assertStaffNotEmpty'], ['somethingElse']),
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V10');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('assertStaffNotEmpty');
      expect(findings[0]?.message).toContain('どこからも呼ばれていません');
      expect(findings[0]?.counterexample).toMatchObject({ call_sites: '0' });
    });

    it('境界: 呼び出し口があれば通る', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('application', 'assertStaffNotEmpty')],
      });

      const findings = invariantEnforcementVerifier.verify(target, {
        ...ctx,
        applicationRefs: refs(['assertStaffNotEmpty'], ['assertStaffNotEmpty']),
      });

      expect(findings).toEqual([]);
    });

    it('境界: 実在しない ref には呼び出し口の指摘を重ねない(実在検査が先に報告する)', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('application', 'goneForGood')],
      });

      const findings = invariantEnforcementVerifier.verify(target, {
        ...ctx,
        applicationRefs: refs([], []),
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('実在しません');
    });

    it('境界: kind: trigger / db_constraint には呼び出し口を要求しない(執行点が DB 側にある)', () => {
      const { ctx } = stubContext({});
      const target = model({
        formal: uniqueness,
        enforcedBy: [enforcement('trigger', 'check_staff_floor')],
      });

      const findings = invariantEnforcementVerifier.verify(target, {
        ...ctx,
        applicationRefs: refs([], []),
      });

      expect(findings).toEqual([]);
    });
  });
});
