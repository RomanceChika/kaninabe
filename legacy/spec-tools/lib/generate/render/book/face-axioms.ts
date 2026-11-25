/**
 * 公理(invariant の `statement`)の人向けの表示。
 *
 * **原文は逐語で折りたたみ「原文」に残し、本文はその分解**にする(柔らかく言い換える代わりに、
 * 原文を主文・例外・補足に割って**ラベル行**で出す。book-human-face.md §7-6 / §7-7):
 *
 * - 主語 … 関わるエンティティ(`entities`)
 * - 決まること … 原文の主文(括弧の外の文)
 * - 例外 … 例外の候補の文(「例外」「ただし」・条件節・除外・括弧の中の但し書き)。
 *   拾えなければ「原文に例外の文は無い」と言う(例外が無いとは断定しない)
 * - 補足 … 原文の括弧の中(主文以外の条件。定義の括弧は主文に残す)
 * - 形式 … `formal` の種類(式に写せないものは「式に写せない」)
 * - 原本 … 公理が宣言されている場所。この章の範囲なら「この章」、範囲の外なら章へのリンク
 *
 * 守らせる場所(`enforced_by`)は**ここには出さない**(下段の執行点の表へ。二重を避ける裁定)。
 * 分解は文字の切り出しだけで、言い換えない(原文に無い語を足さない)。
 */

import type { AggregateSpecs, InvariantDef, InvariantFormal, SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { aggregateTitle } from './chapters.js';
import { specRelative } from './face-sign.js';
import { bookLayout, chapterHref } from './face-scope.js';
import {
  esc,
  fold,
  kv,
  kvs,
  mark,
  mono,
  noException,
  oneLine,
  valueOf,
} from './face-html.js';

/** 原文を割った結果。 */
export interface SplitStatement {
  /** 括弧の外の文(例外の文を除く)。文の途中の定義の括弧は、そのまま残す。 */
  readonly main: readonly string[];
  /** 例外の候補の文(括弧の中の但し書きも含む)。 */
  readonly exceptions: readonly string[];
  /** 括弧の中の条件(`。` で割った 1 項目ずつ。例外の候補を除く)。 */
  readonly supplements: readonly string[];
}

/** 例外の文の書き出し。 */
const EXCEPTION_LEAD = /^(例外|ただし)/;

/**
 * 条件節で始まる特例の文の、頭の節の終わり(`、` の前)。
 * 「〜の場合は」「〜なければ」「〜ても」で終わる節は、本則に対する特例を言う。
 */
const CONDITION_CLAUSE_END = /(場合は|場合|なければ|ても)$/;

/** 「〜は除く」で終わる文、または「除く」を含む文は、除外を言う。 */
const EXCLUSION = /は除く|を除く|を除き|を除いて/;

/** 括弧の中の但し書き(許容・容認・除外)を言う語。 */
const PAREN_PROVISO = /許容|ってよい|を除く|を除き|を除いて|は除く|例外|ただし/;

/** 括弧の中身が、後ろの語にかかる修飾の断片(「の」「な」で終わる)で、文として立たないか。 */
const MODIFIER_FRAGMENT = /[のな]$/;

/** 外の 1 文が例外の候補か(書き出しが「例外」「ただし」/ 頭の節が条件節 / 除外を言う文)。 */
function isExceptionSentence(sentence: string): boolean {
  if (EXCEPTION_LEAD.test(sentence) || EXCLUSION.test(sentence)) return true;
  const [head = sentence] = sentence.split('、');
  return head !== sentence && CONDITION_CLAUSE_END.test(head);
}

/**
 * 原文を主文・例外の候補・補足に割る(文字の切り出しだけ。語は足さない)。
 *
 * 全角・半角の括弧の**最上位**の中身を切り出し、残りを `。` で文に割る。切り出した中身は
 * 但し書き(許容・除外を言う語を含む)なら**例外の候補**、それ以外は補足にする。ただし
 * 「の」「な」で終わる中身(「催しのアクティブな(申込済み・確定済みの)枠」のような定義)は、
 * 文として立たず主文の一部なので、括弧ごと主文に残す。括弧の外の文は、書き出しが「例外」「ただし」・
 * 頭の節が「〜の場合は」「〜なければ」「〜ても」・「除く」を含む文なら例外の候補にする。
 * 括弧の外が空なら、原文をそのまま主文にする。
 *
 * 「例外の候補」であって断定ではない: 文の形で拾うだけなので、拾えなかった例外は補足か主文に残る
 * (表示側は「例外が無い」とは言わず「原文に例外の文は無い」と言う)。
 */
export function splitStatement(statement: string): SplitStatement {
  const text = oneLine(statement);
  const outside: string[] = [];
  const supplements: string[] = [];
  const proviso: string[] = [];
  let depth = 0;
  let buffer = '';
  let sentence = '';
  const closeSentence = (): void => {
    const trimmed = sentence.trim();
    if (trimmed.length > 0) outside.push(trimmed);
    sentence = '';
  };
  const chars = [...text];
  chars.forEach((char, index) => {
    if (char === '（' || char === '(') {
      if (depth === 0) buffer = '';
      else buffer += char;
      depth += 1;
      return;
    }
    if ((char === '）' || char === ')') && depth > 0) {
      depth -= 1;
      if (depth > 0) {
        buffer += char;
        return;
      }
      const next = chars[index + 1];
      const midSentence = next !== undefined && next !== '。';
      if (midSentence && MODIFIER_FRAGMENT.test(buffer.trim())) {
        sentence += `${char === '）' ? '（' : '('}${buffer}${char}`;
      } else {
        for (const part of buffer.split('。').map((piece) => piece.trim()).filter((piece) => piece.length > 0)) {
          (PAREN_PROVISO.test(part) ? proviso : supplements).push(part);
        }
      }
      buffer = '';
      return;
    }
    if (depth > 0) {
      buffer += char;
      return;
    }
    if (char === '。') closeSentence();
    else sentence += char;
  });
  closeSentence();
  if (buffer.trim().length > 0) outside.push(buffer.trim());
  const exceptions = [...outside.filter(isExceptionSentence), ...proviso];
  const main = outside.filter((part) => !isExceptionSentence(part));
  return { main: main.length === 0 ? [text] : main, exceptions, supplements };
}

/** 形式の表示(`formal` の種類。式に写せないものは「式に写せない」)。 */
export function formalKind(formal: InvariantFormal | undefined): string {
  return formal === undefined ? '式に写せない' : mono(formal.kind);
}

/** 主語の値(関わるエンティティを日本語名 + 内部名で)。 */
function subjectOf(invariant: InvariantDef, model: SpecModel): string {
  const labels = new Map<string, string>();
  for (const specs of model.aggregates.values()) {
    if (specs.entity?.label !== undefined) labels.set(specs.entity.entity, specs.entity.label);
  }
  return valueOf(
    invariant.entities.map((entity) => {
      const label = labels.get(entity);
      return label === undefined ? mono(entity) : `${esc(label)} ${mono(entity)}`;
    }),
  );
}

/** 原本の値(範囲の中は「この章」、範囲の外は章へのリンク)。 */
function originOf(invariant: InvariantDef, owner: AggregateSpecs | null, model: SpecModel, ctx: GenerateContext): string {
  const path = mono(specRelative(invariant.location.file, ctx));
  if (owner === null) return `この章 ${path}`;
  const title = aggregateTitle(owner.name, owner.entity?.label);
  // 従属する集約は自分の章を持たない。原本の公理は、その集約が畳まれた章の節にある(節のアンカーへ飛ぶ)。
  return `<a href="./${esc(chapterHref(bookLayout(model, ctx), owner.name))}">${esc(title)}</a> ${path}`;
}

/** 公理 1 本の行の中身(ラベル行)。 */
function axiomRows(
  invariants: readonly InvariantDef[],
  owner: AggregateSpecs | null,
  model: SpecModel,
  ctx: GenerateContext,
): string[] {
  const parts = invariants.map((invariant) => splitStatement(invariant.statement));
  const main = parts.flatMap((part) => part.main.map((sentence) => esc(sentence)));
  const exceptions = parts.flatMap((part) => part.exceptions.map((sentence) => esc(sentence)));
  const supplements = parts.flatMap((part) => part.supplements.map((sentence) => esc(sentence)));
  const first = invariants[0];
  if (first === undefined) return [];
  const subjects =
    invariants.length === 1
      ? subjectOf(first, model)
      : valueOf([...new Set(invariants.flatMap((invariant) => invariant.entities))].map((entity) => mono(entity)));
  return [
    kv('主語', subjects),
    kv('決まること', valueOf(main)),
    kv('例外', exceptions.length === 0 ? noException(supplements.length > 0) : valueOf(exceptions)),
    ...(supplements.length === 0 ? [] : [kv('補足', valueOf(supplements))]),
    kv('形式', invariants.length > 1 ? `${formalKind(first.formal)} ${invariants.length} 本` : formalKind(first.formal)),
    kv('原本', originOf(first, owner, model, ctx)),
  ];
}

/** 公理の行の `id`(遷移の「関係する公理」のリンクが飛ぶ先)。公理の id から機械的に作る。 */
export function axiomAnchor(id: string): string {
  return `inv-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/** 公理 1 行(行頭に標識 = 異議の場所)+ 直下の原文の折りたたみ。 */
function axiomBlock(
  invariants: readonly InvariantDef[],
  owner: AggregateSpecs | null,
  model: SpecModel,
  ctx: GenerateContext,
  short: boolean,
): string[] {
  const ids = invariants.map((invariant) => esc(invariant.id)).join(' / ');
  const tag = short ? ' <span class="bf-from">短い形</span>' : '';
  // 1 本だけの行は `id` を持つ(短い形に束ねた行は、束ねた先頭の公理にも付けない)。
  const anchor = invariants.length === 1 && !short && invariants[0] !== undefined ? ` id="${axiomAnchor(invariants[0].id)}"` : '';
  const head =
    `<div class="bf-axiom"${anchor}><div class="bf-id">${ids} ${mark('axiom')}${tag}</div>` +
    `<div class="bf-st">${kvs(axiomRows(invariants, owner, model, ctx))}</div></div>`;
  const quotes = invariants.map((invariant) =>
    invariants.length === 1
      ? `<p class="bf-q">${esc(oneLine(invariant.statement))}</p>`
      : `<p class="bf-q"><b>${esc(invariant.id)}</b> ${esc(oneLine(invariant.statement))}</p>`,
  );
  return [
    head,
    ...fold({ kind: 'orig', title: invariants.length === 1 ? '原文' : `原文 ${invariants.length} 本` }, quotes),
  ];
}

/**
 * ある集約の公理を行にする。一意性(`uniqueness`)は**短い形**で 1 行にまとめる
 * (読み方の印は必読のまま。視覚の圧縮であって印の降格ではない)。
 *
 * @param invariants 公理(宣言順)
 * @param owner 原本の集約。章の範囲の中なら null
 */
export function axiomBlocks(
  invariants: readonly InvariantDef[],
  owner: AggregateSpecs | null,
  model: SpecModel,
  ctx: GenerateContext,
): string[] {
  const regular = invariants.filter((invariant) => invariant.formal?.kind !== 'uniqueness');
  const short = invariants.filter((invariant) => invariant.formal?.kind === 'uniqueness');
  return [
    ...regular.flatMap((invariant) => axiomBlock([invariant], owner, model, ctx, false)),
    ...(short.length === 0 ? [] : axiomBlock(short, owner, model, ctx, true)),
  ];
}

