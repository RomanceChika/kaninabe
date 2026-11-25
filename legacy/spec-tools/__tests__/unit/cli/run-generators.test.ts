import { describe, expect, it } from 'vitest';
import { preconditionFailure } from '../../../lib/kernel/generator-precondition.js';
import type { DocGenerator, GenerateContext } from '../../../lib/gen-kit/generator.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { runGenerators } from '../../../cli/run-generators.js';

/** 生成器の並びを回す口: セクションはファイルごとにまとまり、何も出さない生成器が名指しされる。 */

const model = {} as SpecModel;
const ctx = {} as GenerateContext;

/** 決まったセクションを返す生成器。 */
function emitting(id: string, ...files: readonly string[]): DocGenerator {
  return { id, generate: () => files.map((file) => ({ file, content: `${id}:${file}`, wholeFile: true })) };
}

describe('runGenerators', () => {
  it('同じファイルへ書くセクションは宣言順にまとまり、何も出さない生成器は ID で返る', () => {
    const outcome = runGenerators([emitting('a', 'x.md', 'y.md'), emitting('none'), emitting('b', 'x.md')], model, ctx);
    if (!outcome.ok) throw new Error('成功のはず');
    expect([...outcome.byFile.keys()]).toEqual(['x.md', 'y.md']);
    expect(outcome.byFile.get('x.md')?.map((section) => section.content)).toEqual(['a:x.md', 'b:x.md']);
    expect(outcome.emptyGenerators).toEqual(['none']);
  });

  it('生成器の前提が破れたら、スタックトレースでなく破れた前提の Finding を返す', () => {
    const broken: DocGenerator = {
      id: 'broken',
      generate: () =>
        preconditionFailure('X1', [{ message: '前提が破れた', suggestion: '検査を足す', counterexample: {}, location: { file: 'a.md' } }]),
    };
    const outcome = runGenerators([emitting('a', 'x.md'), broken], model, ctx);
    if (outcome.ok) throw new Error('失敗のはず');
    expect(outcome.findings.map((finding) => finding.verifier)).toEqual(['X1']);
  });

  it('前提の破れ以外の例外は握りつぶさず投げ直す', () => {
    const crashing: DocGenerator = {
      id: 'crash',
      generate: (): never => {
        throw new Error('想定外');
      },
    };
    expect(() => runGenerators([crashing], model, ctx)).toThrow('想定外');
  });
});
