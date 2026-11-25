/**
 * V10 の 1 項「`is null` を書ける欄は空になりうる欄だけ」の規約網羅テスト(束 ㉒)。
 *
 * 対象の要求: domain-spec-writing.md §ガード式の文法 /
 * [null-literal-purchase.md](../../../../../design/null-literal-purchase.md) §5。
 *
 * 空にならない欄(`required: true` / `auto: true` / `state(...)`)に「空かどうか」を書くと、
 * `is null` は決して成立せず `is not null` は常に成立する。**この誤りを捕るのはこの検査
 * 1 本だけである** —— `kind: check` の充足性判定は「空かどうか」を自由な真偽値として扱い
 * `required` を 1 度も見ないので、必須の欄への `is null` も `satisfiable` のまま通る
 * (この事実もテストで固定する)。したがって severity は **error** である。
 */

import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { checkNullTests } from '../../../../lib/verify/verifiers/v10-invariant-null-test.js';
import { parseFormalGuard } from '../../../../lib/guard/parser.js';
import { satisfiability } from '../../../../lib/guard/satisfiability.js';
import { buildAggregateEnv } from '../../../../lib/semantics/domain-env.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import {
  aggregate,
  entitySpec,
  field,
  invariant,
  invariantSpec,
  machine,
  specModel,
} from '../../../helpers/model-builder-v8plus.js';

/** 空になりうる欄・必須の欄・自動採番の欄・状態の欄を 1 本ずつ持つ doc 集約。 */
function model(expr: string): SpecModel {
  return specModel({
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [
          field('archived_at', { kind: 'datetime' }),
          field('title', { kind: 'string' }, { required: true }),
          field('id', { kind: 'uuid' }, { auto: true }),
          field('state', { kind: 'state', machine: 'doc' }),
        ]),
        stateMachines: [machine({ machine: 'doc', states: ['draft', 'archived'] })],
        invariants: invariantSpec([
          invariant({ id: 'INV-DOC-001', formal: { kind: 'check', expr } }),
        ]),
      }),
    ],
  });
}

/** その式に対する Finding のメッセージ(0 件なら空)。 */
function findings(expr: string): readonly string[] {
  const spec = model(expr);
  const target = spec.aggregates.get('doc')?.invariants?.invariants[0];
  if (target === undefined) throw new Error('題材の組み立てに失敗しました');
  return checkNullTests(target, spec, 'doc', createGuardServices()).map(
    (found) => `${found.severity} ${found.message}`,
  );
}

describe('V10: 「空かどうか」を問える欄か', () => {
  it('空になりうる欄なら何も言わない', () => {
    expect(findings('doc.archived_at is null')).toEqual([]);
    expect(findings('doc.state == archived or doc.archived_at is null')).toEqual([]);
  });

  it('必須の欄(clears にも supplied_by にも無い欄)を問えば error で名指す', () => {
    const found = findings('doc.title is null');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('error');
    expect(found[0]).toContain('doc.title は空にならない欄です');
  });

  it('自動採番の欄・状態の欄も空にならない(行では必ず値がある)', () => {
    expect(findings('doc.id is not null')).toEqual([expect.stringContaining('error')]);
    expect(findings('doc.state is null')).toEqual([expect.stringContaining('error')]);
  });

  it('充足性判定はこの誤りを捕らない(だからここが error でなければ誰も捕らない)', () => {
    // 判定器は「空かどうか」を欄ごとの自由な真偽値として扱い、required を 1 度も見ない。
    const spec = model('doc.title is null');
    const parsed = parseFormalGuard('doc.title is null');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(satisfiability(parsed.expr, buildAggregateEnv(spec, 'doc')).verdict).toBe('satisfiable');
  });

  it('同じ欄を 2 回問うても 1 件にまとめる', () => {
    expect(findings('doc.title is null or doc.title is not null')).toHaveLength(1);
  });

  it('「空かどうか」を書いていない式には何も言わない', () => {
    expect(findings('doc.state == archived')).toEqual([]);
  });

  it('解決できないパスには何も言わない(参照の実在は別の項が error で報告する)', () => {
    expect(findings('doc.nope is null')).toEqual([]);
  });
});
