/**
 * 期待するファイル木の生成物(`app/src/domain/generated/structure-expectations.ts`)。
 *
 * 決定性の格上げ ⑥(形の閉世界)。P1〜P4(配置 ⇔ 命名)は「今リンターが見ているファイルが
 * 正しい形か」しか見ておらず、**期待される全ファイルが実在するか**(逆方向)と
 * **それ以外のファイルが紛れ込んでいないか**(閉世界)は誰も見ていなかった。
 *
 * ここでは「独立して起動されるドメインイベント」(action_spec の `handles` か `scans:` の
 * 宣言を持つイベント)から `src/operation/{aggregate}/{event}.ts` の期待を、action_spec
 * (実在する Server Action の仕様)から `src/app/_actions/{aggregate}/{event}.ts` の期待を、
 * query_spec の主エンティティディレクトリから `src/composition/{aggregate}/queries.ts` /
 * `src/infrastructure/{aggregate}/queries.ts` の期待(ファイルの実在のみ。1 ファイル N クエリ
 * なので export 名の閉世界は Q5 が別に見る)を導く。
 *
 * **置き場(`src/operation/…` ・`src/app/_actions/…` ・`src/composition/…` ・保存点の分)は置き場の配置の役割から、製品の根からの相対で引く**(部品化 ③-c4b。上の綴りは
 * いまの Next.js の配置での姿)。保存点の hooks(`src/operation/usecase/…`。手書き)の置き場は、置き場の配置が宣言する土台の表から引く(部品化 ③-c5)。query_spec の主エンティティのディレクトリは、
 * ここでは役割にしていない。
 *
 * 逆方向の突合(期待の実在・対象ディレクトリに期待に無いファイルが無いこと・主 export が 1 つであること)は生成物ではなく
 * `app/src/operation/__tests__/structure/` のテストが行う(ファイルシステムを読む必要があり、docs 側の生成器は I/O をしない規約のため)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import { splitQualified } from '../../model/trace/parse-action-names.js';
import { isSystemOnlyOperation } from '../../usecase/operation-plan-marks.js';
import { frameworkStructureJsonSection, renderFrameworkLines } from './structure-framework.js';
import { screenExpectations } from './structure-screen-expectations.js';
import type { ScreenExpectations } from './structure-screen-expectations.js';
import { twoLevelExpectations } from './structure-platform-expectations.js';
import { inboundExpectations } from './code-inbound-route.js';
import { LAYOUT_DEFINITION_CHECK, placedPath } from '../layout-placement.js';
import type { LayoutRole, ProductLayout } from '../../model/product/layout.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, toCamelCase, toPascalCase, type LiteralValue } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';

/** 生成物の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'structure-expectations.ts');

export type { ExpectedFile } from './structure-usecase-expectations.js';
import type { ExpectedFile } from './structure-usecase-expectations.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/**
 * 全 action_spec + 全ドメインイベント + 全 query_spec から期待ファイル木を生成するジェネレーター。
 * 出力は `app/src/domain/generated/structure-expectations.ts`(全体生成)。
 */
export const structureExpectationsGenerator: DocGenerator = {
  id: 'code-structure-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const operationFiles = operationExpectations(ctx);
    const actionFiles = actionExpectations(model, ctx);
    const compositionFiles = compositionExpectations(ctx);
    const queryDirs = queryDirExpectations(ctx);
    const usecaseFiles = twoLevelExpectations(model, ctx);
    // 受信口は実装の木の中にしか置けない(実装の木を持たない製品は期待ファイルも無い。受信口の生成器と同じ線)。
    const inboundFiles = ctx.roots.app === null ? [] : inboundExpectations(ctx.external?.catalog, ctx.layout);
    const screenFiles = screenExpectations(model, ctx);
    if (operationFiles.length === 0 && actionFiles.length === 0 && queryDirs.length === 0) return [];
    // 仕組みの土台の宣言は仕様の量に依らない(app/ が実在するなら必ず出す)。

    const specFiles = [
      ...new Set([
        ...(ctx.actions?.actions ?? []).map((action) => action.location.file),
        ...(ctx.actions?.scans ?? []).map((scan) => scan.location.file),
        ...(ctx.queries?.queries ?? []).map((query) => query.location.file),
        ...(ctx.screens?.available ? ctx.screens.screens : []).map((screen) => screen.location.file),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile({
          operationFiles,
          actionFiles,
          compositionFiles,
          queryDirs,
          usecaseFiles,
          inboundFiles,
          screenFiles,
          specFiles,
        }, ctx.layout),
        wholeFile: true,
      },
      frameworkStructureJsonSection(ctx.roots, ctx.layout),
    ];
  },
};

/**
 * **手書きが残る**ドメインイベントを `src/operation/{aggregate}/{event}.ts` の期待に写す(P3/P4)。
 *
 * ## 母集合は「宣言された例外」だけである(束 ⑰-3)
 *
 * 操作の実装は実行計画(`operation-plans.ts`)と唯一の実行器(`_template/run-plan.ts`)に
 * なったので、`src/operation/{集約}/` に置くファイルが要るのは 2 つの場合だけである。
 *   - action_spec が `runner: manual` を理由つきで宣言した操作(定型では組み立てられない)
 *   - `scans:` に宣言された走査・システム起点の呼び出し口(人の入口を持たない経路)
 * どちらも仕様側の宣言であり、**宣言の無い操作はここに現れない** —— 現れていれば、それは
 * 生成物の隣に手書きが並んでいるということである(閉世界のテストが落とす)。
 *
 * `by: system` の予約 ID の一部(`entry.confirm` は `workshop.confirm_fees` の RPC が一括で書く
 * 副作用、`member.create` は sign-in の副作用、`public_workshop.create/delete` は掲載遷移が作る
 * 写しなど)はどちらの宣言も持たないため、ここに現れず独立した operation ファイルを要求しない
 * (README.md の `unscanned` に理由が明示されているものはその一例)。
 *
 * 置き場のディレクトリは `handles`(= `scans[].event`)の machine トークンをそのまま使う。
 * **例外表は持たない。** かつて副次状態機械 1 つ(手書きの業務手順が machine とは違う集約の
 * ディレクトリに置かれていたもの)のために ID → ディレクトリ名の対応表を持っていたが、
 * 束 ⑰-3 で手書きの操作が実行計画に置き換わり、その 2 件は母集合(`runner: manual` と
 * `scans:`)から消えて表は死んだ。**仕組み側コードがアプリの集約名を溜める経路**でもあった
 * (実測: 束 ⑱ の題材 A)ので、同じ食い違いが再発したときも表を復活させず、置き場か仕様の
 * どちらかを直す。
 */
function operationExpectations(ctx: GenerateContext): ExpectedFile[] {
  const ids = new Set([
    ...(ctx.actions?.actions ?? [])
      .filter((action) => action.runner !== undefined)
      .map((action) => action.handles.raw),
    ...(ctx.actions?.scans ?? []).map((scan) => scan.event),
  ]);
  return buildExpectations(ctx, [...ids], 'operation-logic', operationExportName);
}

/** operation の期待 export 名(P4)。 */
function operationExportName(aggregate: string, event: string): string {
  return `${toCamelCase(event)}${toPascalCase(aggregate)}`;
}

/**
 * 実在する action_spec の `handles` を `src/app/_actions/{machine}/{event}.ts` の期待に写す(P1/P2)。
 *
 * 母集合は「今ある action_spec」である(網羅は A4 が別に見る)。ただし**システム専用の
 * イベントは除く** —— `by` が system だけのイベントは Server Action の入口を持たない
 * (actions/README.md)。
 */
function actionExpectations(model: SpecModel, ctx: GenerateContext): ExpectedFile[] {
  // システム専用のイベントは落とす —— 生成器(code-operation-app.ts)が同じ判定で生成しない。
  const ids = (ctx.actions?.actions ?? [])
    .map((action) => action.handles.raw)
    .filter((op) => !isSystemOnlyOperation(model, op));
  const exportName = (aggregate: string, event: string) => `${toCamelCase(event)}${toPascalCase(aggregate)}Action`;
  return buildExpectations(ctx, ids, 'operation-entry', exportName);
}

/**
 * 実在する action_spec の `handles` を `src/composition/{集約}/{イベント}.ts` の期待に写す(束 ⑰-2)。
 *
 * 母集合は Server Action と同じ「今ある action_spec」である —— **どの操作にも Composition Root が
 * 1 つある**(生成に乗る操作は生成物、`runner: manual` の操作は手書き。どちらも置き場と主 export の
 * 規約は同じ)。置き場が `handles` の machine トークンと食い違う例外は無い。
 */
function compositionExpectations(ctx: GenerateContext): ExpectedFile[] {
  const ids = (ctx.actions?.actions ?? []).map((action) => action.handles.raw);
  const exportName = (aggregate: string, event: string) => `create${toPascalCase(event)}${toPascalCase(aggregate)}`;
  return buildExpectations(ctx, ids, 'operation-composition', exportName);
}

/**
 * `{machine}.{event}` 形式の ID 群から期待ファイルの一覧を組み立てる共通処理。
 *
 * 置き場は**置き場の配置の役割**(`operation-logic` / `operation-entry` / `operation-composition`)から、**製品の根からの相対**で引く
 * (部品化 ③-c4b。期待ファイル木は製品の根の外を知らない)。置き場は必ず machine トークンそのままである(例外表は持たない。上記 `operationExpectations`)。
 * 実装の木を持たない製品は置き場が無いので期待も無い。配置が役割を解決できなければ前提の失敗で止める(黙って期待を落とさない)。
 */
function buildExpectations(
  ctx: GenerateContext,
  ids: readonly string[],
  role: LayoutRole,
  exportName: (aggregate: string, event: string) => string,
): ExpectedFile[] {
  if (ctx.roots.app === null) return [];
  const location = { file: specPath(ctx.roots, 'backend/actions') };
  const seen = new Map<string, ExpectedFile>();
  for (const id of ids) {
    const parts = splitQualified(id);
    if (parts === null) continue;
    const file = placedPath(ctx.layout, { app: '' }, { role, key: id, what: `操作 ${id} の期待ファイル(${role})`, location, verifier: LAYOUT_DEFINITION_CHECK });
    seen.set(id, { event: id, file, export: exportName(parts.head, parts.tail) });
  }
  return [...seen.values()].sort((a, b) => a.event.localeCompare(b.event));
}

/**
 * query_spec が 1 件以上ある主エンティティ(ディレクトリ)の一覧(Q5)。
 *
 * 1 ファイルに N クエリが並ぶため、期待するのは「配線・写像のファイルが実在すること」だけ
 * (export 名の形の検査は既存の ESLint `layer/query-naming` が担う)。
 */
function queryDirExpectations(ctx: GenerateContext): readonly string[] {
  const dirs = new Set<string>();
  for (const query of ctx.queries?.queries ?? []) {
    const directory = query.relPath.split('/')[0];
    if (directory !== undefined && directory !== '') dirs.add(directory);
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}

/** `ExpectedFile[]` を `renderLiteral` が受け付ける形(名前の無いレコード)に写す。 */
function toLiteralList(files: readonly ExpectedFile[]): LiteralValue {
  return files.map((file) => ({ event: file.event, file: file.file, export: file.export }));
}

/** `renderFile` に渡す期待の束(引数の数を増やさないためにまとめる)。 */
interface ExpectationSet {
  readonly operationFiles: readonly ExpectedFile[];
  readonly actionFiles: readonly ExpectedFile[];
  readonly compositionFiles: readonly ExpectedFile[];
  readonly queryDirs: readonly string[];
  readonly usecaseFiles: readonly ExpectedFile[];
  readonly inboundFiles: readonly ExpectedFile[];
  readonly screenFiles: ScreenExpectations;
  readonly specFiles: readonly string[];
}

/** ファイル全体を組み立てる(`layout` は層と土台の表の宣言元)。 */
function renderFile(sets: ExpectationSet, layout: ProductLayout): string {
  const { operationFiles, actionFiles, compositionFiles, queryDirs, usecaseFiles, inboundFiles, screenFiles, specFiles } =
    sets;
  return [
    generatedHeader(specFiles),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment(['期待ファイル 1 件(ドメインイベント ID・配置パス・期待する主 export 名)。']),
    'export interface ExpectedStructureFile {',
    '  /** `{aggregate}.{event}` 形式のドメインイベント ID(予約 ID を含む)。 */',
    '  readonly event: string;',
    '  /** app/ からの相対パス(`src/{層}/{集約}/{イベント}.ts`)。 */',
    '  readonly file: string;',
    '  /** 期待する主 export 名。 */',
    '  readonly export: string;',
    '}',
    '',
    docComment([
      '全ドメインイベント(状態機械の遷移 + 予約 ID create/delete/update)から導いた',
      '`src/operation/{aggregate}/{event}.ts` の期待の閉世界(P3/P4)。',
      'human/system を問わない —— 業務手順はどちらの起点でも実在する。',
    ]),
    `export const expectedOperationFiles: readonly ExpectedStructureFile[] = ${frozen(renderLiteral(toLiteralList(operationFiles)))};`,
    '',
    docComment([
      '実在する action_spec の `handles` から導いた `src/app/_actions/{aggregate}/{event}.ts` の',
      '期待(P1/P2)。母集合は「今ある action_spec」であり、網羅(足りているか)は A4 が別に見る。',
    ]),
    `export const expectedActionFiles: readonly ExpectedStructureFile[] = ${frozen(renderLiteral(toLiteralList(actionFiles)))};`,
    '',
    docComment([
      '実在する action_spec の `handles` から導いた `src/composition/{集約}/{イベント}.ts` の期待',
      '(束 ⑰-2)。**どの操作にも Composition Root が 1 つある** —— 生成に乗る操作は生成物、',
      '`runner: manual` の操作は手書きであり、置き場と主 export の規約はどちらも同じである。',
    ]),
    `export const expectedCompositionFiles: readonly ExpectedStructureFile[] = ${frozen(renderLiteral(toLiteralList(compositionFiles)))};`,
    '',
    docComment([
      'query_spec が 1 件以上ある主エンティティ(ディレクトリ)の一覧(Q5)。',
      '`src/composition/{aggregate}/queries.ts` と `src/infrastructure/{aggregate}/queries.ts` の',
      '実在だけを期待する(1 ファイル N クエリのため export 名の形は既存の ESLint が別に見る)。',
    ]),
    `export const expectedQueryDirs: readonly string[] = ${frozen(renderLiteral(queryDirs))};`,
    '',
    docComment([
      'usecase_spec の保存点から導いた app 側のファイルの期待(束⑯c)。',
      '`event` は保存点の鍵(`{ユースケース名}.{保存点 ID}`)であり、ドメインイベント ID ではない。',
      'Server Action・composition・1 画面フォームは生成物、hooks は手書き(要る保存点だけ)。',
    ]),
    `export const expectedUsecaseFiles: readonly ExpectedStructureFile[] = ${frozen(renderLiteral(toLiteralList(usecaseFiles)))};`,
    '',
    docComment([
      'external_spec の `direction: inbound` の行から導いた app 側のファイルの期待(束 ⑲-2b)。',
      '`event` は写像されたドメインイベント ID(`emits`)であり、どちらも生成物である。',
    ]),
    `export const expectedInboundFiles: readonly ExpectedStructureFile[] = ${frozen(renderLiteral(toLiteralList(inboundFiles)))};`,
    '',
    docComment(['画面の層の期待(`expectedScreenFiles` の型)。']),
    'export interface ExpectedScreenTree {',
    '  /** `src/app/_screens/generated/` の期待木(`event` は画面名)。 */',
    '  readonly generated: readonly ExpectedStructureFile[];',
    '  /** 手書きの器 `src/app/_screens/{名前}.tsx` が持ってよい名前(画面名を kebab-case にしたもの)。 */',
    '  readonly containers: readonly string[];',
    '}',
    '',
    docComment([
      '画面の層の期待(束 画面 1「骨と口」)。`generated` は `kind: form` の部品 1 つにつき 1 本',
      '(+ 既定のスタイル 1 枚。部品が無ければ 0 件 = `_screens/generated/` は存在しない)。`containers` は手書きの器が',
      '持ってよい名前の母集合で、**持たねばならない名前ではない**(依存が無い画面は器を持たない)。',
    ]),
    `export const expectedScreenFiles: ExpectedScreenTree = ${frozen(renderLiteral({
      generated: toLiteralList(screenFiles.generated),
      containers: [...screenFiles.containers],
    }))};`,
    '',
    ...renderFrameworkLines(layout),
  ].join('\n');
}
