/**
 * A4(ハンドラの網羅)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「人間ロールが実行できる全イベントに action_spec が
 * 1 つ以上ある(無い場合は理由の明示を必須とする)。creates / deletes も同じ条件で要求する」。
 */

import { describe, expect, it } from 'vitest';
import { handlerCoverageVerifier } from '../../../../lib/trace/verifiers/a4-handler-coverage.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  event,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec, traceInput, unhandled } from '../../../helpers/trace-builder.js';

/** submit(performer)・close(system)を持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted', 'closed'],
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] }),
              event({ id: 'close', from: ['submitted'], to: 'closed', by: ['system'] }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** creates(member)だけを宣言した entry 集約。遷移は持たない。 */
function createOnlyDomain(by = 'member') {
  return specModel({
    aggregates: [
      aggregate({ name: 'entry', access: accessSpec('entry', { creates: [createRule(by)] }) }),
    ],
  });
}

/** deletes(performer)だけを宣言した entry 集約。遷移は持たない。 */
function deleteOnlyDomain(by = 'performer') {
  return specModel({
    aggregates: [
      aggregate({ name: 'entry', access: accessSpec('entry', { deletes: [deleteRule(by)] }) }),
    ],
  });
}

describe('A4 ハンドラの網羅', () => {
  it('人間ロールのイベントに action_spec があれば通る', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'entry.submit' })] });

    expect(handlerCoverageVerifier.verify(input)).toEqual([]);
  });

  it('action_spec も理由宣言も無いと違反になる', () => {
    const findings = handlerCoverageVerifier.verify(traceInput({ domain: domain() }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A4');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.counterexample).toMatchObject({ event: 'entry.submit', by: 'performer' });
  });

  it('理由を宣言すれば免除される', () => {
    const input = traceInput({ domain: domain(), unhandled: [unhandled('entry.submit', '画面が未着手')] });

    expect(handlerCoverageVerifier.verify(input)).toEqual([]);
  });

  it('system ロールだけのイベントは網羅の対象にしない', () => {
    const input = traceInput({ domain: domain(), actions: [actionSpec({ handles: 'entry.submit' })] });

    const findings = handlerCoverageVerifier.verify(input);

    expect(findings.some((f) => f.message.includes('entry.close'))).toBe(false);
  });

  it('境界: 人間ロールとシステムロールが混在するイベントは網羅の対象になる', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          stateMachines: [
            machine({
              machine: 'workshop',
              states: ['open', 'finished'],
              events: [
                event({ id: 'finish', from: ['open'], to: 'finished', by: ['organizer', 'system'] }),
              ],
            }),
          ],
        }),
      ],
    });

    const findings = handlerCoverageVerifier.verify(traceInput({ domain: model }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('workshop.finish');
  });

  it('creates を宣言したのに作成の action_spec が無いと違反になる', () => {
    const findings = handlerCoverageVerifier.verify(traceInput({ domain: createOnlyDomain() }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A4');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('entry.create');
    expect(findings[0]?.location.pointer).toBe('creates');
    expect(findings[0]?.suggestion).toContain('specs/backend/actions/entry/create.md');
    expect(findings[0]?.counterexample).toMatchObject({ event: 'entry.create', by: 'member' });
  });

  it('作成の action_spec があれば通る', () => {
    const input = traceInput({
      domain: createOnlyDomain(),
      actions: [actionSpec({ handles: 'entry.create' })],
    });

    expect(handlerCoverageVerifier.verify(input)).toEqual([]);
  });

  it('creates の理由を宣言すれば免除される', () => {
    const input = traceInput({
      domain: createOnlyDomain(),
      unhandled: [unhandled('entry.create', '画面が未着手')],
    });

    expect(handlerCoverageVerifier.verify(input)).toEqual([]);
  });

  it('境界: system だけの creates は網羅の対象にしない', () => {
    expect(handlerCoverageVerifier.verify(traceInput({ domain: createOnlyDomain('system') }))).toEqual([]);
  });

  it('deletes を宣言したのに削除の action_spec が無いと違反になる', () => {
    const findings = handlerCoverageVerifier.verify(traceInput({ domain: deleteOnlyDomain() }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A4');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('entry.delete');
    expect(findings[0]?.location.pointer).toBe('deletes');
    expect(findings[0]?.suggestion).toContain('specs/backend/actions/entry/delete.md');
    expect(findings[0]?.counterexample).toMatchObject({ event: 'entry.delete', by: 'performer' });
  });

  it('削除の action_spec があれば通る', () => {
    const input = traceInput({
      domain: deleteOnlyDomain(),
      actions: [actionSpec({ handles: 'entry.delete' })],
    });

    expect(handlerCoverageVerifier.verify(input)).toEqual([]);
  });

  it('deletes の理由を宣言すれば免除される', () => {
    const input = traceInput({
      domain: deleteOnlyDomain(),
      unhandled: [unhandled('entry.delete', '画面が未着手')],
    });

    expect(handlerCoverageVerifier.verify(input)).toEqual([]);
  });

  it('境界: system だけの deletes は網羅の対象にしない', () => {
    expect(handlerCoverageVerifier.verify(traceInput({ domain: deleteOnlyDomain('system') }))).toEqual([]);
  });

  it('境界: writes は網羅の対象にしない(編集は 1 宣言 = 1 アクションと決まらない)', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'entry',
          access: accessSpec('entry', { writes: [writeRule('performer', ['title'])] }),
        }),
      ],
    });

    expect(handlerCoverageVerifier.verify(traceInput({ domain: model }))).toEqual([]);
  });

  it('action_spec ができたのに残っている理由宣言は警告になる', () => {
    const input = traceInput({
      domain: domain(),
      actions: [actionSpec({ handles: 'entry.submit' })],
      unhandled: [unhandled('entry.submit')],
    });

    const findings = handlerCoverageVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('理由宣言が残っています');
  });

  it('編集(writes)の理由宣言は「存在しない操作」と警告しない', () => {
    // 網羅の対象ではないが実在はする。「まだ作らない」宣言は正当で、掃除漏れではない。
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'entry',
          access: accessSpec('entry', { writes: [writeRule('performer', ['title'])] }),
        }),
      ],
    });

    const input = traceInput({ domain: model, unhandled: [unhandled('entry.update')] });

    expect(handlerCoverageVerifier.verify(input)).toEqual([]);
  });

  it('実在しないイベントの理由宣言は警告になる', () => {
    const input = traceInput({
      domain: domain(),
      actions: [actionSpec({ handles: 'entry.submit' })],
      unhandled: [unhandled('entry.approve')],
    });

    const findings = handlerCoverageVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('state_spec にも creates / deletes / writes にも存在しない操作');
  });
});
