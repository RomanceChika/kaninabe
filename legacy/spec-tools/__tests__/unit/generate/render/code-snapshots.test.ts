/**
 * スナップショット写像表(app/src/domain/generated/snapshots.ts)の生成器のテスト。
 *
 * 対象の要求（ADR-0008）: 「`effects[].snapshot` をイベント ID で引ける表として出す。
 * 実装は列の並びを手で持たず、この表を読む」。
 */

import { describe, expect, it } from 'vitest';
import type { EffectDef, StateMachineSpec } from '../../../../lib/model/types.js';
import { snapshotMapGenerator } from '../../../../lib/generate/render/code-snapshots.js';
import { aggregate, effect, machine, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** `snapshot` 付きの effects を作る。 */
function withSnapshot(
  on: string,
  jobId: string,
  to: string,
  fields: readonly { readonly from: string; readonly to: string }[],
): EffectDef {
  const base = effect(on, [jobId]);
  return {
    ...base,
    snapshot: {
      to,
      fields: fields.map((field) => ({ ...field, location: base.location })),
      location: base.location,
    },
  };
}

/** 掲載の機械（1 遷移が 2 つの写しを作る形）。 */
function publication(effects: readonly EffectDef[]): StateMachineSpec {
  return machine('workshop_publication', {
    states: ['unpublished', 'published'],
    initial: 'unpublished',
    effects,
  });
}

/** その機械 1 つだけを持つモデルから本文を作る。 */
function generate(spec: StateMachineSpec): readonly { file: string; content: string }[] {
  const model = specModel([aggregate('workshop', { stateMachines: [spec] })]);
  return snapshotMapGenerator.generate(model, GEN_CTX);
}

describe('snapshotMapGenerator', () => {
  it('snapshot を持つ effects が 1 つも無ければ何も出さない', () => {
    expect(generate(publication([effect('publish_public', ['notify'])]))).toEqual([]);
  });

  it('app/src/domain/generated/snapshots.ts を全体生成で出す', () => {
    const sections = generate(
      publication([
        withSnapshot('publish_public', 'snapshot_public_workshop', 'public_workshop', [
          { from: 'workshop.title', to: 'title' },
          { from: 'now', to: 'published_at' },
        ]),
      ]),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/snapshots.ts');
    expect(sections[0]?.content).toContain("'workshop_publication.publish_public'");
    expect(sections[0]?.content).toContain("to: 'public_workshop'");
    expect(sections[0]?.content).toContain("from: 'workshop.title'");
  });

  it('同じイベントに 2 つの写像先があれば 1 つのキーに並べる', () => {
    const content =
      generate(
        publication([
          withSnapshot('publish_public', 'snapshot_public_workshop', 'public_workshop', [
            { from: 'workshop.title', to: 'title' },
          ]),
          withSnapshot('publish_public', 'snapshot_public_program', 'public_program_item', [
            { from: 'program_item.order_index', to: 'order_index' },
          ]),
        ]),
      )[0]?.content ?? '';

    // 1 つのキーの下に 2 つの写像先が並ぶ（キーが 2 回現れない）。
    expect(content.match(/'workshop_publication\.publish_public'/g)).toHaveLength(1);
    expect(content).toContain("to: 'public_workshop'");
    expect(content).toContain("to: 'public_program_item'");
  });

  it('列名を引く関数（snapshotColumns）を添える', () => {
    const content =
      generate(
        publication([
          withSnapshot('publish_public', 'snapshot_public_workshop', 'public_workshop', [
            { from: 'workshop.title', to: 'title' },
          ]),
        ]),
      )[0]?.content ?? '';

    expect(content).toContain('export function snapshotColumns(event: string, target: string)');
  });
});
