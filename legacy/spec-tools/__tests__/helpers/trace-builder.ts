/**
 * トレース検証器(A1〜A8)のテスト用ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器のテストはファイル I/O を行わず、
 * 入力をテスト内でリテラル構築する。ここではその定型部分(location の埋め草・
 * 省略可能フィールドの扱い)だけを引き受ける。
 * ドメイン側(SpecModel)の構築は model-builder-v8plus.ts を使う。
 */

import type { ActionComputeExample, ActionSpec, ActionUxOverride, ComputeShape, RetiredTestCaseRef, ScanDecl, TestTagBaselineDecl, UnhandledDecl, UnscannedDecl } from '../../lib/model/trace/types.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import type { GuardEnvRef, EachTagRef, HalfTagRef, TestAnnotation, TestBlockRef, TestScanResult } from '../../lib/testcase/types-scan.js';
import type { TraceInput } from '../../lib/trace/input.js';
import type { CatalogInput } from '../../lib/kernel/input-state.js';
import type { JobCatalogSpec } from '../../lib/model/job/types.js';
import type { SpecModel } from '../../lib/model/types.js';
import type { CoverageClass } from '../../lib/testcase/types.js';
import type { QuerySpec } from '../../lib/model/query/types.js';
import type { GuardServices } from '../../lib/guard/ast.js';
import type { ExternalCatalogSpec, ExternalSpecModel } from '../../lib/model/external/types.js';
import type { DataTableSpecModel } from '../../lib/model/data/types.js';
import { buildTcRegistry } from '../../lib/testcase/registry.js';
import { collectTcEntries } from '../../lib/spec-index/sources.js';
import { specModel } from './model-builder-v8plus.js';
import type { ProductLayout } from '../../lib/model/product/layout.js';
import { TEST_LAYOUT } from './platform.js';
import { TEST_ROOTS } from './product-roots.js';
import { loadedInput, UNSELECTED } from './verify-inputs.js';

/** action_spec 1 件を作る。handles から id・relPath・ファイルパスを既定で導く。 */
export function actionSpec(init: {
  handles: string;
  id?: string;
  input?: readonly string[];
  testCases?: readonly ActionTestCase[];
  /** 欠番にしたテストケース ID(A9 の再利用検出のテスト用)。 */
  retired?: readonly string[];
  /** specs/backend/actions からの相対パス。省略時は handles から導く。 */
  relPath?: string;
  inherits?: string;
  /** 方針の導出の上書き(V14 のテスト用)。`reason` を省略すると reason 無しの宣言になる。 */
  ux?: { confirm: ActionUxOverride['confirm']; reason?: string };
  /** 計算値の宣言(V18 のテスト用)。`{entity}.{field}` → 純関数名。 */
  computes?: Readonly<Record<string, string>>;
  /** 計算が読む事実の宣言(A19 のテスト用)。`{entity}.{field}` → 読む `{entity}.{field}` の並び。 */
  computeReads?: Readonly<Record<string, readonly string[]>>;
  /** 純関数の呼び口の形(例の表のテスト用)。`{entity}.{field}` → shape。省略は facts_input。 */
  computeShapes?: Readonly<Record<string, ComputeShape>>;
  /** 例の表(例の表のテスト用)。`{entity}.{field}` → 行の並び。 */
  computeExamples?: Readonly<Record<string, readonly ActionComputeExample[]>>;
  /** 実行器の選び方(生成に乗らない操作のテスト用)。 */
  runner?: { reason: string };
  /** 作成の持ち主の欄(`owner: {entity}.{field}`。作成者で埋める欄の明示)。 */
  owner?: string;
}): ActionSpec {
  const [machine = '', event = ''] = init.handles.split('.');
  const relPath = init.relPath ?? `${machine}/${event}.md`;
  const file = `docs/specs/backend/actions/${relPath}`;
  return {
    id: init.id ?? `${machine}-${event}-action`,
    handles: { raw: init.handles, machine, event },
    input: (init.input ?? []).map((raw) => {
      const [entity = '', field = ''] = raw.split('.');
      return { raw, entity, field, location: { file, pointer: `input.${raw}` } };
    }),
    computes: Object.entries(init.computes ?? {}).map(([raw, ref]) => {
      const [entity = '', field = ''] = raw.split('.');
      const reads = (init.computeReads?.[raw] ?? []).map((path) => {
        const [readEntity = '', readField = ''] = path.split('.');
        return { raw: path, entity: readEntity, field: readField, location: { file, pointer: `computes.reads.${path}` } };
      });
      return {
        raw,
        entity,
        field,
        ref,
        reads,
        shape: init.computeShapes?.[raw] ?? 'facts_input',
        examples: init.computeExamples?.[raw] ?? [],
        location: { file, pointer: `computes.${raw}` },
      };
    }),
    ...(init.owner === undefined
      ? {}
      : (() => {
          const [entity = '', field = ''] = (init.owner ?? '').split('.');
          return { owner: { raw: init.owner ?? '', entity, field, location: { file, pointer: 'owner' } } };
        })()),
    ...(init.runner === undefined
      ? {}
      : { runner: { kind: 'manual' as const, reason: init.runner.reason, location: { file, pointer: 'runner' } } }),
    errors: { inherits: init.inherits ?? 'common', additional: [] },
    testCases: init.testCases ?? [],
    ...(init.ux === undefined
      ? {}
      : {
          ux: {
            confirm: init.ux.confirm,
            ...(init.ux.reason === undefined ? {} : { reason: init.ux.reason }),
            location: { file, pointer: 'ux' },
          },
        }),
    retired: (init.retired ?? []).map((id): RetiredTestCaseRef => ({
      id,
      location: { file, pointer: `retired.${id}` },
    })),
    exceptions: [],
    relPath,
    location: { file },
  };
}

/** test_cases の 1 件を作る。implementation は `{パス}::{テスト名}` を分解して持たせる。 */
export function testCase(init: {
  id: string;
  implementation: string;
  type?: ActionTestCase['type'];
  specIds?: readonly string[];
  /** 覆う意味クラス。省略すると「covers 未宣言」のケースになる(A7 の判定に寄与しない)。 */
  covers?: readonly CoverageClass[];
  /** 成功として通したロール(A7 のロール義務の判定に使う)。 */
  byRole?: string;
  /** Finding の location.file。省略時は汎用のダミー。 */
  file?: string;
}): ActionTestCase {
  const sep = init.implementation.indexOf('::');
  return {
    id: init.id,
    type: init.type ?? 'unit',
    specIds: init.specIds ?? ['entry.submit'],
    ...(init.covers === undefined ? {} : { covers: init.covers }),
    ...(init.byRole === undefined ? {} : { byRole: init.byRole }),
    implementation: {
      raw: init.implementation,
      file: init.implementation.slice(0, sep),
      testName: init.implementation.slice(sep + 2),
    },
    location: {
      file: init.file ?? 'docs/specs/backend/actions/entry/submit.md',
      pointer: `test_cases.${init.id}`,
    },
  };
}

/** テストコード側のアノテーション 1 件を作る。 */
export function annotation(init: {
  tcId: string;
  file: string;
  testName?: string | null;
  specIds?: readonly string[];
  line?: number;
  decorates?: boolean;
}): TestAnnotation {
  return {
    tcId: init.tcId,
    specIds: init.specIds ?? [],
    testName: init.testName === undefined ? 'テスト名' : init.testName,
    decorates: init.decorates ?? true,
    file: init.file,
    line: init.line ?? 1,
  };
}

/** A4 の免除宣言を作る。 */
export function unhandled(event: string, reason = '未整備のため'): UnhandledDecl {
  return {
    event,
    reason,
    location: { file: 'docs/specs/backend/actions/README.md', pointer: `unhandled.${event}` },
  };
}

/** A10 の走査実装の宣言を作る。`testCases` を渡すとテスト義務(3 段突合)の対象になる。 */
export function scanDecl(
  event: string,
  implementation = 'app/src/operation/entry/close.ts',
  testCases?: readonly ActionTestCase[],
): ScanDecl {
  return {
    event,
    implementation,
    ...(testCases === undefined ? {} : { testCases }),
    location: { file: 'docs/specs/backend/actions/README.md', pointer: `scans.${event}` },
  };
}

/** テストコードの片方だけの注釈(`@spec` はあるが `@tc` が無い行)を作る。 */
export function halfTag(init: { file: string; specIds?: readonly string[]; line?: number }): HalfTagRef {
  return { file: init.file, line: init.line ?? 1, specIds: init.specIds ?? [] };
}

/** A10 の免除宣言を作る。 */
export function unscanned(event: string, reason = '走査は未実装のため'): UnscannedDecl {
  return {
    event,
    reason,
    location: { file: 'docs/specs/backend/actions/README.md', pointer: `unscanned.${event}` },
  };
}

/** A12 の未処理台帳の 1 行を作る。 */
export function testTagBaseline(file: string): TestTagBaselineDecl {
  return {
    file,
    location: { file: 'docs/specs/backend/actions/README.md', pointer: `test_tag_baseline.${file}` },
  };
}

/** app/ の走査結果を作る。available は既定 true。 */
export function scanResult(init: {
  available?: boolean;
  testFiles?: readonly string[];
  annotations?: readonly TestAnnotation[];
  /** `@spec` はあるが `@tc` が無い行(A12 の片方だけの注釈検出のテスト用)。 */
  halfTags?: readonly HalfTagRef[];
  /** `@tc-each` のひな形(A12 のひな形の接地のテスト用)。 */
  eachTags?: readonly EachTagRef[];
  actionFiles?: readonly string[];
  operationFiles?: readonly string[];
  /** 手書きの `guardEnv` が返す鍵(A14 の突合のテスト用)。 */
  guardEnvs?: readonly GuardEnvRef[];
  /** 注釈付きブロックの中身の事実(A16 の突合のテスト用)。 */
  testBlocks?: readonly TestBlockRef[];
  /** assert を含むヘルパの名前(A16 の許容のテスト用)。 */
  assertionHelpers?: readonly string[];
} = {}): TestScanResult {
  return {
    available: init.available ?? true,
    testFiles: init.testFiles ?? [],
    annotations: init.annotations ?? [],
    halfTags: init.halfTags ?? [],
    eachTags: init.eachTags ?? [],
    actionFiles: init.actionFiles ?? [],
    operationFiles: init.operationFiles ?? [],
    guardEnvs: init.guardEnvs ?? [],
    testBlocks: init.testBlocks ?? [],
    assertionHelpers: init.assertionHelpers ?? [],
  };
}

/** 注釈付きブロックの事実を 1 件作る(既定は「assert あり・ループ外」= 健全)。 */
export function testBlock(init: Partial<TestBlockRef> = {}): TestBlockRef {
  return {
    file: init.file ?? 'app/src/operation/__tests__/entry/submit.test.ts',
    tcId: init.tcId ?? 'TC-ENTRY-SUBMIT-001',
    line: init.line ?? 10,
    readable: init.readable ?? true,
    directAssertions: init.directAssertions ?? 1,
    directAssertionsOutsideLoop: init.directAssertionsOutsideLoop ?? init.directAssertions ?? 1,
    calls: init.calls ?? [],
  };
}

/**
 * TraceInput を組み立てる。省略した入力は「空」になる。
 *
 * テストケース ID 台帳は渡された仕様から自動で構築する(検査と台帳が食い違った入力を
 * 作れないようにするため)。仕様種をまたぐ検査を書くときは `queries` に query_spec を渡す。
 */
export function traceInput(init: {
  domain?: SpecModel;
  actions?: readonly ActionSpec[];
  unhandled?: readonly UnhandledDecl[];
  scans?: readonly ScanDecl[];
  unscanned?: readonly UnscannedDecl[];
  testTagBaseline?: readonly TestTagBaselineDecl[];
  tests?: TestScanResult;
  /** 台帳に載せる query_spec(action_spec 以外の仕様種を母集合に含める場合)。 */
  queries?: readonly QuerySpec[];
  /** ガード式のパーサー(A14 のテスト用。省略すると A14 は何も見ない)。 */
  guards?: GuardServices;
  /**
   * 外部連携カタログ(A10 が受信の `emits` を第 3 の発火元として数える)。省略は**未選択**(採っていない)・
   * `available: false` / `catalog: null` は**阻害**(`externalInput` を明示すればそちらが優先)。
   */
  external?: ExternalSpecModel;
  /**
   * テーブル仕様(A15 / A18 / A19 の材料)。省略は**未選択**(採っていない)・`available: false` は**阻害**
   * (`dataTablesInput` を明示すればそちらが優先)。
   */
  dataTables?: DataTableSpecModel;
  /** 外部連携カタログの入力の状態(状態を直接指定する)。 */
  externalInput?: CatalogInput<ExternalCatalogSpec>;
  /** テーブル仕様の入力の状態(状態を直接指定する)。 */
  dataTablesInput?: CatalogInput<DataTableSpecModel>;
  /** ジョブカタログの入力の状態(A13 のテスト用。省略すると未選択 = 採っていない製品)。 */
  jobs?: CatalogInput<JobCatalogSpec>;
  /** 置き場の配置(別の配置で読む側が動くことを見るテスト用。省略は本番と同じ Next.js の置き場)。 */
  layout?: ProductLayout;
} = {}): TraceInput {
  const actions = {
    actions: init.actions ?? [],
    unhandled: init.unhandled ?? [],
    scans: init.scans ?? [],
    unscanned: init.unscanned ?? [],
    testTagBaseline: init.testTagBaseline ?? [],
  };
  const queries = { available: true, queries: init.queries ?? [] };
  return {
    domain: init.domain ?? specModel({}),
    actions,
    tests: init.tests ?? scanResult(),
    roots: TEST_ROOTS,
    layout: init.layout ?? TEST_LAYOUT,
    registry: buildTcRegistry(collectTcEntries({ actions, queries })),
    jobs: init.jobs ?? { state: 'unselected', findings: [] },
    dataTables: init.dataTablesInput ?? tablesInputOf(init.dataTables),
    external: init.externalInput ?? externalInputOf(init.external),
    ...(init.guards === undefined ? {} : { guards: init.guards }),
  };
}

/** テストの書きやすさのための写し: モデルが無ければ未選択・読めていなければ阻害・読めていれば読込済み。 */
function tablesInputOf(model: DataTableSpecModel | undefined): CatalogInput<DataTableSpecModel> {
  if (model === undefined) return UNSELECTED;
  return model.available ? loadedInput(model) : { state: 'blocked', reason: 'missing', findings: [] };
}

/** `tablesInputOf` の外部連携版(カタログが null なら読めない・壊れている)。 */
function externalInputOf(model: ExternalSpecModel | undefined): CatalogInput<ExternalCatalogSpec> {
  if (model === undefined) return UNSELECTED;
  if (!model.available) return { state: 'blocked', reason: 'missing', findings: [] };
  return model.catalog === null ? { state: 'blocked', reason: 'load-failed', findings: [] } : loadedInput(model.catalog);
}
