/**
 * H9(プラットフォーム操作の宣言)のうち、配線先の**結果の union の失敗の理由**を構文木から読む部分。
 *
 * fail-closed: 読めないものを「理由なし」として黙って通さない。次のどれも、理由つきの問題として返す(呼び出し側が違反にする)。
 *   - 結果の型の別名が見つからない・union でない・メンバーが型リテラルでない
 *   - 成功/失敗の判別子(`ok: true` / `ok: false`)が無い・真偽のリテラルでない
 *   - 成功の側に値の欄が無い・失敗の側に理由の欄が無い・失敗の枝が 1 つも無い
 *   - 理由の型が文字列リテラル(の和・同じファイルの型の別名経由)でない(`string` との和・解決できない別名・テンプレート等)
 * 失敗の枝は**全部**集める(最初の 1 つで止めない)ので、別の枝に足した理由も refusals との突合に載る。
 */

import ts from 'typescript';
import type { PlatformPortDecl } from '../../model/auth/platform-ops.js';

/** 読んだ結果。`problems` が空でなければ `reasons` は信用しない。 */
export interface ReadReasons {
  readonly reasons: readonly string[];
  readonly problems: readonly string[];
}

const MAX_ALIAS_DEPTH = 8;

/** export の有無を問わず、同じファイルの型の別名を名前で探す。 */
function findAlias(file: ts.SourceFile, name: string): ts.TypeAliasDeclaration | undefined {
  return file.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
}

/** 型の和の平坦化(括弧を剥がす)。 */
function flatten(node: ts.TypeNode): readonly ts.TypeNode[] {
  if (ts.isParenthesizedTypeNode(node)) return flatten(node.type);
  if (ts.isUnionTypeNode(node)) return node.types.flatMap(flatten);
  return [node];
}

/** 理由の型を文字列リテラルの集合に解く(解けなければ問題を積む)。 */
function resolveReasonType(file: ts.SourceFile, node: ts.TypeNode, depth: number, problems: string[]): string[] {
  const out: string[] = [];
  for (const part of flatten(node)) {
    if (ts.isLiteralTypeNode(part) && ts.isStringLiteral(part.literal)) {
      out.push(part.literal.text);
    } else if (ts.isTypeReferenceNode(part) && ts.isIdentifier(part.typeName) && part.typeArguments === undefined) {
      const alias = findAlias(file, part.typeName.text);
      if (alias === undefined || alias.typeParameters !== undefined || depth >= MAX_ALIAS_DEPTH) problems.push(`理由の型 ${part.getText()} を同じファイルの型の別名から解決できません`);
      else out.push(...resolveReasonType(file, alias.type, depth + 1, problems));
    } else {
      problems.push(`理由の型に文字列リテラルでない構文があります(${part.getText()}。広い string・テンプレート・未対応の構文は拒否)`);
    }
  }
  return out;
}

/** 判別子の欄の型が `true` / `false` のリテラルならその値、そうでなければ null。 */
function booleanLiteral(node: ts.TypeNode | undefined): boolean | null {
  if (node === undefined || !ts.isLiteralTypeNode(node)) return null;
  if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

/**
 * 結果の union の失敗の理由を全部読む。
 *
 * @param file 配線のモジュールの構文木
 * @param port ポートの宣言(union の型名と欄の名前)
 * @returns 失敗の枝すべての理由の和と、読めなかった理由(問題)
 */
export function readReasons(file: ts.SourceFile, port: PlatformPortDecl): ReadReasons {
  const { type: typeName, ok: okName, value: valueName, reason: reasonName } = port.union;
  const head = `結果の union ${typeName}`;
  const alias = findAlias(file, typeName);
  if (alias === undefined) return { reasons: [], problems: [`${head} の型の別名が ${port.name} の配線に見つかりません(失敗の理由を読めない)`] };
  const members = flatten(alias.type);
  const problems: string[] = [];
  const reasons: string[] = [];
  let failures = 0;
  let successes = 0;
  members.forEach((member, index) => {
    const label = `${head} の ${index + 1} 番目のメンバー`;
    if (!ts.isTypeLiteralNode(member)) {
      problems.push(`${label} が型リテラルではありません(${member.getText()})`);
      return;
    }
    const props = member.members.filter(ts.isPropertySignature);
    const discriminant = props.find((candidate) => candidate.name.getText() === okName);
    const flag = booleanLiteral(discriminant?.type);
    if (flag === null) {
      problems.push(`${label} に判別子 ${okName} が無い、または true / false のリテラル型ではありません`);
      return;
    }
    if (flag) {
      successes += 1;
      if (!props.some((candidate) => candidate.name.getText() === valueName)) problems.push(`${label}(成功)に値の欄 ${valueName} がありません`);
      return;
    }
    failures += 1;
    const reason = props.find((candidate) => candidate.name.getText() === reasonName);
    if (reason?.type === undefined) {
      problems.push(`${label}(失敗)に理由の欄 ${reasonName} がありません`);
      return;
    }
    reasons.push(...resolveReasonType(file, reason.type, 0, problems));
  });
  if (failures === 0) problems.push(`${head} に失敗(${okName}: false)の枝がありません`);
  if (successes === 0) problems.push(`${head} に成功(${okName}: true)の枝がありません`);
  return { reasons: [...new Set(reasons)], problems: [...new Set(problems)] };
}
