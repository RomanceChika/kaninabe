/**
 * 導出の宣言(`triggers[].derives`)が**本文を生成できる形か**の判定。
 *
 * 生成する側(`ddl-derive-triggers.ts`)と検査する側(T15 / T17)が**同じ 1 本**を呼ぶ —— 2 か所に
 * 書くと片方だけが直る。見るのは 6 群である: 関数が `handwritten` でないこと / `supplies` と
 * `derives` の列が一致すること / 各列の元・幅・方式・対象(`supplied_by: db`・datetime 型)/ 同じ列を 2 つのトリガが導出しない
 * こと / 元の列が別のトリガの導出列でないこと / `fires` が本文を出せる形であること(`follow` は元の列の更新を含むこと)。
 * 末尾の番号の形(`append_within`。点検 24 回目 B24-1)は元・幅の代わりに、方式が `initial`・対象が整数・数える範囲が親を直の
 * 外部キーで指す列・その親の排他の `locks`・範囲の列を埋める別のトリガが名前の順で先に発火すること・列の範囲(上端 `max` が
 * あり下端 `min` が 1 以下。上端を越えた作成は本文が `append_full` で断る。点検 25 回目 B25-1)を見る。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { DataDerivation, DataTableSpec, DataTriggerDecl, OffsetDerivation } from '../model/data/types.js';
import { DERIVE_MODES, DERIVE_UNITS, isAppendDerivation } from '../model/data/types.js';
import { nameTheTable } from './ddl-copy-triggers.js';
import { parseDeriveOffset } from './derive-offset.js';
import { appendProblems } from './derive-append-problems.js';
import { parseFires, updatedColumnsOf } from '../model/trigger-fires.js';

/** 宣言が通らない理由 1 件。T15 が Finding にし、T17 が生成できない理由として読む。 */
export interface DerivationProblem {
  /** 指摘の位置(トリガの宣言の下の相対パス。例: `derives.remind_at.from`)。 */
  readonly path: string;
  /** 何が通らないか。 */
  readonly reason: string;
  /** どう直すか。 */
  readonly suggestion: string;
  /** 反例(どの宣言か)。 */
  readonly example: Readonly<Record<string, string>>;
}

/** 問題 1 件を組み立てる。 */
function problem(
  path: string,
  reason: string,
  suggestion: string,
  example: Readonly<Record<string, string>> = {},
): DerivationProblem {
  return { path, reason, suggestion, example };
}

/**
 * `derives` を宣言したトリガが、本文を生成できるか(できなければその理由の全部)。
 *
 * @param trigger トリガの宣言(`derives` を持つもの)
 * @param table テーブル仕様
 * @param domain ドメイン仕様(列の型と `supplied_by` を引く)
 * @returns 通らない理由(宣言順)。空なら生成できる
 */
export function derivationProblemsOf(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
): readonly DerivationProblem[] {
  const derives = trigger.derives ?? [];
  const entity = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
  const fields = new Map((entity?.fields ?? []).map((field) => [field.name, field]));
  return [
    ...functionProblems(trigger, table),
    ...keyProblems(trigger, derives),
    ...derives.flatMap((derivation) => derivationProblems(derivation, fields, trigger, table, domain)),
    ...firesProblems(trigger, table, derives),
  ];
}

/** 本文の出どころ(`handwritten` と併記できない)。 */
function functionProblems(trigger: DataTriggerDecl, table: DataTableSpec): readonly DerivationProblem[] {
  const fn = table.functions.find((candidate) => candidate.name === trigger.functionName);
  if (fn?.handwritten === undefined) return [];
  return [
    problem(
      `functions.${fn.name}.handwritten`,
      `derives を宣言したトリガの関数 ${fn.name} が handwritten を宣言しています(本文は生成物なので手書きと併記できません)`,
      `${fn.name} の handwritten を削除する(本文は derives から生成される)。手書きの本文を残すなら derives を外す`,
      { function: fn.name },
    ),
  ];
}

/** `supplies` と `derives` の列が一致するか(空の `derives` も止める)。 */
function keyProblems(trigger: DataTriggerDecl, derives: readonly DataDerivation[]): readonly DerivationProblem[] {
  const derived = derives.map((derivation) => derivation.column);
  if (derived.length === 0) {
    return [
      problem('derives', 'derives が空です(導出する列が 1 つも宣言されていません)', 'derives に列を宣言するか、derives を削除する'),
    ];
  }
  const missingInSupplies = derived.filter((column) => !trigger.supplies.includes(column));
  const missingInDerives = trigger.supplies.filter((column) => !derived.includes(column));
  if (missingInSupplies.length === 0 && missingInDerives.length === 0) return [];
  return [
    problem(
      'supplies',
      `supplies と derives の列が一致しません(supplies だけ: ${missingInDerives.join(' / ') || 'なし'}、derives だけ: ${missingInSupplies.join(' / ') || 'なし'})`,
      '本文を生成するのは全部が導出のトリガだけである(部分的な本文は手書きの本文と衝突する)。' +
        'supplies と derives のキーを同じ列の集合にそろえる',
      { supplies: trigger.supplies.join(', '), derives: derived.join(', ') },
    ),
  ];
}

/** 導出 1 列の元・幅・方式(形ごと)と、対象(供給元と型)・重複(両方の形に共通)。 */
function derivationProblems(
  derivation: DataDerivation,
  fields: ReadonlyMap<string, FieldDef>,
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
): readonly DerivationProblem[] {
  return [
    ...(isAppendDerivation(derivation) ? appendProblems(derivation, fields, trigger, table, domain) : offsetProblems(derivation, fields, trigger, table)),
    ...targetProblems(derivation, fields, trigger, table),
  ];
}

/** 幅の形の元・幅・方式と、元の列が別のトリガの導出列でないこと。 */
function offsetProblems(
  derivation: OffsetDerivation,
  fields: ReadonlyMap<string, FieldDef>,
  trigger: DataTriggerDecl,
  table: DataTableSpec,
): readonly DerivationProblem[] {
  const { column, from, offset, mode } = derivation;
  const base = `derives.${column}`;
  const found: DerivationProblem[] = [];
  const source = fields.get(from);
  if (from === column || source === undefined || source.type.kind !== 'datetime') {
    found.push(
      problem(
        `${base}.from`,
        from === column
          ? `${column} の元(from)が自分自身です`
          : `${column} の元(from)${from} が自表の日時(datetime)の欄ではありません`,
        'from には、この表の entity_spec に宣言された datetime 型の欄を別の列として書く(別の集約の列は書けない)',
        { column, from },
      ),
    );
  }
  if (parseDeriveOffset(offset) === null) {
    found.push(
      problem(
        `${base}.offset`,
        `${column} の幅(offset)"${offset}" が閉じた語に合いません`,
        `"{±n} {${DERIVE_UNITS.join('|')}}" の形で書く(例: "-14 days" / "1 hour")。数は整数、単位は ${DERIVE_UNITS.join(' / ')}`,
        { column, offset },
      ),
    );
  }
  if (!(DERIVE_MODES as readonly string[]).includes(mode)) {
    found.push(
      problem(
        `${base}.mode`,
        `${column} の方式(mode)"${mode}" が値域にありません`,
        `mode は ${DERIVE_MODES.join(' / ')} のどちらか(initial = 挿入時に空のときだけ / follow = 発火のたびに引き直す)`,
        { column, mode },
      ),
    );
  }
  const upstream = table.triggers.find(
    (candidate) => candidate.name !== trigger.name && candidate.derives?.some((entry) => entry.column === from),
  );
  if (upstream !== undefined) {
    found.push(
      problem(
        `${base}.from`,
        `${column} の元(from)${from} はトリガ ${upstream.name} が導出する列です(BEFORE トリガは名前の順に発火するので、元の値が引き直される前に読まれて結果が発火順で変わります)`,
        'from には導出されない列(入力や既定値の列)を書く。連なった導出にしたいなら、元になる式を 1 つのトリガの導出に畳む(元の元の列から直接の幅で書く)',
        { column, from, upstream: upstream.name },
      ),
    );
  }
  return found;
}

/** 導出する列が `supplied_by: db` で、形に合う型であり、ほかのトリガが同じ列を導出しないこと。 */
function targetProblems(
  derivation: DataDerivation,
  fields: ReadonlyMap<string, FieldDef>,
  trigger: DataTriggerDecl,
  table: DataTableSpec,
): readonly DerivationProblem[] {
  const { column } = derivation;
  const base = `derives.${column}`;
  const found: DerivationProblem[] = [];
  if (fields.get(column)?.suppliedBy !== 'db') {
    found.push(
      problem(
        base,
        `導出する列 ${column} が entity_spec で supplied_by: db を宣言していません`,
        `${column} に supplied_by: db を宣言する(入力に現れず DB が決める列だけが導出できる。V17 が作成の引数まで見る)`,
        { column },
      ),
    );
  }
  const target = fields.get(column);
  const append = isAppendDerivation(derivation);
  const expected = append ? 'integer' : 'datetime';
  if (target !== undefined && target.type.kind !== expected) {
    found.push(
      problem(
        base,
        append
          ? `導出する列 ${column} の型が整数(integer)ではありません(末尾の番号は整数を返すので、別の型の列には入れられません)`
          : `導出する列 ${column} の型が日時(datetime)ではありません(元の日時 ± 幅は日時を返すので、別の型の列には入れられません)`,
        append
          ? `${column} を entity_spec で integer 型の欄にする`
          : `${column} を entity_spec で datetime 型の欄にする。日時でない値を決めたいなら導出ではなく手書きの本文にする`,
        { column, type: target.type.kind },
      ),
    );
  }
  const other = table.triggers.find(
    (candidate) => candidate.name !== trigger.name && candidate.derives?.some((entry) => entry.column === column),
  );
  if (other !== undefined) {
    found.push(
      problem(
        base,
        `${column} をトリガ ${other.name} も導出しています(同じ列を 2 つのトリガが決めると、発火順で結果が変わります)`,
        '導出するトリガを 1 本にする(方式が違うなら、どちらの約束かを仕様で 1 つに決める)',
        { column, other: other.name },
      ),
    );
  }
  return found;
}

/** `fires` が本文を出せる形か(`follow` は元の列の更新を含むこと)。 */
function firesProblems(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  derives: readonly DataDerivation[],
): readonly DerivationProblem[] {
  const fires = trigger.fires ?? '';
  const example = { trigger: trigger.name, fires };
  if (fires.trim() === '') {
    return [problem('fires', 'fires が宣言されていません(いつ実行するかが無い)', 'fires に "before insert" などを書く', example)];
  }
  if (nameTheTable(fires)) {
    return [
      problem(
        'fires',
        'fires が表名まで書いています(本文を生成する形なので、表名は生成が付けます)',
        `fires から " on ${table.table}" を外す(例: "before insert or update of {列}")`,
        example,
      ),
    ];
  }
  const plan = parseFires(fires);
  if (plan.timing === null || plan.events.length === 0) {
    return [problem('fires', 'fires からいつ・何で実行するかを読めません', 'fires を "before insert or update of {列}" の形で書く', example)];
  }
  const unwritable = [
    ...(plan.timing === 'before' ? [] : ['after(new を書き換えられるのは before だけ)']),
    ...(plan.events.includes('insert') ? [] : ['insert を含まない(初期値を入れる時点が無い)']),
    ...plan.events.filter((event) => event === 'delete' || event === 'truncate').map((event) => `${event}(削除では NEW が空)`),
    ...(plan.level === 'statement' ? ['for each statement(行ごとでないと new が無い)'] : []),
    ...(trigger.deferred ? ['deferred: true(コミット時評価の制約トリガは after になる)'] : []),
  ];
  const found = unwritable.length === 0
    ? []
    : [problem('fires', `fires が値を入れられる形ではありません(${unwritable.join(' / ')})`, 'before insert [or update of {元の列}] の形にする', example)];
  const updated = updatedColumnsOf(fires);
  const unfollowed = derives.filter(
    (derivation): derivation is OffsetDerivation =>
      !isAppendDerivation(derivation) &&
      derivation.mode === 'follow' &&
      (updated === null || (updated !== 'all' && !updated.includes(derivation.from.toLowerCase()))),
  );
  return [
    ...found,
    ...unfollowed.map((derivation) =>
      problem(
        `derives.${derivation.column}.mode`,
        `${derivation.column} は follow ですが、fires が元の列 ${derivation.from} の更新を含みません(追随すると宣言して追随しない = 宣言の嘘)`,
        `追随させるなら fires に "update of ${derivation.from}" を足す。初期値のままでよいなら mode を initial にする`,
        { ...example, column: derivation.column, from: derivation.from },
      ),
    ),
  ];
}
