/**
 * 生成物の**骨格**(コメントと文字列の中身を除いた、構造だけ)を取り出す道具。
 *
 * 仕様の自由な文字列が生成物のコメントや文字列リテラルを破ると、骨格が変わる(文や宣言が増える)。**無害な文字列で作った生成物**と
 * **敵対的な文字列で作った生成物**の骨格が同じなら、文字列は位置を破っていない —— 注入の有無を「実行文が現れたか」の字面検索でなく
 * 構造の比較で見る(未知の出口でも効く)。
 */

import ts from 'typescript';

/** TypeScript の骨格: 構文木の節の種類と、識別子・数値の綴り(文字列の中身とコメントは含めない)。 */
export function typeScriptSkeleton(source: string, fileName = 'x.tsx'): readonly string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || node.kind === ts.SyntaxKind.JsxText || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push(`${ts.SyntaxKind[node.kind]}`);
      return;
    }
    out.push(ts.isIdentifier(node) || ts.isNumericLiteral(node) ? `${ts.SyntaxKind[node.kind]}:${node.text}` : ts.SyntaxKind[node.kind] ?? '');
    ts.forEachChild(node, visit);
  };
  visit(file);
  const diagnostics = (file as unknown as { parseDiagnostics: readonly unknown[] }).parseDiagnostics;
  return [...out, `parseDiagnostics:${diagnostics.length}`];
}

/**
 * SQL の骨格: 行コメント・ブロックコメント・単引用符の文字列(`''` の二重化を含む)・`U&'…'` を除いたトークン列。
 *
 * **`$$` で括った本文は Postgres と同じに扱う**: 本文は次の生の `$$` で終わる(本文の中の文字列やコメントの中の `$$` でも終わる)。
 * 外側では文字列とコメントを読み飛ばしてから `$$` を探す。本文が早く閉じる・コメントの外へ文が出る、は骨格の差になる。
 */
export function sqlSkeleton(source: string): readonly string[] {
  const out: string[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    if (rest.startsWith('$$')) {
      const close = source.indexOf('$$', index + 2);
      const body = close === -1 ? source.slice(index + 2) : source.slice(index + 2, close);
      out.push('$$', ...sqlTokens(body));
      if (close === -1) break;
      out.push('$$');
      index = close + 2;
      continue;
    }
    const lead = /^(?:--[^\n]*|\/\*[\s\S]*?\*\/|(?:U&)?'(?:[^']|'')*'|\s+|[^-/'U$\s]+|[\s\S])/.exec(rest);
    const piece = lead?.[0] ?? rest.charAt(0);
    out.push(...sqlTokens(piece));
    index += piece.length;
  }
  return out;
}

/** `$$` を含まない SQL の字面を、コメントと文字列を除いたトークンにする。 */
function sqlTokens(text: string): readonly string[] {
  const out: string[] = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    let match: RegExpExecArray | null;
    if ((match = /^--[^\n]*/.exec(rest)) !== null) index += match[0].length;
    else if ((match = /^\/\*[\s\S]*?\*\//.exec(rest)) !== null) index += match[0].length;
    else if ((match = /^(?:U&)?'(?:[^']|'')*'/.exec(rest)) !== null) {
      out.push("'");
      index += match[0].length;
    } else if ((match = /^\s+/.exec(rest)) !== null) index += match[0].length;
    else if ((match = /^[A-Za-z_][A-Za-z0-9_.]*|^[0-9]+(?:\.[0-9]+)?/.exec(rest)) !== null) {
      out.push(match[0]);
      index += match[0].length;
    } else {
      out.push(rest.charAt(0));
      index += 1;
    }
  }
  return out;
}

/** CSS の骨格: コメントを除いた字面(空白は畳む)。 */
export function cssSkeleton(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}
