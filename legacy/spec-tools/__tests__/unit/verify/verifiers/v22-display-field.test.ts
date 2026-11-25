/**
 * V22(行の名前の欄)の規約網羅テスト。
 * 対象の要求(domain-spec-writing.md §entity_spec):
 *   `display_field` は `fields` に居る `string` / `text` の欄の名前。任意(書かなければ何も言わない)。
 */

import { describe, expect, it } from 'vitest';
import { displayFieldVerifier } from '../../../../lib/verify/verifiers/v22-display-field.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const CTX: VerifyContext = { guards: undefined as never, roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

/** 会場の集約(`displayField` は与えたときだけ持たせる)。 */
function modelWith(displayField?: string) {
  const entity = entitySpec('venue', [
    field('id', { kind: 'uuid' }),
    field('name', { kind: 'string' }),
    field('memo', { kind: 'text' }),
    field('capacity', { kind: 'integer' }),
  ]);
  return specModel({
    aggregates: [aggregate({ name: 'venue', entity: displayField === undefined ? entity : { ...entity, displayField } })],
  });
}

describe('V22 行の名前の欄', () => {
  it('書かなければ何も言わない', () => {
    expect(displayFieldVerifier.verify(modelWith(), CTX)).toEqual([]);
  });

  it('string / text の欄を指していれば通す', () => {
    expect(displayFieldVerifier.verify(modelWith('name'), CTX)).toEqual([]);
    expect(displayFieldVerifier.verify(modelWith('memo'), CTX)).toEqual([]);
  });

  it('fields に居ない欄はエラー(候補を示す)', () => {
    const findings = displayFieldVerifier.verify(modelWith('title'), CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'V22', severity: 'error' });
    expect(findings[0]?.message).toContain('venue の display_field title は fields に居ません');
    expect(findings[0]?.suggestion).toContain('name');
    expect(findings[0]?.location.pointer).toBe('display_field');
    expect(findings[0]?.counterexample).toEqual({ entity: 'venue', display_field: 'title' });
  });

  it('文字列でない欄(数値・uuid)はエラー(型を示す)', () => {
    const numeric = displayFieldVerifier.verify(modelWith('capacity'), CTX);
    const key = displayFieldVerifier.verify(modelWith('id'), CTX);

    expect(numeric).toHaveLength(1);
    expect(numeric[0]?.message).toContain('文字列の欄ではありません(型は integer)');
    expect(numeric[0]?.counterexample).toEqual({ entity: 'venue', display_field: 'capacity', type: 'integer' });
    expect(key[0]?.message).toContain('型は uuid');
  });

  it('entity_spec の無い集約は読み飛ばす', () => {
    expect(displayFieldVerifier.verify(specModel({ aggregates: [aggregate({ name: 'venue' })] }), CTX)).toEqual([]);
  });
});
