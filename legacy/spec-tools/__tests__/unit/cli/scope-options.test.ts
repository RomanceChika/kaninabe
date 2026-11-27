/**
 * 値を取るオプションの共通の取り出し(`cli/value-option.ts`)と、実装の範囲のオプション(`cli/scope-options.ts`)。
 *
 * 守るのは次。
 *   - `--implemented-base <file>` と `--implemented-base=<file>` の両方を受ける。値が無い・次が別のオプションなら「値が無い」
 *   - **2 回書いたら error**(どちらを採るか黙って決めない)。`--root` は従来どおり最初の 1 つを採る(2 回でも error にしない)
 *   - 値は位置引数に混ざらない(`verify` は最初の `--` で始まらない引数をパスとして読む)
 *   - `--root` の取り出しは共通の口を通っても変わらない(値あり / `=` / 値なし / 次がオプション)
 */

import { describe, expect, it } from 'vitest';
import { implementedBaseOption, listOutOfScopeRequested, withoutImplementedBase } from '../../../cli/scope-options.js';
import { valueOption, withoutValueOption } from '../../../cli/value-option.js';
import { withoutRootOption } from '../../../cli/repo-root.js';

describe('implementedBaseOption', () => {
  it('無ければ absent', () => {
    expect(implementedBaseOption(['--list-out-of-scope'])).toEqual({ kind: 'absent' });
  });

  it('空白区切りと = の両方で値を読む', () => {
    expect(implementedBaseOption(['--implemented-base', 'base.md'])).toEqual({ kind: 'value', value: 'base.md' });
    expect(implementedBaseOption(['--implemented-base=base.md'])).toEqual({ kind: 'value', value: 'base.md' });
  });

  it.each([[['--implemented-base']], [['--implemented-base=']], [['--implemented-base', '--list-out-of-scope']]])('値が無い(%j)は missing', (args) => {
    expect(implementedBaseOption(args)).toEqual({ kind: 'missing' });
  });

  it.each([
    [['--implemented-base', 'a.md', '--implemented-base', 'b.md']],
    [['--implemented-base=a.md', '--implemented-base=b.md']],
    [['--implemented-base', 'a.md', '--implemented-base=a.md']],
  ])('2 回書けば duplicate(同じ値でも)(%j)', (args) => {
    expect(implementedBaseOption(args)).toEqual({ kind: 'duplicate' });
  });
});

describe('withoutImplementedBase / listOutOfScopeRequested', () => {
  it('値ごと取り除き、ほかの引数と順序は変えない', () => {
    expect(withoutImplementedBase(['docs/specs/domain', '--implemented-base', 'base.md', '--list-out-of-scope'])).toEqual(['docs/specs/domain', '--list-out-of-scope']);
    expect(withoutImplementedBase(['--implemented-base=base.md', 'path'])).toEqual(['path']);
  });

  it('--list-out-of-scope の有無', () => {
    expect(listOutOfScopeRequested(['--list-out-of-scope'])).toBe(true);
    expect(listOutOfScopeRequested(['--root', 'x'])).toBe(false);
  });
});

describe('共通の値オプションの口(--root の従来の振る舞いが変わらない)', () => {
  it('--root: 値あり / = / 値なし / 次がオプション / 2 回(最初を採る)', () => {
    expect(valueOption(['--root', 'a'], '--root')).toEqual({ kind: 'value', value: 'a', count: 1 });
    expect(valueOption(['--root=a'], '--root')).toEqual({ kind: 'value', value: 'a', count: 1 });
    expect(valueOption(['--root'], '--root')).toEqual({ kind: 'missing' });
    expect(valueOption(['--root', '--x'], '--root')).toEqual({ kind: 'missing' });
    expect(valueOption(['--root', 'a', '--root', 'b'], '--root')).toEqual({ kind: 'value', value: 'a', count: 2 });
  });

  it('withoutRootOption は、値(次の引数)を無条件に落とす従来の形のまま', () => {
    expect(withoutRootOption(['p', '--root', 'a', 'q'])).toEqual(['p', 'q']);
    expect(withoutRootOption(['--root=a', 'q'])).toEqual(['q']);
    expect(withoutRootOption(['--root', '--x', 'q'])).toEqual(['q']);
  });

  it('withoutValueOption は、次がオプションのとき値を落とすかを引数で選べる(両方を固定する)', () => {
    expect(withoutValueOption(['--root', '--x', 'q'], '--root', { skipOptionLikeValue: true })).toEqual(['q']);
    expect(withoutValueOption(['--root', '--x', 'q'], '--root', { skipOptionLikeValue: false })).toEqual(['--x', 'q']);
  });
});
