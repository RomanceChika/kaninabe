/**
 * 保証 fw_markdown_sanitize の見張り: 書式つきの本文として描いている欄が `format: markdown` で宣言されていなければ R15 が止める。
 * 検査の表(止める形・受け入れる形の全部)は `unit/risk/r15-rich-text.test.ts` が持ち、ここは台帳の見張りとして最小の一対を固定する。
 */

import { describe, expect, it } from 'vitest';
import { verifyRichText } from '../../lib/risk/verifiers/r15-rich-text.js';
import type { FieldDef } from '../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../helpers/model-builder.js';

const declared: FieldDef = { ...field('body', { kind: 'text' }), format: 'markdown', maxLength: 20000 };
const undeclared: FieldDef = { ...field('memo', { kind: 'text' }), maxLength: 20000 };
const model = specModel([aggregate('page', { entity: entitySpec('page', { fields: [declared, undeclared] }) })]);
const richText = (argument: string) => ({ available: true, sites: [{ file: 'src/screens/x.tsx', sink: 'MarkdownView' as const, argument }] });

describe('書式つきの本文の欄の宣言(R15)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-MD-002
  it('format: markdown でない欄を書式つきで描くと止まる', () => {
    expect(verifyRichText({ model, richText: richText('row.body') })).toEqual([]);
    const findings = verifyRichText({ model, richText: richText('row.memo') });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'R15', severity: 'error', counterexample: { field: 'memo' } });
  });
});
