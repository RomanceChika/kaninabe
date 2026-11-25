/**
 * 認証基盤の操作の生成の入力(`buildPlatformPlan`)のテスト。名前の規約・入力の zod の式・戻り値の型・配線先を呼ぶ式・行の写しの導出を固定する。
 */

import { describe, expect, it } from 'vitest';
import { buildPlatformPlan, callArguments, projectionLines, tsTypeOf } from '../../../../lib/generate/render/platform-ops-plan.js';
import { authModel, platformOp, platformOpsSection, platformShape } from '../../../helpers/auth-builder.js';
import { designSection } from '../../../helpers/platform-ops-fixture.js';

describe('buildPlatformPlan', () => {
  it('宣言の無い製品・操作が空の宣言は空の計画', () => {
    expect(buildPlatformPlan(undefined).ops).toEqual([]);
    expect(buildPlatformPlan(authModel()).ops).toEqual([]);
    expect(buildPlatformPlan(authModel({ platformOps: platformOpsSection([]) })).ops).toEqual([]);
  });

  it('操作の名前・入力の型・戻り値の型が宣言から決まる', () => {
    const plan = buildPlatformPlan(authModel({ platformOps: designSection() }));
    const byId = new Map(plan.ops.map((op) => [op.id, op]));

    expect(byId.get('session.end_mine')).toMatchObject({ base: 'sessionEndMine', pascal: 'SessionEndMine', outputType: 'boolean', portFactory: 'sessionManagement' });
    expect(byId.get('session.list_mine')?.outputType).toBe('readonly SessionSummaryRow[]');
    expect(byId.get('session.end_every')?.inputs).toMatchObject([{ arg: 'keep_self', prop: 'keepSelf', row: false, type: 'boolean', zod: 'z.boolean().default(true)' }]);
    expect(byId.get('session.end_member')?.outputType).toBe('number');
  });

  it('行から受ける識別子は UUID の形を要求できる(format: uuid)。無ければ長さだけを抑える', () => {
    const plan = buildPlatformPlan(authModel({ platformOps: designSection() }));

    expect(plan.ops.find((op) => op.id === 'session.end_mine')?.inputs[0]).toMatchObject({ row: true, uuid: true, source: { of: 'session.list_mine', field: 'id', skipIf: 'is_current' } });
    expect(plan.ops.find((op) => op.id === 'session.end_mine')?.inputs[0]?.zod).toMatch(/^z\.string\(\)\.regex\(\/\^\[0-9a-f\]\{8\}/u);
  });

  it('返す欄: 欄 → 行のプロパティの対応・型と null の有無は行の型から・見出しと整形は宣言から', () => {
    const shape = buildPlatformPlan(authModel({ platformOps: designSection() })).shapes[0];

    expect(shape?.typeName).toBe('SessionSummaryRow');
    expect(shape?.fields.map((field) => ({ field: field.field, prop: field.prop, from: field.from, format: field.format, label: field.label }))).toEqual([
      { field: 'id', prop: 'id', from: 'id', format: 'text', label: 'id' },
      { field: 'created_at', prop: 'createdAt', from: 'createdAt', format: 'text', label: 'created_at' },
      { field: 'last_used_at', prop: 'lastUsedAt', from: 'lastActiveAt', format: 'datetime', label: '最後に使った日時' },
      { field: 'is_current', prop: 'isCurrent', from: 'current', format: 'boolean', label: 'この端末' },
    ]);
  });

  it('対応表が無い shape・ポートが無い操作は計画に載らない(H9 が言う。生成器は落ちない)', () => {
    const unmapped = platformOpsSection([platformOp('session.list_mine', { kind: 'read' })], { shapes: [platformShape('session_summary', ['id'], { mapped: false })] });
    expect(buildPlatformPlan(authModel({ platformOps: unmapped })).ops).toEqual([]);
    const noPort = platformOpsSection([platformOp('session.end_mine')], { ports: [] });
    expect(buildPlatformPlan(authModel({ platformOps: noPort })).ops).toEqual([]);
  });
});

describe('呼び出しと射影の式', () => {
  const plan = buildPlatformPlan(authModel({ platformOps: designSection() }));

  it('配線先を呼ぶ式は宣言した対応表の位置の順(スカラー・オブジェクト)', () => {
    expect(callArguments(plan.ops.find((op) => op.id === 'session.end_mine')!)).toEqual(['input.sessionId']);
    expect(callArguments(plan.ops.find((op) => op.id === 'session.end_every')!)).toEqual(['{ keepSelf: input.keepSelf }']);
    expect(callArguments(plan.ops.find((op) => op.id === 'session.list_mine')!)).toEqual([]);
  });

  it('行の射影は宣言した欄だけを 1 行ずつ(余分な欄を運ぶ展開を使わない)', () => {
    const lines = projectionLines(plan.shapes[0]!, '  ');

    expect(lines).toEqual(['  id: row.id,', '  createdAt: row.createdAt,', '  lastUsedAt: row.lastActiveAt,', '  isCurrent: row.current,']);
  });

  it('TypeScript の型 (null がありうれば | null)', () => {
    expect(tsTypeOf('string', true)).toBe('string | null');
    expect(tsTypeOf('boolean', false)).toBe('boolean');
  });
});
