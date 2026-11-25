/**
 * アプリの枠の後段 Next.js の、操作・保存点の入口と組み立ての根とフォームの置き場の値(役割 `operation-entry` ・`operation-composition` ・`save-entry` ・
 * `save-composition` ・`ui-component`。部品化 ③-c4a)と、層の読み書き(`operation-logic` ・`infrastructure`。部品化 ③-c4b)と、7 役割の逆引き(`classify`)のテスト。
 *
 * 固定するのは 5 点 —— ①置き場と import の指定が、直書きしていたときと**同じ**(生成物がバイト同一の根拠。置き場は 1 か所に移っただけ)②持ち主の生成器が実在の
 * 生成器の ID と一致する(`operation-*` は手書き(`runner: manual`)と混在・保存点とフォームは生成物だけ)③配置そのものの契約を満たす(Next.js の値・架空の値の両方)
 * ④キーの形(操作 ID と保存点 ID は 2 語・フォームはファイル名)⑤**衝突の検査の反例**(同じ操作に 2 ファイル・生成と手書き(`runner: manual`)が同じパス・手書きの
 * 保存点の Server Action・役割をまたぐ取り合い)。
 */

import { describe, expect, it } from 'vitest';
import { operationAppGenerator } from '../../../../lib/generate/render/code-operation-app.js';
import { usecaseAppGenerator } from '../../../../lib/generate/render/code-usecase-app.js';
import { usecaseFormGenerator } from '../../../../lib/generate/render/code-usecase-form.js';
import { layoutClaimProblems } from '../../../../lib/model/product/layout-claims.js';
import type { LayoutClaim } from '../../../../lib/model/product/layout-claims.js';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { layoutKeyFits, layoutModule, layoutPath } from '../../../../lib/model/product/layout.js';
import type { LayoutRole, ProductLayout } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_LAYOUT } from '../../../helpers/platform.js';

/** 操作・保存点の入口と組み立ての根とフォームの 5 役割。 */
const APP_ROLES: readonly LayoutRole[] = ['operation-entry', 'operation-composition', 'save-entry', 'save-composition', 'ui-component'];

/** 役割の持ち主を、生成器の ID・製品の手書きの名前で並べる。 */
function owners(role: LayoutRole): string[] {
  return (NEXTJS_LAYOUT[role]?.owners ?? []).map((owner) => (owner.kind === 'generator' ? owner.id : owner.kind));
}

describe('NEXTJS_LAYOUT: 操作・保存点の入口と組み立ての根とフォーム', () => {
  it('置き場は、直書きしていたときと同じパス(基準は製品の根 app の下の src)', () => {
    const at = (role: LayoutRole, key: string): string | null => layoutPath(NEXTJS_LAYOUT, 'app', role, key);
    expect(at('operation-entry', 'widget.send')).toBe('app/src/app/_actions/widget/send.ts');
    expect(at('operation-composition', 'widget.send')).toBe('app/src/composition/widget/send.ts');
    expect(at('save-entry', 'demo.register')).toBe('app/src/app/_actions/usecase/demo/register.ts');
    expect(at('save-composition', 'demo.register')).toBe('app/src/composition/usecase/demo/register.ts');
    expect(at('ui-component', 'demo.register-form.tsx')).toBe('app/src/components/usecase/generated/demo.register-form.tsx');
    // 製品の根からの相対(期待ファイル木のように、製品の根の外を知らない呼び手)。
    expect(layoutPath(NEXTJS_LAYOUT, '', 'operation-entry', 'widget.send')).toBe('src/app/_actions/widget/send.ts');
  });

  it('import の指定: 組み立ての根だけが持ち、置き場(拡張子なし)に基準の別名を接いだ形', () => {
    expect(layoutModule(NEXTJS_LAYOUT, 'operation-composition', 'widget.send')).toBe('@/composition/widget/send');
    expect(layoutModule(NEXTJS_LAYOUT, 'save-composition', 'demo.register')).toBe('@/composition/usecase/demo/register');
    // 入口(Server Action)とフォームは生成物の本文から import されない(import するのは手書きの画面)ので、指定を持たない。
    for (const role of ['operation-entry', 'save-entry', 'ui-component'] as const) expect(layoutModule(NEXTJS_LAYOUT, role, 'a.b'), role).toBeNull();
  });

  it('キーの形: 操作 ID・保存点 ID は 2 語(区切りと空白を含まない)・フォームのファイル名は区切りと空白を含まない', () => {
    for (const role of ['operation-entry', 'operation-composition', 'save-entry', 'save-composition'] as const) {
      for (const bad of ['widget', 'widget.', '.send', 'a.b.c', 'a b.c', 'a/b.c', '']) expect(layoutKeyFits(NEXTJS_LAYOUT, role, bad), `${role}:${bad}`).toBe(false);
      expect(layoutKeyFits(NEXTJS_LAYOUT, role, undefined), role).toBe(false);
      expect(layoutKeyFits(NEXTJS_LAYOUT, role, 'entry_participant.link'), role).toBe(true);
    }
    for (const bad of ['', 'a/b.tsx', 'a b.tsx']) expect(layoutKeyFits(NEXTJS_LAYOUT, 'ui-component', bad), bad).toBe(false);
    expect(layoutKeyFits(NEXTJS_LAYOUT, 'ui-component', 'demo.register-form.tsx')).toBe(true);
  });

  it('持ち主の生成器は、実在の生成器の ID と一致する(食い違えば赤)・書くのは生成器だけ', () => {
    expect(owners('operation-entry')).toEqual([operationAppGenerator.id, 'product']);
    expect(owners('operation-composition')).toEqual([operationAppGenerator.id, 'product']);
    expect(owners('save-entry')).toEqual([usecaseAppGenerator.id]);
    expect(owners('save-composition')).toEqual([usecaseAppGenerator.id]);
    expect(owners('ui-component')).toEqual([usecaseFormGenerator.id]);
    for (const role of APP_ROLES) expect(NEXTJS_LAYOUT[role]?.access.writers, role).toEqual([owners(role)[0]]);
  });

  it('生成物か手書きか: 単発の操作は手書き(`runner: manual`)と混在・保存点とフォームは生成物だけ', () => {
    expect(NEXTJS_LAYOUT['operation-entry']?.origin).toBe('mixed');
    expect(NEXTJS_LAYOUT['operation-composition']?.origin).toBe('mixed');
    for (const role of ['save-entry', 'save-composition', 'ui-component'] as const) expect(NEXTJS_LAYOUT[role]?.origin, role).toBe('generated');
  });

  it('配置そのものの契約を満たす(Next.js の値・架空の値の両方。下限 1・基準・import の指定)', () => {
    expect(layoutDefinitionProblems(NEXTJS_LAYOUT)).toEqual([]);
    expect(layoutDefinitionProblems(FOREIGN_BODY_COMPATIBLE_LAYOUT)).toEqual([]);
  });

  it('5 役割は逆引きを持つ(部品化 ③-c4b。読む側が走査の根を引く)', () => {
    for (const role of APP_ROLES) expect(NEXTJS_LAYOUT[role]?.classify, role).toBeDefined();
  });

  it('5 役割の置き場は互いに衝突しない(同じ名前のキーを別の種類の生成器が取っても、別の置き場になる)', () => {
    const claim = (role: LayoutRole, key: string): LayoutClaim => ({ role, key, owner: owners(role)[0] ?? '', source: `${role}:${key}` });
    const claims: LayoutClaim[] = [
      claim('operation-entry', 'demo.register'),
      claim('operation-composition', 'demo.register'),
      claim('save-entry', 'demo.register'),
      claim('save-composition', 'demo.register'),
      claim('ui-component', 'demo.register-form.tsx'),
    ];
    for (const layout of [NEXTJS_LAYOUT, FOREIGN_LAYOUT]) expect(layoutClaimProblems(layout, claims), 'ok').toEqual([]);
  });
});

describe('衝突の検査の反例(操作・保存点の置き場)', () => {
  const claim = (role: LayoutRole, key: string, owner: string, source: string): LayoutClaim => ({ role, key, owner, source });

  it('同じ (集約, イベント) に 2 ファイル: 同じ操作の入口を 2 つの主張が取れば、置き場の衝突として止まる', () => {
    const problems = layoutClaimProblems(NEXTJS_LAYOUT, [
      claim('operation-entry', 'widget.send', operationAppGenerator.id, '一つ目'),
      claim('operation-entry', 'widget.send', operationAppGenerator.id, '二つ目'),
    ]);
    expect(problems.map((problem) => problem.kind)).toEqual(['duplicate_path']);
    expect(problems[0]?.message).toContain('app/_actions/widget/send.ts');
  });

  it('生成と手書き(`runner: manual`)が同じパスを取れば衝突する(どちらも持ち主として宣言済みなので、取り合いだけが指される)', () => {
    for (const role of ['operation-entry', 'operation-composition'] as const) {
      const problems = layoutClaimProblems(NEXTJS_LAYOUT, [
        claim(role, 'widget.send', operationAppGenerator.id, '生成'),
        claim(role, 'widget.send', 'product', '手書き(runner: manual)'),
      ]);
      expect(problems.map((problem) => problem.kind), role).toEqual(['duplicate_path']);
      expect(problems[0]?.sources, role).toEqual(['生成', '手書き(runner: manual)']);
    }
  });

  it('操作の入口と別の操作の入口は別の置き場(同じ集約の別のイベント・別の集約の同じイベント)', () => {
    expect(
      layoutClaimProblems(NEXTJS_LAYOUT, [
        claim('operation-entry', 'widget.send', operationAppGenerator.id, 'a'),
        claim('operation-entry', 'widget.drop', 'product', 'b'),
        claim('operation-entry', 'gadget.send', operationAppGenerator.id, 'c'),
      ]),
    ).toEqual([]);
  });

  it('保存点の Server Action と組み立ての根は生成物だけ: 手書き(製品)が取れば、持ち主として宣言されていない', () => {
    for (const role of ['save-entry', 'save-composition'] as const) {
      const problems = layoutClaimProblems(NEXTJS_LAYOUT, [claim(role, 'demo.register', 'product', '手書きの保存点')]);
      expect(problems.map((problem) => problem.kind), role).toEqual(['undeclared_owner']);
    }
  });

  it('別の役割が同じ置き場を取る配置は、役割をまたいでも衝突として止まる(操作の入口と保存点の入口が同じファイルになる配置)', () => {
    const merged: ProductLayout = {
      ...NEXTJS_LAYOUT,
      'operation-entry': {
        ...(NEXTJS_LAYOUT['operation-entry'] ?? failMissing()),
        place: (op) => `actions/${op.replace('.', '__')}.ts`,
        classify: { dir: 'actions', keyOf: flatPair },
      },
      'save-entry': {
        ...(NEXTJS_LAYOUT['save-entry'] ?? failMissing()),
        place: (save) => `actions/${save.replace('.', '__')}.ts`,
        classify: { dir: 'actions', keyOf: flatPair },
      },
    };
    const problems = layoutClaimProblems(merged, [
      claim('operation-entry', 'demo.register', operationAppGenerator.id, '操作 demo.register'),
      claim('save-entry', 'demo.register', usecaseAppGenerator.id, '保存点 demo.register'),
    ]);
    expect(problems.map((problem) => problem.kind)).toEqual(['duplicate_path']);
  });

  it('キーが形に合わない・役割が配置に無い主張は、置き場を決められない違反として止まる', () => {
    expect(layoutClaimProblems(NEXTJS_LAYOUT, [claim('operation-entry', 'widget', operationAppGenerator.id, '集約だけ')]).map((problem) => problem.kind)).toEqual(['invalid_key']);
    const { 'save-entry': _removed, ...without } = NEXTJS_LAYOUT;
    expect(layoutClaimProblems(without, [claim('save-entry', 'demo.register', usecaseAppGenerator.id, '保存点')]).map((problem) => problem.kind)).toEqual(['unknown_role']);
  });
});

/** 平らな置き場の `{a}__{b}.ts` → `{a}.{b}`(架空の配置の逆引き)。 */
function flatPair(relative: string): string | null {
  return relative.includes('/') || !relative.endsWith('.ts') ? null : relative.slice(0, -'.ts'.length).replace('__', '.');
}

/** 配置の元の値が足りないテストの書き間違いを知らせる(投げる)。 */
function failMissing(): never {
  throw new Error('NEXTJS_LAYOUT に必要な役割がありません');
}
