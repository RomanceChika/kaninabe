/**
 * `guardEnv` の鍵の読み取り(A14 の材料)の規約網羅テスト。
 *
 * 対象の要求: server-actions.md「5 形の定型」の `guardEnv`(`(facts) => ({ パス: 値 })`)と
 * ADR-0012 §Implementation の当座の突合。読めない形を**黙って空にしない**ことがこの関数の
 * いちばん大事な性質である(空と読み取り失敗を混ぜると、A14 が「一致した」と嘘をつく)。
 */

import { describe, expect, it } from 'vitest';
import { extractGuardEnv } from '../../../lib/trace/extract-guard-env.js';

describe('extractGuardEnv', () => {
  it('guardEnv が無いファイルは null(対象外)', () => {
    expect(extractGuardEnv('export const x = 1;\n')).toBeNull();
  });

  it('空のオブジェクトは鍵ゼロ(ガードを持たない操作)', () => {
    expect(extractGuardEnv('  guardEnv: () => ({}),\n')).toEqual({ keys: [], unreadable: false });
  });

  it('クォートした鍵(ドットを含むパス)を読む', () => {
    const source = "  guardEnv: ({ workshop }) => ({ 'workshop.state': workshop?.state ?? null }),\n";

    expect(extractGuardEnv(source)).toEqual({ keys: ['workshop.state'], unreadable: false });
  });

  it('短縮記法(now)と複数の鍵を出現順に読む', () => {
    const source = "  guardEnv: ({ workshop, now }) => ({ now, 'workshop.starts_at': workshop.startsAt }),\n";

    expect(extractGuardEnv(source)).toEqual({ keys: ['now', 'workshop.starts_at'], unreadable: false });
  });

  it('プレフィクスの無い鍵(対象自身の状態)を読む', () => {
    expect(extractGuardEnv('  guardEnv: ({ entry }) => ({ state: entry.state }),\n')).toEqual({
      keys: ['state'],
      unreadable: false,
    });
  });

  it('改行と入れ子(三項・関数呼び出し)があっても最上位の鍵だけを読む', () => {
    const source = [
      '  guardEnv: ({ entry, workshop, now }) => ({',
      '    now,',
      "    'entry.state': entry === null ? null : entry.state,",
      "    'workshop.state': expected(workshop, { fallback: null }),",
      '  }),',
    ].join('\n');

    expect(extractGuardEnv(source)).toEqual({
      keys: ['now', 'entry.state', 'workshop.state'],
      unreadable: false,
    });
  });

  it('文字列の中の括弧・カンマに釣られない', () => {
    const source = "  guardEnv: () => ({ 'workshop.state': label('a, b) {'), state: '}' }),\n";

    expect(extractGuardEnv(source)).toEqual({ keys: ['workshop.state', 'state'], unreadable: false });
  });

  it('引数を 2 つ取る形(編集の定型)も読む', () => {
    const source = "  guardEnv: (_target, { workshop }) => ({ 'workshop.state': workshop?.state ?? null }),\n";

    expect(extractGuardEnv(source)).toEqual({ keys: ['workshop.state'], unreadable: false });
  });

  it('ブロック本体は読めない形として返す(黙って空にしない)', () => {
    const source = '  guardEnv: (facts) => {\n    return { state: facts.state };\n  },\n';

    expect(extractGuardEnv(source)).toEqual({ keys: [], unreadable: true });
  });

  it('計算された鍵・スプレッドは読めない形として返す', () => {
    expect(extractGuardEnv('  guardEnv: () => ({ [key]: 1 }),\n')?.unreadable).toBe(true);
    expect(extractGuardEnv('  guardEnv: () => ({ ...base }),\n')?.unreadable).toBe(true);
  });

  it('型宣言だけ(定型そのもの)は読めない形として返す —— 呼び側が対象から外す', () => {
    const source = '  readonly guardEnv: (facts: TFacts, actorId: string | null) => GuardEnv;\n';

    expect(extractGuardEnv(source)).toEqual({ keys: [], unreadable: true });
  });
});
