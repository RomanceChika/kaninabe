/**
 * M8(台帳の語が 3 つの木のどこにも出てこない = 死んだ行)の規約網羅テスト。
 *
 * 対象の要求(book-human-face.md §4「検査」): 重さは warning。
 *   - どこかの文書の本文に語が 1 回でも出ていれば通る(例示の行でも数える)
 *   - 1 回も出なければ warning(台帳の行だけが残っている)
 */

import { describe, expect, it } from 'vitest';
import { verifyDeadTerms } from '../../../../lib/terms/verifiers/m8-dead-term.js';
import { corpus, ledger, proseFile, term } from '../../../helpers/terms-builder.js';

describe('M8 死んだ行', () => {
  it('語が 1 つの文書に出ていれば通る', () => {
    const findings = verifyDeadTerms(
      ledger([term('注釈')]),
      corpus([proseFile('docs/rules/a.md', '注釈を付ける'), proseFile('docs/book/b.md', '無関係')]),
    );

    expect(findings).toEqual([]);
  });

  it('例示の行に出ているだけでも出ていると数える', () => {
    const findings = verifyDeadTerms(ledger([term('注釈')]), corpus([proseFile('docs/rules/a.md', '(例: 注釈)')]));

    expect(findings).toEqual([]);
  });

  it('どの文書にも出なければ warning', () => {
    const findings = verifyDeadTerms(
      ledger([term('注釈', { id: 'tag' })]),
      corpus([proseFile('docs/rules/a.md', '別の話')]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('M8');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('どの本文・コメントにも出てきません');
    expect(findings[0]?.location.pointer).toBe('terms.tag');
    expect(findings[0]?.counterexample).toEqual({ term: '注釈', id: 'tag' });
  });

  it('文書が 1 枚も無ければ全語が死んでいる', () => {
    const findings = verifyDeadTerms(ledger([term('注釈', { id: 'a' }), term('窓', { id: 'b' })]), corpus([]));

    expect(findings).toHaveLength(2);
  });
});
