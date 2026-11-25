/**
 * 読み取りクエリの「配置 ⇔ 命名」を執行するローカルルール。
 *
 * 規約（ARCH-BE-0016 / queries.md「配置と命名」）は、`query_spec` の `name` から
 * 配線 `src/composition/{aggregate}/queries.ts` の `{camel(name)}Query` と
 * 写像 `src/infrastructure/{aggregate}/queries.ts` の `select{Pascal(name)}` を
 * 機械的に導く、と定める。
 *
 * 書き込み側（action-naming / operation-naming）と違い、1 ファイルに N 本のクエリが並ぶため、
 * パスからは export 名を 1 つに決められない。そこで縛るのは**名前の形**である。
 * これだけでも「配線に写像を置く」「写像に配線を置く」「`getItems` のような
 * 仕様に無い名前を生やす」は落ちる（仕様の `name` との対応は Q6 の @tc 突合が別途見る）。
 *
 * 名前の形だけを見る以上、**名前を持たない export の口**は塞いでおかなければ検査に穴が空く。
 * そのため次の 2 つも落とす。
 * - `export default` … 名前が無いので命名規約の検査を素通りする
 * - `export * from` … 別モジュールの中身（service role を使う実装を含む）を、名前の検査を
 *   受けないまま読み取り経路の入口から公開してしまう
 */

import { collectExportedValueNames, isSpecIdentifier, relativeSourcePath } from "./naming.mjs";

/** 読み取りクエリが置かれる 2 つの層と、そこで許される export 名の形。 */
const QUERY_ROOTS = [
  {
    root: "src/composition/",
    layer: "配線",
    pattern: /^[a-z][A-Za-z0-9]*Query$/,
    shape: "{camelCase(name)}Query",
  },
  {
    root: "src/infrastructure/",
    layer: "写像",
    pattern: /^select[A-Z][A-Za-z0-9]*$/,
    shape: "select{PascalCase(name)}",
  },
];

/** 読み取りクエリのファイル名（1 集約 1 ファイル）。 */
const QUERIES_FILE = "queries.ts";

/**
 * 検査対象かを判定し、対象なら期待する名前の形を返す。
 *
 * @param relativePath - プロジェクトルート起点の POSIX パス
 * @returns 対象外なら `null`、規約違反の配置なら `"bad"`、対象なら期待する形
 */
function classifyQueryPath(relativePath) {
  const target = QUERY_ROOTS.find((candidate) => relativePath.startsWith(candidate.root));
  if (target === undefined) return null;
  if (!relativePath.endsWith(`/${QUERIES_FILE}`)) return null;

  const segments = relativePath.slice(target.root.length).split("/");
  if (segments.length !== 2) return "bad";
  if (!isSpecIdentifier(segments[0])) return "bad";

  return target;
}

/** @type {import("eslint").Rule.RuleModule} */
export const queryNaming = {
  meta: {
    type: "problem",
    docs: {
      description:
        "読み取りクエリのファイル配置と export 名を query_spec の name から導ける形に保つ",
    },
    schema: [],
    messages: {
      badPath:
        "読み取りクエリは src/composition/{aggregate}/queries.ts（配線）と src/infrastructure/{aggregate}/queries.ts（写像）に置くこと（集約は仕様どおりの snake_case）。1 集約 1 ファイルで、仕様のパスから実装の位置が一意に決まる状態を保つ（ARCH-BE-0016）。",
      badName:
        "{{layer}}の export は `{{shape}}` の形にすること（query_spec の name から機械的に導く名前）。違反している export: {{actual}}",
      noDefaultExport:
        "queries.ts に default export を置くのは禁止。名前を持たない export は命名規約の検査をすり抜け、仕様の name から実装を引けなくなる（`{{shape}}` の名前付き export にすること）。",
      noReExport:
        "queries.ts で `export * from` を書くのは禁止。名前の検査をすり抜けたまま別モジュールの中身（service role を使う実装を含む）を読み取り経路の入口から公開してしまう。必要なものだけを名前付きで export すること。",
    },
  },
  create(context) {
    const classified = classifyQueryPath(relativeSourcePath(context));
    if (classified === null) return {};

    return {
      Program(node) {
        if (classified === "bad") {
          context.report({ loc: { line: 1, column: 0 }, messageId: "badPath" });
          return;
        }

        for (const statement of node.body) {
          if (statement.type === "ExportDefaultDeclaration") {
            context.report({
              node: statement,
              messageId: "noDefaultExport",
              data: { shape: classified.shape },
            });
          }
          if (statement.type === "ExportAllDeclaration") {
            context.report({ node: statement, messageId: "noReExport" });
          }
        }

        const violations = [...collectExportedValueNames(node)].filter(
          (name) => !classified.pattern.test(name),
        );
        if (violations.length === 0) return;

        context.report({
          loc: { line: 1, column: 0 },
          messageId: "badName",
          data: {
            layer: classified.layer,
            shape: classified.shape,
            actual: violations.join(", "),
          },
        });
      },
    };
  },
};
