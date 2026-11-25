/**
 * 生成コードのコメント・文字列を組み立てる部品(`lib/gen-kit/code-emit.ts`)が、仕様の敵対的な文字列でコメントを破られないことを確かめる。
 *
 * 監査の実測(F-03): エンティティの `label` に「閉じ記号 + globalThis.X=1; + 開き記号」を書くと `'use server'` のファイルに実行文が入った。仕様ファイルの
 * パス(ディレクトリ名)もヘッダに入り、`*\/` で閉じ・文を置き・`/*` で開き直せた。
 */

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { docComment, generatedHeader, tsString } from '../../../lib/gen-kit/code-emit.js';

/** ソースをコメントと文字列を除いたトークン列にして、文があるかを見る。 */
function statementsOf(source: string): readonly ts.SyntaxKind[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.ES2022, true);
  return file.statements.map((statement) => statement.kind);
}

/** 期待する文の並び(`export const a = 1;` の 1 文だけ)。 */
const ONLY_THE_DECLARATION = [ts.SyntaxKind.VariableStatement];

describe('docComment', () => {
  it('ラベルが `*/ evil(); /*` でも、コメントの外に文が出ない', () => {
    const source = `${docComment([`会議室 */ globalThis.X = 1; /* —— 操作`])}\nexport const a = 1;`;

    expect(statementsOf(source)).toEqual(ONLY_THE_DECLARATION);
    expect(source.split('*/').length).toBe(2);
  });

  it('要素の中の改行は行を分ける(コメントの外に出ない)', () => {
    const source = `${docComment(['目的\nexport const injected = 1;', 'b'])}\nexport const a = 1;`;

    expect(statementsOf(source)).toEqual(ONLY_THE_DECLARATION);
    expect(source).toContain(' * export const injected = 1;');
  });

  it('正常な本文は従来と同じ(1 行形式・空行は ` *`)', () => {
    expect(docComment(['本文'])).toBe('/** 本文 */');
    expect(docComment(['a', '', 'b'])).toBe(['/**', ' * a', ' *', ' * b', ' */'].join('\n'));
  });
});

describe('generatedHeader', () => {
  it('仕様ファイルのパスに改行や `*/` があっても、ヘッダの外に文が出ない', () => {
    const header = generatedHeader(['site/usecases/dept*/globalThis.FILENAME_INJ=1;/*x/book_room.md', 'site/a\nb */ evil();/*.md']);

    expect(statementsOf(`${header}\nexport const a = 1;`)).toEqual(ONLY_THE_DECLARATION);
    expect(header.split('*/').length).toBe(2);
  });
});

describe('tsString', () => {
  it('単独の復帰・行の区切りを含む値でも、リテラルが 1 行に収まって構文エラーにならない', () => {
    const source = `const v = ${tsString('a\rb\u2028c')};`;

    expect(source.split(/[\n\r\u2028\u2029]/)).toHaveLength(1);
    const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.ES2022, true);
    expect((file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toHaveLength(0);
  });
});
