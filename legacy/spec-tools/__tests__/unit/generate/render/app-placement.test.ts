/**
 * 操作・保存点の入口(Server Action)・組み立ての根・フォームの置き場を、置き場の配置から引く口(`app-placement.ts` と、それを通る生成器 3 本 —
 * `code-operation-app` ・`code-usecase-app` ・`code-usecase-form`。部品化 ③-c4a)のテスト。
 *
 * 固定するのは 4 点 —— ①Next.js の値では、直書きしていたときと**同じパス・同じ import の指定**になる(生成物のバイト同一は `generate:check` も見る)②**別の配置
 * (架空の値)では、書き先と import の指定がその値になり、Next.js の綴り(`_actions` ・`composition/usecase` ・`components/usecase/generated`)が残らない**
 * ③実装の木を持たない製品は 1 本も出さない ④配置が役割を解決できなければ、黙って 0 本にせず前提の失敗で止まる(名指すのは配置の定義の検査)。
 */

import { describe, expect, it } from 'vitest';
import { operationAppGenerator } from '../../../../lib/generate/render/code-operation-app.js';
import { usecaseAppGenerator } from '../../../../lib/generate/render/code-usecase-app.js';
import { usecaseFormGenerator } from '../../../../lib/generate/render/code-usecase-form.js';
import type { DocGenerator, GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { GeneratorPreconditionError } from '../../../../lib/kernel/generator-precondition.js';
import type { ProductLayout } from '../../../../lib/model/product/layout.js';
import { EMPTY_LAYOUT } from '../../../../lib/model/product/layout.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { FOREIGN_LAYOUT, FOREIGN_ROOTS, leaksNextjsEntrySpelling, TEST_LAYOUT } from '../../../helpers/platform.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';

/** container.create → item.create → item.submit の 1 保存点を持つユースケース。 */
const USECASE = usecaseSpec({
  name: 'demo',
  saves: [
    usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')], {
      migration: '20260909000050_usecase_demo_register.sql',
      name: 'demo',
    }),
  ],
});

/** 生成器に渡す文脈(配置・実装の木は差し替えられる)。 */
function context(layout: ProductLayout = TEST_LAYOUT, app: string | null = GEN_CTX.roots.app): GenerateContext {
  return {
    ...GEN_CTX,
    // 別の綴りの配置のときは、生成物の総置き場もその配置のソースの根の下へ合わせる(製品の宣言と配置の食い違いを作らない)。
    roots: { ...GEN_CTX.roots, app, ...(layout === FOREIGN_LAYOUT ? { generated: FOREIGN_ROOTS.generated } : {}) },
    layout,
    actions: rpcActions(),
    dataTables: rpcDataTables(),
    usecases: { available: true, usecases: [USECASE] },
  };
}

/** 生成器を回して、書き先と本文を返す。 */
function run(generator: DocGenerator, model: SpecModel, ctx: GenerateContext): { readonly file: string; readonly content: string }[] {
  return generator.generate(model, ctx).map((section) => ({ file: section.file, content: section.content }));
}

/** 止まったときの例外(止まらなければテストの失敗)。 */
function stopped(act: () => unknown): GeneratorPreconditionError {
  try {
    act();
  } catch (error) {
    if (error instanceof GeneratorPreconditionError) return error;
    throw error;
  }
  throw new Error('止まらなかった');
}

describe('Next.js の値: 直書きしていたときと同じパスと import の指定', () => {
  it('単発の操作: Server Action と Composition Root(import の指定は組み立ての根の置き場から)', () => {
    const files = run(operationAppGenerator, rpcDomain(), context());

    expect(files.map((file) => file.file)).toEqual([
      'app/src/app/_actions/container/create.ts',
      'app/src/composition/container/create.ts',
      'app/src/app/_actions/item/create.ts',
      'app/src/composition/item/create.ts',
      'app/src/app/_actions/item/submit.ts',
      'app/src/composition/item/submit.ts',
    ]);
    expect(files[0]?.content).toContain("import { createCreateContainer } from '@/composition/container/create';");
    expect(files[0]?.content).toContain("import type { OperationResult } from '@/composition/container/create';");
  });

  it('保存点: Server Action と composition と 1 画面フォーム', () => {
    const app = run(usecaseAppGenerator, rpcDomain(), context());
    expect(app.map((file) => file.file)).toEqual(['app/src/app/_actions/usecase/demo/register.ts', 'app/src/composition/usecase/demo/register.ts']);
    expect(app[0]?.content).toContain("import { createDemoRegister } from '@/composition/usecase/demo/register';");

    const form = run(usecaseFormGenerator, rpcDomain(), context());
    expect(form.map((file) => file.file)).toEqual(['app/src/components/usecase/generated/demo.register-form.tsx']);
  });
});

describe('別の配置(架空の値): 書き先と import の指定がその値になり、Next.js の綴りが残らない', () => {
  it('単発の操作: 書き先は配置の値・Server Action は配置の組み立ての根を import する', () => {
    const files = run(operationAppGenerator, rpcDomain(), context(FOREIGN_LAYOUT));

    expect(files.map((file) => file.file)).toEqual([
      'app/server_code/handlers/ops/container__create.action.ts',
      'app/server_code/wiring/ops/container__create.wire.ts',
      'app/server_code/handlers/ops/item__create.action.ts',
      'app/server_code/wiring/ops/item__create.wire.ts',
      'app/server_code/handlers/ops/item__submit.action.ts',
      'app/server_code/wiring/ops/item__submit.wire.ts',
    ]);
    for (const file of files) expect(leaksNextjsEntrySpelling(file.file), file.file).toBe(false);
    const action = files[0]?.content ?? '';
    expect(action).toContain("import { createCreateContainer } from '~srv/wiring/ops/container__create.wire';");
    expect(action).toContain("import type { OperationResult } from '~srv/wiring/ops/container__create.wire';");
    // 別名の指定は 1 つも残らない(組み立ての根・生成物の根の下・認証の組み立ての根は、全部配置から引く。部品化 ③-e1)。
    expect(action).not.toMatch(/@\//);
    expect(action).toContain("import { operationInputSchemas } from '~srv/domain/generated/operation-inputs';");
    expect(action).toContain("import { recordActionRefusal, resolveActorId, resolveRequestId, resolveSessionProfile } from '~srv/wiring/who';");
    expect(files[1]?.content).toContain("import { systemClock } from '~srv/store/clock';");
    // DB への口は製品の配線 1 本が組んだ束を受け取るだけ(PostgREST のクライアントも、その適合も、口の工場も本文に出ない。③-e2C)。
    const composition = files[1]?.content ?? '';
    expect(composition).toContain("import { createDbPorts } from '~srv/etc/db_open';");
    expect(composition).toContain('    ...createDbPorts(),\n    clock: systemClock,\n    bindings: runtimeBindings,\n');
    expect(composition).not.toMatch(/createServiceRoleClient|rowSourceOf|rpcSourceOf|createFactReader|createUsecaseRepository|createRpcCaller|const client\b/);
  });

  it('保存点: Server Action・composition・フォームの書き先は配置の値', () => {
    const app = run(usecaseAppGenerator, rpcDomain(), context(FOREIGN_LAYOUT));
    expect(app.map((file) => file.file)).toEqual(['app/server_code/handlers/saves/demo__register.action.ts', 'app/server_code/wiring/saves/demo__register.wire.ts']);
    expect(app[0]?.content).toContain("import { createDemoRegister } from '~srv/wiring/saves/demo__register.wire';");
    expect(app[0]?.content).toContain("import type { UsecaseResult } from '~srv/wiring/saves/demo__register.wire';");
    expect(app[0]?.content).not.toMatch(/@\//);
    expect(app[1]?.content).not.toMatch(/@\//);
    expect(app[1]?.content).toContain("import { createDbPorts } from '~srv/etc/db_open';");
    expect(app[1]?.content).toContain('    ...createDbPorts(),\n    clock: systemClock,\n    bindings: runtimeBindings,\n');
    expect(app[1]?.content).not.toMatch(/createServiceRoleClient|rowSourceOf|rpcSourceOf|createFactReader|createUsecaseRepository|createRpcCaller|const client\b/);

    const form = run(usecaseFormGenerator, rpcDomain(), context(FOREIGN_LAYOUT));
    expect(form.map((file) => file.file)).toEqual(['app/server_code/ui/forms/demo.register-form.tsx']);
    for (const file of [...app, ...form]) expect(leaksNextjsEntrySpelling(file.file), file.file).toBe(false);
  });
});

describe('実装の木を持たない製品・配置が役割を解決できない構成', () => {
  const generators: readonly [string, DocGenerator][] = [
    ['code-operation-app', operationAppGenerator],
    ['code-usecase-app', usecaseAppGenerator],
    ['code-usecase-form', usecaseFormGenerator],
  ];

  it('実装の木を持たない製品(roots.app が null)は 1 本も出さない(置き場が無いのが事実)', () => {
    for (const [id, generator] of generators) expect(generator.generate(rpcDomain(), context(TEST_LAYOUT, null)), id).toEqual([]);
  });

  it('実装の木があるのに配置が役割を宣言していなければ、黙って 0 本にせず前提の失敗で止まる(名指すのは配置の定義の検査)', () => {
    for (const [id, generator] of generators) {
      const error = stopped(() => generator.generate(rpcDomain(), context(EMPTY_LAYOUT)));
      expect(error.findings, id).toHaveLength(1);
      const finding = error.findings[0];
      expect(finding?.verifier, id).toBe('配置の定義の検査');
      expect(finding?.suggestion, id).toContain('配置の定義の検査');
      expect(finding?.counterexample, id).toMatchObject({ declared: 'no' });
    }
  });

  it('止まるときは何の置き場か(操作・保存点の名前と役割)を名指し、出どころの仕様の位置を指す', () => {
    const operation = stopped(() => operationAppGenerator.generate(rpcDomain(), context(EMPTY_LAYOUT))).findings[0];
    expect(operation?.message).toBe('操作 container.create の Server Action の置き場を、置き場の配置から決められません(役割 operation-entry・キー container.create)');
    expect(operation?.location.file).toContain('backend/actions/');

    const save = stopped(() => usecaseAppGenerator.generate(rpcDomain(), context(EMPTY_LAYOUT))).findings[0];
    expect(save?.message).toBe('保存点 demo.register の Server Action の置き場を、置き場の配置から決められません(役割 save-entry・キー demo.register)');
    expect(save?.location.file).toContain('frontend/usecases/');

    const form = stopped(() => usecaseFormGenerator.generate(rpcDomain(), context(EMPTY_LAYOUT))).findings[0];
    expect(form?.message).toBe('保存点 demo.register の 1 画面フォーム の置き場を、置き場の配置から決められません(役割 ui-component・キー demo.register-form.tsx)');
  });

  it('組み立ての根の役割だけが欠ける配置でも止まる(Server Action の置き場は決まっても、import の指定が決まらない)', () => {
    const { 'operation-composition': _removed, ...without } = TEST_LAYOUT;
    const error = stopped(() => operationAppGenerator.generate(rpcDomain(), context(without)));
    expect(error.findings[0]?.message).toContain('操作 container.create の Composition Root');
    expect(error.findings[0]?.counterexample).toMatchObject({ role: 'operation-composition', declared: 'no' });
  });
});
