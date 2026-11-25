/**
 * レビューの手引きの「警告の区分」の節(`render/book/review-guide-extension.ts`)のテスト。
 *
 * 台帳が渡されていなければ節を出さない(区分できない)。渡されていれば、候補ごとの言い分・件数・場所と、
 * 未分類の警告の一覧を出す。場所はファイルまでで、位置は載せない。
 */

import { describe, expect, it } from 'vitest';
import { extensionSection } from '../../../../../lib/generate/render/book/review-guide-extension.js';
import type { ExtensionLedgerModel } from '../../../../../lib/model/extension/types.js';
import type { Finding } from '../../../../../lib/kernel/finding.js';
import { bookCtx } from '../../../../helpers/book-fixture.js';

/** 警告 1 件。 */
function warn(verifier: string, file: string, message = `${verifier} の警告`): Finding {
  return { verifier, severity: 'warning', message, location: { file, pointer: 'a.b' }, suggestion: '直す。' };
}

const LEDGER: ExtensionLedgerModel = {
  available: true,
  ledger: {
    candidates: [
      { id: 'X-a', statement: '何かが組めない', rules: ['T8'], status: 'open', since: '2026-10-03', ref: 'BACKLOG.md', location: { file: 'l.md', pointer: 'candidates.X-a' } },
      { id: 'X-b', statement: '別の何かが組めない', rules: ['T15'], status: 'decided', since: '2026-10-03', ref: 'BACKLOG.md', location: { file: 'l.md', pointer: 'candidates.X-b' } },
    ],
    location: { file: 'l.md' },
  },
};

describe('extensionSection', () => {
  it('台帳が渡されていなければ節を出さない(区分できない = 警告は全部まだ通していない受け入れ)', () => {
    expect(extensionSection({ ...bookCtx(), findings: [warn('T8', 'docs/specs/a.md')] })).toEqual([]);
  });

  it('候補ごとに言い分・状態・当たる検査・件数・場所(ファイルまで。同じ組は件数にまとめる)を出す', () => {
    const lines = extensionSection({
      ...bookCtx(),
      extensionLedger: LEDGER,
      findings: [warn('T8', 'docs/specs/backend/x.md'), warn('T8', 'docs/specs/backend/x.md'), warn('T8', 'docs/specs/backend/y.md')],
    });
    const text = lines.join('\n');

    expect(lines[0]).toBe('## 警告の区分(仕組みの拡張候補と未分類)');
    expect(text).toContain('台帳の候補 2 件、当たる警告は合わせて 3 件');
    expect(text).toContain('| `X-a` | 何かが組めない | open | `T8` | 3 | `T8` backend/x.md(2 件)<br>`T8` backend/y.md |');
    expect(text).toContain('| `X-b` | 別の何かが組めない | decided | `T15` | 0 | — |');
    expect(text).toContain('未分類の警告は無い');
    // 位置(pointer)は生成物に入れない。
    expect(text).not.toContain('a.b');
  });

  it('未分類の警告は 1 件ずつ(検査 ID・何が・場所のファイル)出す', () => {
    const text = extensionSection({
      ...bookCtx(),
      extensionLedger: LEDGER,
      findings: [warn('T8', 'docs/specs/backend/x.md'), warn('Y5', 'docs/specs/frontend/usecases/u.md', '予算を超えている')],
    }).join('\n');

    expect(text).toContain('未分類の警告は 1 件');
    expect(text).toContain('- `Y5` 予算を超えている(frontend/usecases/u.md)');
    expect(text).not.toContain('- `T8`');
  });

  it('台帳が読めなかったときは、警告がすべて未分類だと言う', () => {
    const text = extensionSection({
      ...bookCtx(),
      extensionLedger: { available: true, ledger: null },
      findings: [warn('T8', 'docs/specs/backend/x.md')],
    }).join('\n');

    expect(text).toContain('台帳が読めなかったので、警告はすべて未分類として数えている');
    expect(text).toContain('未分類の警告は 1 件');
  });

  it('候補が 0 件の台帳は、載っていないと言う。検証の結果が無ければ未集計', () => {
    const empty: ExtensionLedgerModel = { available: true, ledger: { candidates: [], location: { file: 'l.md' } } };

    expect(extensionSection({ ...bookCtx(), extensionLedger: empty, findings: [] }).join('\n')).toContain('台帳に拡張候補は載っていない');
    expect(extensionSection({ ...bookCtx(), extensionLedger: LEDGER }).join('\n')).toContain('未集計(検証の結果が渡されていない)');
  });
});
