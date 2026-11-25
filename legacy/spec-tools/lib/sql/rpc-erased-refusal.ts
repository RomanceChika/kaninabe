/**
 * 定型 RPC の**消去された行への紐づけの関所**(点検 19 回目 A19-4。`foreign_keys[].refuse_erased`)。
 *
 * 外部キーの列を引数(`p_{列}`)の値で書く遷移・作成は、紐づけ先の行を共有で先に掴み(表名のバイト順の列に入る。実行者の
 * 集約と同じ表なら実行者の行と 1 文で id の昇順に掴む)、書き込みが通った後で、紐づけ先が消去済みなら拒否の語で断る
 * (`UC412`・`usecase_guard:{操作}`・detail = 宣言の語)。消去は紐づけ先の行を排他で掴むので、掴んだ後に消去済みでなければ、
 * コミットまで消去済みにならない。書き込みの後で断るのは、状態 → ロール → ガードの判定の順を変えないためである
 * (権限の無い実行者に「そのメンバーは消去済み」を教えない)。例外で書き込みは巻き戻る。
 *
 * 引数でなく変更集合(`p_changes` / `p_values`)から列を書く形は、ここでは関所を出さない —— その本文は実 DB の見張り
 * (`erased-link-parity`)が「関所の無い書き込み」として赤にする。
 *
 * **指したままの行の個人列の凍結**(点検 20 回目 A20-1。`refuse_erased.freezes_personal`): 自表の個人列を書く編集・遷移は、
 * 対象の行が外部キーで指す行を共有で先に掴み(対象の行を排他で掴んだ後。表名のバイト順の列に入る)、書き込みの直前の個人列の
 * 値を対象の行から控え、書き込みが通った後で「個人列の値が変わった」かつ「指す行が消去済み」なら拒否の語で断る。
 * 消去は紐づけを外さずに個人列を置き換え、指す行を排他で掴んでから消去済みにするので、消去と重なった直しは消去のコミットの後に
 * ここで断られ、消去の後の打ち直し(紐づいたまま)も同じ形で断られる。紐づけを外した行(外部キーが null)は凍らない。
 * 値が変わらない書き込み(画面が全部の欄を送り直す形)は断らない(実名は増えない)。
 *
 * DB のトリガでなく RPC の本文に出す理由: 消去の本文自身が同じ行の個人列を置き換える(印を立てた後に)ので、トリガは消去の
 * 置き換えまで断るか、消去を見分ける例外を持つことになる。また判定の順(状態 → ロール → ガード → 消去済み)を本文が決めており、
 * トリガは書き込みの文の中で発火するので「権限の無い実行者に消去の事実を教えない」順を保てない。手で書く本文の漏れは実 DB の見張り
 * (`erased-link-parity`)が、掴んだ行と断る値の結びつきまで見て赤にする。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { RpcParam } from './rpc-params.js';
import { sqlLiteral } from './guard-to-sql.js';
import { TARGET_ALIAS } from './rpc-parts.js';

/** 関所 1 つ(この関数が書く外部キー 1 本)。 */
export interface ErasedRefusal {
  /** 書く列。 */
  readonly column: string;
  /** 値を運ぶ引数。 */
  readonly param: string;
  /** 紐づけ先の表(スキーマ修飾なし)。 */
  readonly table: string;
  /** 紐づけ先の、消去済みの印の列。 */
  readonly markColumn: string;
  readonly values: readonly string[];
  readonly word: string;
}

/** 指したままの行の個人列の凍結 1 つ(外部キー 1 本)。 */
export interface FrozenOwner {
  /** 自表の外部キーの列(対象の行の持ち主を指す)。 */
  readonly column: string;
  /** 参照先の表(スキーマ修飾なし)。 */
  readonly table: string;
  readonly markColumn: string;
  readonly values: readonly string[];
  /** 凍結の拒否の語。 */
  readonly word: string;
  /** この関数が書く自表の個人列(宣言順)。 */
  readonly personal: readonly string[];
}

/** 関所の別名の前置(他のどの別名とも衝突しない)。 */
const ERASED_ALIAS = 'le';

/** 書き込みの直前の個人列を控える変数(対象の行の型)。 */
const FROZEN_BEFORE_VAR = 'v_frozen_before';

/** 紐づけの関所の行に付ける別名の前置(実行者の集約と別の表のとき)。 */
const ERASED_LOCK_ALIAS = 'lr';

/** 凍結の行に付ける別名の前置(実行者の集約と別の表のとき)。 */
const FROZEN_LOCK_ALIAS = 'lf';

/** 関所が実行者の行の文とは別に共有で掴む行 1 つ(`id` は同じ行かの鍵の材料)。 */
export interface ErasedLockRow {
  readonly table: string;
  readonly id: string;
  readonly alias: string;
  readonly from: readonly string[];
  readonly where: readonly string[];
}

/** 関所が掴む行の割り振り(実行者の集約と同じ表の行は、実行者の行と 1 文で id の昇順に掴む)。 */
export interface ErasedLockPlan {
  /** 実行者の行の文に足す id の式。 */
  readonly actorIds: readonly string[];
  /** 実行者の行の文が対象の行(`t`)を from に並べて、その列から id を引くか。 */
  readonly viaTarget: boolean;
  /** 実行者の集約と別の表の行(1 行ずつ別の文)。 */
  readonly rows: readonly ErasedLockRow[];
}

/**
 * この関数が引数で書く、`refuse_erased` を宣言した外部キーの関所。
 *
 * @param table 自表
 * @param params 分類した引数
 * @param written 自表に書く列(遷移の列・作成の列)
 * @returns 関所の並び(宣言順)
 */
export function erasedRefusalsOf(table: DataTableSpec, params: readonly RpcParam[], written: readonly string[]): readonly ErasedRefusal[] {
  return table.foreignKeys.flatMap((key): ErasedRefusal[] => {
    const decl = key.refuseErased;
    const param = `p_${key.column}`;
    if (decl === undefined || !written.includes(key.column) || !params.some((candidate) => candidate.name === param)) return [];
    const target = key.references.startsWith('public.') ? key.references.slice('public.'.length) : key.references;
    return [{ column: key.column, param, table: target, markColumn: decl.column, values: decl.values, word: decl.word }];
  });
}

/**
 * 書き込みが通った後の関所(紐づけ先が消去済みなら断る)。
 *
 * @param refusals 関所の並び
 * @param operation 拒否の本文の操作 ID の式(遷移は `p_event_id`、作成は操作 ID の文字列)
 * @returns plpgsql の断片(関所が無ければ空)
 */
export function erasedRefusalChecks(refusals: readonly ErasedRefusal[], operation: string): readonly string[] {
  if (refusals.length === 0) return [];
  return [
    '    -- 紐づけ先が消去済みなら断る(紐づけ先の行は先に共有で掴んだので、コミットまで消去済みにならない。refuse_erased)。',
    ...refusals.map((refusal) =>
      [
        `    if exists (select 1 from public.${refusal.table} ${ERASED_ALIAS} where ${ERASED_ALIAS}.id = ${refusal.param} and ${ERASED_ALIAS}.${refusal.markColumn} in (${refusal.values.map(sqlLiteral).join(', ')})) then`,
        `        raise exception using errcode = 'UC412', message = 'usecase_guard:' || ${operation}, detail = ${sqlLiteral(refusal.word)};`,
        '    end if;',
      ].join('\n'),
    ),
    '',
  ];
}

/**
 * この関数が書く自表の個人列を凍らせる宣言(`refuse_erased.freezes_personal`)の引き当て。
 *
 * @param table 自表
 * @param personalWritten この関数が書く自表の個人列(編集の変更集合の列・1 欄ずつの引数の列・遷移の列のうち個人列)
 * @returns 凍結の並び(宣言順。書く個人列が無ければ空)
 */
export function frozenOwnersOf(table: DataTableSpec, personalWritten: readonly string[]): readonly FrozenOwner[] {
  if (personalWritten.length === 0) return [];
  return table.foreignKeys.flatMap((key): FrozenOwner[] => {
    const freeze = key.refuseErased?.freezesPersonal;
    if (key.refuseErased === undefined || freeze === undefined) return [];
    const target = key.references.startsWith('public.') ? key.references.slice('public.'.length) : key.references;
    return [{ column: key.column, table: target, markColumn: key.refuseErased.column, values: key.refuseErased.values, word: freeze.word, personal: personalWritten }];
  });
}

/**
 * 書き込みの直前の個人列を控える文(対象の行は先に排他で掴んであるので、控えた値はこの txn の書き込みまで動かない)。
 *
 * @param owners 凍結の並び
 * @param table 自表
 * @param targetId 対象の行の id の式
 * @returns plpgsql の断片(凍結が無ければ空)
 */
export function frozenBeforeCapture(owners: readonly FrozenOwner[], table: string, targetId: string): readonly string[] {
  if (owners.length === 0) return [];
  return [
    '    -- 書き込みの直前の個人列を控える(消去済みを指したままの行の個人列を変えたかを、書き込みの後で見る。refuse_erased.freezes_personal)。',
    `    select * into ${FROZEN_BEFORE_VAR} from public.${table} where id = ${targetId};`,
    '',
  ];
}

/**
 * 書き込みが通った後の凍結の関所(指す行が消去済みで、個人列の値が変わったなら断る)。
 *
 * @param owners 凍結の並び
 * @param operation 拒否の本文の操作 ID の式
 * @returns plpgsql の断片(凍結が無ければ空)
 */
export function frozenOwnerChecks(owners: readonly FrozenOwner[], operation: string): readonly string[] {
  if (owners.length === 0) return [];
  return [
    '    -- 消去済みを指したままの行の個人列は書き換えない(指す行は先に共有で掴んだので、コミットまで消去済みにならない。refuse_erased.freezes_personal)。',
    ...owners.map((owner) =>
      [
        `    if (${owner.personal.map((column) => `v_row.${column} is distinct from ${FROZEN_BEFORE_VAR}.${column}`).join('\n        or ')})`,
        `       and exists (select 1 from public.${owner.table} ${ERASED_ALIAS} where ${ERASED_ALIAS}.id = v_row.${owner.column} and ${ERASED_ALIAS}.${owner.markColumn} in (${owner.values.map(sqlLiteral).join(', ')})) then`,
        `        raise exception using errcode = 'UC412', message = 'usecase_guard:' || ${operation}, detail = ${sqlLiteral(owner.word)};`,
        '    end if;',
      ].join('\n'),
    ),
    '',
  ];
}

/**
 * 関所が書き込みの前に共有で掴む行(紐づけ先 = 引数の値、凍結 = 対象の行の外部キーの列。凍結は対象の行がある編集・遷移だけ)。
 * 実行者の集約と同じ表なら実行者の行と 1 文で id の昇順に掴む(別々に掴むと、2 行を逆の順に掴む txn と互いを待ちうる)。
 *
 * @param facts 関所と、対象の行の表・id の式
 * @param actorTable 実行者の集約の表(無ければ null)
 * @param withTarget 対象の行があるか(作成は false)
 * @returns 掴む行の割り振り
 */
export function erasedLockPlan(
  facts: { readonly erasedRefusals: readonly ErasedRefusal[]; readonly frozenOwners: readonly FrozenOwner[]; readonly table: string; readonly targetId: string },
  actorTable: string | null,
  withTarget: boolean,
): ErasedLockPlan {
  const frozen = withTarget ? facts.frozenOwners : [];
  const linkRows = facts.erasedRefusals
    .filter((refusal) => refusal.table !== actorTable)
    .map((refusal, index): ErasedLockRow => {
      const alias = `${ERASED_LOCK_ALIAS}${String(index)}`;
      return { table: refusal.table, id: refusal.param, alias, from: [`public.${refusal.table} ${alias}`], where: [`${alias}.id = ${refusal.param}`] };
    });
  const frozenRows = frozen
    .filter((owner) => owner.table !== actorTable)
    .map((owner, index): ErasedLockRow => {
      const alias = `${FROZEN_LOCK_ALIAS}${String(index)}`;
      const id = `${TARGET_ALIAS}.${owner.column}`;
      return { table: owner.table, id, alias, from: [`public.${facts.table} ${TARGET_ALIAS}`, `public.${owner.table} ${alias}`], where: [`${TARGET_ALIAS}.id = ${facts.targetId}`, `${alias}.id = ${id}`] };
    });
  const frozenIds = frozen.filter((owner) => owner.table === actorTable).map((owner) => `${TARGET_ALIAS}.${owner.column}`);
  return {
    actorIds: [...facts.erasedRefusals.filter((refusal) => refusal.table === actorTable).map((refusal) => refusal.param), ...frozenIds],
    viaTarget: frozenIds.length > 0,
    rows: [...linkRows, ...frozenRows],
  };
}

/**
 * 凍結の控えの変数の宣言(凍結が無ければ空 = 凍結の無い RPC の本文は 1 バイトも変わらない)。
 *
 * @param owners 凍結の並び
 * @param table 自表
 * @returns declare の行
 */
export function frozenDeclares(owners: readonly FrozenOwner[], table: string): readonly string[] {
  return owners.length === 0 ? [] : [`    ${FROZEN_BEFORE_VAR} public.${table};`];
}

/**
 * 書き込みが通った後の関所の全部(紐づけの関所 → 凍結の関所。どちらも無ければ空)。
 *
 * @param facts 関所の並び
 * @param operation 拒否の本文の操作 ID の式
 * @returns plpgsql の断片
 */
export function erasedChecks(facts: { readonly erasedRefusals: readonly ErasedRefusal[]; readonly frozenOwners: readonly FrozenOwner[] }, operation: string): readonly string[] {
  return [...erasedRefusalChecks(facts.erasedRefusals, operation), ...frozenOwnerChecks(facts.frozenOwners, operation)];
}
