/**
 * アプリの枠の後段 Next.js の、層の読み書きの置き場の値(役割 `operation-logic` ・`infrastructure`。部品化 ③-c4b)と、操作・保存点・フォームを含む **7 役割の逆引き**(`classify`)のテスト。
 *
 * 固定するのは 5 点 —— ①置き場が、直書きしていたときと**同じパス**(読む側 = 走査・A2・A11 / A14・構造の期待・免除表が配置から引いても、挙動は変わらない)②持ち主・生成物か手書きか
 * ③**逆引きの規則**(旧 `operationIdOf` の規約の写し。土台のディレクトリ・補助ファイル・テスト・段の違うものは操作ではない)④**同じファイルを 2 つの役割が自分のものと読まない**
 * (代表的なパス、そして実物の木 `app/src` の全ファイルで)⑤配置そのものの契約を満たす(Next.js の値・架空の値)。
 */

import { describe, expect, it } from 'vitest';
import { layoutClassify } from '../../../../lib/model/product/layout-classify.js';
import { productBaseDirPaths } from '../../../../lib/model/framework-base-dirs.js';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { layoutPath, layoutScan } from '../../../../lib/model/product/layout.js';
import type { ClassifiedRole } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT, nextjsLayoutWith } from '../../../../lib/targets/nextjs/layout.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_LAYOUT } from '../../../helpers/platform.js';

/** 役割の逆引きで、`dir` からの相対パスをキーに直す(走査の根は配置から引く。無ければテストの書き間違い)。 */
function keyOf(role: ClassifiedRole, relative: string): string | null {
  const scan = layoutScan(NEXTJS_LAYOUT, '', role);
  if (scan === null) throw new Error(`${role} の走査の根が無い`);
  return scan.keyOf(relative);
}

describe('置き場: 直書きしていたときと同じパス', () => {
  it('手書きの操作の本体と、基盤の層の集約・連携の置き場', () => {
    expect(layoutPath(NEXTJS_LAYOUT, 'app', 'operation-logic', 'entry.submit')).toBe('app/src/operation/entry/submit.ts');
    expect(layoutPath(NEXTJS_LAYOUT, '', 'operation-logic', 'entry.submit')).toBe('src/operation/entry/submit.ts');
    expect(layoutPath(NEXTJS_LAYOUT, 'app', 'infrastructure', 'workshop')).toBe('app/src/infrastructure/workshop/queries.ts');
    expect(layoutPath(NEXTJS_LAYOUT, 'app', 'operation-logic', 'entry')).toBeNull();
    expect(layoutPath(NEXTJS_LAYOUT, 'app', 'infrastructure', 'a/b')).toBeNull();
  });

  it('逆引きの走査の根は、層の置き場(製品の根からの相対 / リポジトリルートからの相対)', () => {
    expect(layoutScan(NEXTJS_LAYOUT, '', 'operation-logic')?.dir).toBe('src/operation');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'operation-entry')?.dir).toBe('app/src/app/_actions');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'save-entry')?.dir).toBe('app/src/app/_actions/usecase');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'operation-composition')?.dir).toBe('app/src/composition');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'save-composition')?.dir).toBe('app/src/composition/usecase');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'ui-component')?.dir).toBe('app/src/components/usecase/generated');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'infrastructure')?.dir).toBe('app/src/infrastructure');
  });
});

describe('持ち主・生成物か手書きか', () => {
  it('層の読み書きの 2 役割は製品の手書き(書く生成器は無い)', () => {
    for (const role of ['operation-logic', 'infrastructure'] as const) {
      const decl = NEXTJS_LAYOUT[role];
      expect(decl?.owners, role).toEqual([{ kind: 'product' }]);
      expect(decl?.origin, role).toBe('handwritten');
      expect(decl?.access.writers, role).toEqual([]);
      expect(decl?.module, role).toBeNull();
    }
  });

  it('5 役割の読み手(access.readers)は、移した後の実際の読み手を名指す(空でない)', () => {
    for (const role of ['operation-entry', 'operation-composition', 'save-entry', 'save-composition', 'ui-component', 'operation-logic', 'infrastructure'] as const) {
      expect(NEXTJS_LAYOUT[role]?.access.readers.length, role).toBeGreaterThan(0);
    }
    expect(NEXTJS_LAYOUT['operation-entry']?.access.readers).toEqual(expect.arrayContaining(['A2', 'code-structure-expectations']));
    expect(NEXTJS_LAYOUT['operation-logic']?.access.readers).toEqual(expect.arrayContaining(['A11', 'A14', 'code-lint-exceptions']));
  });
});

/** 操作の本体の層の逆引き(実物の配置のもの)。 */
const operationIdFromLogicFile = (relative: string): string | null => layoutScan(NEXTJS_LAYOUT, '', 'operation-logic')?.keyOf(relative) ?? null;

describe('逆引きの規則', () => {
  it('operation-logic: 旧 operationIdOf の規約の写し(操作の本体だけが操作 ID になる)', () => {
    expect(operationIdFromLogicFile('entry/submit.ts')).toBe('entry.submit');
    // 深すぎる配置は、規約のパスから導けない ID のまま突合に出して落とす(旧 operationIdOf と同じ)。
    expect(operationIdFromLogicFile('entry/deep/submit.ts')).toBe('entry.deep.submit');
    // 集約の `hooks/` の下は単発の操作の hooks(役割 `operation-hooks`)で操作の本体ではない —— 同じファイルを 2 つの役割が自分のものと読まない(部品化 ③-e1)。
    expect(operationIdFromLogicFile('entry/hooks/submit.ts')).toBeNull();
    for (const relative of [
      'logging.ts',
      'README.md',
      'entry/ports.ts',
      'shared/x.ts',
      'jobs/handlers.ts',
      'usecase/demo/register.ts',
      '__tests__/entry/submit.test.ts',
      'entry/submit.test.ts',
      'entry/notes.md',
    ]) {
      expect(operationIdFromLogicFile(relative), relative).toBeNull();
    }
  });

  it('operation-hooks: 集約の hooks/ の下の 3 段が単発の操作の hooks(operation-logic の逆引きと同じファイルを取り合わない)', () => {
    const hooksKeyOf = (relative: string): string | null => layoutScan(NEXTJS_LAYOUT, '', 'operation-hooks')?.keyOf(relative) ?? null;
    expect(hooksKeyOf('entry/hooks/submit.ts')).toBe('entry.submit');
    // 集約の名前・イベントの名前が `hooks` でも、置き場の hooks と取り違えない(3 段目が hooks の中身・2 段目が置き場の名前)。
    expect(hooksKeyOf('hooks/hooks/submit.ts')).toBe('hooks.submit');
    expect(operationIdFromLogicFile('hooks/hooks/submit.ts')).toBeNull();
    expect(operationIdFromLogicFile('hooks/submit.ts')).toBe('hooks.submit');
    expect(hooksKeyOf('hooks/submit.ts')).toBeNull();
    expect(operationIdFromLogicFile('entry/hooks.ts')).toBe('entry.hooks');
    expect(hooksKeyOf('entry/hooks.ts')).toBeNull();
    // 深すぎる配置は hooks でも操作の本体でもなく、操作の本体の側が「深すぎる ID」のまま突合に出す(従来どおり)。
    expect(hooksKeyOf('entry/hooks/sub/submit.ts')).toBeNull();
    expect(operationIdFromLogicFile('entry/hooks/sub/submit.ts')).toBe('entry.hooks.sub.submit');
    // テスト・説明・土台のディレクトリの下は hooks ではない。
    for (const relative of ['entry/hooks/submit.test.ts', 'entry/hooks/README.md', 'entry/hooks/submit.tsx', 'shared/hooks/x.ts', '__tests__/hooks/x.ts', 'hooks/x.ts']) {
      expect(hooksKeyOf(relative), relative).toBeNull();
    }
  });

  it('operation-entry: 集約 / イベントの 2 段だけ(保存点の 3 段・直下・テストは操作の入口ではない)', () => {
    expect(keyOf('operation-entry', 'workshop/confirm.ts')).toBe('workshop.confirm');
    for (const relative of ['usecase/demo/register.ts', 'x.ts', 'workshop/confirm.test.ts', 'workshop/confirm.tsx', 'workshop/confirm/y.ts']) {
      expect(keyOf('operation-entry', relative), relative).toBeNull();
    }
  });

  it('operation-composition: 2 段だけ。土台のディレクトリ(ジョブの配線・保存点・受信・テスト支援)とクエリの配線は操作の組み立ての根ではない', () => {
    expect(keyOf('operation-composition', 'workshop/create.ts')).toBe('workshop.create');
    // `shared` は土台の表に載せていない手書きの共有の配線(`composition/shared/*.ts`)。土台の表から導く除外に入っているので操作と読まれない。
    for (const relative of ['workshop/queries.ts', 'jobs/run.ts', 'inbound/hook.ts', 'shared/confirm_due_workshops.ts', 'usecase/demo.ts', 'usecase/demo/register.ts', '__tests__/claims.ts', 'auth.ts', 'workshop/create.test.ts']) {
      expect(keyOf('operation-composition', relative), relative).toBeNull();
    }
  });

  it('save-entry / save-composition: ユースケース / 保存点の 2 段だけ', () => {
    for (const role of ['save-entry', 'save-composition'] as const) {
      expect(keyOf(role, 'demo/register.ts'), role).toBe('demo.register');
      for (const relative of ['demo.ts', 'a/b/c.ts', 'demo/register.test.ts']) expect(keyOf(role, relative), `${role}:${relative}`).toBeNull();
    }
  });

  it('ui-component: 平らな置き場のファイル名そのものがキー(入れ子は null)', () => {
    expect(keyOf('ui-component', 'demo.register-form.tsx')).toBe('demo.register-form.tsx');
    expect(keyOf('ui-component', 'sub/x.tsx')).toBeNull();
  });

  it('infrastructure: 集約または連携のディレクトリ名がキー(土台のディレクトリ・層の直下のファイル・テストは対象外)', () => {
    expect(keyOf('infrastructure', 'workshop/queries.ts')).toBe('workshop');
    expect(keyOf('infrastructure', 'jobs/job.queue.ts')).toBe('jobs');
    expect(keyOf('infrastructure', 'workshop/sub/x.ts')).toBe('workshop');
    for (const relative of ['supabase/client.ts', '__tests__/x.ts', 'config.ts', 'README.md', 'workshop/queries.test.ts']) {
      expect(keyOf('infrastructure', relative), relative).toBeNull();
    }
  });
});

describe('逆引きの除外は、渡された層と土台の表に従う(実物の表に閉じない)', () => {
  const structure = NEXTJS_LAYOUT['source-root']?.structure;

  it('表に土台を足した配置では、その土台の下は操作・配線・集約として読まれない(足さない配置では読まれる)', () => {
    if (structure === undefined) throw new Error('実物の配置は source-root の structure を宣言する');
    const extra = { ...structure, unlistedDirs: [...structure.unlistedDirs, ...(['operation', 'composition', 'infrastructure'] as const).map((layer) => ({ layer, dir: 'extra', role: '足した置き場' }))] };
    const widened = nextjsLayoutWith(extra);
    for (const [role, relative] of [
      ['operation-logic', 'extra/x.ts'],
      ['operation-composition', 'extra/x.ts'],
      ['infrastructure', 'extra/x.ts'],
    ] as const) {
      expect(layoutScan(NEXTJS_LAYOUT, '', role)?.keyOf(relative), `実物:${role}`).not.toBeNull();
      expect(layoutScan(widened, '', role)?.keyOf(relative), `足した配置:${role}`).toBeNull();
    }
  });

  it('実物の表そのものを渡した配置は、実物の配置と同じ逆引きを持つ', () => {
    if (structure === undefined) throw new Error('実物の配置は source-root の structure を宣言する');
    const same = nextjsLayoutWith(structure);
    for (const [role, relative] of [
      ['operation-logic', 'shared/x.ts'],
      ['operation-logic', 'entry/submit.ts'],
      ['operation-composition', 'shared/confirm.ts'],
      ['infrastructure', 'supabase/client.ts'],
    ] as const) {
      expect(layoutScan(same, '', role)?.keyOf(relative), `${role}:${relative}`).toBe(layoutScan(NEXTJS_LAYOUT, '', role)?.keyOf(relative));
    }
  });
});

describe('同じファイルを 2 つの役割が自分のものと読まない', () => {
  it('代表的なパス: どれも高々 1 つの役割に読まれる(読まれない手書きの置き場もある)', () => {
    const roles = (file: string): string[] => layoutClassify(NEXTJS_LAYOUT, 'app', file).map((entry) => entry.role);
    expect(roles('app/src/operation/entry/submit.ts')).toEqual(['operation-logic']);
    expect(roles('app/src/app/_actions/entry/submit.ts')).toEqual(['operation-entry']);
    expect(roles('app/src/app/_actions/usecase/demo/register.ts')).toEqual(['save-entry']);
    expect(roles('app/src/composition/entry/submit.ts')).toEqual(['operation-composition']);
    expect(roles('app/src/composition/usecase/demo/register.ts')).toEqual(['save-composition']);
    expect(roles('app/src/components/usecase/generated/demo.register-form.tsx')).toEqual(['ui-component']);
    expect(roles('app/src/infrastructure/workshop/queries.ts')).toEqual(['infrastructure']);
    expect(roles('app/src/app/workshops/page.tsx')).toEqual(['screen-shell']);
    expect(roles('app/src/app/api/jobs/run/route.ts')).toEqual(['http-entry']);
    expect(roles('app/src/operation/__tests__/generated/computes/fees.examples.test.ts')).toEqual(['compute-example-test']);
    expect(roles('app/src/infrastructure/__tests__/generated/equivalence/workshop.eq.test.ts')).toEqual(['eq-test']);
    expect(roles('app/src/composition/__tests__/generated/equivalence/demo.uc.eq.test.ts')).toEqual(['eq-save-test']);
    expect(roles('app/src/infrastructure/__tests__/generated/rls/venues.rls.test.ts')).toEqual(['rls-test']);
    // 受信の配線(`composition-root`)と手書きのテスト・土台は、逆引きを持つどの役割にも読まれない。
    expect(roles('app/src/composition/inbound/billing_hook.ts')).toEqual([]);
    expect(roles('app/src/operation/__tests__/entry/submit.test.ts')).toEqual([]);
  });
});

describe('逆引きが除く土台は、配置の層と土台の表が宣言したものそのもの', () => {
  const declared = (layer: string): ReadonlySet<string> => {
    const names = [...productBaseDirPaths(NEXTJS_LAYOUT, '')].filter((entry) => entry.startsWith(`src/${layer}/`)).map((entry) => entry.slice(`src/${layer}/`.length).split('/')[0] ?? '');
    return new Set(names);
  };

  it('operation-logic / operation-composition / infrastructure の逆引きは、表の土台の名前のディレクトリの下を操作・集約と読まない(表と逆引きの食い違いの見張り)', () => {
    for (const name of declared('operation')) expect(keyOf('operation-logic', `${name}/x.ts`), `operation/${name}`).toBeNull();
    for (const name of declared('composition')) expect(keyOf('operation-composition', `${name}/x.ts`), `composition/${name}`).toBeNull();
    for (const name of declared('infrastructure')) expect(keyOf('infrastructure', `${name}/x.ts`), `infrastructure/${name}`).toBeNull();
  });

  it('逆引きが除く土台の集合は、表から導いたものと同じ(operation の 4 つ・配線の層の 6 つ(手書きの shared を含む)・基盤の層の 2 つ)', () => {
    expect(declared('operation')).toEqual(new Set(['shared', 'jobs', 'usecase', '__tests__']));
    expect(declared('composition')).toEqual(new Set(['jobs', 'usecase', 'platform', 'inbound', '__tests__', 'shared']));
    expect(declared('infrastructure')).toEqual(new Set(['supabase', '__tests__']));
  });
});

describe('配置そのものの契約(Next.js の値・架空の値)', () => {
  it('層の読み書きの 2 役割も含めて、契約を満たす', () => {
    expect(layoutDefinitionProblems(NEXTJS_LAYOUT)).toEqual([]);
    expect(layoutDefinitionProblems(FOREIGN_BODY_COMPATIBLE_LAYOUT)).toEqual([]);
    expect(FOREIGN_LAYOUT['operation-logic']?.classify?.dir).toBe('rules');
  });
});
