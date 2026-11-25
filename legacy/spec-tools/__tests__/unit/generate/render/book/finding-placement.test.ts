/**
 * 検証器の警告を章に配る(`render/book/finding-placement.ts`)のテスト。
 *
 * 警告は「まだ通していない受け入れ」である。渡されていなければ null(0 件とは別)、配るのは `場所:` の
 * ファイルで、章のブロックを引けないものは「どの章にも配れない」側に残る。
 */

import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../../../../lib/kernel/finding.js';
import {
  clip,
  extensionHits,
  pendingFindings,
  pendingInFiles,
  pendingLine,
  pendingOfChapter,
  unplacedCounts,
  unplacedFindings,
} from '../../../../../lib/generate/render/book/finding-placement.js';
import type { ExtensionLedgerModel } from '../../../../../lib/model/extension/types.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

const warn = (id: string, file: string, extra: { pointer?: string; message?: string; suggestion?: string } = {}): ReturnType<typeof makeFinding> =>
  makeFinding(id, {
    severity: 'warning',
    message: extra.message ?? `${id} の警告`,
    location: extra.pointer === undefined ? { file } : { file, pointer: extra.pointer },
    suggestion: extra.suggestion ?? '直す。理由は別の文。',
  });

const FINDINGS = [
  warn('Y10', 'docs/specs/domain/workshop/invariants.md'),
  warn('T8', 'docs/specs/backend/data/tables/workshops.md'),
  warn('W1', 'legacy/spec-tools/lib/semantics/x.ts'),
  makeFinding('V1', { message: 'エラー', location: { file: 'docs/specs/domain/workshop/states.md' }, suggestion: 'x' }),
];

describe('pendingFindings', () => {
  it('検証の結果が渡されていなければ null(0 件とは別)', () => {
    expect(pendingFindings(bookCtx())).toBeNull();
  });

  it('渡されたものから warning だけを取る(error は生成を止める側が持つ)', () => {
    const pending = pendingFindings({ ...bookCtx(), findings: FINDINGS });

    expect(pending?.map((finding) => finding.verifier)).toEqual(['Y10', 'T8', 'W1']);
  });

  it('空の一覧が渡されていれば、空(未集計ではなく 0 件)', () => {
    expect(pendingFindings({ ...bookCtx(), findings: [] })).toEqual([]);
  });
});

/** T8 を拡張候補 X-a に当てる台帳。 */
const LEDGER: ExtensionLedgerModel = {
  available: true,
  ledger: {
    candidates: [
      { id: 'X-a', statement: '何かが組めない', rules: ['T8'], status: 'open', since: '2026-10-03', ref: 'BACKLOG.md', location: { file: 'l.md', pointer: 'candidates.X-a' } },
    ],
    location: { file: 'l.md' },
  },
};

describe('台帳が渡されたときの pendingFindings(拡張候補は仕組みの宿題で、まだ通していない受け入れに数えない)', () => {
  it('拡張候補に当たらない警告(未分類)だけを取る', () => {
    const pending = pendingFindings({ ...bookCtx(), findings: FINDINGS, extensionLedger: LEDGER });

    expect(pending?.map((finding) => finding.verifier)).toEqual(['Y10', 'W1']);
  });

  it('台帳が読めなかった(ledger が null)ときは、警告はすべて未分類として数える', () => {
    const pending = pendingFindings({ ...bookCtx(), findings: FINDINGS, extensionLedger: { available: true, ledger: null } });

    expect(pending?.map((finding) => finding.verifier)).toEqual(['Y10', 'T8', 'W1']);
  });

  it('検証の結果が渡されていなければ、台帳があっても null(未集計)', () => {
    expect(pendingFindings({ ...bookCtx(), extensionLedger: LEDGER })).toBeNull();
  });
});

describe('extensionHits(拡張候補ごとの当たる警告)', () => {
  it('候補ごとに、当たる警告を宣言順に集める', () => {
    const rows = extensionHits({ ...bookCtx(), findings: FINDINGS, extensionLedger: LEDGER });

    expect(rows?.map((row) => [row.candidate.id, row.hits.map((finding) => finding.verifier)])).toEqual([['X-a', ['T8']]]);
  });

  it('検証の結果・台帳のどちらかが無ければ null', () => {
    expect(extensionHits({ ...bookCtx(), findings: FINDINGS })).toBeNull();
    expect(extensionHits({ ...bookCtx(), extensionLedger: LEDGER })).toBeNull();
    expect(extensionHits({ ...bookCtx(), findings: FINDINGS, extensionLedger: { available: true, ledger: null } })).toBeNull();
  });
});

describe('配り方', () => {
  const pending = FINDINGS.filter((finding) => finding.severity === 'warning');

  it('ファイルの集合に属するものだけを取る', () => {
    expect(pendingInFiles(pending, new Set(['docs/specs/backend/data/tables/workshops.md'])).map((finding) => finding.verifier)).toEqual(['T8']);
  });

  it('章のブロック(標識と同じ blockOf)に配られるものだけを、その章に配る', () => {
    const chapter = pendingOfChapter(pending, bookModel(), TEST_ROOTS, 'docs/book/domain/workshop.md');

    expect(chapter.map((finding) => finding.verifier)).toEqual(['Y10']);
  });

  it('どの章にも配れないもの(仕様の木の外の場所)は、配れなかった側に残る', () => {
    expect(unplacedFindings(pending, bookModel(), TEST_ROOTS).map((finding) => finding.verifier)).toEqual(['W1']);
  });
});

describe('pendingLine(ID・場所・対処の 1 行。全文は検証器の出力に任せる)', () => {
  it('場所は仕様の木からの相対パス(ファイルまで。論理位置・行は載せない)、対処は最初の 1 文', () => {
    const line = pendingLine(
      warn('T2', 'docs/specs/backend/data/tables/x.md', { pointer: 'indexes.i', suggestion: '削除を検討する。理由を書くのでもよい。' }),
      TEST_ROOTS,
    );

    expect(line).toEqual({ id: 'T2', what: 'T2 の警告', where: 'backend/data/tables/x.md', fix: '削除を検討する' });
  });

  it('長いメッセージ・対処は 80 字で切る(省略の印つき)', () => {
    const line = pendingLine(warn('Y10', 'docs/specs/domain/x.md', { message: 'あ'.repeat(120), suggestion: 'い'.repeat(120) }), TEST_ROOTS);

    expect([...line.what]).toHaveLength(81);
    expect(line.what.endsWith('…')).toBe(true);
    expect(line.fix.endsWith('…')).toBe(true);
  });

  it('clip は短ければそのまま、空白は 1 つに詰める', () => {
    expect(clip('短い', 80)).toBe('短い');
    expect(clip('a   b\n c', 80)).toBe('a b c');
  });
});

describe('unplacedCounts(配れない警告は ID と件数だけ。行や文面は生成物に入れない)', () => {
  it('ID ごとに件数を数え、ID の昇順で返す。同じファイルの位置違いは生成物に影響しない', () => {
    const counts = unplacedCounts([
      warn('W1', 'legacy/spec-tools/lib/a.ts', { pointer: 'L34', message: '一つめ' }),
      warn('M9', 'docs/design/x.md', { pointer: 'L1' }),
      warn('W1', 'legacy/spec-tools/lib/b.ts', { pointer: 'L99', message: '二つめ' }),
    ]);

    expect(counts).toEqual([
      { id: 'M9', count: 1 },
      { id: 'W1', count: 2 },
    ]);
    // 位置と文面を変えても、数は同じ(仕組みのコードの 1 行の変更で生成物が動かない)。
    expect(unplacedCounts([warn('W1', 'legacy/spec-tools/lib/a.ts', { pointer: 'L35' }), warn('W1', 'legacy/spec-tools/lib/b.ts')])).toEqual([
      { id: 'W1', count: 2 },
    ]);
  });

  it('警告が無ければ空', () => {
    expect(unplacedCounts([])).toEqual([]);
  });
});
