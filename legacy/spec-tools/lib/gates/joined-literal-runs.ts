/**
 * パスを組む呼び出し(`join` / `joinPath` / `resolve` / `…Path`)の、**連続する文字列リテラルの引数**を取り出す(綴りの検査の入力)。
 *
 * 単語ごとに分けた組み立て(`join('src', 'operation')`)は、文字列 1 つ 1 つにはパスの形が無く、`/` でつないで初めて綴りの表に当たる。
 * 使うのは綴りの検査(`platform-spellings.ts`)だけだが、「どの呼び出しがパスを組む口か」を決める責務は、綴りの照合(表に当てる)とは別にある。
 * 純関数であり throw しない。
 */

import ts from 'typescript';

/** 連続する文字列リテラルの引数 1 まとまり。 */
export interface JoinedRun {
  /** `/` でつないだ形。 */
  readonly text: string;
  /** つなぐ前の各段(空文字は除く)。 */
  readonly parts: readonly string[];
  /** 先頭の引数(行の位置を示す)。 */
  readonly first: ts.Node;
}

/** パスを組む呼び出しの口の名前(`join` / `joinPath` / `resolve` と、`…Path`(`specPath` ほか。第 1 引数が根で残りが段)。実物の呼び出しを数えて決めた)。 */
const PATH_BUILDER_NAME: RegExp = /^(?:join|joinPath|resolve)$|Path$/;

/** 呼び出しの口の名前(`join(…)` なら `join`・`path.posix.join(…)` なら `join`)。名前が読めない形は null。 */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/**
 * パスを組む呼び出しの、**連続する文字列リテラルの引数**を `/` でつないだ形(`join('src', 'operation')` → `src/operation`)。
 * 単語ごとに分けた組み立てを、パスの形の綴りに当てるため。非リテラルの引数(`roots.app` ・変数)で連続は切れ、空文字の段は無いものとして飛ばす。
 * 連続が 2 段に満たない(単独の語)ものは返さない。
 *
 * @returns つないだ形と、先頭の引数(行の位置)の組
 */
export function joinedLiteralRuns(call: ts.CallExpression): readonly JoinedRun[] {
  const name = calleeName(call);
  if (name === null || !PATH_BUILDER_NAME.test(name)) return [];
  const runs: { text: string; parts: string[]; first: ts.Node }[] = [];
  let current: { parts: string[]; first: ts.Node } | null = null;
  const close = (): void => {
    if (current !== null && current.parts.length >= 2) runs.push({ text: current.parts.join('/'), parts: current.parts, first: current.first });
    current = null;
  };
  for (const arg of call.arguments) {
    if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
      close();
    } else if (arg.text !== '') {
      current ??= { parts: [], first: arg };
      current.parts.push(arg.text);
    }
  }
  close();
  return runs;
}
