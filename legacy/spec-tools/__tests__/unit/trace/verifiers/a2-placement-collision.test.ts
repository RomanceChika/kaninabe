/**
 * A2(続き)操作・保存点・フォームの置き場の取り合い(`lib/trace/verifiers/a2-placement-collision.ts` と、主張を集める `lib/trace/placement-claims.ts`)のテスト。
 *
 * 固定するのは 5 点 —— ①実物の形(操作・保存点・受信の配線が別々の置き場を取る)では取り合いが無い(いまの製品と 6 題材で 0 件は `npm run verify` が見る)
 * ②**組み立ての根の層の下で、集約名 `inbound` のイベント `x` と連携 ID `x` の受信の配線が同じパスを取る反例**(M5)③層の土台のディレクトリと同じ集約名は、辿れない置き場として指す
 * ④主張の集め方(`runner: manual` は持ち主が製品・システム専用のイベントは入口を持たない・使えなかった入力の主張は作らない・実装の木が無ければ見ない)⑤別の配置(架空の値)でも同じ検査が動く。
 */

import { describe, expect, it } from 'vitest';
import { operationAppGenerator } from '../../../../lib/generate/render/code-operation-app.js';
import { inboundRouteGenerator } from '../../../../lib/generate/render/code-inbound-route.js';
import { usecaseAppGenerator } from '../../../../lib/generate/render/code-usecase-app.js';
import { usecaseFormGenerator } from '../../../../lib/generate/render/code-usecase-form.js';
import type { ProductLayout } from '../../../../lib/model/product/layout.js';
import { formFileNameFor, saveIdFor } from '../../../../lib/usecase/save-names.js';
import { verifyPlacementCollision } from '../../../../lib/trace/verifiers/a2-placement-collision.js';
import type { PlacementCollisionInput } from '../../../../lib/trace/verifiers/a2-placement-collision.js';
import {
  FORM_GENERATOR_ID,
  INBOUND_GENERATOR_ID,
  OPERATION_APP_GENERATOR_ID,
  placementClaimsOf,
  SAVE_APP_GENERATOR_ID,
} from '../../../../lib/trace/placement-claims.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { aggregate, event, machine, specModel } from '../../../helpers/model-builder-v8plus.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { ExternalCatalogSpec } from '../../../../lib/model/external/types.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import type { UsecaseSpecModel } from '../../../../lib/model/usecase/types.js';
import { runTrace } from '../../../../lib/verify/pipeline-trace.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';

/** 受信の連携 1 件(`emits` は問わない)。 */
function inbound(id: string) {
  return integration(id, { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'HOOK_SECRET', eventIdTable: 'inbound_events', emits: 'inbound.noop', effect: 'read', degrade: 'refuse' });
}

/** 取り合いの検査の入力(既定は Next.js の置き場・実装の木あり・何も主張しない)。 */
function input(init: Partial<PlacementCollisionInput> & { handles?: readonly string[]; runner?: readonly string[]; integrations?: readonly string[]; saves?: boolean } = {}): PlacementCollisionInput {
  const { handles = [], runner = [], integrations = [], saves = false, ...rest } = init;
  return {
    domain: specModel({}),
    actions: {
      actions: [...handles.map((h) => actionSpec({ handles: h })), ...runner.map((h) => actionSpec({ handles: h, runner: { reason: '定型では組み立てられない' } }))],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    usecases: saves
      ? { available: true, usecases: [usecaseSpec({ name: 'demo', saves: [usecaseSave('register', [usecaseStep('a.create')], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })] })] }
      : undefined,
    external: integrations.length === 0 ? undefined : externalCatalog(integrations.map(inbound)),
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
    ...rest,
  };
}

describe('A2(続き)置き場の取り合い', () => {
  it('実物の形(操作・保存点・フォーム・受信の配線)は別々の置き場を取り、取り合いは無い', () => {
    expect(verifyPlacementCollision(input({ handles: ['entry.submit', 'entry.create'], runner: ['item.tune'], integrations: ['billing_hook'], saves: true }))).toEqual([]);
  });

  it('反例(M5): 集約名 inbound のイベントと連携 ID が同じなら、組み立ての根の層の下で受信の配線と同じパスを取る(取り合い + 土台のディレクトリと混ざる置き場)', () => {
    const findings = verifyPlacementCollision(input({ handles: ['inbound.billing_hook'], integrations: ['billing_hook'] }));

    expect(findings.map((finding) => finding.counterexample?.['kind']).sort()).toEqual(['duplicate_path', 'not_reachable']);
    const clash = findings.find((finding) => finding.counterexample?.['kind'] === 'duplicate_path');
    expect(clash?.verifier).toBe('A2');
    expect(clash?.severity).toBe('error');
    expect(clash?.message).toContain('実装の置き場が衝突しています');
    expect(clash?.message).toContain('composition/inbound/billing_hook.ts');
    expect(clash?.counterexample?.['sources']).toBe('操作 inbound.billing_hook の組み立ての根 / 外部連携 billing_hook の受信の配線');
    // 位置は取り合っている主張の最初の出どころ(操作の仕様)。
    expect(clash?.location.file).toContain('backend/actions/');
    const unreachable = findings.find((finding) => finding.counterexample?.['kind'] === 'not_reachable');
    expect(unreachable?.message).toContain('実装の置き場を決められません');
  });

  it('層の土台のディレクトリと同じ集約名(ジョブの配線 jobs ・保存点 usecase ・手書きの共有の配線 shared ・テスト支援 __tests__)は、操作の組み立ての根として読めない置き場として指す', () => {
    // `shared` は土台の表に載せていない手書きの置き場(`unlistedDirs`)。表から導く除外に入っている(以前は構造だけで読み、`shared.*` が操作 ID に読まれた)。
    for (const handles of ['jobs.run', 'usecase.register', 'shared.confirm_due_workshops', '__tests__.run']) {
      const findings = verifyPlacementCollision(input({ handles: [handles] }));
      expect(findings.map((finding) => finding.counterexample?.['kind']), handles).toEqual(['not_reachable']);
      expect(findings[0]?.message, handles).toContain(`操作 ${handles} の組み立ての根`);
    }
  });

  it('別の配置(架空の値)でも同じ検査が動く: 組み立ての根の置き場を共有する配置では、別々の仕様が同じファイルを取る', () => {
    const shared: ProductLayout = {
      ...FOREIGN_LAYOUT,
      'composition-root': { ...(FOREIGN_LAYOUT['composition-root'] ?? failMissing()), place: (id) => `wiring/ops/${id}.wire.ts`, module: (id) => `~srv/wiring/ops/${id}.wire` },
    };

    expect(verifyPlacementCollision(input({ layout: FOREIGN_LAYOUT, handles: ['inbound.hook'], integrations: ['inbound__hook'] }))).toEqual([]);
    const findings = verifyPlacementCollision(input({ layout: shared, handles: ['inbound.hook'], integrations: ['inbound__hook'] }));
    expect(findings.map((finding) => finding.counterexample?.['kind'])).toEqual(['duplicate_path']);
    expect(findings[0]?.message).toContain('wiring/ops/inbound__hook.wire.ts');
  });

  it('配置が組み立ての根の役割を宣言していなければ、置き場を決められないとして指す(黙って通さない)', () => {
    const { 'operation-composition': _removed, ...without } = NEXTJS_LAYOUT;
    const findings = verifyPlacementCollision(input({ layout: without, handles: ['entry.submit'] }));

    expect(findings.map((finding) => finding.counterexample?.['kind'])).toEqual(['unknown_role']);
    expect(findings[0]?.message).toContain('実装の置き場を決められません');
  });

  it('実装の木を持たない製品(roots.app が null)は置き場が無いので見ない', () => {
    expect(verifyPlacementCollision(input({ roots: { ...TEST_ROOTS, app: null }, handles: ['inbound.billing_hook'], integrations: ['billing_hook'] }))).toEqual([]);
  });
});

describe('主張の集め方(placementClaimsOf)', () => {
  const domain = specModel({
    aggregates: [aggregate({ name: 'widget', stateMachines: [machine({ machine: 'widget', states: ['a', 'b'], events: [event({ id: 'tick', from: ['a'], to: 'b', by: ['system'] }), event({ id: 'press', from: ['a'], to: 'b', by: ['member'] })] })] })],
  });
  const claimsOf = (ops: readonly string[], runnerOps: readonly string[] = []) =>
    placementClaimsOf({ ...input({ domain, handles: ops, runner: runnerOps }), usecases: undefined, external: undefined }).claims.map((claim) => `${claim.role}:${claim.key}:${claim.owner}`);

  it('操作 1 つにつき入口と組み立ての根。持ち主は操作の生成器(`runner: manual` なら製品)', () => {
    expect(claimsOf(['widget.press'])).toEqual([`operation-entry:widget.press:${OPERATION_APP_GENERATOR_ID}`, `operation-composition:widget.press:${OPERATION_APP_GENERATOR_ID}`]);
    expect(claimsOf([], ['widget.press'])).toEqual(['operation-entry:widget.press:product', 'operation-composition:widget.press:product']);
  });

  it('システム専用のイベントは入口を持たない(Server Action を生成しない)ので、組み立ての根だけを主張する', () => {
    expect(claimsOf(['widget.tick'])).toEqual([`operation-composition:widget.tick:${OPERATION_APP_GENERATOR_ID}`]);
  });

  it('保存点 1 つにつき入口・組み立ての根・フォーム、受信の連携 1 件につき配線。使えなかった入力(未指定・available: false・outbound)の主張は作らない', () => {
    const full = placementClaimsOf(input({ saves: true, integrations: ['billing_hook'] }));
    expect(full.claims.map((claim) => `${claim.role}:${claim.key}:${claim.owner}`)).toEqual([
      `save-entry:demo.register:${SAVE_APP_GENERATOR_ID}`,
      `save-composition:demo.register:${SAVE_APP_GENERATOR_ID}`,
      `ui-component:demo.register-form.tsx:${FORM_GENERATOR_ID}`,
      `composition-root:billing_hook:${INBOUND_GENERATOR_ID}`,
    ]);
    expect(placementClaimsOf({ ...input({ saves: true }), usecases: { available: false, usecases: [] } }).claims).toEqual([]);
    expect(placementClaimsOf({ ...input(), external: externalCatalog([integration('notice')]) }).claims).toEqual([]);
  });

  it('出どころの文面から仕様の位置を引ける', () => {
    const claims = placementClaimsOf(input({ handles: ['entry.submit'], saves: true, integrations: ['billing_hook'] }));
    for (const claim of claims.claims) expect(claims.locations.get(claim.source), claim.source).toBeDefined();
  });

  it('保存点のキーの組み立ては生成器と同じ(生成器が使う口を共有する)', () => {
    expect(saveIdFor('demo', 'register')).toBe('demo.register');
    expect(formFileNameFor('demo', 'register')).toBe('demo.register-form.tsx');
  });

  it('持ち主の生成器の ID は、実在の生成器の ID と同じ(食い違えば赤)', () => {
    expect(OPERATION_APP_GENERATOR_ID).toBe(operationAppGenerator.id);
    expect(SAVE_APP_GENERATOR_ID).toBe(usecaseAppGenerator.id);
    expect(FORM_GENERATOR_ID).toBe(usecaseFormGenerator.id);
    expect(INBOUND_GENERATOR_ID).toBe(inboundRouteGenerator.id);
  });
});

describe('実行口(runTrace): 取り合いの違反が A 群の結果に載り、外部連携が阻害のときは見ていないことを 1 行で言う', () => {
  /** 受信の連携との取り合いが起きる操作 1 件で、実行口を通す(app/ は無い環境。ここで見るのは取り合いの検査の起動と報告だけ)。 */
  function run(external: CatalogInput<ExternalCatalogSpec>) {
    const base = traceInput({ actions: [actionSpec({ handles: 'inbound.billing_hook' })] });
    const lines: string[] = [];
    const result = runTrace(
      {
        model: base.domain,
        domainRoot: '/nonexistent/docs/specs/domain',
        actions: loadedInput(base.actions),
        registry: base.registry,
        jobs: UNSELECTED,
        dataTables: base.dataTables,
        guards: createGuardServices(),
        external,
        roots: TEST_ROOTS,
        layout: TEST_LAYOUT,
        usecases: UNSELECTED,
      },
      (line) => lines.push(line),
    );
    return { lines, kinds: result.findings.filter((finding) => finding.verifier === 'A2').map((finding) => finding.counterexample?.['kind']) };
  }

  it('外部連携が読込済みなら、取り合いが A2 の違反として載る。行は増えない', () => {
    const { lines, kinds } = run(loadedInput(externalCatalog([inbound('billing_hook')])));

    expect(kinds.sort()).toEqual(['duplicate_path', 'not_reachable']);
    expect(lines.some((line) => line.startsWith('A2(続き'))).toBe(false);
  });

  it('外部連携が阻害なら、受信の配線の主張は作れない(取り合いは出ない)ので、見ていないことを行で言う。未選択は事実なので何も言わない', () => {
    const blocked = run({ state: 'blocked', reason: 'missing', findings: [] });
    expect(blocked.kinds).toEqual(['not_reachable']);
    expect(blocked.lines.filter((line) => line.startsWith('A2(続き'))).toEqual([
      'A2(続き・実装の置き場の取り合い): 外部連携カタログが使えないため、受信の配線の置き場は取り合いを見ていません(操作・保存点・フォームの分は見ました)。',
    ]);

    const unselected = run(UNSELECTED);
    expect(unselected.kinds).toEqual(['not_reachable']);
    expect(unselected.lines.some((line) => line.startsWith('A2(続き'))).toBe(false);
  });
});

describe('実行口(runTrace): action_spec に依らない分は、action_spec が読めなくても見る。見ていない分は名指す', () => {
  const GAP = 'A2(続き・実装の置き場の取り合い): ';
  /** 保存点 1 つのユースケース仕様(読込済み)。 */
  const saves: CatalogInput<UsecaseSpecModel> = loadedInput({
    available: true,
    usecases: [usecaseSpec({ name: 'demo', saves: [usecaseSave('register', [usecaseStep('a.create')], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })] })],
  });
  /** 保存点の入口の役割を持たない配置(保存点の主張が置き場を決められず、違反になる)。 */
  const { 'save-entry': _removed, ...withoutSaveEntry } = NEXTJS_LAYOUT;

  function run(init: { actions: CatalogInput<ActionSpecModel>; usecases: CatalogInput<UsecaseSpecModel>; external?: CatalogInput<ExternalCatalogSpec>; roots?: typeof TEST_ROOTS }) {
    const base = traceInput({ actions: [actionSpec({ handles: 'inbound.billing_hook' })] });
    const lines: string[] = [];
    const result = runTrace(
      {
        model: base.domain,
        domainRoot: '/nonexistent/docs/specs/domain',
        actions: init.actions,
        registry: base.registry,
        jobs: UNSELECTED,
        dataTables: base.dataTables,
        guards: createGuardServices(),
        external: init.external ?? UNSELECTED,
        roots: init.roots ?? TEST_ROOTS,
        layout: withoutSaveEntry,
        usecases: init.usecases,
      },
      (line) => lines.push(line),
    );
    return { lines, a2: result.findings.filter((finding) => finding.verifier === 'A2') };
  }

  it('action_spec が阻害でも、保存点の取り合い(置き場を決められない)は見る。操作の分は見ていないと 1 行で名指す', () => {
    const { lines, a2 } = run({ actions: blockedInput(), usecases: saves });

    expect(a2.map((finding) => finding.counterexample?.['kind'])).toEqual(['unknown_role']);
    expect(a2[0]?.message).toContain('保存点 demo.register の Server Action');
    expect(lines.filter((line) => line.startsWith('A2(続き'))).toEqual([`${GAP}action_spec が読めないため、操作の置き場は取り合いを見ていません(保存点・フォーム・受信の配線の分は見ました)。`]);
  });

  it('action_spec が未選択なら、操作の分は事実として主張が無いので何も言わない(保存点の分は見る)', () => {
    const { lines, a2 } = run({ actions: UNSELECTED, usecases: saves });

    expect(a2).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('A2(続き'))).toBe(false);
  });

  it('(i) ユースケース仕様を採っていない(uses に無い)なら、置き場に仕様が残っていても主張に入らない。行も出ない(事実)', () => {
    const { lines, a2 } = run({ actions: loadedInput({ actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }), usecases: UNSELECTED });

    expect(a2).toEqual([]);
    expect(lines.some((line) => line.startsWith('A2(続き'))).toBe(false);
  });

  it('(ii) ユースケース仕様が阻害(読めなかった・部分的に捨てた)なら、保存点・フォームの分は見ていないと名指す。違反は出ない', () => {
    const actions = loadedInput({ actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] });
    for (const reason of ['missing', 'invalid'] as const) {
      const { lines, a2 } = run({ actions, usecases: blockedInput(reason) });

      expect(a2, reason).toEqual([]);
      expect(lines.filter((line) => line.startsWith('A2(続き')), reason).toEqual([`${GAP}ユースケース仕様が使えないため、保存点・フォームの置き場は取り合いを見ていません(操作・受信の配線の分は見ました)。`]);
    }
  });

  it('阻害が重なれば行も重なり、見ました側は阻害でない分だけを言う。全部阻害なら「見ました」の括弧を付けない', () => {
    const two = run({ actions: blockedInput(), usecases: blockedInput(), external: UNSELECTED });
    expect(two.lines.filter((line) => line.startsWith('A2(続き'))).toEqual([
      `${GAP}action_spec が読めないため、操作の置き場は取り合いを見ていません(受信の配線の分は見ました)。`,
      `${GAP}ユースケース仕様が使えないため、保存点・フォームの置き場は取り合いを見ていません(受信の配線の分は見ました)。`,
    ]);
    const all = run({ actions: blockedInput(), usecases: blockedInput(), external: blockedInput() });
    expect(all.lines.filter((line) => line.startsWith('A2(続き')).every((line) => line.endsWith('見ていません。'))).toBe(true);
  });

  it('(nit) 実装の木が無い製品は置き場の取り合いの検査そのものが走らないので、阻害の入力があっても何も言わない(「見ました」とも言わない)', () => {
    const { lines, a2 } = run({ actions: blockedInput(), usecases: blockedInput(), external: blockedInput(), roots: { ...TEST_ROOTS, app: null } });

    expect(a2).toEqual([]);
    expect(lines.some((line) => line.startsWith('A2(続き'))).toBe(false);
  });
});

/** 配置の元の値が足りないテストの書き間違いを知らせる(投げる)。 */
function failMissing(): never {
  throw new Error('FOREIGN_LAYOUT に必要な役割がありません');
}
