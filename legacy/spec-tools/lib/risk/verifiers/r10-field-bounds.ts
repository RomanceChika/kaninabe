/**
 * R10 **上限の無い欄**(危ない形の群。規則の正は enforcement-matrix の C32)。
 *
 * entity_spec の欄の制約は、生成される入力スキーマ(zod)と表の導出 CHECK の**唯一の源**である。制約を書かなければ
 * 生成物にも上限が出ない —— 文字列なら 1 回の送信で数 MB の本文がログ・通知・保存に流れ、数なら桁あふれや
 * 費用の計算の暴走に届く。省略は「上限が無い」の宣言として読めてしまうので、**省略そのものを止める**。
 *
 * 見る形は 4 つである。
 *
 * | 欄の型 | 止める形 | 受け入れの欄 |
 * |---|---|---|
 * | `string` / `text` | `max_length` が無い | `unbounded: 理由`(理由は空にできない) |
 * | `string` / `text` | `max_length` と `unbounded` の併記(どちらが正か読めない) | なし |
 * | `integer` / `decimal` | `min` か `max` が無い | なし(数の範囲はどの製品でも決められる) |
 * | それ以外 | `unbounded` を書いている(効く欄が無い宣言) | なし |
 *
 * 読むのは欄の型と制約の軸だけで、**アプリの語彙は 1 語も持たない**。純関数であり throw しない。
 */

import type { FieldDef, SpecModel } from '../../model/types.js';
import { makeFinding, type Finding } from '../../kernel/finding.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'R10';

/** 長さの上限を要る型(人が自由に書ける文字列)。 */
const TEXT_KINDS: ReadonlySet<string> = new Set(['string', 'text']);

/** 下限と上限を要る型(数)。 */
const NUMBER_KINDS: ReadonlySet<string> = new Set(['integer', 'decimal']);

/** 欄 1 つの指摘(無ければ空)。 */
function checkField(entity: string, field: FieldDef): Finding[] {
  const place = `${entity}.${field.name}`;
  const kind = field.type.kind;
  const counterexample = { entity, field: field.name, type: kind };
  if (TEXT_KINDS.has(kind)) return checkText(place, field, counterexample);
  if (NUMBER_KINDS.has(kind)) return checkNumber(place, field, counterexample);
  if (field.unbounded === undefined) return [];
  return [
    makeFinding(VERIFIER_ID, {
      message: `${place} は ${kind} の欄に unbounded を書いています(長さの上限を外す宣言は文字列の欄にしか効かず、ここでは何も受け入れていません)`,
      location: field.location,
      suggestion: 'unbounded を消す(string / text 以外の欄に、長さの上限を外す口は無い)',
      counterexample,
    }),
  ];
}

/** 文字列の欄の指摘。 */
function checkText(place: string, field: FieldDef, counterexample: Readonly<Record<string, string>>): Finding[] {
  if (field.maxLength !== undefined && field.unbounded !== undefined) {
    return [
      makeFinding(VERIFIER_ID, {
        message: `${place} は max_length と unbounded を併記しています(上限があるのか無いのか、宣言から 1 つに決まりません)`,
        location: field.location,
        suggestion: '上限を置くなら unbounded を消す。上限を置かないなら max_length を消して unbounded に理由を残す',
        counterexample,
      }),
    ];
  }
  if (field.maxLength !== undefined) return [];
  if (field.unbounded !== undefined && field.unbounded.trim() !== '') return [];
  const empty = field.unbounded !== undefined;
  return [
    makeFinding(VERIFIER_ID, {
      message: empty
        ? `${place} は unbounded の理由が空です(理由の無い受け入れは、上限の省略と同じものです)`
        : `${place} は長さの上限が無い文字列の欄です(1 回の送信で巨大な本文を保存・ログ・通知・外部への送信に流せます)`,
      location: field.location,
      suggestion: empty
        ? 'なぜ上限を置けないのかを unbounded に具体的に書く。決められるなら unbounded を消して max_length を書く'
        : 'max_length を書く(生成される入力スキーマと表の CHECK に上限が出る)。意図して上限を置かないなら unbounded: 理由 を書く',
      counterexample,
    }),
  ];
}

/** 数の欄の指摘。 */
function checkNumber(place: string, field: FieldDef, counterexample: Readonly<Record<string, string>>): Finding[] {
  const missing = [field.min === undefined ? 'min' : null, field.max === undefined ? 'max' : null].filter(
    (key): key is string => key !== null,
  );
  const findings: Finding[] = [];
  if (missing.length > 0) {
    findings.push(
      makeFinding(VERIFIER_ID, {
        message: `${place} は範囲の${missing.length === 2 ? '下限と上限' : missing[0] === 'min' ? '下限' : '上限'}が無い数の欄です(桁あふれ・負の値・費用の計算の暴走に届く値を入力から受け取れます)`,
        location: field.location,
        suggestion: `${missing.join(' と ')} を書く(生成される入力スキーマと表の CHECK に範囲が出る)。数の欄に範囲を外す受け入れの口は無い`,
        counterexample: { ...counterexample, missing: missing.join(',') },
      }),
    );
  }
  if (field.unbounded !== undefined) {
    findings.push(
      makeFinding(VERIFIER_ID, {
        message: `${place} は数の欄に unbounded を書いています(数の範囲を外す受け入れの口は無く、ここでは何も受け入れていません)`,
        location: field.location,
        suggestion: 'unbounded を消し、min と max を書く',
        counterexample,
      }),
    );
  }
  return findings;
}

/**
 * R10: 全集約の欄に、型に応じた上限があるかを見る。
 *
 * @param model ドメイン仕様全体
 * @returns 違反(無ければ空)
 */
export function verifyFieldBounds(model: SpecModel): Finding[] {
  return [...model.aggregates.values()].flatMap((specs) =>
    specs.entity === undefined ? [] : specs.entity.fields.flatMap((field) => checkField(specs.entity?.entity ?? specs.name, field)),
  );
}
