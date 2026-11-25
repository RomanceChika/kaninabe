/**
 * 新規プロジェクト初期化直後(仕様の集約がまだ 1 つも無い)の既知解テスト。
 *
 * BACKLOG「新プロジェクト初期化時の空仕様で generate が成立すること」への対応。
 *
 * `verify-pipeline-canary.test.ts` が「壊れた仕様束を読ませてエラー件数が動いていないか」を
 * 見るのに対し、こちらは逆の極(**仕様がまだ何も無い**)で「エラーにならず完走するか」を見る。
 * 実測で見つかった穴(2026-09-04): `cli/generate-docs.ts` はマーカー差し込み先のファイル
 * (`specs/backend/queries/README.md` のような一覧の置き場)が実在する前提で
 * `readFileSync` していたため、初期化直後(まだ手で作っていない)は ENOENT で generate 全体が
 * 落ちた。`lib/generate/apply-sections.ts` に「対象が無ければ書き込みを飛ばす」を実装して塞いだ
 * ―― このテストはその穴が再発しないことを、CLI と同じ入口(ローダー群 → `testGenerators` →
 * `applyGeneratedSections`)を直接呼んで確かめる(CLI 自体は `import.meta.dirname` から
 * 固定パスを解決するため、フィクスチャを差し替えられない)。
 *
 * fixture(`fixtures/empty-project/domain/roles.md`)は roles.md だけを持つ最小構成。
 * 集約(entity_spec 等)・action_spec・query_spec・screen_spec は 1 つも置かない
 * ―― 「初期化直後、まだ何も仕様化していない」状態そのものである。
 *
 * **`specs/backend/actions` だけはディレクトリを空でも作る。** query_spec 等と違い
 * action_spec の不在(ディレクトリごと無い)は A0 が違反として扱う(意図的な非対称 —
 * `lib/model/query/loader.ts` の doc コメント参照: 「action_spec は全操作の網羅を要求するため、
 * 不在そのものが違反」)。ディレクトリはあるが 0 件は正常系として区別されるため、
 * 「初期化直後の scaffold は空ディレクトリまで作ってある」という前提を置く
 * (`npx create-spec-driven-app` 相当のスキャフォールドが担う仕事)。
 */

import { TEST_PLATFORM, TEST_VERIFY_INPUTS, TEST_LAYOUT } from '../helpers/platform.js';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSpecModel } from '../../lib/model/loader.js';
import { createGuardServices } from '../../lib/guard/services.js';
import { testGenerators } from '../helpers/generators.js';
import { ALL_VERIFIERS } from '../../lib/verify/verifiers/index.js';
import { runAllVerifications } from '../../lib/compose/verify-pipeline.js';
import { loadQuerySpecModel } from '../../lib/model/query/loader.js';
import { loadScreenSpecModel } from '../../lib/model/screen/loader.js';
import { loadDesignTokens } from '../../lib/model/design/loader.js';
import { loadActionSpecModel } from '../../lib/model/trace/loader.js';
import { loadDataTableSpecModel } from '../../lib/model/data/loader.js';
import { loadNotificationSpecModel } from '../../lib/model/notification/loader.js';
import { loadJobSpecModel } from '../../lib/model/job/loader.js';
import { loadConfigSpecModel } from '../../lib/model/config/loader.js';
import { loadAuthSpecModel } from '../../lib/model/auth/loader.js';
import { loadGuaranteeSpecModel } from '../../lib/model/guarantee/loader.js';
import { loadExternalSpecModel } from '../../lib/model/external/loader.js';
import { applyGeneratedSections } from '../../lib/generate/apply-sections.js';
import { writableTreesOf } from '../../lib/generate/write-gate.js';
import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import type { FileSection } from '../../lib/generate/apply-sections.js';
import { TEST_ROOTS, writeProductDeclaration } from '../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../helpers/verify-inputs.js';
import { NO_GATES } from '../helpers/generate-context.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

describe('新規プロジェクト初期化直後の既知解テスト(仕様ゼロで verify / generate が完走する)', () => {
  let repoRoot: string;

  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'empty-project-canary-'));
    // スキャフォールドが置くもの: 製品の根の宣言(これが無いと仕組みは根を決められない)。
    // 仕様ゼロの製品は何も採っていない(置き場の無い種類を採ると P2 が落とす)。
    writeProductDeclaration(repoRoot, []);
    mkdirSync(join(repoRoot, 'docs/specs'), { recursive: true });
    cpSync(join(FIXTURES, 'empty-project/domain'), join(repoRoot, 'docs/specs/domain'), {
      recursive: true,
    });
    // action_spec 以外の backend / frontend カタログは「まだ 1 ファイルも置いていない」を表す
    // ため、作りさえしない(ローダーは `available: false` として区別する。K1 等と同じ流儀)。
    // `backend/actions` だけは上のコメントの理由で空ディレクトリを作る(scaffold 前提)。
    mkdirSync(join(repoRoot, 'docs/specs/backend/actions'), { recursive: true });
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('verify: モデルが構築でき、エラーが 0 件で完走する', async () => {
    const { findings, modelBuilt } = await runAllVerifications({
      ...TEST_VERIFY_INPUTS,
      domainRoot: join(repoRoot, 'docs/specs/domain'),
    });

    expect(modelBuilt).toBe(true);
    expect(findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });

  it('generate: 一覧の置き場(README.md 等)が無くても ENOENT で落ちず完走する', () => {
    const domainRoot = join(repoRoot, 'docs/specs/domain');
    const { model, findings } = loadSpecModel(domainRoot, { repoRoot });
    expect(model, `モデル構築に失敗: ${JSON.stringify(findings)}`).not.toBeNull();
    if (model === null) return;

    const load = (relative: string) => join(repoRoot, 'docs/specs', relative);
    const queries = loadQuerySpecModel(load('backend/queries'), { repoRoot }).model;
    const screens = loadScreenSpecModel(load('frontend'), { repoRoot, roots: TEST_ROOTS, layout: TEST_LAYOUT }).model;
    const design = loadDesignTokens(load('frontend/design'), { repoRoot }).model;
    const actions = loadActionSpecModel(load('backend/actions'), { repoRoot }).model;
    const dataTables = loadDataTableSpecModel(load('backend/data/tables'), { repoRoot }).model;
    const notifications = loadNotificationSpecModel(load('backend/notifications.md'), { repoRoot }).model;
    const jobs = loadJobSpecModel(load('backend/jobs.md'), { repoRoot }).model;
    const config = loadConfigSpecModel(load('backend/config.md'), { repoRoot }).model;
    const auth = loadAuthSpecModel(load('backend/auth.md'), { repoRoot }).model;
    const guarantees = loadGuaranteeSpecModel(load('backend/guarantees.md'), { repoRoot }).model;
    const external = loadExternalSpecModel(load('backend/external.md'), { repoRoot }).model;

    const ctx: GenerateContext = {
      guards: createGuardServices(),
      roots: TEST_ROOTS,
      platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      queries,
      screens,
      design,
      dataTables,
      notifications,
      jobs,
      config,
      auth,
      guarantees,
      external,
      ...(actions === null ? {} : { actions }),
      book: {},
    };

    const verifyErrors = ALL_VERIFIERS.flatMap((v) => v.verify(model, { roots: TEST_ROOTS, guards: ctx.guards, ...NO_DOMAIN_INPUTS })).filter(
      (f) => f.severity === 'error',
    );
    expect(verifyErrors).toEqual([]);

    const byFile = new Map<string, FileSection[]>();
    for (const gen of testGenerators()) {
      for (const section of gen.generate(model, ctx)) {
        const list = byFile.get(section.file) ?? [];
        list.push(section);
        byFile.set(section.file, list);
      }
    }

    // ここが実穴だった行(2026-09-04 実測): 修正前はこの呼び出しが ENOENT を投げていた。
    expect(() => applyGeneratedSections(byFile, repoRoot, { check: false, trees: writableTreesOf(TEST_ROOTS, { ownFrameworkTree: false }) })).not.toThrow();
  });
});
