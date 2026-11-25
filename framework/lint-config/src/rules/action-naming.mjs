/**
 * Server Action の「配置 ⇔ 命名」を執行するローカルルール。
 *
 * 規約（server-actions.md「配置と命名」）は、ドメインイベントID `{aggregate}.{event}` から
 * 実装ファイル `src/app/_actions/{aggregate}/{event}.ts` と export 名
 * `{camel(event)}{Pascal(aggregate)}Action` を機械的に導く、と定める。
 *
 * これを人の目で守らせると、仕様IDと実装の対応が静かに壊れる（対応表を作り直さないと
 * 「この仕様はどこに実装されているか」が分からなくなる）。パスと名前の一致だけを
 * 機械が見ることで、grep 一発で仕様 ⇔ 実装を往復できる状態を維持する。
 */

import {
  collectExportedNames,
  isSpecIdentifier,
  relativeSourcePath,
  toCamelCase,
  toPascalCase,
} from "./naming.mjs";

/** Server Action の置き場。この配下は 1 ファイル 1 アクションに固定する。 */
const ACTIONS_ROOT = "src/app/_actions/";

/**
 * 保存点（usecase_spec の `saves[]`）の Server Action の置き場。
 *
 * ドメインイベント 1 つに対応しない（複数の操作を 1 トランザクションで実行する）ため、
 * 集約ではなく**ユースケース名と保存点 ID**から配置と名前を導く（束⑯c）。実体は生成物。
 */
const USECASE_DIR = "usecase";

/**
 * 認証基盤の操作（auth_spec の `platform_ops`。ADR-0019）の Server Action の置き場。
 *
 * これもドメインイベントに対応しない（セッションの一覧・終了など認証基盤の操作）ので、集約ではなく**操作 ID の 2 語**
 * （`{グループ}.{名前}`）から配置と名前を導く（`{camel(グループ)}{Pascal(名前)}Action`）。実体は生成物。
 */
const PLATFORM_DIR = "platform";

/** 2 語のキーから導く置き場（保存点・認証基盤の操作）。 */
const KEYED_DIRS = new Set([USECASE_DIR, PLATFORM_DIR]);

/**
 * パスから集約名とイベント名を取り出す。
 *
 * @param relativePath - プロジェクトルート起点の POSIX パス
 * @returns `{aggregate, event}`。規約どおりの形でなければ `null`
 */
function parseActionPath(relativePath) {
  const segments = relativePath.slice(ACTIONS_ROOT.length).split("/");
  if (segments.length === 3 && KEYED_DIRS.has(segments[0])) {
    const [, usecase, saveFile] = segments;
    const save = saveFile.replace(/\.tsx?$/, "");
    if (save === saveFile) return null;
    if (!isSpecIdentifier(usecase) || !isSpecIdentifier(save)) return null;
    return { aggregate: usecase, event: save, usecase: true };
  }
  if (segments.length !== 2) return null;

  const [aggregate, filename] = segments;
  const event = filename.replace(/\.tsx?$/, "");
  if (event === filename) return null;
  if (!isSpecIdentifier(aggregate) || !isSpecIdentifier(event)) return null;

  return { aggregate, event };
}

/** @type {import("eslint").Rule.RuleModule} */
export const actionNaming = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Server Action のファイル配置と export 名をドメインイベントIDに一致させる",
    },
    schema: [],
    messages: {
      badPath:
        "Server Action は src/app/_actions/{aggregate}/{event}.ts に置くこと（集約とイベントは仕様どおりの snake_case）。ドメインイベントIDから配置が一意に決まらないと、仕様と実装の対応が追えなくなる。",
      missingExport:
        "このファイルは `{{expected}}` という export を持つこと（ドメインイベント {{aggregate}}.{{event}} から機械的に導く名前）。現在の export: {{actual}}",
    },
  },
  create(context) {
    const relativePath = relativeSourcePath(context);
    if (!relativePath.startsWith(ACTIONS_ROOT)) return {};

    const parsed = parseActionPath(relativePath);

    return {
      Program(node) {
        if (parsed === null) {
          context.report({ loc: { line: 1, column: 0 }, messageId: "badPath" });
          return;
        }

        // 保存点はドメインイベントではないので、名前の導き方も違う
        // （`{camel(ユースケース名)}{Pascal(保存点 ID)}Action`）。
        const expected = parsed.usecase
          ? `${toCamelCase(parsed.aggregate)}${toPascalCase(parsed.event)}Action`
          : `${toCamelCase(parsed.event)}${toPascalCase(parsed.aggregate)}Action`;
        const exported = collectExportedNames(node);
        if (exported.has(expected)) return;

        context.report({
          loc: { line: 1, column: 0 },
          messageId: "missingExport",
          data: {
            expected,
            aggregate: parsed.aggregate,
            event: parsed.event,
            actual: exported.size === 0 ? "（なし）" : [...exported].join(", "),
          },
        });
      },
    };
  },
};
