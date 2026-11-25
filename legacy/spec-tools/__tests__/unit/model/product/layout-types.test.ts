/**
 * 置き場の配置の型の葉(`lib/model/product/layout-types.ts`)のテスト。
 *
 * 葉の値打ちは「配置の解決・検査・役割の語彙を触っても、生成の文脈(`generator.ts`)の import の閉包 = C24(RPC のモデル)の写し元の閉包が動かない」ことである。
 * 型だけの import も閉包に入るので、`generator.ts` が型を本体(`layout.ts`)から読むと、役割を足すたびにモデルの hash が動く。ここでは、
 * ①葉が何も import せず値を持たないこと ②実物の閉包に葉は入り、本体と検査と衝突の検査は入らないこと、を実ファイルで確かめる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { worktreeReader } from '../../../../cli/formal-sources-io.js';
import { computeClosure } from '../../../../lib/semantics/import-closure.js';

const SPEC_TOOLS = fileURLToPath(new URL('../../../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const LEAF = `${SPEC_TOOLS}lib/model/product/layout-types.ts`;

/** 葉のソースの構文木。 */
function leafSource(): ts.SourceFile {
  return ts.createSourceFile(LEAF, readFileSync(LEAF, 'utf8'), ts.ScriptTarget.ES2022, true);
}

describe('layout-types.ts: 型だけの葉', () => {
  it('何も import せず、値(関数・定数・クラス)を 1 つも持たない(interface / type だけ)', () => {
    const statements = leafSource().statements;
    expect(statements.filter((statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))).toEqual([]);
    const kinds = statements.map((statement) => ts.SyntaxKind[statement.kind]);
    expect(kinds.every((kind) => kind === 'InterfaceDeclaration' || kind === 'TypeAliasDeclaration')).toBe(true);
    expect(kinds.length).toBeGreaterThan(0);
  });

  it('生成の文脈(generator.ts)の閉包に葉は入り、解決・検査・衝突の検査の本体は入らない(役割を足しても C24 の hash が動かない)', () => {
    const closure = computeClosure('legacy/spec-tools/lib/gen-kit/generator.ts', worktreeReader(REPO_ROOT));
    const paths = new Set(closure?.files.map((file) => file.path));
    expect(paths.has('legacy/spec-tools/lib/model/product/layout-types.ts')).toBe(true);
    for (const body of ['layout.ts', 'layout-definition.ts', 'layout-claims.ts']) {
      expect(paths.has(`legacy/spec-tools/lib/model/product/${body}`), body).toBe(false);
    }
  });
});
