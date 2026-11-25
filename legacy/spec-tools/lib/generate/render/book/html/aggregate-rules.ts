/**
 * 集約の章の上段のうち、アクセスの宣言と計算の早見表の HTML 版。
 *
 * - **アクセスの宣言**(`face-rules.ts`) … 読むは集約ごとの 1 ブロック(見えるロールを 1 行ずつ、見えないロールは最後の 1 行に明示)、
 *   作る・書く・消すは役をまとめた行を範囲の集約ごとの折りたたみに並べる。数える単位は表の行(`accessUnits`)。
 * - **計算の早見表**(`face-examples.ts`) … `computes[].examples` の行。1 行が主張 1 つ。
 *
 * 書き出し方は、表は `<table>`、行頭の語はロール名(`bf-rk`)。
 */

import { readFilterPath } from '../../../../model/read-filter-path.js';
import type { ReadScope } from '../../../../model/types.js';
import type { ActionComputeExample, ComputeExampleValue } from '../../../../model/trace/types.js';
import { accessUnits, type AccessRuleItem, type AccessWriteRow } from '../../../../semantics/reading-axioms.js';
import type { ComputeExampleSet } from '../../../../semantics/compute-examples.js';
import { findEntitySpec } from '../../../../semantics/domain-lookup.js';
import { WIDE_READ_MARK } from '../access-view.js';
import { guardTranslator } from '../domain-sections.js';
import { aggregateLabel, type AccessGroup } from '../face-facts.js';
import { grouped, isFlatRecord, usedKeys } from '../face-examples.js';
import { KIND_WORDS, readUniverse, WIDE_GLOSS_PER_ROW_MAX, WIDE_READ_GLOSS } from '../face-rules.js';
import { table } from './chapter-parts.js';
import type { DomainEnv } from './aggregate-env.js';
import { roleWord } from './aggregate-env.js';
import { bold, dash, fold, kv, kvs, mark, mono, none, pts, roleKv, valueOf } from './face-parts.js';
import type { Outline } from './layer-chapter.js';
import { el, join, text, type Child, type Html } from './markup.js';

/** 式の日本語化(ガード式 → 文)。 */
type Translate = (expression: string | undefined, selfEntity?: string) => string;

/** ロールの値(日本語名 + 内部名。名前が無ければ内部名だけ)。 */
function roleValue(env: DomainEnv, role: string): Child {
  return env.roleName.has(role) ? join([`${roleWord(env, role)} `, mono(role)]) : mono(role);
}

/** 決まること(書ける欄・作れる・消せる)。 */
function settles(row: AccessWriteRow): Child {
  switch (row.kind) {
    case 'write':
      return valueOf((row.fields ?? []).map((field) => mono(field)));
    case 'create':
      return '行を作れる';
    case 'delete':
      return '行を消せる';
  }
}

/** 条件の値(式の日本語化と式そのもの。実行者の属性で絞る条件があれば足す。無ければ「なし」)。 */
function conditionOf(when: string | undefined, filters: AccessRuleItem['filters'], entity: string, ja: Translate): Child {
  const items: Child[] = [
    ...(when === undefined ? [] : [ja(when, entity), mono(when)]),
    ...filters.map((filter) => join(['実行者の属性で絞る ', mono(`${readFilterPath(filter)} = actor.${filter.actorField}`)])),
  ];
  return items.length === 0 ? 'なし' : valueOf(items);
}

/** 作る・書く・消すの 1 行(役をまとめた行)。 */
function writeRow(env: DomainEnv, row: AccessWriteRow, entity: string, ja: Translate): Html {
  const rows = [kv('誰が', valueOf(row.roles.map((role) => roleValue(env, role)))), kv('決まること', settles(row)), kv('条件', conditionOf(row.when, [], entity, ja))];
  return el('div', { class: 'bf-rule' }, el('div', { class: 'bf-id' }, KIND_WORDS[row.kind], ' ', mark('axiom')), el('div', { class: 'bf-st' }, kvs(rows)));
}

/** 範囲の集約 1 つぶんの、作る・書く・消すの行(折りたたみ 1 つ)。 */
function writeFold(env: DomainEnv, group: AccessGroup, ja: Translate): Html | null {
  const entity = group.specs.entity?.entity ?? group.specs.name;
  const title = group.specs === env.facts.specs ? aggregateLabel(group.specs) : `${aggregateLabel(group.specs)}(従属)`;
  return fold(
    { kind: 'detail', title: `作る・書く・消す — ${title}`, count: `${group.table.rows.length} 行`, hint: '誰が・決まること・条件' },
    group.table.rows.map((row) => writeRow(env, row, entity, ja)),
  );
}

/** 読む範囲の言い方(全件は目立たせる)。条件つきは、その旨を添える。 */
function scopeLine(scope: ReadScope, conditional: boolean, glossed: boolean): Child {
  const word: Child = (() => {
    switch (scope.kind) {
      case 'all':
        return bold(`全件 ${WIDE_READ_MARK}`);
      case 'none':
        return none('見えない');
      case 'own':
        return '自分の行';
      case 'context':
        return join(['紐づく ', mono(scope.entity), ' の行']);
    }
  })();
  if (conditional) return join([word, '(条件つき。条件は下の「読み取りの条件」)']);
  return scope.kind === 'all' && glossed ? join([word, ` — ${WIDE_READ_GLOSS}`]) : word;
}

/** 読むのブロック(集約 1 つが 1 ブロック。行頭に読み方の印)。 */
function readBlock(env: DomainEnv, group: AccessGroup, universe: readonly string[]): Html {
  const root = env.facts.specs;
  const title = group.specs === root ? aggregateLabel(group.specs) : `${aggregateLabel(group.specs)}(従属)`;
  const order = (role: string): number => universe.indexOf(role);
  const visible = group.table.reads
    .flatMap((rule) =>
      rule.scope === undefined || rule.scope.kind === 'none' ? [] : [{ by: rule.by, scope: rule.scope, conditional: rule.when !== undefined || rule.filters.length > 0 }],
    )
    .sort((a, b) => order(a.by) - order(b.by));
  const seen = new Set(visible.map((rule) => rule.by));
  const hidden = universe.filter((role) => !seen.has(role));
  const wideRows = visible.filter((rule) => rule.scope.kind === 'all' && !rule.conditional).length;
  const legendOnTop = wideRows > WIDE_GLOSS_PER_ROW_MAX;
  const rows = [
    ...visible.map((rule) => roleKv(roleValue(env, rule.by), scopeLine(rule.scope, rule.conditional, !legendOnTop))),
    ...(hidden.length === 0 ? [] : [roleKv('ほかのロール', join([hidden.map((role) => roleWord(env, role)).join('・'), ' は', none('見えない')]))]),
  ];
  const legend = legendOnTop ? el('p', { class: 'bf-note' }, `${WIDE_READ_MARK} の行のうち「条件つき」と書いていないものは、${WIDE_READ_GLOSS}`) : null;
  return el('div', { class: 'bf-rule' }, el('div', { class: 'bf-id' }, '読む — ', title, ' ', mark('axiom')), el('div', { class: 'bf-st' }, legend, kvs(rows)));
}

/** 条件つきの読みの折りたたみ(表のマスに付いた条件の文と式)。 */
function readConditionFold(env: DomainEnv, groups: readonly AccessGroup[], ja: Translate): Html | null {
  const items = groups.flatMap((group) => {
    const entity = group.specs.entity?.entity ?? group.specs.name;
    return group.table.reads
      .filter((rule) => rule.when !== undefined || rule.filters.length > 0)
      .map((rule) => join([bold(`${aggregateLabel(group.specs)} × ${roleWord(env, rule.by)}`), ' ', conditionOf(rule.when, rule.filters, entity, ja)]));
  });
  return fold({ kind: 'detail', title: '読み取りの条件', count: `${items.length} 件`, hint: '「条件つき」の行' }, items.length === 0 ? [] : [pts(items)]);
}

/** アクセスの宣言。宣言が無ければ出さない。 */
export function accessSection(env: DomainEnv, outline: Outline): Child {
  const { facts, model, ctx } = env;
  const groups = facts.access.filter((group) => accessUnits(group.table) > 0);
  if (groups.length === 0) return null;
  const total = groups.reduce((sum, group) => sum + accessUnits(group.table), 0);
  const readers = groups.filter((group) => group.table.reads.length > 0);
  const ja = guardTranslator(model, ctx);
  const universe = readUniverse(model, readers);
  return [
    outline.h3('access', `アクセスの宣言(${total})`),
    pts(
      [
        '誰が、どの行を読め、作れ、書けて、消せるかの宣言',
        '数えるのは表の行。判断ポイントの台帳の 1 本 1 件とは、数え方が違う',
        `読むは、集約ごとに 1 ブロック。見えるロールを 1 行ずつ並べ、見えないロールは最後の 1 行に明示する。${WIDE_READ_MARK} は全件が見える宣言`,
        '読むの宣言は行の見え方だけを決める。欄の公開は別の層で、下段の隠す欄が持つ',
        '作ると書くと消すは、書ける欄と条件が同じ宣言の役を 1 行にまとめる',
        '従属する集約の宣言は、親の状態を条件にした編集可否の置き場なので、親に写して出す',
        join([mono('filters'), ' と ', mono('when'), ' の意図は、人が判定する']),
        '機械が保証するのは、式の文法と矛盾の無さと、行の絞り込みの実装だけ',
      ],
      true,
    ),
    readers.length === 0 ? null : [readers.map((group) => readBlock(env, group, universe)), readConditionFold(env, readers, ja)],
    groups.map((group) => writeFold(env, group, ja)),
  ];
}

// ------------------------------------------------------------ 計算の早見表

/** スカラーの値の見せ方(真偽は「はい / いいえ」・空は薄い字・数はけた区切り)。 */
function showScalar(value: string | number | boolean | null): Child {
  if (value === null) return none('空');
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  return typeof value === 'number' ? grouped(value) : value;
}

/** 欄の見出し(表示名があればそれ、無ければ内部名の等幅)。 */
function headingOf(env: DomainEnv, entity: string, field: string): Child {
  const label = findEntitySpec(env.model, entity)?.fields.find((candidate) => candidate.name === field)?.label;
  return label === undefined ? mono(`${entity}.${field}`) : label;
}

/** 値の入れ子を箇条にほどく。平らなマッピング 1 つを 1 行にする。 */
function flatten(value: ComputeExampleValue, path: string): Child[] {
  if (Array.isArray(value)) {
    const items = value as readonly ComputeExampleValue[];
    return items.flatMap((item, index) => flatten(item, items.length > 1 ? `${path}[${index}]` : path));
  }
  if (isFlatRecord(value)) {
    return [
      join([
        mono(path),
        ' ',
        join(
          Object.entries(value).map(([key, item]) => join([key, ' ', showScalar(item)])),
          text('・'),
        ),
      ]),
    ];
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as { readonly [key: string]: ComputeExampleValue };
    return Object.entries(record).flatMap(([key, item]) => flatten(item, path === '' ? key : `${path}.${key}`));
  }
  return [path === '' ? showScalar(value) : join([mono(path), ' ', showScalar(value)])];
}

/** 例の表 1 枚(純関数 1 本ぶん)。 */
function exampleTable(env: DomainEnv, set: ComputeExampleSet): Html {
  const examples: readonly ActionComputeExample[] = set.examples.map((entry) => entry.example);
  const name = (example: ActionComputeExample): Child => join([example.note, ' ', mark('axiom')]);
  if (set.decl.shape === 'input') {
    return table(
      ['行の名前', '入力', '値'],
      examples.map((example) => [name(example), pts(flatten(example.input, '')), pts(flatten(example.expect, ''))]),
    );
  }
  const factKeys = usedKeys(
    set.decl.reads.map((read) => read.raw),
    examples.map((example) => Object.keys(example.facts)),
  );
  const action = env.facts.actions.find((candidate) => candidate.handles.raw === set.op);
  const inputKeys = usedKeys(
    action?.input.map((ref) => ref.field) ?? [],
    examples.map((example) => Object.keys(example.input)),
  );
  const cellOf = (values: Readonly<Record<string, ComputeExampleValue>>, key: string): Child => {
    const value = values[key];
    return value === undefined ? dash() : showScalar(value as string | number | boolean | null);
  };
  return table(
    [
      '行の名前',
      ...factKeys.map((key) => headingOf(env, key.split('.')[0] ?? '', key.split('.')[1] ?? '')),
      ...inputKeys.map((key) => {
        const ref = action?.input.find((candidate) => candidate.field === key);
        return join(['入力: ', ref === undefined ? mono(key) : headingOf(env, ref.entity, ref.field)]);
      }),
      join(['→ ', headingOf(env, set.decl.raw.split('.')[0] ?? '', set.decl.raw.split('.')[1] ?? '')]),
    ],
    examples.map((example) => [
      name(example),
      ...factKeys.map((key) => cellOf(example.facts, key)),
      ...inputKeys.map((key) => cellOf(example.input, key)),
      bold(showScalar(example.expect as string | number | boolean | null)),
    ]),
  );
}

/** 計算の早見表。例の表を持つ操作が章の範囲に無ければ出さない。 */
export function examplesSection(env: DomainEnv, outline: Outline): Child {
  const { facts } = env;
  if (facts.computeExamples.length === 0) return null;
  return [
    outline.h3('examples', `計算の早見表(${facts.axiomParts.examples})`),
    pts(
      [
        '式は DSL の外の純関数の中にある。この表は、その振る舞いを入力と値の行で宣言したもの',
        '1 行が主張 1 つ。数えるのは行',
        '人が判定するのは、各行の値が業務の規則どおりかどうか',
        '機械が保証するのは、生成したテストが純関数の実際の値と表の一致を確かめること。一致しなければ、式か表のどちらかが間違っている',
        '「—」は与えなかった欄。「空」は値が空であること',
      ],
      true,
    ),
    facts.computeExamples.map((set) => {
      const decls = facts.actions.find((action) => action.handles.raw === set.op)?.computes.filter((decl) => decl.ref === set.decl.ref) ?? [set.decl];
      return [
        el(
          'p',
          { class: 'bf-group' },
          mono(set.decl.ref),
          el(
            'small',
            null,
            mono(set.op),
            ` が決める `,
            join(
              decls.map((decl) => mono(decl.raw)),
              text('・'),
            ),
            `・${set.examples.length} 行`,
          ),
        ),
        fold({ kind: 'table', title: `${set.decl.ref} の早見表`, count: `${set.examples.length} 行`, hint: '入力と値。行ごとに主張 1 つ', open: true }, [exampleTable(env, set)]),
      ];
    }),
  ];
}
