/**
 * V10 のうち、**`exclusion`(期間の重なりの排他)の `range` の接地**を見る部分。
 *
 * `keys` の実在は v10-invariant-formal.ts の `checkFormalKeys` が見る(uniqueness /
 * cardinality と同じ規則)。`range` だけ別に見るのは、**重なりを測る軸**なので型まで
 * 要るからである —— 文字列や整数の 2 列を range に書いた宣言は、DB 側の範囲型
 * (`tstzrange(...)`)に落ちない。開始と終了が同じフィールドであることはパーサーが弾く
 * (端の扱いは半開区間に固定されており、宣言では選べない)。
 *
 * このファイルの責務は `range` の接地だけである(`keys` の実在を見る `checkFormalKeys` とは見る欄が
 * 別で、`range` は型まで要る)。
 */

import type { InvariantDef, InvariantFormal, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { finding } from './v10-invariant-index.js';

/** 期間を表せるフィールド型(排他制約は範囲型に畳むので、時間軸の型に限る)。 */
const TEMPORAL_KINDS: readonly string[] = ['datetime', 'date'];

/**
 * `exclusion` の `range`(期間の 2 フィールド)がその集約に実在し、**時間軸の型**であることを見る。
 *
 * `keys` の実在は checkFormalKeys が見るが、`range` は「重なりを測る軸」なので型まで要る ——
 * 文字列や整数の 2 列を range に書いた宣言は、DB 側の `tstzrange(...)` に落ちない。
 * 開始と終了が同じフィールドであることはパーサーが弾く(端の扱いは半開に固定)。
 *
 * @param aggregate 不変条件を持つ集約名
 * @param model ドメイン仕様全体(フィールドの型を引く)
 */
export function checkExclusionRange(
  invariant: InvariantDef,
  formal: InvariantFormal | undefined,
  aggregate: string,
  model: SpecModel,
): Finding[] {
  if (formal?.kind !== 'exclusion') return [];
  const entity = model.aggregates.get(aggregate)?.entity;
  if (entity === undefined) return [];
  const findings: Finding[] = [];
  for (const name of formal.range) {
    const field = entity.fields.find((candidate) => candidate.name === name);
    if (field === undefined) {
      findings.push(
        finding(
          invariant,
          `formal.range の ${name} は ${aggregate} のフィールドではありません`,
          `${aggregate} の fields に ${name} を追加するか、range を実在するフィールドへ直してください`,
          { range: formal.range.join(', '), missing_field: name, entity: aggregate },
        ),
      );
      continue;
    }
    if (TEMPORAL_KINDS.includes(field.type.kind)) continue;
    findings.push(
      finding(
        invariant,
        `formal.range の ${name} は ${field.type.kind} 型です(期間の端は datetime / date でなければなりません)`,
        `${name} の型を datetime(または date)にするか、期間を表す 2 フィールドへ range を直してください。` +
          '重なりの判定は時間軸の範囲型に畳んで DB の排他制約が行うので、時間軸でない列では執行できません',
        { range: formal.range.join(', '), field: name, type: field.type.kind },
      ),
    );
  }
  return findings;
}

