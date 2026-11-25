/**
 * `src/app/**` のクライアント部品が Server Action を直接呼ぶのを禁止する。
 *
 * 正: docs/rules/process/frontend/system/standards/conventions/action-runner.md
 * 「閉世界」の節。**宣言のあるファイルが `src/app/_actions/**` 配下の関数を呼び出したら**落ちる
 * （`cancelItemAction({ id })` の形）。**import して `<ActionButton action={cancelItemAction}>`
 * のように値として渡すことは禁じない** —— 実行器（`useActionRunner` / `ActionButton` /
 * `ActionForm`）に手渡すこと自体は「経由」であり、`await action(...)` を手で書いて
 * `useState(pending)` / `setError` / `router.refresh()` を自前で回すことだけを塞ぐ。
 *
 * **判定は識別子名でも import 文の形でもない。** `projectService` の型情報を使い、呼び出し式
 * (`CallExpression`)の callee を型チェッカーで解決し、辿り着いた宣言のファイルパスを見る。
 * これにより次の 2 つの「すり抜け」も塞がる（2026-09 裁定。以前は識別子名の追跡だけだった）。
 *
 *   - 別名に代入してから呼ぶ: `const shim = cancelItemAction; shim(input);`
 *   - オブジェクトのプロパティに入れてから呼ぶ: `const w = { run: cancelItemAction }; w.run(input);`
 *
 * どちらも「呼び出し先の関数が最終的にどこで宣言されているか」を型で辿れば、束縛の名前や
 * 経由した式の形に関わらず同じ結論になる。
 */

import ts from "typescript";
import { ESLintUtils } from "@typescript-eslint/utils";

/** Server Action の置き場。宣言ファイルがこの下にあるかどうかだけを見る。 */
const ACTIONS_PATH_SEGMENT = "/src/app/_actions/";

/** 再帰的に辿る間接参照の深さの上限（循環参照・異常に長い連鎖からの安全弁）。 */
const MAX_DEPTH = 8;

/**
 * ファイルパスが Server Action の置き場の配下かどうか。
 *
 * TypeScript のファイルパスは OS を問わず常に `/` 区切りなので、そのまま部分一致で見てよい。
 *
 * @param fileName - `ts.SourceFile.fileName`
 * @returns `src/app/_actions/` 配下なら `true`
 */
function isActionsSourceFile(fileName) {
  return fileName.includes(ACTIONS_PATH_SEGMENT);
}

/**
 * シンボルを alias（`import { x } from '...'` の `x`、`export { x as y }` の `y` 等）の
 * 先まで辿る。alias でなければそのまま返す。
 *
 * @param symbol - 辿る起点のシンボル
 * @param checker - 型チェッカー
 * @returns alias でなくなるまで辿った先のシンボル
 */
function resolveAliasChain(symbol, checker) {
  let current = symbol;
  const seen = new Set();
  while ((current.getFlags() & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current);
    const next = checker.getAliasedSymbol(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * シンボルの宣言が「別の式の値をそのまま持つだけ」のとき、その式を返す。
 *
 * `const shim = xxxAction`（変数）と `{ run: xxxAction }`（プロパティ）の 2 形を見る——
 * どちらも「呼び出し先の実体を、別の名前・別の場所へそのまま横流ししているだけ」であり、
 * 実際に呼ばれる関数の宣言はその式の先にある。
 *
 * @param declaration - シンボルの宣言ノード
 * @returns 横流し元の式（無ければ `undefined`）
 */
function initializerOf(declaration) {
  if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
    return declaration.initializer;
  }
  if (ts.isShorthandPropertyAssignment(declaration)) {
    return declaration.name;
  }
  return undefined;
}

/**
 * シンボルから辿れる「宣言の実体」をすべて集める（alias・変数・プロパティの横流しを再帰的に辿る）。
 *
 * @param symbol - 起点のシンボル（呼び出し式の callee が指すもの）
 * @param checker - 型チェッカー
 * @param seen - 訪問済みシンボル（循環参照ガード）
 * @param depth - 再帰の深さ（`MAX_DEPTH` で打ち切る）
 * @returns `{ fileName, name }` の一覧（横流し元をすべて含む）
 */
function collectOriginDeclarations(symbol, checker, seen = new Set(), depth = 0) {
  if (depth > MAX_DEPTH) return [];
  const resolved = resolveAliasChain(symbol, checker);
  if (seen.has(resolved)) return [];
  seen.add(resolved);

  const origins = [];
  for (const declaration of resolved.getDeclarations() ?? []) {
    origins.push({ fileName: declaration.getSourceFile().fileName, name: resolved.getName() });

    const initializer = initializerOf(declaration);
    if (initializer === undefined) continue;
    const initializerSymbol = checker.getSymbolAtLocation(initializer);
    if (initializerSymbol === undefined) continue;
    origins.push(...collectOriginDeclarations(initializerSymbol, checker, seen, depth + 1));
  }
  return origins;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noDirectActionCall = {
  meta: {
    type: "problem",
    docs: {
      description:
        "宣言が src/app/_actions/** 配下にある関数を直接呼び出すのを禁止し、実行器経由に限定する",
    },
    schema: [],
    messages: {
      directCall:
        "Server Action `{{name}}` を直接呼び出すのは禁止。useActionRunner / ActionButton / ActionForm に渡し、実行器に呼ばせること（action-runner.md）。別名に代入する・オブジェクトのプロパティに入れるなどして経由しても、呼び出し先が同じなら同じ扱いになる。",
    },
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      CallExpression(node) {
        const calleeTsNode = services.esTreeNodeToTSNodeMap.get(node.callee);
        const symbol = checker.getSymbolAtLocation(calleeTsNode);
        if (symbol === undefined) return;

        const hit = collectOriginDeclarations(symbol, checker).find((origin) =>
          isActionsSourceFile(origin.fileName),
        );
        if (hit === undefined) return;

        context.report({ node: node.callee, messageId: "directCall", data: { name: hit.name } });
      },
    };
  },
};
