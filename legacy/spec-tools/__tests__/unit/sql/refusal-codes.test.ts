/**
 * 拒否の分類の 1 表(lib/sql/refusal-codes.ts)。
 *
 * 分類 → errcode → 本文の接頭辞 → エンジンの拒否理由が 1 か所で閉じていることを固定する。
 * 既存の複合 RPC が使っている `UC409` + `usecase_conflict:` と同じ字面であることも見る
 * (⑳-3 で `usecase-sql.ts` / `rpc.caller.ts` の字面をここへ寄せるときの錨)。
 */

import { describe, expect, it } from 'vitest';
import {
  raiseRefusal,
  REFUSAL_CODES,
  REFUSAL_ENGINE_REASONS,
  REFUSAL_KINDS,
  REFUSAL_MESSAGE_PREFIXES,
} from '../../../lib/sql/refusal-codes.js';

describe('拒否の分類', () => {
  it('分類は 3 つで、すべてに errcode と接頭辞と拒否理由の対応がある', () => {
    expect([...REFUSAL_KINDS]).toEqual(['forbidden', 'guard', 'conflict']);
    for (const kind of REFUSAL_KINDS) {
      expect(REFUSAL_CODES[kind]).toMatch(/^UC\d{3}$/);
      expect(REFUSAL_MESSAGE_PREFIXES[kind]).toMatch(/:$/);
      expect(kind in REFUSAL_ENGINE_REASONS).toBe(true);
    }
  });

  it('errcode は分類ごとに違う', () => {
    expect(new Set(Object.values(REFUSAL_CODES)).size).toBe(REFUSAL_KINDS.length);
  });

  it('競合は既存の複合 RPC と同じ字面のままである', () => {
    expect(raiseRefusal('conflict', 'entry.submit')).toBe(
      "raise exception using errcode = 'UC409', message = 'usecase_conflict:entry.submit';",
    );
  });

  it('ロール違いとガード違いは別の errcode で上がる', () => {
    expect(raiseRefusal('forbidden', 'entry.submit', '    ')).toBe(
      "    raise exception using errcode = 'UC403', message = 'usecase_forbidden:entry.submit';",
    );
    expect(raiseRefusal('guard', 'entry.submit', '    ')).toBe(
      "    raise exception using errcode = 'UC412', message = 'usecase_guard:entry.submit';",
    );
  });

  it('本文の単引用符はエスケープされる', () => {
    expect(raiseRefusal('conflict', "it's")).toContain("'usecase_conflict:it''s'");
  });

  it('エンジンの拒否理由は 4 つの入口ぶん全部が分類に載る', () => {
    // 判断時の前提が崩れた(競合)に当たる engine の語は `invalid_from` である ——
    // 本文は状態の段を最初に見るので、宣言に無い遷移元・イベントはどちらもそこで落ちる。
    expect(REFUSAL_ENGINE_REASONS.conflict).toContain('invalid_from');
    expect(REFUSAL_ENGINE_REASONS.forbidden).toEqual(['role_forbidden']);
    expect(REFUSAL_ENGINE_REASONS.guard).toEqual(['guard_unsatisfied', 'guard_unknown']);
  });

  it('1 つの理由が 2 つの分類に載っていない(写像が 1 対 1 で読める)', () => {
    const reasons = REFUSAL_KINDS.flatMap((kind) => REFUSAL_ENGINE_REASONS[kind]);
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});
