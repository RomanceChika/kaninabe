/**
 * 生成する SQL の識別子の長さの関所(lib/sql/identifier-length.ts の `longIdentifierRefusals`)のテスト。
 *
 * 書き出す前に全 `.sql` を見て、63 バイトを超える名前を `{ファイル, 理由}` で返す。
 * `.sql` 以外のファイル(Markdown・TypeScript)は見ない(SQL の文法ではないので名前と読み違える)。
 */

import { describe, expect, it } from 'vitest';
import { longIdentifierRefusals } from '../../../lib/sql/identifier-length.js';

const section = (content: string): { readonly content: string } => ({ content });
const long = 'p'.repeat(64);

describe('longIdentifierRefusals', () => {
  it('超えた名前を持つ SQL を、ファイルと理由で返す(ファイル名順)', () => {
    const refusals = longIdentifierRefusals(
      new Map([
        ['second.sql', [section(`create policy ${long} on t using (true);`)]],
        ['first.sql', [section(`create index ${long} on t (a);`)]],
      ]),
    );

    expect(refusals.map((refusal) => refusal.file)).toEqual(['first.sql', 'second.sql']);
    expect(refusals[0]?.reason).toContain('index');
    expect(refusals[0]?.reason).toContain('64 バイト');
    expect(refusals[0]?.reason).toContain('短くする');
  });

  it('収まっている SQL は黙る', () => {
    expect(
      longIdentifierRefusals(new Map([['single.sql', [section('create policy ok on t using (true);')]]])),
    ).toEqual([]);
  });

  it('SQL でないファイルは見ない', () => {
    expect(
      longIdentifierRefusals(
        new Map([
          ['notes.md', [section(`create policy ${long} on t`)]],
          ['module.ts', [section(`// create policy ${long} on t`)]],
        ]),
      ),
    ).toEqual([]);
  });

  it('1 ファイルに複数のセクションがあれば全部見る', () => {
    const refusals = longIdentifierRefusals(
      new Map([['single.sql', [section('create policy ok on t using (true);'), section(`create index ${long} on t (a);`)]]]),
    );

    expect(refusals).toHaveLength(1);
  });
});
