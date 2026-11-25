/**
 * M9(台帳が `avoid` に挙げた綴りが本文に出ている)の規約網羅テスト。
 *
 * 対象の要求(book-human-face.md §4「検査」): 重さは warning。**いちばん効く 1 本**であり、
 * 同義語の統合(例: 固定物 → fixture など)の再発を止める。
 *   - 旧綴りが本文に出ていれば、ファイル 1 件につき 1 件の warning にまとめる
 *   - 例示の印(`例:`)のある行は外す(旧綴りを説明するために挙げている行)
 *   - 語の境界を見る(`閉世界` の中の `世界` は数えない)
 *   - 台帳の語そのものは数えない
 *   - 英字の綴り(例: `parity`)は、識別子(`-` `.` `/` でつながる)なら数えず、散文なら数える
 *   - コードのコメントも本文と同じに読む(コードの文字列は読まない)
 *   - **引用は読まない**: `> ` で始まる引用ブロックと、かぎ括弧「」の中(人の発言・検査の出力の写しは置換しない)
 */

import { describe, expect, it } from 'vitest';
import { verifyAvoidedSpellings } from '../../../../lib/terms/verifiers/m9-avoided-spelling.js';
import { commentProseLines } from '../../../../lib/terms/prose.js';
import { corpus, ledger, proseFile, term } from '../../../helpers/terms-builder.js';

const FIXTURE = term('fixture', { id: 'fixture', origin: 'english', avoid: ['固定物'] });

describe('M9 旧綴りの再発', () => {
  it('avoid の綴りが出ていれば warning(場所と直し先の語を載せる)', () => {
    const findings = verifyAvoidedSpellings(
      ledger([FIXTURE]),
      corpus([proseFile('docs/rules/a.md', '前置き\nテストの固定物を置く\n')]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('M9');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('固定物');
    expect(findings[0]?.message).toContain('fixture');
    expect(findings[0]?.location).toEqual({ file: 'docs/rules/a.md', pointer: 'L2' });
    expect(findings[0]?.counterexample?.at).toBe('docs/rules/a.md:2');
  });

  it('同じファイルの複数箇所は 1 件にまとめる(直すときは 1 ファイルをまとめて見直す)', () => {
    const findings = verifyAvoidedSpellings(
      ledger([FIXTURE]),
      corpus([proseFile('docs/rules/a.md', '固定物\n固定物\n'), proseFile('docs/rules/b.md', '固定物')]),
    );

    expect(findings).toHaveLength(2);
    expect(findings[0]?.counterexample?.occurrences).toBe('2');
    expect(findings[1]?.counterexample?.occurrences).toBe('1');
  });

  it('例示の印のある行は外す', () => {
    const findings = verifyAvoidedSpellings(
      ledger([FIXTURE]),
      corpus([proseFile('docs/rules/a.md', '旧綴りは使わない(例: 固定物)\n')]),
    );

    expect(findings).toEqual([]);
  });

  it('旧綴りが無ければ通る', () => {
    const findings = verifyAvoidedSpellings(ledger([FIXTURE]), corpus([proseFile('docs/rules/a.md', 'fixture を置く')]));

    expect(findings).toEqual([]);
  });

  it('語の境界を見る(閉世界の中の世界は数えない。単独の世界は数える)', () => {
    const world = term('world', { id: 'world', origin: 'english', avoid: ['世界'] });

    const clean = verifyAvoidedSpellings(ledger([world]), corpus([proseFile('a.md', '閉世界の外')]));
    const dirty = verifyAvoidedSpellings(ledger([world]), corpus([proseFile('a.md', '閉世界と、RLS の世界')]));

    expect(clean).toEqual([]);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]?.counterexample?.occurrences).toBe('1');
  });

  it('同じ綴りを 2 つの語が禁じていれば、直し先の語を両方挙げて 1 回だけ数える', () => {
    const step = term('段', { id: 'step', avoid: ['ステップ'] });
    const procedure = term('手順', { id: 'procedure', avoid: ['ステップ'] });

    const findings = verifyAvoidedSpellings(ledger([step, procedure]), corpus([proseFile('a.md', '3 ステップで進む')]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.occurrences).toBe('1');
    expect(findings[0]?.message).toContain('段');
    expect(findings[0]?.message).toContain('手順');
  });

  it('avoid を持たない台帳では何も見ない', () => {
    const findings = verifyAvoidedSpellings(ledger([term('注釈')]), corpus([proseFile('a.md', '注釈と固定物')]));

    expect(findings).toEqual([]);
  });
});

describe('M9 英字の綴り(例: parity)は識別子を数えない', () => {
  const PARITY = term('突合', { id: 'parity', avoid: ['parity'] });

  it('散文の綴りは数え、識別子(例: data-table-parity・パス・ファイル名)は数えない', () => {
    const prose = verifyAvoidedSpellings(ledger([PARITY]), corpus([proseFile('a.md', 'DDL の parity が緑になる\n')]));
    const identifiers = verifyAvoidedSpellings(
      ledger([PARITY]),
      corpus([proseFile('b.md', '検査 ID は data-table-parity。`lib/parity/x.ts` と policy.parity.test.ts と rls_parity\n')]),
    );

    expect(prose).toHaveLength(1);
    expect(prose[0]?.message).toContain('突合');
    expect(identifiers).toEqual([]);
  });

  it('識別子と散文が 1 行に混ざれば、散文の分だけ数える', () => {
    const findings = verifyAvoidedSpellings(
      ledger([PARITY]),
      corpus([proseFile('a.md', 'data-table-parity は parity の検査\n')]),
    );

    expect(findings[0]?.counterexample?.occurrences).toBe('1');
  });
});

describe('M9 コードのコメント', () => {
  const FIXTURE = term('fixture', { id: 'fixture', origin: 'english', avoid: ['固定物'] });

  it('コメントの旧綴りは数え、コードの文字列の旧綴りは数えない', () => {
    const source = "const label = '固定物'; // 固定物を置く\nconst other = '固定物';\n";

    const findings = verifyAvoidedSpellings(
      ledger([FIXTURE]),
      corpus([{ file: 'legacy/spec-tools/lib/a.ts', lines: commentProseLines(source) }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.at).toBe('legacy/spec-tools/lib/a.ts:1');
    expect(findings[0]?.counterexample?.occurrences).toBe('1');
  });

  it('コメントの `例:` の行は外す', () => {
    const findings = verifyAvoidedSpellings(
      ledger([FIXTURE]),
      corpus([{ file: 'legacy/spec-tools/lib/a.ts', lines: commentProseLines('/** 旧綴り(例: 固定物)。 */\n') }]),
    );

    expect(findings).toEqual([]);
  });
});

describe('M9 引用は読まない', () => {
  const STEP = term('段', { id: 'step', avoid: ['段階'] });

  it('`> ` の引用ブロックの行は数えない(隣の普通の行は数える)', () => {
    const findings = verifyAvoidedSpellings(
      ledger([STEP]),
      corpus([proseFile('a.md', '> 最初の段階であり\n> 段階を踏む\n本文の段階\n')]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.at).toBe('a.md:3');
  });

  it('かぎ括弧「」の中は数えず、外の同じ綴りは数える', () => {
    const quoted = verifyAvoidedSpellings(
      ledger([STEP]),
      corpus([proseFile('a.md', 'ユーザーの方針: 「最初の段階であり、先のコストを払う」\n')]),
    );
    const mixed = verifyAvoidedSpellings(ledger([STEP]), corpus([proseFile('b.md', '「段階」と書かれた段階\n')]));

    expect(quoted).toEqual([]);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]?.counterexample?.occurrences).toBe('1');
  });

  it('同じ行で閉じていない「は引用ではない(黙って見逃さない)', () => {
    const findings = verifyAvoidedSpellings(ledger([STEP]), corpus([proseFile('a.md', '「閉じ忘れた段階\n')]));

    expect(findings).toHaveLength(1);
  });

  it('コードのコメントの中のかぎ括弧も同じに読む', () => {
    const findings = verifyAvoidedSpellings(
      ledger([STEP]),
      corpus([{ file: 'a.ts', lines: commentProseLines('// 出力は「2 段階」と出る\n// 2 段階で進む\n') }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.at).toBe('a.ts:2');
  });
});

describe('M9 英字の綴りは大文字小文字を区別しない', () => {
  it('大文字小文字の違う散文(例: Parity / PARITY)は数え、CamelCase の識別子は数えない', () => {
    const PARITY = term('突合', { id: 'parity', avoid: ['parity'] });

    const prose = verifyAvoidedSpellings(ledger([PARITY]), corpus([proseFile('a.md', 'Parity テストと PARITY の検査\n')]));
    const identifiers = verifyAvoidedSpellings(
      ledger([PARITY]),
      corpus([proseFile('b.md', '`expectDdlParity` と `checkVariantParity`\n')]),
    );

    expect(prose[0]?.counterexample?.occurrences).toBe('2');
    expect(identifiers).toEqual([]);
  });
});
