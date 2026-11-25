/**
 * **実装の木が枠から使うものを閉じた表に限る**(点検 12 回目 B12-1・B12-2)。表と理由は `framework-entries.mjs`。
 *
 * 赤にするもの:
 *   - 表に無い枠のモジュール(`next/script`・`next/cache`・`next/dynamic`・`next/image` …)の import(静的・動的・`require`・`import =`・再 export)
 *   - 表のモジュールの、表に無い名前の値の import(`next/headers` の `draftMode`・`react-dom` の `preinit` …)
 *   - 表のモジュールでも、束縛が読めない形(名前空間の import・動的 import・`require`・再 export・副作用だけの import)
 *   - 表に無い指令(`'use cache'`・`'use cache: private'` …。ファイルの頭でも関数の頭でも)
 *   - Next.js のファイルの規約の、表に無い export(`revalidate`・`fetchCache`・`generateStaticParams` …)と `dynamic` の表に無い値
 *   - 置き場を閉じた名前(`FRAMEWORK_NAME_HOMES`。`cookies`・`headers`)の、置き場の外の import
 *   - `useActionState` の第 3 引数(permalink は `<form action>` になり、水和の前の送信の送り先になる)
 *
 * 型の import は表のモジュールなら名前を問わない(実行時に残らない)。免除の口は作らない(`no-eslint-disable-comment` が止める)。
 * 足すときは表に理由つきの行を足す。
 */

import { moduleOf, stringValue } from "./redirect-sinks.mjs";
import { importOf } from "./require-safe-link.mjs";
import { entryAllows, FRAMEWORK_DIRECTIVES, FRAMEWORK_ENTRIES, FRAMEWORK_NAME_HOMES, isFrameworkModule, SEGMENT_EXPORTS } from "./framework-entries.mjs";

/** `src/app` の下のファイルの規約の名前を取り出す。 */
const SEGMENT_FILE = /(?:^|[\\/])src[\\/]app[\\/](?:.*[\\/])?([a-z-]+)\.tsx?$/u;

/** 値を変えずに包むだけの TS のラッパ。 */
const WRAPPERS = new Set(["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion"]);

/**
 * import の指定子の元の名前。
 *
 * @param {import("estree").ImportSpecifier | import("estree").ImportDefaultSpecifier} specifier - 指定子
 * @returns {string} 名前(既定は `default`)
 */
function importedName(specifier) {
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  return specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
}

/** @type {import("eslint").Rule.RuleModule} */
export const closedFrameworkSurface = {
  meta: {
    type: "problem",
    docs: { description: "枠(Next.js・React)から使うものを閉じた表に限る。表に無いモジュール・名前・指令・ファイルの規約の export は全部赤" },
    schema: [],
    messages: {
      module: "`{{module}}` は枠の閉じた表に無いので使えません。要るなら `framework-entries.mjs` に理由つきの行を足す(要求をまたいで値を持たないか・利用者の値をスクリプトにしないかを書く)。",
      name: "`{{module}}` の `{{name}}` は枠の閉じた表に無いので使えません。要るなら `framework-entries.mjs` に理由つきの行を足す。",
      opaque: "`{{module}}` を{{how}}で引いています。表は名前で閉じるので、名前つきの静的な import で書く。",
      directive: "指令 `{{name}}` は閉じた表に無いので使えません(`'use cache'` の共有のキャッシュは鍵に実行者が入らず、RLS の手前で別の利用者へ値を返す)。",
      home: "`{{module}}` の `{{name}}` は置き場の外では使えません(`cookies` は認証の接続層、`headers` はログの配線とセッションの読みだけ)。要るなら `framework-entries.mjs` の `FRAMEWORK_NAME_HOMES` の行を理由つきで直す。",
      permalink: "`useActionState` の第 3 引数は `<form action>` の送り先になるので渡せません。",
      segmentExport: "ファイルの規約の export `{{name}}` は閉じた表に無いので使えません(`revalidate` などは要求をまたぐ保存になる)。要るなら `framework-entries.mjs` に足す。",
      segmentValue: "`export const {{name}}` の値は閉じた表の字句({{allowed}})だけです。",
    },
  },
  create(context) {
    /**
     * 動的な読み込み・再 export など、名前で閉じられない形を報告する。
     *
     * @param {import("estree").Node} node - 報告の位置
     * @param {string | null} raw - 指定子(字句でなければ null。字句でない形は `no-opaque-module-specifier` が止める)
     * @param {string} how - 報告の言葉
     */
    function checkOpaque(node, raw, how) {
      const module = moduleOf(raw);
      if (module === null || !isFrameworkModule(module)) return;
      const messageId = FRAMEWORK_ENTRIES.has(module) ? "opaque" : "module";
      context.report({ node, messageId, data: { module, how } });
    }

    /**
     * 静的な import を調べる。
     *
     * @param {import("estree").ImportDeclaration} node - import
     */
    function checkImport(node) {
      const module = moduleOf(node.source.value);
      if (module === null || !isFrameworkModule(module)) return;
      const entry = FRAMEWORK_ENTRIES.get(module);
      if (entry === undefined) return context.report({ node, messageId: "module", data: { module } });
      if (node.importKind === "type") return undefined;
      if (node.specifiers.length === 0) return context.report({ node, messageId: "opaque", data: { module, how: "副作用だけの import" } });
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          context.report({ node: specifier, messageId: "opaque", data: { module, how: "名前空間の import" } });
        } else if (specifier.importKind !== "type" && !entryAllows(entry, importedName(specifier))) {
          context.report({ node: specifier, messageId: "name", data: { module, name: importedName(specifier) } });
        } else if (specifier.importKind !== "type" && FRAMEWORK_NAME_HOMES.get(module)?.[importedName(specifier)]?.test(context.filename) === false) {
          context.report({ node: specifier, messageId: "home", data: { module, name: importedName(specifier) } });
        }
      }
      return undefined;
    }

    /**
     * 再 export を調べる(束縛が消えるので、型のほかは全部赤)。
     *
     * @param {import("estree").ExportNamedDeclaration | import("estree").ExportAllDeclaration} node - export
     */
    function checkReexport(node) {
      const raw = node.source?.value;
      if (typeof raw !== "string") return;
      const module = moduleOf(raw);
      if (module === null || !isFrameworkModule(module)) return;
      if (!FRAMEWORK_ENTRIES.has(module)) context.report({ node, messageId: "module", data: { module } });
      else if (node.exportKind !== "type") context.report({ node, messageId: "opaque", data: { module, how: "再 export" } });
    }

    const segment = SEGMENT_EXPORTS.get(SEGMENT_FILE.exec(context.filename)?.[1] ?? "");

    /**
     * ファイルの規約の export の名前を調べる。
     *
     * @param {import("estree").Node} node - 報告の位置
     * @param {string} name - export の名前
     * @param {import("estree").Node | null} value - 字句を見る値(無ければ null)
     */
    function checkSegmentName(node, name, value) {
      if (segment === undefined) return;
      if (!Object.hasOwn(segment, name)) return context.report({ node, messageId: "segmentExport", data: { name } });
      const allowed = segment[name];
      if (allowed === null) return undefined;
      let inner = value;
      while (inner !== null && WRAPPERS.has(inner.type)) inner = inner.expression;
      const text = stringValue(inner);
      if (text === null || !allowed.includes(text)) context.report({ node, messageId: "segmentValue", data: { name, allowed: allowed.join(" / ") } });
      return undefined;
    }

    /**
     * ファイルの規約の、宣言の export を調べる。
     *
     * @param {import("estree").ExportNamedDeclaration} node - export
     */
    function checkSegmentExport(node) {
      if (segment === undefined || node.exportKind === "type") return;
      const declaration = node.declaration;
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type !== "Identifier") context.report({ node: declarator, messageId: "segmentExport", data: { name: "分割代入" } });
          else checkSegmentName(declarator, declarator.id.name, declarator.init ?? null);
        }
      } else if (declaration?.id?.name !== undefined && !/^TS/u.test(declaration.type)) {
        checkSegmentName(declaration, declaration.id.name, null);
      }
      if (node.source !== null && node.source !== undefined) return context.report({ node, messageId: "segmentExport", data: { name: "再 export" } });
      for (const specifier of node.specifiers) {
        const name = specifier.exported.type === "Identifier" ? specifier.exported.name : specifier.exported.value;
        if (specifier.exportKind !== "type") checkSegmentName(specifier, name, null);
      }
      return undefined;
    }

    return {
      ImportDeclaration: checkImport,
      ExportNamedDeclaration(node) {
        checkReexport(node);
        checkSegmentExport(node);
      },
      ExportAllDeclaration(node) {
        checkReexport(node);
        if (segment !== undefined) context.report({ node, messageId: "segmentExport", data: { name: "再 export の全部" } });
      },
      ImportExpression: (node) => checkOpaque(node, stringValue(node.source), "動的 import"),
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") checkOpaque(node, stringValue(node.arguments[0]), "`require`");
        if (node.callee.type === "Identifier" && node.arguments.length >= 3) {
          const binding = importOf(context.sourceCode.getScope(node), node.callee.name);
          if (binding?.module === "react" && binding.imported === "useActionState") context.report({ node, messageId: "permalink" });
        }
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") checkOpaque(node, stringValue(node.moduleReference.expression), "`import =`");
      },
      ExpressionStatement(node) {
        if (typeof node.directive === "string" && !FRAMEWORK_DIRECTIVES.has(node.directive)) {
          context.report({ node, messageId: "directive", data: { name: node.directive } });
        }
      },
    };
  },
};
