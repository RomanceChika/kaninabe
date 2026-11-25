/**
 * V16 enum の表示名(`labels`)—— 人が選ぶ値には人の言葉が要る。
 *
 * domain-spec-writing.md §entity_spec の要求:
 * 「`type: enum(...)` の欄が**どれかの action_spec の `input` に現れる**なら `labels` は必須。
 *  `labels` のキー集合は enum の値集合と一致する」。
 *
 * ## なぜこの検査が要るのか
 *
 * 入力に現れる enum は、いつか画面の `select` になる。表示名の置き場が仕様に無かったあいだ、
 * 画面はそれを手で持っていた(`ENTRY_KIND_LABELS` / `CLIPBOARD_LABELS` / `ENUM_OPTION_LABELS`
 * の 3 つ。⑯c-2 報告 §9-2)—— 値を 1 つ足したときに画面の対応表を直し忘れる形であり、
 * 生成フォームは値そのもの(`performance`)を人に見せていた。表示名を仕様に置けば写像は
 * 生成物になり、二重管理が消える。
 *
 * 入力に現れない enum(内部の区分など)は任意である —— 人が選ばない値に人の言葉を強いても、
 * 「書いたが誰も読まない宣言」が増えるだけになる。
 */

import type { EntitySpec, FieldDef, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';
import { inputValue } from '../../kernel/input-state.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V16';

/** V16 の指摘を組み立てる。 */
function finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * その欄がどれかの action_spec の `input` に現れるか。
 *
 * @param ctx 検証器に注入された共有サービス(action_spec を含む)
 * @param entity エンティティ名
 * @param field 欄の名前
 * @returns 現れれば true(action_spec が使えない構成では常に false。使えない理由は報告する)
 */
function appearsInInput(ctx: VerifyContext, entity: string, field: string): boolean {
  // 未選択(採っていない)は「入力に現れる欄が無い」が事実。阻害は「分からない」ので、この判定(labels 必須)は出さない
  // —— 見ていないことは実行ログが報告する(`verify/domain-input-notes.ts`)。
  const model = inputValue(ctx.actions);
  if (model === undefined) return false;
  return model.actions.some((action) =>
    action.input.some((ref) => ref.entity === entity && ref.field === field),
  );
}

/** 1 つの enum 欄を見る。 */
function checkField(entity: EntitySpec, field: FieldDef, ctx: VerifyContext): Finding[] {
  if (field.type.kind !== 'enum') return [];
  const values = field.type.values;
  const labels = field.labels;
  if (labels === undefined) {
    if (!appearsInInput(ctx, entity.entity, field.name)) return [];
    return [
      finding({
        message: `${entity.entity}.${field.name} は入力に現れる enum ですが labels がありません`,
        location: field.location,
        suggestion:
          `labels に enum の全値の表示名を書く(例: labels: { ${values.join(': …, ')}: … })。` +
          '人が選ぶ値の表示名は仕様が持ち、画面は生成物(`{entity}EnumLabels`)を引くだけにする',
        counterexample: { entity: entity.entity, field: field.name, values: values.join(', ') },
      }),
    ];
  }
  const keys = Object.keys(labels);
  const missing = values.filter((value) => !keys.includes(value));
  const extra = keys.filter((key) => !values.includes(key));
  const findings: Finding[] = [];
  if (missing.length > 0) {
    findings.push(
      finding({
        message: `${entity.entity}.${field.name} の labels に ${missing.join(', ')} の表示名がありません`,
        location: field.location,
        suggestion: 'labels のキー集合は enum の値集合と一致させる(足りない値の表示名を足す)',
        counterexample: { entity: entity.entity, field: field.name, missing: missing.join(', ') },
      }),
    );
  }
  if (extra.length > 0) {
    findings.push(
      finding({
        message: `${entity.entity}.${field.name} の labels に enum の値でないキー(${extra.join(', ')})があります`,
        location: field.location,
        suggestion:
          `enum の値は ${values.join(' / ')} だけである。綴り違いなら直し、消えた値の名残なら削除する`,
        counterexample: { entity: entity.entity, field: field.name, extra: extra.join(', ') },
      }),
    );
  }
  return findings;
}

/** V16 の実装。 */
export const enumLabelsVerifier: Verifier = {
  id: VERIFIER_ID,
  title: 'enum の表示名 — 入力に現れる enum は labels 必須・キー集合 = 値集合',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];
    for (const specs of model.aggregates.values()) {
      const entity = specs.entity;
      if (entity === undefined) continue;
      for (const field of entity.fields) findings.push(...checkField(entity, field, ctx));
    }
    return findings;
  },
};
