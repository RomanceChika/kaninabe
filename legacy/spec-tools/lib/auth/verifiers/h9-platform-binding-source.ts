/**
 * H9(プラットフォーム操作の宣言)のうち、**配線先の実際の TypeScript の形との突合**(束 B。束 A が「束 B で」と持ち越した配線先の実在)。
 *
 * 宣言の `binding`(`port` / `method` / `params` / `result`)と `platform_ports`(結果の union・失敗の理由・行の型)が、手書きの配線(役割 `platform-binding`)の
 * **構文木**と合っているかを見る。字面の `includes` ではなく構文木なので、コメントの中の名前・別の型の一部では通らない。
 *
 * | 見ること | 落とす例 |
 * |---|---|
 * | 配線のモジュールが実在し、ポートの interface を export している | ファイルが無い・interface の名前が違う |
 * | ポートの組み立て関数(ポート名の先頭を小文字にした名前)を値として export している | 入口が import するのに無い |
 * | メソッドが実在し、引数の数・名前・省略・型が `params` と一致する(オブジェクトの引数はプロパティの集合まで) | 引数が増えたのに対応表が古い |
 * | 戻り値が `Promise<結果の union<値>>` で、値が `result`(スカラー / 行の配列)と一致する | 戻り値の型が `number` から `boolean` に変わった |
 * | 結果の union の失敗の理由(文字列リテラルの和)と `refusals` の理由の集合が一致する | 新しい理由を足したのに画面の文言が無い |
 * | 行の型が同じファイルにあれば、プロパティの名前・型・null の有無が `rows` と一致する | 行の欄の名前が変わった |
 *
 * 行の型が別のパッケージから import されている場合、その定義はここでは読まない(生成された入口が行のプロパティを型つきで写すので、
 * 実在しない名前は型検査が落とす。生成テストの接続の試験も配線先の本物の形から画面の値を作る)。
 * 実装の木が無い・配置が役割を持たない製品は、モジュールの実在が言えないので 1 件だけ名指す(宣言した製品が黙って未検査にならない)。
 */

import path from 'node:path';
import ts from 'typescript';
import { isFile } from '../../io/paths.js';
import { readText } from '../../io/read-text.js';
import type { Finding } from '../../kernel/finding.js';
import type { AuthPlatformOps, PlatformBindingParam, PlatformBindingValue, PlatformOpDecl, PlatformPortDecl, PlatformRowDecl } from '../../model/auth/platform-ops.js';
import { layoutPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { exportedValueNames } from '../../semantics/module-exports.js';
import { parseModule } from '../../semantics/guard-ast.js';
import { readReasons } from './h9-platform-binding-reasons.js';

/** 配線先を読む入力(実装の木と置き場の配置)。 */
export interface PlatformBindingSource {
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}

function h9(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { severity: 'error', verifier: 'H9', ...args };
}

/** ポートの組み立て関数の名前(ポート名の先頭を小文字にする。生成された入口が import する名前)。 */
export function portFactoryName(port: string): string {
  return `${port.charAt(0).toLowerCase()}${port.slice(1)}`;
}

/** 型のキーワードを `string` / `boolean` / `number` にする(それ以外は null)。 */
function keywordOf(node: ts.TypeNode | undefined): string | null {
  if (node === undefined) return null;
  if (node.kind === ts.SyntaxKind.StringKeyword) return 'string';
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return 'boolean';
  if (node.kind === ts.SyntaxKind.NumberKeyword) return 'number';
  return null;
}

/** `string | null` / `string | undefined` の null 部分を除いた型と、null を許すか。 */
function stripNullish(node: ts.TypeNode | undefined): { readonly node: ts.TypeNode | undefined; readonly nullable: boolean } {
  if (node === undefined || !ts.isUnionTypeNode(node)) return { node, nullable: false };
  const isNullish = (member: ts.TypeNode): boolean => member.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword);
  const rest = node.types.filter((member) => !isNullish(member));
  return { node: rest.length === 1 ? rest[0] : node, nullable: rest.length !== node.types.length };
}

/** 引数 1 つの型の字面(`string` など。読めなければ「読めない型」)。 */
function typeWord(node: ts.TypeNode | undefined): string {
  return keywordOf(node) ?? (node === undefined ? '(型なし)' : node.getText());
}

/** 行の配列の型(`readonly Row[]` / `Row[]` / `ReadonlyArray<Row>` / `Array<Row>`)の要素の型名。 */
function elementOfArray(node: ts.TypeNode): string | null {
  const inner = ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword ? node.type : node;
  if (ts.isArrayTypeNode(inner) && ts.isTypeReferenceNode(inner.elementType) && ts.isIdentifier(inner.elementType.typeName)) return inner.elementType.typeName.text;
  if (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName) && ['Array', 'ReadonlyArray'].includes(inner.typeName.text)) {
    const element = inner.typeArguments?.[0];
    if (element !== undefined && ts.isTypeReferenceNode(element) && ts.isIdentifier(element.typeName)) return element.typeName.text;
  }
  return null;
}

/** export した interface / type alias をファイルから探す。 */
function findExported<T extends ts.InterfaceDeclaration | ts.TypeAliasDeclaration>(file: ts.SourceFile, name: string, guard: (statement: ts.Statement) => statement is T): T | undefined {
  return file.statements.find((statement): statement is T => guard(statement) && statement.name.text === name && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

const isInterface = (statement: ts.Statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement);

/** メソッドの引数と `params` の突合。 */
function checkParams(op: PlatformOpDecl, signature: ts.MethodSignature): string[] {
  const problems: string[] = [];
  const declared = op.binding.params;
  if (signature.parameters.length !== declared.length) {
    return [`引数の数が違います(配線先 ${signature.parameters.length} 個・params ${declared.length} 個)`];
  }
  declared.forEach((param, index) => {
    const actual = signature.parameters[index];
    if (actual === undefined) return;
    problems.push(...checkParam(param, actual));
  });
  return problems;
}

/** 引数 1 つ。 */
function checkParam(param: PlatformBindingParam, actual: ts.ParameterDeclaration): string[] {
  const name = ts.isIdentifier(actual.name) ? actual.name.text : actual.name.getText();
  const problems: string[] = [];
  if (name !== param.name) problems.push(`引数名が違います(配線先 ${name}・params ${param.name})`);
  const optional = actual.questionToken !== undefined;
  const wantOptional = param.kind === 'scalar' ? param.map.optional : param.optional;
  if (optional !== wantOptional) problems.push(`引数 ${param.name} の省略の可否が違います(配線先 ${optional ? '省略できる' : '必須'}・params ${wantOptional ? '省略できる' : '必須'})`);
  if (param.kind === 'scalar') {
    if (typeWord(actual.type) !== param.map.type) problems.push(`引数 ${param.name} の型が違います(配線先 ${typeWord(actual.type)}・params ${param.map.type})`);
    return problems;
  }
  const literal = actual.type !== undefined && ts.isTypeLiteralNode(actual.type) ? actual.type : null;
  if (literal === null) return [...problems, `引数 ${param.name} の型がオブジェクトのリテラル型ではありません(配線先 ${typeWord(actual.type)})`];
  const members = literal.members.filter(ts.isPropertySignature);
  for (const prop of param.props) {
    const member = members.find((candidate) => candidate.name.getText() === prop.prop);
    if (member === undefined) {
      problems.push(`引数 ${param.name} にプロパティ ${prop.prop} がありません`);
      continue;
    }
    if (typeWord(member.type) !== prop.type) problems.push(`プロパティ ${param.name}.${prop.prop} の型が違います(配線先 ${typeWord(member.type)}・params ${prop.type})`);
    if ((member.questionToken !== undefined) !== prop.optional) problems.push(`プロパティ ${param.name}.${prop.prop} の省略の可否が違います`);
  }
  for (const member of members.filter((candidate) => !param.props.some((prop) => prop.prop === candidate.name.getText()))) {
    problems.push(`引数 ${param.name} に、対応表に無いプロパティ ${member.name.getText()} があります(余剰)`);
  }
  return problems;
}

/** 戻り値と `result` の突合(`Promise<Union<T>>`)。 */
function checkReturn(signature: ts.MethodSignature, port: PlatformPortDecl, result: PlatformBindingValue): string[] {
  const type = signature.type;
  if (type === undefined || !ts.isTypeReferenceNode(type) || type.typeName.getText() !== 'Promise' || type.typeArguments?.length !== 1) {
    return [`戻り値が Promise<${port.union.type}<…>> ではありません(配線先 ${typeWord(type)})`];
  }
  const union = type.typeArguments[0];
  if (union === undefined || !ts.isTypeReferenceNode(union) || union.typeName.getText() !== port.union.type || union.typeArguments?.length !== 1) {
    return [`戻り値が結果の union ${port.union.type}<…> ではありません(配線先 ${typeWord(union)})`];
  }
  const value = union.typeArguments[0];
  if (value === undefined) return [`結果の union ${port.union.type} の値の型がありません`];
  if (result.kind === 'scalar') {
    return keywordOf(value) === result.type ? [] : [`戻り値の値の型が違います(配線先 ${typeWord(value)}・result ${result.type})`];
  }
  const element = elementOfArray(value);
  return element === result.row ? [] : [`戻り値の値の型が違います(配線先 ${typeWord(value)}・result は ${result.row} の配列)`];
}

/** 同じファイルにある行の型とのプロパティの突合(別の場所から import している行の型は読まない)。 */
function checkRow(file: ts.SourceFile, row: PlatformRowDecl): string[] {
  const declaration = findExported(file, row.name, isInterface);
  if (declaration === undefined) return [];
  const problems: string[] = [];
  const members = declaration.members.filter(ts.isPropertySignature);
  for (const prop of row.props) {
    const member = members.find((candidate) => candidate.name.getText() === prop.name);
    if (member === undefined) {
      problems.push(`行の型 ${row.name} にプロパティ ${prop.name} がありません`);
      continue;
    }
    const { node, nullable } = stripNullish(member.type);
    if (keywordOf(node) !== prop.type) problems.push(`行の型 ${row.name} の ${prop.name} の型が違います(配線先 ${typeWord(member.type)}・rows ${prop.type})`);
    else if (nullable !== prop.nullable) problems.push(`行の型 ${row.name} の ${prop.name} の null の有無が違います(配線先 ${nullable ? 'null がありうる' : 'null にならない'}・rows ${prop.nullable ? 'null がありうる' : 'null にならない'})`);
  }
  return problems;
}

/** ポート 1 つ分の突合。 */
function checkPort(port: PlatformPortDecl, ops: readonly PlatformOpDecl[], file: string, source: string): Finding[] {
  const module = parseModule(file, source);
  const where = { file };
  const findings: Finding[] = [];
  const problem = (op: PlatformOpDecl | null, message: string, suggestion: string): void => {
    findings.push(h9({ message, location: op?.location ?? port.location, suggestion, grounding: 'implementation', counterexample: { port: port.name, ...(op === null ? {} : { op: op.id, method: op.binding.method }), file: where.file } }));
  };
  const declaration = findExported(module, port.name, isInterface);
  if (declaration === undefined) {
    problem(null, `配線 ${file} が、ポート ${port.name} の interface を export していません`, `export interface ${port.name} { … } を書く(宣言した操作の配線先のメソッドを並べる)`);
    return findings;
  }
  if (!exportedValueNames(file, source).has(portFactoryName(port.name))) {
    problem(null, `配線 ${file} が、ポートの組み立て関数 ${portFactoryName(port.name)} を export していません`, `export function ${portFactoryName(port.name)}(): ${port.name} を書く(生成された入口がこの名前で import する)`);
  }
  for (const op of ops) {
    const signature = declaration.members.filter(ts.isMethodSignature).find((member) => member.name.getText() === op.binding.method);
    if (signature === undefined) {
      problem(op, `操作 ${op.id} の配線先 ${port.name}.${op.binding.method} が ${file} にありません`, `interface ${port.name} にメソッド ${op.binding.method} を足すか、binding.method を実在の名前に直す`);
      continue;
    }
    const wrong = [...checkParams(op, signature), ...(op.binding.result === undefined ? [] : checkReturn(signature, port, op.binding.result))];
    for (const message of wrong) {
      problem(op, `操作 ${op.id} の配線先 ${port.name}.${op.binding.method} が宣言と食い違います: ${message}`, 'binding の params / result を配線先の実際の形に合わせる(または配線先を宣言に合わせる)');
    }
  }
  const read = readReasons(module, port);
  for (const message of read.problems) {
    problem(null, `ポート ${port.name} の結果の union の失敗の理由を安全に読めません: ${message}`, '結果の型を { ok: true; value } | { ok: false; reason: 文字列リテラルの和 } の形にする(広い string・読めない別名は不可。未申告の理由が画面の返り値に出ないことを検査が保証できない)');
  }
  if (read.problems.length === 0) {
    const { reasons } = read;
    const declared = port.refusals.map((refusal) => refusal.reason);
    for (const reason of reasons.filter((candidate) => !declared.includes(candidate))) {
      problem(null, `ポート ${port.name} の結果の union が返す理由 ${reason} が、refusals に宣言されていません(画面に出す文言が無い)`, `platform_ports.${port.name}.refusals に ${reason} と画面に出す文言を足す`);
    }
    for (const reason of declared.filter((candidate) => !reasons.includes(candidate))) {
      problem(null, `ポート ${port.name} の refusals の理由 ${reason} は、結果の union ${port.union.type} が返さない理由です(余剰)`, `refusals から ${reason} を消す(配線先が返さない理由の文言は死んだ宣言になる)`);
    }
  }
  for (const row of port.rows) {
    for (const message of checkRow(module, row)) problem(null, `ポート ${port.name} の${message}`, 'platform_ports の rows を配線先の行の型に合わせる');
  }
  return findings;
}

/**
 * 配線先の実際の形と宣言の突合。
 *
 * @param section `platform_ops` の節
 * @param source 実装の木と置き場の配置
 * @returns 違反のリスト
 */
export function verifyPlatformBindingSource(section: AuthPlatformOps, source: PlatformBindingSource): Finding[] {
  if (section.ops.length === 0) return [];
  const findings: Finding[] = [];
  const ports = [...new Set(section.ops.map((op) => op.binding.port))];
  for (const name of ports) {
    const port = section.ports.find((candidate) => candidate.name === name);
    const ops = section.ops.filter((op) => op.binding.port === name);
    const first = ops[0];
    if (port === undefined || first === undefined) continue; // 宣言の無いポートは対応表の検査が名指す
    const file = layoutPath(source.layout, source.roots.app, 'platform-binding', name);
    if (file === null) {
      findings.push(
        h9({
          message: `配線先のポート ${name} の置き場を、置き場の配置から決められません(実装の木が無い・配置が役割 platform-binding を宣言していない)`,
          location: first.location,
          suggestion: '製品の宣言(roots.app)と、アプリの枠の後段の配置が platform-binding を持つことを確かめる(宣言した配線先が検査されない状態で出荷しない)',
          counterexample: { port: name },
        }),
      );
      continue;
    }
    if (!isFile(path.join(source.repoRoot, file))) {
      findings.push(
        h9({
          message: `配線先のポート ${name} の配線 ${file} がありません`,
          location: first.location,
          suggestion: `${file} に export interface ${name} とその組み立て関数 ${portFactoryName(name)} を手書きする(宣言した操作が呼ぶ配線)`,
          grounding: 'implementation',
          counterexample: { port: name, file },
        }),
      );
      continue;
    }
    findings.push(...checkPort(port, ops, file, readText(path.join(source.repoRoot, file))));
    findings.push(...checkScenario(port, first, file, source.repoRoot));
  }
  return findings;
}

/** 配線の隣の場面(生成テストが import する手書きの `{配線}.scenario`)の実在と export。 */
function checkScenario(port: PlatformPortDecl, op: PlatformOpDecl, bindingFile: string, repoRoot: string): Finding[] {
  const file = bindingFile.replace(/\.ts$/u, '.scenario.ts');
  const name = `${portFactoryName(port.name)}Scenario`;
  const fail = (message: string, suggestion: string): Finding[] => [h9({ message, location: op.location, suggestion, grounding: 'implementation', counterexample: { port: port.name, file } })];
  if (!isFile(path.join(repoRoot, file))) {
    return fail(
      `配線先のポート ${port.name} の生成テストの場面 ${file} がありません`,
      `${file} に、配線の本物の組み立てに偽の部品(実行者・資格・認証基盤の写し)を渡した場面 ${name}(PlatformScenarioFactory)を手書きする(生成テストが権限表・接続・負例をその場面で確かめる)`,
    );
  }
  return exportedValueNames(file, readText(path.join(repoRoot, file))).has(name)
    ? []
    : fail(`生成テストの場面 ${file} が ${name} を export していません`, `export const ${name}: PlatformScenarioFactory<${port.name}> = (spec) => … を書く`);
}
