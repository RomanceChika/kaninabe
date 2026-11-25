import { describe, expect, it } from 'vitest';
import type { GitResult } from '../../../lib/diff/git-io.js';
import { commitExists, gitSide, gitSilentReason } from '../../../lib/diff/git-io.js';

/** 返事を仕込んだ git の口(引数の先頭で振り分ける)。 */
function runner(replies: Readonly<Record<string, GitResult>>): (args: readonly string[]) => GitResult {
  return (args: readonly string[]): GitResult => replies[args[0] ?? ''] ?? { ok: false, reason: '仕込みがありません' };
}

describe('gitSilentReason — git が答えるか', () => {
  it('答えれば null', () => {
    expect(gitSilentReason(runner({ 'rev-parse': { ok: true, stdout: '.git' } }))).toBeNull();
  });

  it('答えなければ理由を報告する(黙って通さない)', () => {
    const reason = gitSilentReason(runner({ 'rev-parse': { ok: false, reason: 'not a git repository' } }));
    expect(reason).toContain('git が答えませんでした');
    expect(reason).toContain('not a git repository');
  });
});

describe('commitExists', () => {
  it('実在すれば true', () => {
    expect(commitExists(runner({ 'cat-file': { ok: true, stdout: '' } }), 'abc')).toBe(true);
  });

  it('無ければ false', () => {
    expect(commitExists(runner({ 'cat-file': { ok: false, reason: 'bad object' } }), 'abc')).toBe(false);
  });
});

describe('gitSide.read — 3 つの結末を畳まない', () => {
  it('読めたら中身', () => {
    const side = gitSide(runner({ show: { ok: true, stdout: 'body' } }), 'abc');
    expect(side.read('a/b.ts')).toEqual({ kind: 'found', content: 'body' });
  });

  it('その版に無いパスは「無かった」(判定できる)', () => {
    const side = gitSide(runner({ show: { ok: false, reason: "path 'a/b.ts' exists on disk, but not in 'abc'" } }), 'abc');
    expect(side.read('a/b.ts')).toEqual({ kind: 'absent' });
  });

  it('git が答えなければ「判定できない」(黙って absent に倒さない)', () => {
    const side = gitSide(runner({ show: { ok: false, reason: 'fatal: repository is corrupt' } }), 'abc');
    const outcome = side.read('a/b.ts');
    expect(outcome.kind).toBe('unavailable');
    expect(outcome.kind === 'unavailable' && outcome.reason).toContain('repository is corrupt');
  });
});

describe('gitSide.list — その版のディレクトリ直下', () => {
  it('接尾辞に合うものだけをパスにして並べる', () => {
    const side = gitSide(runner({ 'ls-tree': { ok: true, stdout: 'b.json\na.json\nc.txt\n' } }), 'abc');
    expect(side.list('dir', '.json')).toEqual(['dir/a.json', 'dir/b.json']);
  });

  it('その版にディレクトリが無ければ空(新しい置き場は「増えた」側になる)', () => {
    const side = gitSide(runner({ 'ls-tree': { ok: false, reason: 'not a tree object' } }), 'abc');
    expect(side.list('dir', '.json')).toEqual([]);
  });
});
