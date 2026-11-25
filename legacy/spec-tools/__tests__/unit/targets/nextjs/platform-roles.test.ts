/**
 * アプリの枠の後段 Next.js の、認証基盤の操作(`platform_ops`。ADR-0019)の置き場の値のテスト
 * (役割 `platform-op-entry` ・`platform-op-composition` ・`platform-binding` ・`platform-op-test`)。
 *
 * 固定するのは: ①置き場と import の指定 ②持ち主の生成器が実在の生成器の ID と一致する(手書きの配線は製品が書く)③キーの形(操作 ID は 2 語・ポートは型名)
 * ④逆引き(入口と組み立ての根の 2 段のファイルだけが操作)⑤配置そのものの契約(土台の表に載せた置き場が役割の置き場と一致する)。
 */

import { describe, expect, it } from 'vitest';
import { platformOpsAppGenerator } from '../../../../lib/generate/render/code-platform-ops-app.js';
import { platformOpsTestsGenerator } from '../../../../lib/generate/render/code-platform-ops-tests.js';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { layoutClassify } from '../../../../lib/model/product/layout-classify.js';
import { layoutKeyFits, layoutModule, layoutPath } from '../../../../lib/model/product/layout.js';
import type { LayoutRole } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';

/** 製品の根からの相対(`src/…`)で引く(実装の木の外を知らない呼び手と同じ形)。 */
const at = (role: LayoutRole, key?: string): string | null => layoutPath(NEXTJS_LAYOUT, '', role, key);

describe('NEXTJS_LAYOUT: 認証基盤の操作の置き場', () => {
  it('置き場と import の指定(組み立ての根と配線先だけが import される)', () => {
    expect(at('platform-op-entry', 'session.end_mine')).toBe('src/app/_actions/platform/session/end_mine.ts');
    expect(at('platform-op-composition', 'session.end_mine')).toBe('src/composition/platform/session/end_mine.ts');
    expect(at('platform-binding', 'SessionManagement')).toBe('src/composition/session-management.ts');
    expect(at('platform-op-test')).toBe('src/composition/__tests__/generated/platform-ops.test.ts');
    expect(layoutModule(NEXTJS_LAYOUT, 'platform-op-composition', 'session.end_mine')).toBe('@/composition/platform/session/end_mine');
    expect(layoutModule(NEXTJS_LAYOUT, 'platform-binding', 'SessionManagement')).toBe('@/composition/session-management');
    for (const role of ['platform-op-entry', 'platform-op-test'] as const) expect(layoutModule(NEXTJS_LAYOUT, role, role === 'platform-op-entry' ? 'a.b' : undefined), role).toBeNull();
  });

  it('ポートの型名はケバブケースの配線のファイル名になる', () => {
    expect(at('platform-binding', 'Foo')).toBe('src/composition/foo.ts');
    expect(at('platform-binding', 'FooBarBaz')).toBe('src/composition/foo-bar-baz.ts');
  });

  it('キーの形: 操作 ID は 2 語・ポートは区切りと空白を含まない・テストは 1 枚', () => {
    for (const bad of ['session', 'session.', '.end', 'a.b.c', 'a b.c', '']) expect(layoutKeyFits(NEXTJS_LAYOUT, 'platform-op-entry', bad), bad).toBe(false);
    expect(layoutKeyFits(NEXTJS_LAYOUT, 'platform-op-composition', 'session.end_mine')).toBe(true);
    for (const bad of ['', 'a/b', 'a b']) expect(layoutKeyFits(NEXTJS_LAYOUT, 'platform-binding', bad), bad).toBe(false);
    expect(layoutKeyFits(NEXTJS_LAYOUT, 'platform-op-test', undefined)).toBe(true);
  });

  it('持ち主の生成器は実在の生成器の ID と一致する。配線先は製品が手で書く', () => {
    const owners = (role: LayoutRole): string[] => (NEXTJS_LAYOUT[role]?.owners ?? []).map((owner) => (owner.kind === 'generator' ? owner.id : owner.kind));

    expect(owners('platform-op-entry')).toEqual([platformOpsAppGenerator.id]);
    expect(owners('platform-op-composition')).toEqual([platformOpsAppGenerator.id]);
    expect(owners('platform-op-test')).toEqual([platformOpsTestsGenerator.id]);
    expect(owners('platform-binding')).toEqual(['product']);
    expect(NEXTJS_LAYOUT['platform-binding']?.origin).toBe('handwritten');
  });

  it('逆引き: 入口と組み立ての根の 2 段のファイルが操作で、操作の入口・組み立ての根の逆引きはこの下を操作と読まない', () => {
    const roles = (file: string): string[] => layoutClassify(NEXTJS_LAYOUT, '', file).map((entry) => entry.role);
    expect(roles('src/app/_actions/platform/session/end_mine.ts')).toEqual(['platform-op-entry']);
    expect(roles('src/composition/platform/session/end_mine.ts')).toEqual(['platform-op-composition']);
    // 生成テストと配線先(層の直下のファイル)は操作ではない。
    expect(roles('src/composition/__tests__/generated/platform-ops.test.ts')).toEqual([]);
    expect(roles('src/composition/session-management.ts')).toEqual([]);
  });

  it('配置そのものの契約を満たす(土台の表に載せた置き場が、書き込む役割の置き場の中にある)', () => {
    expect(layoutDefinitionProblems(NEXTJS_LAYOUT)).toEqual([]);
  });
});
