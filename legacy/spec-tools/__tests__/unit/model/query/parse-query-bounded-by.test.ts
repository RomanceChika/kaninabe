/**
 * bounded_by パーサーの規約網羅テスト。
 * 対象の要求: query-spec-writing.md「paging: none を選んだら bounded_by を書く。
 * paging: none 以外では bounded_by は書けない」。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { YamlReader } from '../../../../lib/model/yaml-reader.js';
import { parseBoundedBy } from '../../../../lib/model/query/parse-query-bounded-by.js';

const FILE = 'docs/specs/backend/queries/workshop/sample.md';

function reader(record: Record<string, unknown>): { root: YamlReader; reporter: SpecReporter } {
  const reporter = new SpecReporter(FILE);
  return { root: new YamlReader(record, '', reporter), reporter };
}

describe('parseBoundedBy', () => {
  it('paging: none で bounded_by が無ければ undefined を返す(Q8 がエラーにする)', () => {
    const { root, reporter } = reader({});

    expect(parseBoundedBy(root, reporter, { kind: 'none' })).toBeUndefined();
    expect(reporter.findings()).toEqual([]);
  });

  it('paging: none で bounded_by: window を読める', () => {
    const { root, reporter } = reader({ bounded_by: 'window' });

    expect(parseBoundedBy(root, reporter, { kind: 'none' })).toEqual({ kind: 'window' });
    expect(reporter.findings()).toEqual([]);
  });

  it('paging: none で bounded_by: parent + reason を読める', () => {
    const { root, reporter } = reader({
      bounded_by: { parent: 'workshop', reason: 'capacity で有界' },
    });

    expect(parseBoundedBy(root, reporter, { kind: 'none' })).toEqual({
      kind: 'parent',
      aggregate: 'workshop',
      reason: 'capacity で有界',
    });
    expect(reporter.findings()).toEqual([]);
  });

  it('paging: limit(n) で bounded_by を書くとエラー', () => {
    const { root, reporter } = reader({ bounded_by: 'window' });

    expect(parseBoundedBy(root, reporter, { kind: 'limit', max: 50 })).toBeNull();
    expect(reporter.findings()).toHaveLength(1);
    expect(reporter.findings()[0]?.message).toBe('bounded_by は paging: none のときだけ書けます');
  });

  it('paging: none で bounded_by が文字列でも parent/reason マッピングでもなければエラー', () => {
    const { root, reporter } = reader({ bounded_by: 'unknown' });

    expect(parseBoundedBy(root, reporter, { kind: 'none' })).toBeNull();
    expect(reporter.findings()).toHaveLength(1);
    expect(reporter.findings()[0]?.message).toBe('bounded_by の形式が不正です');
  });

  it('parent はあるが reason が無ければエラー', () => {
    const { root, reporter } = reader({ bounded_by: { parent: 'workshop' } });

    expect(parseBoundedBy(root, reporter, { kind: 'none' })).toBeNull();
    expect(reporter.findings()).toHaveLength(1);
  });
});
