/**
 * V19 のうち `records_time`(遷移が「いま」を書き留める列)の規約網羅テスト。
 * 対象の要求(domain-spec-writing.md §state_spec):
 *   (a) その集約の entity_spec に実在する
 *   (b) **`datetime` 型**である
 *   (c) 行で必ず値がある列ではない(`required` / `auto` / `state(...)` を弾く)
 *   (d) `access_spec` の `transition_writes` に載っている
 *   (e) 同じイベントが `records_actor` / `clears` と同じ列を並べていない
 *   (f) **値の口(引数)は要らない** —— 書く値は SQL の `now()` である
 */

import { describe, expect, it } from 'vitest';
import { recordsActorVerifier } from '../../../../lib/verify/verifiers/v19-records-actor.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  specModel,
} from '../../../helpers/model-builder-v8plus.js';
import { loadedInput, NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

/** 検査は仕様モデルだけを見る(data_table が無い構成)。 */
const CTX = { guards: undefined, ...NO_DOMAIN_INPUTS } as unknown as VerifyContext;

/**
 * 文書(document)1 集約と、実行者の集約(staff)。
 *
 * `archived_at` は任意の `datetime` で `transition_writes` に載っている列(遷移が書く列だけを載せる)、
 * `disposable_after` は必須の `datetime`、`created_at` は `auto` の `datetime`、
 * `title` は `datetime` でない列、`noted_at` は transition_writes に載っていない `datetime` である。
 *
 * @param recordsTime `archive` の `records_time`
 * @param extra 同じイベントに重ねる宣言
 * @returns 仕様モデル
 */
function model(
  recordsTime: readonly string[],
  extra: { readonly recordsActor?: readonly string[]; readonly clears?: readonly string[] } = {},
) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'staff',
        entity: entitySpec('staff', [field('is_curator', { kind: 'boolean' }, { session: true })]),
      }),
      aggregate({
        name: 'document',
        entity: entitySpec('document', [
          field('state', { kind: 'state', machine: 'document' }, { required: true }),
          field('archived_at', { kind: 'datetime' }),
          field('archived_by', { kind: 'ref', entity: 'staff' }),
          field('disposable_after', { kind: 'datetime' }, { required: true }),
          field('created_at', { kind: 'datetime' }, { auto: true }),
          field('noted_at', { kind: 'datetime' }),
          field('title', { kind: 'string' }),
        ]),
        stateMachines: [
          machine({
            machine: 'document',
            states: ['circulating', 'archived'],
            initial: 'circulating',
            events: [
              event({
                id: 'archive',
                from: ['circulating'],
                to: 'archived',
                recordsTime,
                ...extra,
              }),
            ],
          }),
        ],
        access: accessSpec('document', {
          transitionWrites: ['archived_at', 'archived_by', 'disposable_after', 'created_at'].filter((column) =>
            [...recordsTime, ...(extra.recordsActor ?? []), ...(extra.clears ?? [])].includes(column),
          ),
        }),
      }),
    ],
  });
}

/** その宣言で出る指摘の文面。 */
function findings(
  recordsTime: readonly string[],
  extra: { readonly recordsActor?: readonly string[]; readonly clears?: readonly string[] } = {},
): readonly string[] {
  return recordsActorVerifier.verify(model(recordsTime, extra), CTX).map((finding) => finding.message);
}

describe('V19 遷移が「いま」を書き留める列(records_time)の接地', () => {
  it('実在し・datetime で・空にでき・transition_writes に載っている列なら通る', () => {
    expect(findings(['archived_at'])).toEqual([]);
  });

  it('宣言が無ければ何も見ない', () => {
    expect(findings([])).toEqual([]);
  });

  it('実在しない列はエラーにする', () => {
    expect(findings(['nowhere']).join('\n')).toContain('実在しません');
  });

  it('datetime でない列はエラーにする(書き留めるのは時刻である)', () => {
    expect(findings(['title']).join('\n')).toContain('datetime 型ではありません');
  });

  it('必須の列はエラーにする(遷移より前は「まだ起きていない」= 空である)', () => {
    expect(findings(['disposable_after']).join('\n')).toContain('行では必ず値がある列です');
  });

  it('作成時刻(auto)の列はエラーにする(遷移が書き直す列ではない)', () => {
    expect(findings(['created_at']).join('\n')).toContain('行では必ず値がある列です');
  });

  it('transition_writes に載っていない列はエラーにする', () => {
    expect(findings(['noted_at']).join('\n')).toContain('transition_writes に宣言されていません');
  });

  it('同じイベントで records_actor と重ねることはできない', () => {
    expect(findings(['archived_at'], { recordsActor: ['archived_at'] }).join('\n')).toContain(
      '両方に並べています',
    );
  });

  it('同じイベントで clears と重ねることはできない', () => {
    expect(findings(['archived_at'], { clears: ['archived_at'] }).join('\n')).toContain(
      '両方に並べています',
    );
  });

  it('値の口(引数)は要らない —— 書く値は SQL の now() である', () => {
    const ctx = {
      guards: undefined,
      dataTables: loadedInput(dataTableModel([
        dataTable('documents', {
          entity: 'document',
          functions: [
            {
              name: 'apply_document_transition',
              args: ['uuid', 'text'],
              params: ['p_document_id', 'p_expected_state'],
              kind: 'rpc',
              shape: 'transition',
              alsoWrites: [],
            },
          ],
        }),
      ])),
    } as unknown as VerifyContext;

    expect(recordsActorVerifier.verify(model(['archived_at']), ctx)).toEqual([]);
  });
});
