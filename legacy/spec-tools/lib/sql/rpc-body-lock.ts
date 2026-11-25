/**
 * 定型 RPC の本文が掛ける**行ロック**(0 行の理由を聞き直す文が読む行を、書き込みの前に掴む)。
 *
 * 形ごとの本文は `rpc-body-shapes.ts` が持ち、ここはその 4 形すべてが同じ形で持つ
 * 「書き込みの前に読む相手を掴む」1 か所だけを持つ。**どの親を掴むか**は `rpc-guard-locks.ts` が決める。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { RPC_BODY_WORDS } from '../messages/messages.js';
import type { RpcBodyFacts } from './rpc-facts.js';
import { CLOCK_VAR, TARGET_ALIAS } from './rpc-parts.js';
import { erasedLockPlan, frozenBeforeCapture } from './rpc-erased-refusal.js';
import { writtenRow, type RowId } from './rpc-row-id.js';
import { mergeSameTable } from './rpc-lock-merge.js';

/** ガード式が読む親の行に付ける別名の前置(`l0` / `l1` …。他のどの別名とも衝突しない)。 */
const LOCK_ALIAS_PREFIX = 'l';

/** 実行者の行に付ける別名。 */
const ACTOR_LOCK_ALIAS = 'la';

/** 実行者 id の引数名(`rpc-reach.ts` と同じ字面)。 */
const ACTOR_ID_PARAM = 'p_actor_id';

/** 同じ行かどうかの鍵の区切り(識別子にも SQL の式にも現れない字面)。 */
const KEY_SEPARATOR = '|';

/** 掴む相手 1 つ(表・別名・その 1 文の `from` と `where`・掴み方)。 */
export interface LockTarget {
  /** 並べ替えに使う表名(スキーマ修飾なし)。 */
  readonly table: string;
  /** 同じ行を 2 経路から掴まないための鍵(表 + その行の id を与える式)。 */
  readonly key: string;
  readonly alias: string;
  readonly from: readonly string[];
  readonly where: readonly string[];
  /** 行の並び(同じ表の 2 行を 1 文で掴むときだけ付ける)。 */
  readonly order: string | null;
  /** `for share`(読むだけ)か `for update`(この後で書く行を含む)か。 */
  readonly mode: 'share' | 'update';
  /** 作成の冪等キーの行(既にあれば挿入の前の再送の枝で返り、無ければ 0 行で何も持たない)。 */
  readonly createKey?: true;
  /** 掴む行がどの値で決まるか(データ。書く参照の列の親の照合 `rpc-fk-check-order.ts` が読む。言えない行は空)。 */
  readonly ids: readonly RowId[];
}

/**
 * 条件にする集約の行(`from` / `using` に並べる)。
 *
 * @param facts 本文の事実
 * @returns `public.{表} {別名}` の並び(宣言順)
 */
export function guardFrom(facts: RpcBodyFacts): readonly string[] {
  return facts.guardRows.map((row) => `public.${row.table} ${row.alias}`);
}

/**
 * 0 行の理由を聞き直す文が読む行を、**書き込みの前に**掴む文。
 *
 * 聞き直しは書き込みとは別の snapshot を見る。掴まなければ、書き込みが通ったあと(あるいは
 * 0 行の理由を数える前)に相手が動き、**コミットした世界では成り立たない条件**で書いた
 * ことになる(TLA+ の `Occ` が S9 / S8 の反例を出した時間帯)。掴むのは 3 種類である。
 *
 * | 相手 | なぜ | 掴み方 |
 * |---|---|---|
 * | 期待状態の条件として join する親 | ガードの前提 | `for share`(1 文に全部を並べて 1 つずつ) |
 * | ガード式がスカラー副問い合わせで読む親(鎖の途中も) | ガードの前提 | `for share` |
 * | **実行者の行** | `by` のロールの根拠(`claim` の欄・行の実在) | `for share` |
 * | 作成の冪等キーの既にある行(`createKey`) | 挿入の前の再送の枝の前提(消す txn を待つ。点検 26 回目 B26-1) | `for update`(実行者の表と同じなら実行者の行と 1 文で `for share`。D26b-1) |
 * | **トリガ・外部キーの連鎖が書く行** | この後で書かれる(`rpc-closure-locks.ts`) | `for update`(id の昇順) |
 * | **トリガが掴むと宣言した親**(`locks`) | トリガの中で掴む(点検 19 回目 A19-1) | 宣言の強さ(同じ行の期待状態の親の掴みも強める) |
 * | **トリガの写し元**(`copies_from`) | 写しの作成と写し元の消去を 1 本ずつに並べる(点検 19 回目 A19-3) | `for share`(id の昇順) |
 * | **対象の行が指す持ち主**(`refuse_erased.freezes_personal`) | 消去と個人列の書き込みを 1 本ずつに並べる(点検 20 回目 A20-1) | `for share`(実行者の集約と同じ表なら実行者の行と 1 文で id の昇順) |
 *
 * ロック順は **表名の昇順**に固定する —— 生成 RPC どうしも、手書き RPC も同じ 1 つの順序で
 * 掴む(ARCH-SP-BE-0001 §書き込み RPC の形)。**実行者の集約が書き込む表と同じとき**だけは、
 * 2 行を 1 文で `order by id` の昇順に `for update` で掴む —— 別々に掴むと「自分の行を共有で
 * 掴んでから相手の行を書く」2 本が互いを待つ(互いに相手を編集する形)。
 *
 * @param facts 本文の事実(掴む相手と、対象の行の id を与える式)
 * @param withTarget 対象の行を `from` に並べるか(錨が対象の行の列を指す編集・削除・遷移は
 *   true、錨が引数から直に来る作成は false)
 * @param createKey 作成の冪等キーの既にある行を掴むか(作成の本文だけ true)
 * @returns plpgsql の断片(掴む相手が 1 つも無ければ空)
 */
export function lockGuardRows(facts: RpcBodyFacts, withTarget: boolean, createKey = false): readonly string[] {
  const targets = lockPlan(facts, withTarget, createKey);
  if (targets.length === 0) return [];
  const statements = targets.map((target) =>
    [
      '    perform 1',
      `    from ${target.from.join(', ')}`,
      `    where ${target.where.join('\n      and ')}`,
      ...(target.order === null ? [] : [`    order by ${target.order}`]),
      `    for ${target.mode} of ${target.alias};`,
    ].join('\n'),
  );
  // 凍結の控え(点検 20 回目 A20-1)は対象の行を排他で掴んだ直後に取る(控えた値はこの txn の書き込みまで動かない)。
  const frozen = withTarget ? frozenBeforeCapture(facts.frozenOwners, facts.table, facts.targetId) : [];
  return [[`    -- ${RPC_BODY_WORDS.lockGuardRows}`, statements.join('\n\n')].join('\n'), '', ...frozen];
}

/**
 * 掴む相手を 3 経路から集め、表名の昇順に並べる(同じ行は 1 回だけ・同じ表は 1 文で掴む)。本文の先掴みはこの並びのとおりに書く。
 * @param facts 本文の事実
 * @param withTarget 対象の行を `from` に並べるか(作成だけ false)
 * @param createKey 作成の冪等キーの既にある行を掴むか
 * @returns 掴む順の並び(書く参照の列の親の照合 `rpc-fk-check-order.ts` も同じ並びを読む)
 */
export function lockPlan(facts: RpcBodyFacts, withTarget: boolean, createKey: boolean): readonly LockTarget[] {
  // 根の錨の値が書き込みの入れる値と言えるのは作成だけ(それ以外は書く前の対象の行の列。`rpc-facts.ts` の ownRefs)。
  const inserted = !withTarget;
  const anchor = withTarget ? [`${TARGET_ALIAS}.id = ${facts.targetId}`] : [];
  const target = withTarget ? [`public.${facts.table} ${TARGET_ALIAS}`] : [];
  // 楽観的並行制御の join —— 錨が互いの別名を指すので、1 文に全部を並べて 1 つだけ掴む。
  const joined: LockTarget[] = facts.guardRows.map((row) => ({
    table: row.table,
    key: rowKey(row.table, row.anchors.map((text) => idOf(row.alias, text)).find((id) => id !== null) ?? row.alias),
    alias: row.alias,
    from: [...target, ...guardFrom(facts)],
    where: [...anchor, ...facts.guardRows.flatMap((other) => other.anchors)],
    order: null,
    mode: 'share' as const,
    ids: inserted ? row.ownColumns.map((column) => writtenRow(column)) : [],
  }));
  const rest = [
    ...scalarTargets(facts, anchor, target),
    ...actorTargets(facts, withTarget, createKey),
    ...writeTargets(facts, withTarget, createKey),
    ...closureTargets(facts.closureLockRows),
  ];
  // 同じ行を 2 経路から掴まない。畳んだ側が強く掴むなら、残す側の掴みを強める(トリガが排他を求める親を共有で先に
  // 掴むと、2 本の txn が共有を持ったまま互いの排他を待つ。点検 19 回目 A19-1)。
  const kept = new Map<string, LockTarget>();
  for (const row of [...joined, ...rest]) {
    const held = kept.get(row.key);
    if (held === undefined) kept.set(row.key, row);
    else kept.set(row.key, { ...held, mode: row.mode === 'update' ? 'update' : held.mode, ids: [...held.ids, ...row.ids] });
  }
  return [...mergeSameTable([...kept.values()])].sort(byTable); // 同じ表に文が 2 つ以上なら強さを問わず 1 文に畳む(rpc-lock-merge.ts。D26e-1・D26f-1)
}

/**
 * 掴む順(**表名のバイト順**)。
 *
 * `localeCompare` を使わないのは、順序の根拠が「リポジトリに 1 つの順序」だからである ——
 * 手で書く側はバイト順で考えるので、機械も同じ規則で並べないと、ICU の照合順とバイト順が
 * 分かれる表名が現れた日に**静かに逆順**ができる(独立レビュー 2 回目 R5)。
 */
function byTable(left: LockTarget, right: LockTarget): number {
  if (left.table !== right.table) return left.table < right.table ? -1 : 1;
  // 同じ表では排他を先に掴む(共有の後に同じ表を排他で掴むと格上げになる。点検 19 回目 A19-1)。
  if (left.mode !== right.mode) return left.mode === 'update' ? -1 : 1;
  return left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0;
}

/**
 * **これから書く行**(対象の行。作成は冪等キーの既にある行)。読む行と同じ順序の列に並べる —— 順序の外に置くと、書く表の名前が
 * 読む表より小さいときに逆順ができる(独立レビュー 2 回目 S1')。実行者の集約と同じ表のときは `actorTargets` が
 * 2 行を 1 文で掴むので、ここは掴まない(作成の冪等キーの行も `la.id in (p_actor_id, p_id)` の 1 文が掴む。D26-1)。
 */
function writeTargets(facts: RpcBodyFacts, withTarget: boolean, createKey: boolean): readonly LockTarget[] {
  if (!withTarget && !createKey) return [];
  if (facts.hasActor && facts.actorTable === facts.table) return [];
  // 作成は冪等キー p_id の既にある行(再送・消された後の押し直し)を掴む。消す txn がまだコミットしていなければここで待つ(点検 26 回目 B26-1)。
  const id = withTarget ? facts.targetId : 'p_id';
  return [
    {
      table: facts.table,
      key: rowKey(facts.table, id),
      alias: TARGET_ALIAS,
      from: [`public.${facts.table} ${TARGET_ALIAS}`],
      where: [`${TARGET_ALIAS}.id = ${id}`],
      order: null,
      mode: 'update',
      ...(withTarget ? {} : { createKey: true as const }),
      ids: [],
    },
  ];
}

/**
 * **トリガと外部キーの連鎖が書く行**(`rpc-closure-locks.ts`)を、読む行・書く行と同じ順序の列に並べる。
 * 先掴みに入れないと書き込みの後から掴み、名前の小さい表を後ろで掴む逆順ができる(点検 18 回目 O18-1。強さは行の宣言のとおり)。
 */
function closureTargets(rows: RpcBodyFacts['closureLockRows']): readonly LockTarget[] {
  return rows.map((row) => ({
    table: row.table,
    key: rowKey(row.table, row.idKey ?? row.where.join(' and ')),
    alias: row.alias,
    from: row.from,
    where: row.where,
    order: row.ordered ? `${row.alias}.id` : null,
    mode: row.mode,
    ids: row.ids ?? [],
  }));
}

/** ガード式が読む親(鎖の途中も含む)。錨は鎖の式そのものなので 1 文に 1 つだけ並べる。 */
function scalarTargets(
  facts: RpcBodyFacts,
  anchor: readonly string[],
  target: readonly string[],
): readonly LockTarget[] {
  return facts.guardLockRows.map((row, index) => {
    const alias = `${LOCK_ALIAS_PREFIX}${index}`;
    return {
      table: bare(row.table),
      key: rowKey(bare(row.table), row.id),
      alias,
      from: [...target, `${row.table} ${alias}`],
      where: [...anchor, `${alias}.id = ${row.id}`],
      order: null,
      mode: 'share' as const,
      ids: [],
    };
  });
}

/**
 * 実行者の行(`by` のロールの根拠)。
 *
 * 書き込む表と同じなら、**対象の行と 2 つまとめて 1 文で id の昇順に `for update`** する ——
 * 別々に掴むと「自分の行を共有で掴んでから相手の行を書く」2 本が互いを待つ(互いに相手を
 * 編集する形)。この 1 文が対象の行の掴みも兼ねるので、`writeTargets` の鍵と同じにして畳む。
 */
function actorTargets(facts: RpcBodyFacts, withTarget: boolean, createKey: boolean): readonly LockTarget[] {
  const table = facts.actorTable;
  // 消去済みの関所が掴む行(点検 19 回目 A19-4・20 回目 A20-1。どの行かは関所の持ち主 `rpc-erased-refusal.ts` が決める)。
  const plan = erasedLockPlan(facts, table, withTarget);
  const others = plan.rows.map((row): LockTarget => ({ ...row, key: rowKey(row.table, row.id), order: null, mode: 'share', ids: [] }));
  if (!facts.hasActor || table === null) return others;
  // 作成でも作る表が実行者の表なら、冪等キー p_id の既にある行を同じ 1 文で掴む(掴まないと再送の枝が掴まずに読む。D26-1)。作成は共有で掴む ——
  // 消す txn を待てば足り、排他のまま挿入の外部キーの確かめが前の親に key share を掛けると輪になる(D26b-1。組の閉じた表は rpc-fk-key-share.test.ts)。
  const sameTable = (withTarget || createKey) && table === facts.table;
  const targetId = withTarget ? facts.targetId : 'p_id';
  const ids = [ACTOR_ID_PARAM, ...(sameTable ? [targetId] : []), ...plan.actorIds];
  const viaTarget = plan.viaTarget && !sameTable;
  return [
    ...others,
    {
      table,
      key: rowKey(table, sameTable ? `${ACTOR_ID_PARAM}${KEY_SEPARATOR}${targetId}` : ACTOR_ID_PARAM),
      alias: ACTOR_LOCK_ALIAS,
      from: [`public.${table} ${ACTOR_LOCK_ALIAS}`, ...(viaTarget ? [`public.${facts.table} ${TARGET_ALIAS}`] : [])],
      where: [
        ...(viaTarget ? [`${TARGET_ALIAS}.id = ${facts.targetId}`] : []),
        ids.length > 1 ? `${ACTOR_LOCK_ALIAS}.id in (${ids.join(', ')})` : `${ACTOR_LOCK_ALIAS}.id = ${ACTOR_ID_PARAM}`,
      ],
      order: ids.length > 1 ? `${ACTOR_LOCK_ALIAS}.id` : null,
      mode: sameTable && withTarget ? 'update' : 'share',
      ids: [],
    },
  ];
}

/**
 * 同じ行かどうかの鍵(**表だけでは足りない** —— 同じ表の別の行を落とさない)。区切りは可視文字にする(生の制御文字は git にバイナリと
 * 判定され diff が読めなくなる。独立レビュー 2 回目 F4')。表名の長さを前置するので、区切りの字が id の式に現れても鍵は一意である。
 */
function rowKey(table: string, id: string): string {
  return `${table.length}${KEY_SEPARATOR}${table}${KEY_SEPARATOR}${id}`;
}

/** `{別名}.id = {式}` の右辺(その行の id を与える式)。形が違えば null。 */
function idOf(alias: string, anchor: string): string | null {
  const head = `${alias}.id = `;
  return anchor.startsWith(head) ? anchor.slice(head.length) : null;
}

/** スキーマ修飾を落とした表名(経路をまたいで表で並べるため)。 */
function bare(table: string): string {
  return table.slice(table.lastIndexOf('.') + 1);
}

/** 本文が時刻(ガードの `now`・`records_time`)を使うか(述語・遷移の列・実行者の縛りのどれからでも来うるので、事実の束ごと `v_now` の字面を見る)。 */
export function usesClock(facts: RpcBodyFacts): boolean {
  return JSON.stringify(facts).includes(CLOCK_VAR);
}

/** 時刻の変数の宣言(使わない本文では空 = 時刻を使わない RPC の本文は 1 バイトも変わらない)。 */
export function clockDeclares(facts: RpcBodyFacts): readonly string[] {
  return usesClock(facts) ? [`    ${CLOCK_VAR} timestamptz;`] : [];
}

/**
 * 時刻を取る文(**行ロックの直後**に置く)。
 *
 * 行ロックを待つ間に締切が過ぎても、通るのは締切の前に取った時刻で判定した場合だけにする ——
 * `now()` はトランザクションの開始時刻であり、ロック待ちの前のままである。1 回だけ取って
 * ガードの `now` と `records_time` の全部に使うので、1 回の呼び出しの中で「いま」は 1 つに決まる。
 *
 * @param facts 本文の事実
 * @returns plpgsql の断片(使わなければ空)
 */
export function clockCapture(facts: RpcBodyFacts): readonly string[] {
  if (!usesClock(facts)) return [];
  return [`    -- ${RPC_BODY_WORDS.clockCapture}`, `    ${CLOCK_VAR} := clock_timestamp();`, ''];
}
