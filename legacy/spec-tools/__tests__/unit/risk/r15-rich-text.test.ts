/**
 * R15(書式つきの本文として描いている欄は `format: markdown` で宣言する)の単体テスト。
 * 止める形(欄の参照でない式・宣言の無い欄)と受け入れる形(宣言のある欄・テストの木・走査できないとき)を 1 つずつ固定する。
 */

import { describe, expect, it } from 'vitest';
import { verifyRichText } from '../../../lib/risk/verifiers/r15-rich-text.js';
import type { RichTextScan, RichTextSite } from '../../../lib/risk/rich-text-scan.js';
import type { FieldDef } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder.js';

const markdownField: FieldDef = { ...field('long_note', { kind: 'text' }), format: 'markdown', maxLength: 20000 };
const plainField: FieldDef = { ...field('body', { kind: 'text' }), maxLength: 20000 };
const model = specModel([
  aggregate('page', { entity: entitySpec('page', { fields: [markdownField] }) }),
  aggregate('inquiry', { entity: entitySpec('inquiry', { fields: [plainField] }) }),
]);

const site = (argument: string, extra: Partial<RichTextSite> = {}): RichTextSite => ({ file: 'src/screens/a.tsx', sink: 'MarkdownView', argument, ...extra });
const scan = (...sites: RichTextSite[]): RichTextScan => ({ available: true, sites });
const check = (richText: RichTextScan) => verifyRichText({ model, richText });

describe('R15 受け入れる形', () => {
  it('format: markdown の欄の参照(camelCase 一致・?. もよい)は通る', () => {
    expect(check(scan(site('row.longNote'), site('page.longNote', { sink: 'renderMarkdown' }), site('row.child?.longNote', { sink: 'plainTextOf' })))).toEqual([]);
  });

  it('テストの木は見ない(敵対的な値を渡して描かせる)', () => {
    expect(check(scan(site('hostile', { file: 'src/__tests__/a.test.tsx' }), site('x(y)', { file: 'src/a.spec.ts' })))).toEqual([]);
  });

  it('走査できなかったとき(実装の木が無い)は何も言わない', () => {
    expect(check({ available: false, sites: [] })).toEqual([]);
  });

  it('渡している場所が無ければ違反なし', () => {
    expect(check(scan())).toEqual([]);
  });
});

describe('R15 止める形', () => {
  it('format: markdown でない欄を書式つきで描くと止まる', () => {
    const findings = check(scan(site('row.title')));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'R15', severity: 'error', counterexample: { file: 'src/screens/a.tsx', sink: 'MarkdownView', field: 'title' } });
    expect(findings[0]?.message).toContain('format: markdown で宣言された欄ではありません');
    expect(findings[0]?.suggestion).toContain('type: text');
  });

  it('format の無い欄(別の集約の同名でも、markdown の欄が無い名前なら)止まる', () => {
    expect(check(scan(site('inquiry.body', { sink: 'renderMarkdown' })))).toHaveLength(1);
  });

  it.each([
    ['呼び出しの結果', 'trim(row.longNote'],
    ['演算', 'a + b'],
    ['添字', 'row["longNote"]'],
    ['リテラル', '"# x"'],
    ['空', ''],
  ])('欄の参照でない式は止まる: %s', (_name, argument) => {
    const findings = check(scan(site(argument)));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('欄の参照でない式');
    expect(findings[0]?.counterexample).toMatchObject({ argument });
  });

  it('違反は場所ごとに 1 件ずつ出る', () => {
    expect(check(scan(site('row.title'), site('row.longNote'), site('row.other', { sink: 'plainTextOf' })))).toHaveLength(2);
  });
});
