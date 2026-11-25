/**
 * operation 関数の「配置 ⇔ 命名」を執行するローカルルール。
 *
 * Server Action 側（action-naming）と対になる規約。ドメインイベントID
 * `{aggregate}.{event}` に対して、業務手順は `src/operation/{aggregate}/{event}.ts` の
 * `{camel(event)}{Pascal(aggregate)}` として置く（server-actions.md「配置と命名」の表）。
 *
 * Server Action は薄い受け口でしかないため、仕様の意味が乗っているのはこちら側である。
 * 名前が揃っていれば `submitEntryAction` → `submitEntry` → `docs/specs/.../entry/submit.md`
 * を機械的にたどれる。
 *
 * 集約に属さない横断的なモジュール（`src/operation/*.ts`。`ports.ts` や共有ヘルパ）は
 * ドメインイベントに対応しないため対象外。仕組みの土台ディレクトリ（`_template/`・`shared/`・
 * `jobs/` 等。一覧の正は生成物 `framework-structure.json`）の配下も同様に除外する。
 *
 * **その生成物は製品の所有物なので、ここは読まない** —— 規則は `@kaninabe/lint-config`（仕組み）に
 * 住み、`framework-structure.json`（製品の生成物）は製品の `eslint.config.mjs` が
 * `createOperationNaming()` に渡す。仕組みが製品を読む向きを作らないための裏返しである
 * （設計メモ `docs/design/runtime-package.md` §3-2 と同じ形）。
 */

import {
  collectExportedNames,
  isSpecIdentifier,
  relativeSourcePath,
  toCamelCase,
  toPascalCase,
} from "./naming.mjs";

/** operation 層の名前と置き場。 */
const OPERATION_LAYER = "operation";
const OPERATION_ROOT = `src/${OPERATION_LAYER}/`;

/**
 * operation 層の直下にある土台ディレクトリの名前を、宣言から並び方で絞って引く。
 *
 * @param frameworkStructure - 製品が渡す構造の宣言（生成物 `framework-structure.json`）
 * @param layout - "flat"（直下にファイル）か "nested"（1 段のサブディレクトリの下）
 * @returns ディレクトリ名の配列
 */
function operationBaseDirs(frameworkStructure, layout) {
  return frameworkStructure.baseDirs
    .filter((entry) => entry.root === "product")
    .filter((entry) => entry.path.startsWith(OPERATION_ROOT) && entry.layout === layout)
    .map((entry) => entry.path.slice(OPERATION_ROOT.length).split("/")[0]);
}

/**
 * 分類に要る 3 つの集合を、製品が渡した宣言から 1 度だけ組む。
 *
 * - `nonEventFiles`: 集約直下でもドメインイベントに対応しないファイル（正は `auxFiles`。
 *   現状は IF 宣言だけ）。読み取りの `queries.ts` はここに載せない —— 読み取りは operation を
 *   経由せず、写像は `src/infrastructure/{aggregate}/queries.ts` に置く（ARCH-BE-0016）ので、
 *   operation 配下に現れたら層の割り当ての誤りとして検出したい。
 * - `nonAggregateDirs`: 集約ではないディレクトリ（`_template` / `shared` / `jobs` 等）。
 *   どれもドメインイベントに 1 対 1 で対応せず、イベント ID からの命名導出が成り立たない。
 * - `nestedDirs`: 直下にサブディレクトリを持つ土台（保存点の置き場）。保存点の不変条件
 *   チェックはドメインイベント 1 つに対応しないので、**ユースケース名と保存点 ID** から
 *   配置と名前を導く（束⑯c）。
 *
 * **一覧をここに持たない。** 正は 1 つの宣言（`legacy/spec-tools/lib/model/framework-dirs.ts`）で、
 * 同じ事実を X1・A11・W1・構造テストもそこから引く。
 *
 * @param frameworkStructure - 製品が渡す構造の宣言（生成物 `framework-structure.json`）
 * @returns 分類に使う 3 つの集合
 */
function operationDirs(frameworkStructure) {
  return {
    nonEventFiles: new Set(
      frameworkStructure.auxFiles
        .filter((entry) => entry.layer === OPERATION_LAYER)
        .map((entry) => entry.file.replace(/\.tsx?$/, "")),
    ),
    nonAggregateDirs: new Set(operationBaseDirs(frameworkStructure, "flat")),
    nestedDirs: new Set(operationBaseDirs(frameworkStructure, "nested")),
  };
}

/**
 * パスを分類する。
 *
 * @param relativePath - プロジェクトルート起点の POSIX パス
 * @param dirs - `operationDirs()` が組んだ 3 つの集合
 * @returns 検査対象なら `{aggregate, event}`、対象外なら `"skip"`、規約違反の配置なら `"bad"`
 */
function classifyOperationPath(relativePath, dirs) {
  const segments = relativePath.slice(OPERATION_ROOT.length).split("/");

  // 集約に属さない横断的なモジュール（src/operation/ports.ts 等）。
  if (segments.length === 1) return "skip";
  if (dirs.nestedDirs.has(segments[0])) {
    if (segments.length !== 3) return "bad";
    const [, usecase, saveFile] = segments;
    const save = saveFile.replace(/\.tsx?$/, "");
    if (save === saveFile) return "bad";
    if (!isSpecIdentifier(usecase) || !isSpecIdentifier(save)) return "bad";
    return { aggregate: usecase, event: save, suffix: "Hooks" };
  }
  if (dirs.nonAggregateDirs.has(segments[0])) return "skip";
  if (segments.length > 2) return "bad";

  const [aggregate, filename] = segments;
  const event = filename.replace(/\.tsx?$/, "");
  if (event === filename) return "bad";
  if (dirs.nonEventFiles.has(event)) return "skip";
  if (!isSpecIdentifier(aggregate) || !isSpecIdentifier(event)) return "bad";

  return { aggregate, event };
}

/**
 * 規則を組む（製品が構造の宣言を渡す）。
 *
 * @param frameworkStructure - 製品の生成物 `framework-structure.json` の中身
 * @returns ESLint の規則
 */
export function createOperationNaming(frameworkStructure) {
  const dirs = operationDirs(frameworkStructure);
  /** @type {import("eslint").Rule.RuleModule} */
  return {
    meta: {
    type: "problem",
    docs: {
      description:
        "operation 関数のファイル配置と export 名をドメインイベントIDに一致させる",
    },
    schema: [],
    messages: {
      badPath:
        "業務手順は src/operation/{aggregate}/{event}.ts に置くこと（集約とイベントは仕様どおりの snake_case）。集約に属さない共有物は src/operation/ 直下か src/operation/shared/ に、4 形の定型そのものは src/operation/_template/ に置く。",
      missingExport:
        "このファイルは `{{expected}}` という export を持つこと（ドメインイベント {{aggregate}}.{{event}} から機械的に導く名前）。現在の export: {{actual}}",
    },
  },
  create(context) {
    const relativePath = relativeSourcePath(context);
    if (!relativePath.startsWith(OPERATION_ROOT)) return {};

    const classified = classifyOperationPath(relativePath, dirs);
    if (classified === "skip") return {};

    return {
      Program(node) {
        if (classified === "bad") {
          context.report({ loc: { line: 1, column: 0 }, messageId: "badPath" });
          return;
        }

        const expected =
          classified.suffix === "Hooks"
            ? `${toCamelCase(classified.aggregate)}${toPascalCase(classified.event)}Hooks`
            : `${toCamelCase(classified.event)}${toPascalCase(classified.aggregate)}`;
        const exported = collectExportedNames(node);
        if (exported.has(expected)) return;

        context.report({
          loc: { line: 1, column: 0 },
          messageId: "missingExport",
          data: {
            expected,
            aggregate: classified.aggregate,
            event: classified.event,
            actual: exported.size === 0 ? "（なし）" : [...exported].join(", "),
          },
        });
      },
    };
  },
  };
}
