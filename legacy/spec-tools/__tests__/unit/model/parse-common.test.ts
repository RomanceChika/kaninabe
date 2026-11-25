import { describe, expect, it } from 'vitest';
import {
  asRecord,
  checkDocType,
  elementPointer,
  parseFrontmatter,
  SpecReporter,
} from '../../../lib/model/parse-common.js';
import { expectWellFormed } from './_helpers.js';

describe('SpecReporter', () => {
  it('error は「何が・どこで・どう直すか」を揃えた V1 の Finding を作る', () => {
    const reporter = new SpecReporter('docs/specs/domain/entry/states.md');
    reporter.error('events.submit.by', 'by が空です', 'by にロールを 1 つ以上並べる', { event: 'submit' });

    const findings = reporter.findings();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      verifier: 'V1',
      severity: 'error',
      message: 'by が空です',
      location: { file: 'docs/specs/domain/entry/states.md', pointer: 'events.submit.by' },
      suggestion: 'by にロールを 1 つ以上並べる',
      counterexample: { event: 'submit' },
    });
  });

  it('warn は severity=warning の Finding を作り、pointer 省略時はファイル全体を指す', () => {
    const reporter = new SpecReporter('docs/specs/domain/entry/entity.md');
    reporter.warn(undefined, 'entity.md がありません', 'テンプレートをコピーして作る');

    const finding = reporter.findings()[0];
    expect(finding?.severity).toBe('warning');
    expect(finding?.location).toEqual({ file: 'docs/specs/domain/entry/entity.md' });
    expect(finding?.counterexample).toBeUndefined();
  });
});

describe('SpecReporter の落とした行の勘定', () => {
  it('settleRows は 読んだ − 残した − 重複 を数える(重複は先の行が残るので数えない)', () => {
    const reporter = new SpecReporter('f.md');

    reporter.settleRows(5, 3, 1);

    expect(reporter.droppedCount()).toBe(1);
    expect(reporter.findings()).toEqual([]);
  });

  it('勘定が合うとき(落とした行が無い)は数えず、error も出さない', () => {
    const reporter = new SpecReporter('f.md');

    reporter.settleRows(4, 3, 1);
    reporter.settleRows(0, 0);

    expect(reporter.droppedCount()).toBe(0);
    expect(reporter.findings()).toEqual([]);
  });

  it('勘定の食い違い(残した行と重複の合計が読んだ行より多い)は黙って 0 にせず、検証器の不具合として error で報告する(投げない)', () => {
    const reporter = new SpecReporter('f.md');

    expect(() => reporter.settleRows(2, 3, 1)).not.toThrow();

    const findings = reporter.findings();
    expect(findings.map((finding) => finding.severity)).toEqual(['error']);
    expect(findings[0]?.message).toContain('落とした行の勘定が合いません');
    expect(findings[0]?.message).toContain('読んだ 2 行');
    expect(reporter.droppedCount()).toBe(0);
  });
});

describe('parseFrontmatter', () => {
  it('YAML フロントマターをマッピングとして取り出す', () => {
    const reporter = new SpecReporter('f.md');
    const data = parseFrontmatter('---\ndoc_type: role_spec\nroles: []\n---\n\n# 本文\n', reporter);

    expect(data).toEqual({ doc_type: 'role_spec', roles: [] });
    expect(reporter.findings()).toHaveLength(0);
  });

  it('YAML が壊れていれば例外にせず Finding を積んで null を返す', () => {
    const reporter = new SpecReporter('f.md');
    const data = parseFrontmatter('---\nfields:\n  - name: id\n   type: uuid\n---\n', reporter);

    expect(data).toBeNull();
    const findings = reporter.findings();
    expectWellFormed(findings);
    expect(findings[0]?.message).toContain('YAML フロントマターを解析できません');
  });

  it('フロントマターが無ければ Finding を積んで null を返す', () => {
    const reporter = new SpecReporter('f.md');
    expect(parseFrontmatter('# 本文だけ\n', reporter)).toBeNull();
    expect(reporter.findings()[0]?.message).toBe('YAML フロントマターがありません');
  });
});

describe('asRecord / elementPointer', () => {
  it('配列と null はマッピングとして扱わない', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1, 2])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord('text')).toBeNull();
  });

  it('id が分かるときは id 形式、分からないときは添字形式の YAML パスにする', () => {
    expect(elementPointer('events', 2, 'submit')).toBe('events.submit');
    expect(elementPointer('events', 2)).toBe('events[2]');
  });
});

describe('checkDocType', () => {
  it('期待どおりなら何も積まない', () => {
    const reporter = new SpecReporter('f.md');
    checkDocType({ doc_type: 'state_spec' }, 'state_spec', reporter);
    expect(reporter.findings()).toHaveLength(0);
  });

  it('欠落と不一致をそれぞれ指摘する', () => {
    const missing = new SpecReporter('f.md');
    checkDocType({}, 'state_spec', missing);
    expect(missing.findings()[0]?.message).toBe('doc_type がありません');

    const wrong = new SpecReporter('f.md');
    checkDocType({ doc_type: 'entity_spec' }, 'state_spec', wrong);
    expect(wrong.findings()[0]?.counterexample).toEqual({ expected: 'state_spec', actual: 'entity_spec' });
  });
});
