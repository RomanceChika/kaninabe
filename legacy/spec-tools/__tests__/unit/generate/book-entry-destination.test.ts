import { describe, expect, it } from 'vitest';
import { NO_TERM_SCAN, type ProductRoots } from '../../../lib/model/product/types.js';
import { destinationConflicts, type DestinationProbe, entryDestination, outOptionOf } from '../../../lib/generate/book-entry-destination.js';

describe('outOptionOf / entryDestination: 書き先', () => {
  it('--out は「--out <dir>」と「--out=<dir>」の両方を取り出し、値が無い・欠けた綴りを黙って無視しない', () => {
    expect(outOptionOf(['--root', 'x'])).toEqual({ kind: 'absent' });
    expect(outOptionOf(['--out', 'a'])).toEqual({ kind: 'value', value: 'a' });
    expect(outOptionOf(['--out=b'])).toEqual({ kind: 'value', value: 'b' });
    expect(outOptionOf(['--out'])).toEqual({ kind: 'missing' });
    expect(outOptionOf(['--out', '--root'])).toEqual({ kind: 'missing' });
    expect(outOptionOf(['--out='])).toEqual({ kind: 'missing' });
  });

  const withApp: ProductRoots = { ...rootsOf('app'), app: 'app' };
  const withoutApp: ProductRoots = { ...rootsOf('app'), app: null };

  it('実装の木を持つ製品は --out が無ければ書かない(使い方つきで止める)。実装の木を持たない製品は製品の根に書く', () => {
    const refused = entryDestination('/p', withApp, { kind: 'absent' }, '/cwd');
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.message).toContain('既定では書きません');
    expect(refused.ok ? '' : refused.message).toContain('--out <dir>');
    expect(entryDestination('/p', withoutApp, { kind: 'absent' }, '/cwd')).toEqual({ ok: true, outRoot: '/p', explicit: false });
  });

  it('--out は呼ばれた場所から解く(相対でも絶対でも)。値の無い --out は止める', () => {
    expect(entryDestination('/p', withApp, { kind: 'value', value: 'out/x' }, '/cwd')).toEqual({ ok: true, outRoot: '/cwd/out/x', explicit: true });
    expect(entryDestination('/p', withoutApp, { kind: 'value', value: '/abs' }, '/cwd')).toEqual({ ok: true, outRoot: '/abs', explicit: true });
    const missing = entryDestination('/p', withApp, { kind: 'missing' }, '/cwd');
    expect(missing.ok ? '' : missing.message).toContain('--out には値(書き込み先の置き場)が要ります');
  });

  it('--out が製品の根と同じ場所(別名を畳んだあとも)を指すなら、本物の book の根に書いてしまうので止める', () => {
    const same = entryDestination('/p', withApp, { kind: 'value', value: '..' }, '/p/sub');
    expect(same.ok ? '' : same.message).toContain('製品の根と同じ場所');
    const alias = entryDestination('/p', withApp, { kind: 'value', value: '/alias' }, '/cwd', (file) => file.replace('/alias', '/p'));
    expect(alias.ok).toBe(false);
    expect(entryDestination('/p', withApp, { kind: 'value', value: '/elsewhere' }, '/cwd', (file) => file.replace('/alias', '/p')).ok).toBe(true);
  });
});

describe('destinationConflicts: 置き場の木を通して本物のハンドブックを書き換える書き込みを、書く前に全ファイルぶん探す', () => {
  const withApp: ProductRoots = rootsOf('app');
  /** 製品の根 `/p`・置き場 `/o`。別名は表で与える(`/o/x` → `/p/docs/book/x` のように実体を指す)。 */
  function probeOf(links: Readonly<Record<string, string>>, existing: readonly string[] = []): DestinationProbe {
    const resolve = (file: string): string => {
      for (const [from, to] of Object.entries(links)) if (file === from || file.startsWith(`${from}/`)) return resolve(`${to}${file.slice(from.length)}`);
      return file;
    };
    return {
      kindOf: (file) => (file in links ? 'symlink' : [...Object.keys(links), ...existing].some((known) => known === file || known.startsWith(`${file}/`)) ? 'other' : 'absent'),
      realpath: resolve,
    };
  }
  const files = ['docs/book/README.md', 'docs/book/assets/results/item.json', 'docs/book/actions.md'];

  it('独立した置き場(別名が 1 つも無い)は、書いてよい', () => {
    expect(destinationConflicts(files, '/o', '/p', withApp, probeOf({}))).toEqual([]);
    expect(destinationConflicts(files, '/o', '/p', withApp, probeOf({}, ['/o/docs/book/README.md']))).toEqual([]);
  });

  it('置き場の book ディレクトリ・1 ファイル・assets 配下のディレクトリの別名は、どれも名指して拒否する(全件ぶんを 1 回で返す)', () => {
    const dir = destinationConflicts(files, '/o', '/p', withApp, probeOf({ '/o/docs/book': '/p/docs/book' }));
    expect(dir).toEqual(['docs/book は置き場の木の中の既存のシンボリックリンクです(書き込みが辿って別のファイルを書き換えます)']);
    const child = destinationConflicts(files, '/o', '/p', withApp, probeOf({ '/o/docs/book/README.md': '/p/docs/book/README.md', '/o/docs/book/assets/results': '/p/docs/book/assets/results' }));
    expect(child.map((line) => line.split(' ')[0])).toEqual(['docs/book/README.md', 'docs/book/assets/results']);
    expect(child.every((line) => line.includes('シンボリックリンク'))).toBe(true);
  });

  it('辿った先が製品のハンドブックでなくても、置き場の木の中の別名は一律に拒否する(単純な方)', () => {
    const elsewhere = destinationConflicts(files, '/o', '/p', withApp, probeOf({ '/o/docs/book/actions.md': '/elsewhere/a.md' }));
    expect(elsewhere).toEqual(['docs/book/actions.md は置き場の木の中の既存のシンボリックリンクです(書き込みが辿って別のファイルを書き換えます)']);
  });

  it('置き場の根そのものが製品のハンドブックの中に解決されるなら、書く先が全部そこなので 1 件で拒否する(根が製品の根の別名でも同じ)', () => {
    const inside = destinationConflicts(files, '/o', '/p', withApp, probeOf({ '/o': '/p/docs/book/sub' }));
    expect(inside).toHaveLength(1);
    expect(inside[0]).toContain('製品の本物のハンドブック(docs/book)の中に解決されます');
    const root = destinationConflicts(files, '/o', '/p', withApp, probeOf({ '/o': '/p' }));
    expect(root.length).toBeGreaterThan(0);
  });

  it('途中が実在しなければそこから先は見ない(これから作るディレクトリは別名になりえない)', () => {
    expect(destinationConflicts(['docs/book/new/a.md'], '/o', '/p', withApp, probeOf({}))).toEqual([]);
  });
});

/** 実装の木の有無だけを変えて使う、最小の製品の根。 */
function rootsOf(app: string): ProductRoots {
  return { name: 'sample', specs: 'docs/specs', book: 'docs/book', generated: 'app/src/domain/generated', migrations: 'supabase/migrations', app, knowledge: null, previews: null, termScan: NO_TERM_SCAN };
}
