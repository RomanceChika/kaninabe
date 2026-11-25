/**
 * 仕様のフロントマターを読む唯一の入口(`lib/model/safe-frontmatter.ts`)の単体テスト。
 *
 * 仕様の文字列は生成物のコメント・ハンドブックの見出しに置かれる。キーと値に制御文字・行の区切り・向きを変える文字が
 * 入る仕様は読めないものとして落とす(複数行の YAML 文字列は仕様の形ではない)。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../lib/model/parse-common.js';
import { forbiddenCharacterIn, MAX_KEY_LENGTH, MAX_VALUE_LENGTH, overlongStringIn, parseSafeFrontmatter } from '../../../lib/model/safe-frontmatter.js';

/** フロントマターを読む(違反は Finding の message に集める)。 */
function read(source: string): { readonly data: unknown; readonly messages: readonly string[] } {
  const reporter = new SpecReporter('x.md');
  const data = parseSafeFrontmatter(source, reporter);
  return { data, messages: reporter.findings().map((finding) => finding.message) };
}

describe('parseSafeFrontmatter', () => {
  it('普通の仕様は読める(タブは置ける)', () => {
    const { data, messages } = read('---\ndoc_type: entity_spec\nlabel: "会議室\t(大)"\n---\n');

    expect(messages).toEqual([]);
    expect(data).toEqual({ doc_type: 'entity_spec', label: '会議室\t(大)' });
  });

  it.each([
    ['ダブルクォートの \\n(監査の実測: 改行入りのラベルで次の行に SQL が出た)', '---\ndoc_type: x\nlabel: "会議室\\n drop table users;"\n---\n', 'U+000A'],
    ['ブロック文字列(| で複数行)', '---\ndoc_type: x\nlabel: |\n  一行目\n  二行目\n---\n', 'U+000A'],
    ['U+2028(JavaScript の行コメントを終える)', '---\ndoc_type: x\nlabel: "a\\u2028b"\n---\n', 'U+2028'],
    ['向きを変える文字(Trojan Source)', '---\ndoc_type: x\nlabel: "a\\u202Eb"\n---\n', 'U+202E'],
    ['U+200E(左から右の印)', '---\ndoc_type: x\nlabel: "a\\u200Eb"\n---\n', 'U+200E'],
    ['U+200F(右から左の印)', '---\ndoc_type: x\nlabel: "a\\u200Fb"\n---\n', 'U+200F'],
    ['U+2060(単語結合)', '---\ndoc_type: x\nlabel: "a\\u2060b"\n---\n', 'U+2060'],
    ['U+FEFF(零幅の空白)', '---\ndoc_type: x\nlabel: "a\\uFEFFb"\n---\n', 'U+FEFF'],
    ['NUL', '---\ndoc_type: x\nlabel: "a\\0b"\n---\n', 'U+0000'],
    ['キーの中の改行', '---\ndoc_type: x\n"a\\nb": 1\n---\n', 'U+000A'],
    ['リストの奥の文字列', '---\ndoc_type: x\nitems:\n  - ok\n  - "bad\\rvalue"\n---\n', 'U+000D'],
  ])('%s は読めないものとして落とす', (_name, source, code) => {
    const { data, messages } = read(source);

    expect(data).toBeNull();
    expect(messages.join('\n')).toContain(code);
  });
});

describe('forbiddenCharacterIn', () => {
  it('どこにあったかを返す', () => {
    expect(forbiddenCharacterIn({ a: { b: ['ok', 'x\ny'] } })).toEqual({ pointer: 'a.b[1]', code: 'U+000A' });
    expect(forbiddenCharacterIn({ a: 'fine', b: 1, c: null })).toBeNull();
  });
});

describe('読み込みの関所の構造', () => {
  /** `lib/` の `.ts` を全部集める。 */
  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const target = path.join(dir, entry);
      if (statSync(target).isDirectory()) sources(target, found);
      else if (target.endsWith('.ts')) found.push(target);
    }
    return found;
  }

  it('ローダーは parseFrontmatter を直接呼ばない(文字の検査を素通りする口を作らない)', () => {
    const lib = path.resolve(import.meta.dirname, '../../../lib');
    const direct = sources(lib)
      .filter((file) => !file.endsWith('model/parse-common.ts') && !file.endsWith('model/safe-frontmatter.ts'))
      .filter((file) => /\bparseFrontmatter\(/.test(readFileSync(file, 'utf-8')))
      .map((file) => path.relative(lib, file));

    expect(direct).toEqual([]);
  });
});

describe('文字列の長さの上限(極端に長い 1 行は読み込みで止める)', () => {
  it('上限ちょうどの値は読める。1 字超えると読めないものとして落とし、場所と字数を名指す', () => {
    const ok = read(`---\ndoc_type: x\nlabel: ${'a'.repeat(MAX_VALUE_LENGTH)}\n---\n`);
    const over = read(`---\ndoc_type: x\nitems:\n  - label: ${'a'.repeat(MAX_VALUE_LENGTH + 1)}\n---\n`);

    expect(ok.messages).toEqual([]);
    expect(over.data).toBeNull();
    expect(over.messages.join('\n')).toContain(`${MAX_VALUE_LENGTH + 1} 字`);
  });

  it('キーの長さにも上限がある', () => {
    const { data, messages } = read(`---\ndoc_type: x\n${'k'.repeat(MAX_KEY_LENGTH + 1)}: 1\n---\n`);

    expect(data).toBeNull();
    expect(messages.join('\n')).toContain('長すぎます');
  });

  it('場所を返す(奥の値)', () => {
    expect(overlongStringIn({ a: [{ b: 'x'.repeat(MAX_VALUE_LENGTH + 5) }] })).toEqual({ pointer: 'a[0].b', length: MAX_VALUE_LENGTH + 5 });
    expect(overlongStringIn({ a: 'short' })).toBeNull();
  });
});
