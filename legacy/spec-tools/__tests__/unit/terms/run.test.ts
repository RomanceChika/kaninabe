/**
 * 用語の台帳の検証(M7〜M9)と文体の検査(M12)の実行口のテスト。
 *
 * 台帳が無い環境では何も実行せず、あれば M7・M8・M9・M12 を順に流す。
 */

import { describe, expect, it } from 'vitest';
import { runTermVerification } from '../../../lib/terms/run.js';
import { corpus, ledger, proseFile, term } from '../../helpers/terms-builder.js';

describe('runTermVerification', () => {
  it('台帳が無ければ実行しない(台帳を開設していない製品でも壊れない)', () => {
    const result = runTermVerification({ available: false, ledger: null }, corpus([]));

    expect(result).toEqual({ findings: [], available: false, termCount: 0 });
  });

  it('台帳があれば M7・M8・M9 を流す', () => {
    const model = {
      available: true,
      ledger: ledger([
        term('名札', { id: 'tag', first: 'a.md', avoid: ['札'] }),
        term('窓', { id: 'window', first: 'a.md' }),
      ]),
    };

    const result = runTermVerification(model, corpus([proseFile('docs/rules/a.md', '名札 と 札')], { 'a.md': '名札' }));

    expect(result.available).toBe(true);
    expect(result.termCount).toBe(2);
    expect(result.findings.map((finding) => finding.verifier)).toEqual(['M7', 'M8', 'M9']);
  });

  it('人が書く文(summary)があれば M12 も流す', () => {
    const model = { available: true, ledger: ledger([]) };
    const summaries = [{ file: 'docs/specs/domain/x/entity.md', pointer: 'summary', text: '段である(戻せる)。' }];

    const result = runTermVerification(model, corpus([], {}, summaries));

    expect(result.findings.map((finding) => finding.verifier)).toEqual(['M12']);
  });

  it('人が書く文の語が仕様にも台帳にも無ければ M10 も流す(台帳の語と仕様の語は通る)', () => {
    const model = { available: true, ledger: ledger([term('マトリクス', { id: 'matrix', first: 'a.md' })]) };
    const sentence = (text: string): { file: string; pointer: string; text: string } => ({
      file: 'docs/specs/domain/x/entity.md',
      pointer: 'summary',
      text,
    });
    const files = [proseFile('docs/rules/a.md', 'マトリクス')];
    const texts = { 'a.md': 'マトリクス' };

    const bad = runTermVerification(model, corpus(files, texts, [sentence('世話役が盛況を作ります。')], '世話役 催し'));
    const good = runTermVerification(model, corpus(files, texts, [sentence('世話役がマトリクスを読みます。')], '世話役 催し'));

    expect(bad.findings.map((finding) => finding.verifier)).toEqual(['M10']);
    expect(good.findings).toEqual([]);
  });
});
