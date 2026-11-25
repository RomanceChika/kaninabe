/**
 * 許可の証明（`FireAllowed`）が偽造できないことのテスト。
 *
 * ここで守っているのは「エンジンの判定を通さずに状態を書き換える経路が**型として**存在しない」
 * という性質である（ARCH-BE-0013 の②→③）。性質は型検査でしか壊れないため、
 * 検査は `@ts-expect-error` で行い、`npm run typecheck` が落とし役になる。
 * 実行時の assertion（`expect`）は、その型テストが実際にコンパイルされたことを示す番人である。
 *
 * `as unknown as FireAllowed` のような二段キャストは TypeScript の言語仕様上どうやっても塞げない。
 * ここが保証するのは「うっかり」と「構造的に同じ形を作っての偽造」であり、
 * 意図的な迂回に対しては `transitionOf` の実行時チェックが最後の防御になる。
 */

import { describe, expect, it } from 'vitest';
import { canFire, transitionOf } from '../machine';
import type { FireAllowed } from '../machine';
import type { MachineTable } from '@kaninabe/runtime/engine/types';

/** ガードもロール制限も最小の表（許可を1つ得るためだけのもの）。 */
const noteMachine: MachineTable = {
  machine: 'note',
  states: ['open', 'archived'],
  initial: 'open',
  final: ['archived'],
  transitions: [{ event: 'archive', from: ['open'], to: 'archived', by: ['librarian'], effects: ['audit'] }],
};

/** エンジンから正規の許可を得る。 */
function realDecision(): FireAllowed {
  const decision = canFire(noteMachine, { state: 'open', actorRoles: ['librarian'], env: {} }, 'archive');
  if (!decision.allowed) throw new Error('許可されるはずの遷移が拒否されました');
  return decision;
}

describe('FireAllowed — 偽造できないこと（型テスト）', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-ENGINE-001
  it('遷移の中身を並べただけのオブジェクトは FireAllowed として代入できない', () => {
    // @ts-expect-error 中身は非公開 symbol の下にあるため、構造的に一致するオブジェクトは作れない
    const forged: FireAllowed = { allowed: true, from: 'open', to: 'archived', effects: [] };

    expect(forged.allowed).toBe(true);
  });

  it('遷移の中身を並べただけのオブジェクトは as FireAllowed でも通らない', () => {
    // @ts-expect-error 双方に重なりが無いため、単純なキャストでは偽造できない（TS2352）
    const forged = { allowed: true, from: 'open', to: 'archived', effects: [] } as FireAllowed;

    expect(forged.allowed).toBe(true);
  });

  it('型を明示した変数からのキャストでも通らない（fresh でないオブジェクトも同じ）', () => {
    const shaped: { allowed: true; from: string; to: string; effects: readonly string[] } = {
      allowed: true,
      from: 'open',
      to: 'archived',
      effects: [],
    };

    // @ts-expect-error 公開プロパティが一致していても、封印が無いので FireAllowed にはならない
    const forged = shaped as FireAllowed;

    expect(forged.allowed).toBe(true);
  });

  it('satisfies でも構造的一致では満たせない', () => {
    // @ts-expect-error satisfies も代入可能性を要求するため、封印の無い値は満たせない
    const forged = { allowed: true, from: 'open', to: 'archived', effects: [] } satisfies FireAllowed;

    expect(forged.allowed).toBe(true);
  });

  it('遷移の中身は公開プロパティとして読めない（読み口は transitionOf だけ）', () => {
    const decision = realDecision();

    // @ts-expect-error to は FireAllowed の公開プロパティではない
    const leaked: unknown = decision.to;

    expect(leaked).toBeUndefined();
    expect(transitionOf(decision).to).toBe('archived');
  });
});

describe('FireAllowed — 正規の許可', () => {
  it('canFire が発行した許可からはイベントID・判断時の状態・遷移先・副作用が取り出せる', () => {
    expect(transitionOf(realDecision())).toEqual({
      event: 'note.archive',
      from: 'open',
      to: 'archived',
      effects: ['audit'],
    });
  });

  it('型検査を迂回して渡された偽の許可は実行時に弾かれる', () => {
    // 二段キャストは言語仕様上防げないため、最後の防御として実行時に落とす。
    const forged = { allowed: true, from: 'open', to: 'archived', effects: [] } as unknown as FireAllowed;

    expect(() => transitionOf(forged)).toThrow(/エンジンが発行していない許可/);
  });
});
