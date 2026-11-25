/**
 * 「配置 ⇔ 命名」を機械執行するローカルルールの共通部品。
 *
 * 仕様側のドメインイベントID（`{集約}.{操作}`）から実装のファイルパスと export 名が
 * 一意に決まる、という規約（server-actions.md「配置と命名」）をコードで表現する。
 * 変換規則をここ 1 箇所に置き、Server Action 側と operation 側で共有する。
 */

import path from "node:path";

/** 仕様に現れる識別子の書式（snake_case）。`program_item` のような複数語の集約名を含む。 */
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * 仕様の識別子として妥当か（snake_case か）を判定する。
 *
 * @param segment - ファイル名またはディレクトリ名（拡張子を除く）
 * @returns snake_case なら `true`
 */
export function isSpecIdentifier(segment) {
  return SNAKE_CASE.test(segment);
}

/**
 * snake_case を PascalCase に変換する（`program_item` → `ProgramItem`）。
 *
 * @param snake - snake_case の識別子
 * @returns PascalCase の識別子
 */
export function toPascalCase(snake) {
  return snake
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

/**
 * snake_case を camelCase に変換する（`mark_paid` → `markPaid`）。
 *
 * @param snake - snake_case の識別子
 * @returns camelCase の識別子
 */
export function toCamelCase(snake) {
  const pascal = toPascalCase(snake);
  return pascal.length === 0 ? pascal : pascal[0].toLowerCase() + pascal.slice(1);
}

/**
 * 検査対象ファイルのパスを、プロジェクトルート起点の POSIX 形式で返す。
 *
 * ルール本体はパスの構造（`src/app/_actions/{aggregate}/{event}.ts`）だけを見るため、
 * 実行環境ごとに変わる絶対パスと区切り文字をここで吸収する。
 *
 * @param context - ESLint のルールコンテキスト
 * @returns `src/...` から始まる相対パス。区切りは常に `/`
 */
export function relativeSourcePath(context) {
  return path.relative(context.cwd, context.filename).split(path.sep).join("/");
}

/** 名前を持つ export を宣言できる構文の種類。 */
const NAMED_DECLARATIONS = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSDeclareFunction",
]);

/**
 * 実行時の値を公開する export の名前だけを集める（型の再公開は含めない）。
 *
 * 命名規約が縛るのは「呼べるもの」の名前である。`export type { Row }` のような
 * 型の再公開まで縛ると、行の型を宣言した場所から出せなくなるだけで、
 * 仕様 ⇔ 実装の往復には何も寄与しない。
 *
 * @param node - Program ノード
 * @returns 値として公開されている export 名の集合
 */
export function collectExportedValueNames(node) {
  const names = new Set();

  for (const statement of node.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.exportKind === "type") continue;

    const declaration = statement.declaration;
    if (declaration && VALUE_DECLARATIONS.has(declaration.type) && declaration.id) {
      names.add(declaration.id.name);
    }
    if (declaration && declaration.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === "Identifier") names.add(declarator.id.name);
      }
    }
    for (const specifier of statement.specifiers) {
      if (specifier.exportKind === "type") continue;
      const exported = specifier.exported;
      names.add(exported.type === "Identifier" ? exported.name : exported.value);
    }
  }

  return names;
}

/** 値（呼べるもの）を宣言する構文の種類。 */
const VALUE_DECLARATIONS = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSDeclareFunction",
]);

/**
 * モジュールが公開している名前付き export をすべて集める。
 *
 * `export function f`・`export const f =`・`export { f }`・`export { g as f }` の
 * いずれの書き方でも同じ集合になるようにする（規約は名前だけを問うため）。
 *
 * @param node - Program ノード
 * @returns export 名の集合
 */
export function collectExportedNames(node) {
  const names = new Set();

  for (const statement of node.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;

    const declaration = statement.declaration;
    if (declaration && NAMED_DECLARATIONS.has(declaration.type) && declaration.id) {
      names.add(declaration.id.name);
    }
    if (declaration && declaration.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === "Identifier") names.add(declarator.id.name);
      }
    }
    for (const specifier of statement.specifiers) {
      const exported = specifier.exported;
      names.add(exported.type === "Identifier" ? exported.name : exported.value);
    }
  }

  return names;
}
