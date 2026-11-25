/**
 * 全状態機械の索引(app/src/domain/generated/state-machines.ts)の生成器のテスト。
 *
 * 対象の要求: 「ウォーカーのオラクルが集約名を手で import しなくても、機械名から
 * MachineTable を引けるようにする」(builder-report-12a2.md ⑫a2-(d))。
 */

import { describe, expect, it } from 'vitest';
import { stateMachinesIndexGenerator } from '../../../../lib/generate/render/code-state-machines-index.js';
import { aggregate, event, machine, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

describe('stateMachinesIndexGenerator', () => {
  it('状態機械が 0 件なら何も生成しない', () => {
    const model = specModel([aggregate('entry')]);
    expect(stateMachinesIndexGenerator.generate(model, GEN_CTX)).toEqual([]);
  });

  it('ファイル全体モードで app/src/domain/generated/state-machines.ts を出力する', () => {
    const model = specModel([
      aggregate('entry', { stateMachines: [machine('entry', { states: ['draft'], initial: 'draft' })] }),
    ]);
    const sections = stateMachinesIndexGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/state-machines.ts');
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('機械名をキーに、対応する {machine}.transitions.ts の export を import して束ねる', () => {
    const model = specModel([
      aggregate('workshop', {
        stateMachines: [
          machine('workshop', { states: ['draft'], initial: 'draft' }),
          machine('workshop_publication', { states: ['unpublished'], initial: 'unpublished' }),
        ],
      }),
    ]);
    const content = stateMachinesIndexGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain("import { workshopMachine } from './workshop.transitions';");
    expect(content).toContain("import { workshopPublicationMachine } from './workshop_publication.transitions';");
    expect(content).toContain('export const STATE_MACHINES: Readonly<Record<string, MachineTable>> = {');
    expect(content).toContain('  workshop: workshopMachine,');
    expect(content).toContain('  workshop_publication: workshopPublicationMachine,');
  });

  it('機械名の宣言順に依らず、常にアルファベット順で並べる(決定性)', () => {
    const model = specModel([
      aggregate('zeta', { stateMachines: [machine('zeta', { states: ['a'], initial: 'a' })] }),
      aggregate('alpha', { stateMachines: [machine('alpha', { states: ['a'], initial: 'a' })] }),
    ]);
    const content = stateMachinesIndexGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content.indexOf('alpha:')).toBeLessThan(content.indexOf('zeta:'));
  });

  it('同じモデルからは同じ出力になる(生成物の決定性 — ADR-0006)', () => {
    const model = specModel([
      aggregate('entry', { stateMachines: [machine('entry', { states: ['draft'], initial: 'draft' })] }),
    ]);
    const first = stateMachinesIndexGenerator.generate(model, GEN_CTX)[0]?.content;
    const second = stateMachinesIndexGenerator.generate(model, GEN_CTX)[0]?.content;
    expect(first).toBe(second);
  });

  it('機械名をキーに、対応する {machine}.labels.ts の EventLabels を束ねた EVENT_LABELS も出す(⑯d: 現在地と次)', () => {
    const model = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted', label: '申し込む' })],
          }),
        ],
      }),
    ]);
    const content = stateMachinesIndexGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain("import { entryEventLabels } from './entry.labels';");
    expect(content).toContain(
      'export const EVENT_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {',
    );
    expect(content).toContain('  entry: entryEventLabels,');
  });
});
