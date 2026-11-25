/**
 * guarantee_spec(保証台帳)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器・生成器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・語彙の既定)を引き受ける。
 */

import type { GuaranteeCatalogSpec, GuaranteeDecl, GuaranteeSpecModel } from '../../lib/model/guarantee/types.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import { loc } from './model-builder.js';

/** カタログの仕様ファイル(location に使う)。 */
const CATALOG_FILE = 'docs/specs/backend/guarantees.md';

/** 仕組みの台帳の仕様ファイル(location に使う)。 */
const FRAMEWORK_CATALOG_FILE = 'framework/guarantees.md';

/** テスト用のテストケース宣言を 1 件作る。`implementation` は `{パス}::{テスト名}` 形式。 */
export function guaranteeTestCase(
  id: string,
  implementation = 'app/src/infrastructure/__tests__/guarantees/example.test.ts::突合',
): ActionTestCase {
  const sep = implementation.indexOf('::');
  return {
    id,
    type: 'integration',
    specIds: ['guarantee-catalog'],
    covers: ['forbidden'],
    implementation: {
      raw: implementation,
      file: implementation.slice(0, sep),
      testName: implementation.slice(sep + 2),
    },
    location: loc(CATALOG_FILE, `test_cases.${id}`),
  };
}

/** 保証 1 件を作る。既定は「enforced・見張りテスト 1 件」。 */
export function guarantee(
  id: string,
  opts: Partial<Omit<GuaranteeDecl, 'id' | 'location'>> = {},
): GuaranteeDecl {
  const status = opts.status ?? 'enforced';
  const base = {
    id,
    label: opts.label ?? `${id} の言い切り`,
    enforcedBy: opts.enforcedBy ?? ['rls'],
    status,
    summary: opts.summary ?? `${id} の説明`,
    location: loc(CATALOG_FILE, `guarantees.${id}`),
  };
  if (status === 'enforced') {
    return { ...base, canaries: opts.canaries ?? [`TC-GUAR-${id.toUpperCase()}-001`] };
  }
  return { ...base, plannedReason: opts.plannedReason ?? 'まだ着手していないため' };
}

/**
 * カタログ 1 件を作る。語彙はビルダーの既定値を全部含む。
 * `testCases` を省略すると、宣言された canaries から既定の実装参照で 1 件ずつ作る
 * (canaries が 1 つも無ければダミーの 1 件を置く — test_cases は空を許さないため)。
 */
export function guaranteeCatalog(
  guarantees: readonly GuaranteeDecl[],
  testCases?: readonly ActionTestCase[],
  id = 'guarantee-catalog',
): GuaranteeCatalogSpec {
  const canaries = guarantees.flatMap((decl) => decl.canaries ?? []);
  return {
    id,
    vocabulary: {
      enforcer: [{ id: 'rls', label: '行単位セキュリティ(Postgres RLS)' }, { id: 'grant' }, { id: 'verifier' }],
    },
    guarantees,
    testCases:
      testCases ??
      (canaries.length === 0 ? [guaranteeTestCase('TC-GUAR-EXAMPLE-001')] : canaries.map((id) => guaranteeTestCase(id))),
    location: loc(CATALOG_FILE),
  };
}

/** GuaranteeSpecModel を作る。 */
export function guaranteeModel(
  guarantees: readonly GuaranteeDecl[],
  opts: { available?: boolean; testCases?: readonly ActionTestCase[] } = {},
): GuaranteeSpecModel {
  return { available: opts.available ?? true, catalog: guaranteeCatalog(guarantees, opts.testCases) };
}

/**
 * 仕組みの台帳のテストケース宣言を 1 件作る(`spec_ids` は仕組みの台帳自身の id)。
 * `implementation` は仕組みの根からの相対パスの `{パス}::{テスト名}`。
 */
export function frameworkTestCase(
  id: string,
  implementation = 'framework/runtime/src/domain/__tests__/example.test.ts::突合',
): ActionTestCase {
  const base = guaranteeTestCase(id, implementation);
  return { ...base, specIds: ['framework-guarantee-catalog'], location: loc(FRAMEWORK_CATALOG_FILE, `test_cases.${id}`) };
}

/**
 * 仕組みの台帳のモデルを作る(文書 ID は `framework-guarantee-catalog`)。
 * 保証は `fw_` 始まり・テストケースは `TC-FW-` 始まりで渡す(名前空間は Z0 の担当で、ここでは検査しない)。
 */
export function frameworkGuaranteeModel(
  guarantees: readonly GuaranteeDecl[],
  opts: { testCases?: readonly ActionTestCase[] } = {},
): GuaranteeSpecModel {
  const canaries = guarantees.flatMap((decl) => decl.canaries ?? []);
  return {
    available: true,
    catalog: guaranteeCatalog(
      guarantees,
      opts.testCases ?? canaries.map((id) => frameworkTestCase(id)),
      'framework-guarantee-catalog',
    ),
  };
}
