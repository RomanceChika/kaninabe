/**
 * A17(`writes` に並ぶのに誰も動かせない欄)の規約網羅テスト。
 *
 * 由来と認めるのは 4 つ —— action_spec の `input` / `computes`、state_spec の `records_actor` /
 * `clears`。どれにも当たらない欄だけを報告する。
 *
 * `computes` は**別の集約の欄も指せる**ので、母集合は操作の集約ではなく `computes` が名指しした
 * 集約で数える(1 つの業務イベントで複数の集約が同時に動く形)。
 *
 * `personal_placeholder` は由来に**しない** —— `personal: true` の欄はそれを必須にしているので、
 * 数えると「個人データなら動かせる」と同値になる(検査が黙る)。ここで固定する。
 */

import { describe, expect, it } from 'vitest';
import { writableFieldsVerifier } from '../../../../lib/trace/verifiers/a17-writable-fields.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';
import type { FieldDef } from '../../../../lib/model/types.js';
import type { ActionSpec } from '../../../../lib/model/trace/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';

/**
 * `doc` 1 集約だけのドメイン(`writes` に `secret` 1 本を並べる)。
 *
 * @param extra `secret` に足す宣言(消去の置換値など)
 * @param transition 遷移に持たせる宣言(`records_actor` / `clears`)
 * @returns そのドメイン仕様
 */
function domain(
  extra: Partial<FieldDef> = {},
  transition: { recordsActor?: readonly string[]; clears?: readonly string[] } = {},
): ReturnType<typeof specModel> {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [
          field('state', { kind: 'state', machine: 'doc' }, { required: true }),
          field('secret', { kind: 'string' }, extra),
        ]),
        stateMachines: [
          machine({
            machine: 'doc',
            states: ['open', 'closed'],
            initial: 'open',
            events: [event({ id: 'close', from: ['open'], to: 'closed', by: ['member'], ...transition })],
          }),
        ],
        access: accessSpec('doc', { writes: [writeRule('system', ['secret'])] }),
      }),
    ],
  });
}

/** `doc.secret` を動かす action_spec 1 本。 */
function mover(kind: 'input' | 'computes'): readonly ActionSpec[] {
  return [
    actionSpec(
      kind === 'input'
        ? { handles: 'doc.close', input: ['doc.secret'] }
        : { handles: 'doc.close', computes: { 'doc.secret': 'docSecret' } },
    ),
  ];
}

describe('A17 writes の欄 — 誰も動かせない欄', () => {
  it('どの宣言にも現れない欄は warning(近似の所在を報告する)', () => {
    const findings = writableFieldsVerifier.verify(traceInput({ domain: domain() }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A17');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('doc.secret');
  });

  it('action_spec の input に現れれば通る', () => {
    expect(writableFieldsVerifier.verify(traceInput({ domain: domain(), actions: mover('input') }))).toEqual([]);
  });

  it('action_spec の computes に現れれば通る', () => {
    expect(writableFieldsVerifier.verify(traceInput({ domain: domain(), actions: mover('computes') }))).toEqual([]);
  });

  it('state_spec の records_actor / clears に現れれば通る', () => {
    const recorded = domain({}, { recordsActor: ['secret'] });
    const cleared = domain({}, { clears: ['secret'] });

    expect(writableFieldsVerifier.verify(traceInput({ domain: recorded }))).toEqual([]);
    expect(writableFieldsVerifier.verify(traceInput({ domain: cleared }))).toEqual([]);
  });

  it('personal_placeholder を宣言していても warning のまま(消去の宣言は「動かせる」の根拠ではない)', () => {
    // `personal: true` は placeholder を必須にしている(V1)。ここを由来に数えると条件が
    // 「personal なら動かせる」と同値になり、消去が書かない個人データの列まで黙る。
    const withPlaceholder = domain({ personal: true, personalPlaceholder: '(消去済み)' });
    const cleared = domain({ personal: true, personalPlaceholder: null });

    expect(writableFieldsVerifier.verify(traceInput({ domain: withPlaceholder }))).toHaveLength(1);
    expect(writableFieldsVerifier.verify(traceInput({ domain: cleared }))).toHaveLength(1);
  });
});
