import { describe, expect, it } from 'vitest';
import { renderDiff } from '../../../lib/diff/render.js';
import type { DiffOutcome, SemanticChange } from '../../../lib/diff/types.js';

/** 行 1 つを作る。 */
function change(partial: Partial<SemanticChange>): SemanticChange {
  return {
    axis: 'permission',
    direction: 'widened',
    subject: 'unit.open',
    before: null,
    after: null,
    text: '🔓 ひろがった',
    ...partial,
  };
}

/** 結果 1 つを作る。 */
function outcome(partial: Partial<DiffOutcome>): DiffOutcome {
  return { changes: [], problems: [], comparedFiles: 7, ...partial };
}

describe('renderDiff — 差分が無いとき', () => {
  it('何本と比べた結果の 0 かを書く', () => {
    expect(renderDiff(outcome({}), 'abc1234')).toContain('意味の差分はありません(基点 abc1234 / 生成物 7 本を比較)');
  });

  it('基点を HEAD~1 に倒したときは、そのことを出力に残す', () => {
    const markdown = renderDiff(outcome({}), 'HEAD~1', ['基点が無いので HEAD~1 に倒しました']);
    expect(markdown).toContain('> 基点が無いので HEAD~1 に倒しました');
  });

  it('読めなかった生成物があるときは言い切らない(黙って「差分なし」に倒さない)', () => {
    const markdown = renderDiff(
      outcome({ problems: [{ kind: 'unreadable', side: 'head', path: 'a/b.ts', reason: '閉じていません' }] }),
      'abc1234',
    );
    expect(markdown).toContain('判定できた範囲に意味の差分はありません');
    expect(markdown).toContain('判定できなかった生成物(1 件)');
    expect(markdown).toContain('`npm run generate:check` が先');
  });

  it('生成物が答えを出していない操作も言い切らせない', () => {
    const markdown = renderDiff(
      outcome({ problems: [{ kind: 'unanswered', side: 'base', path: 'r/u.json', reason: 'unit.update — world を作れません' }] }),
      'abc1234',
    );
    expect(markdown).toContain('判定できた範囲に意味の差分はありません');
    expect(markdown).toContain('権限の軸で結果表が答えていない操作(1 件)');
    expect(markdown).toContain('unit.update');
  });

  it('両版で同じことが起きていれば 1 行に畳む', () => {
    const same = { kind: 'unanswered', side: 'base', path: 'r/u.json', reason: '同じ理由' } as const;
    const markdown = renderDiff(outcome({ problems: [same, { ...same, side: 'head' }] }), 'abc1234');
    expect(markdown).toContain('(1 件)');
    expect(markdown).toContain('[両版]');
  });

  it('宣言が無かっただけのものは別の節に出す(赤ではない)', () => {
    const markdown = renderDiff(
      outcome({ problems: [{ kind: 'undeclared', side: 'base', path: 'a/b.ts', reason: 'export const x が見つかりません' }] }),
      'abc1234',
    );
    expect(markdown).toContain('意味の差分はありません(基点');
    expect(markdown).toContain('その版に宣言が無かったもの・判定していません(1 件)');
  });
});

describe('renderDiff — 差分があるとき', () => {
  it('**見えていないものの節が 🔓 より前に出る**', () => {
    const markdown = renderDiff(
      outcome({
        changes: [change({})],
        problems: [
          { kind: 'unreadable', side: 'head', path: 'a/b.ts', reason: '閉じていません' },
          { kind: 'unanswered', side: 'base', path: 'r/u.json', reason: 'unit.update' },
        ],
      }),
      'abc1234',
    );
    const unreadableAt = markdown.indexOf('### 判定できなかった生成物');
    const undecidedAt = markdown.indexOf('### 権限の軸で結果表が答えていない操作');
    const widenedAt = markdown.indexOf('### 🔓 広がった変化');
    expect(unreadableAt).toBeGreaterThan(-1);
    expect(undecidedAt).toBeGreaterThan(unreadableAt);
    expect(widenedAt).toBeGreaterThan(undecidedAt);
  });

  it('🔓 の行を先頭の節にまとめ、軸ごとの節にも出す', () => {
    const markdown = renderDiff(
      outcome({
        changes: [
          change({ direction: 'added', axis: 'screens', text: '➕ ふえた' }),
          change({ direction: 'widened', axis: 'rows', text: '🔓 ひろがった' }),
        ],
      }),
      'abc1234',
    );
    const widenedAt = markdown.indexOf('### 🔓 広がった変化(1 件)');
    const axisAt = markdown.indexOf('### 見える行(1 件)');
    expect(widenedAt).toBeGreaterThan(-1);
    expect(axisAt).toBeGreaterThan(widenedAt);
    expect(markdown).toContain('**2 件**の意味の差分があります');
    expect(markdown).toContain('### 画面(1 件)');
  });
});
