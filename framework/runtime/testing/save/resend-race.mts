import { randomUUID } from 'node:crypto';
import type { Client as PgClient } from 'pg';
import { expect } from 'vitest';
import type { RunPlan } from '@kaninabe/runtime/plan';
import type { EqSaveWorld } from './types.mjs';
import type { BuiltEqWorld } from './world.mjs';
import { subjectOfSave } from './world.mjs';
import { clearSaveWrites, placeSaveCase } from './place.mjs';
import { saveOracle } from './oracle.mjs';
import type { SaveHarness } from './expect.mjs';
import { enumerateDecisions, enumerateWrites } from './expect.mjs';
import { rowIdsOf } from './fire.mjs';
import { eqPg } from '../equivalence/world.mjs';
import { identifier } from '../pg/encode.mjs';
import { editedResendInput, firstInputs, firstWrite } from './resend.mjs';
import type { ResendCall } from './resend.mjs';

/**
 * **保存点の作成の、1 回目がコミットする前に届いた同じ鍵の押し直しの性質**(点検 22 回目 A22-1)。生成した保存点の一致の証明が、
 * 再送で既存の行を返す保存点(`resend: idempotent` = 複合の作成)ごとに 1 本ずつ呼ぶ。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 応答を失った利用者の押し直しは、画面の実行器が同じ鍵で送る(点検 20 回目 B20-1)。1 回目の txn がまだ開いている間に届くと、
 * 2 本目は複合 RPC の先頭の再送の確かめ(錨の行の実在)を抜け、手順 1 の作成 RPC で 1 回目のコミットを待つ。ここでは点検の探り
 * (`racex.sh`)の交錯を実 DB で作る —— 1 本目を pg の txn で開いたまま、同じ鍵の 2 本目を画面と同じ口(`rpcSource`)で送り、
 * 2 本目が待っているのを確かめてから 1 本目をコミットする。確かめるのは:
 *
 * 1. **同じ入力**の 2 本目は成功し、返る行は 1 本目と同じ(子の手順の行をもう 1 組作らない)。後の押し直しも同じ行を返す。
 * 2. **1 欄変えた入力**の 2 本目は `UC412` / `resend_input_mismatch` で断られる(書けたと返さない)。後の押し直し(1 回目の入力)は
 *    1 本目と同じ行を返す(要約が 2 本目の入力に置き換わっていない = 1 回目にコミットした入力が勝つ)。
 *
 * 書き込み経路の各点(繰り返しの件数 × 入力の形)で、1 回目に書ける入力を `expectSaveResendEdited` と同じ探し方(`firstInputs` / `firstWrite`)で決め、交錯は毎回新しい鍵で行う
 * (探しに使った鍵の要約は短命の表に残るので、同じ鍵で 1 回目をやり直すと「既に保存されている」になる)。
 *
 * **アプリの語彙は 1 語も持たない。**
 *
 * @param world その保存点の設計図(生成物)
 * @param built 実 DB に作った world
 * @param harness 製品が渡す口と宣言
 */
export async function expectSaveResendRace(world: EqSaveWorld, built: BuiltEqWorld, harness: SaveHarness): Promise<void> {
  const key = `${world.usecase}.${world.save}`;
  expect(world.resend, `${key}: 再送で既存の行を返す保存点ではありません`).toBe('idempotent');
  const plan: RunPlan | undefined = harness.plans[key];
  expect(plan, `${key}: 実行計画がありません`).toBeDefined();
  if (plan === undefined) return;
  const base = enumerateDecisions(world).find(
    (selection) => saveOracle(plan, world, selection, subjectOfSave(world, built, selection, plan), harness).allowed,
  );
  expect(base, `${key}: 実行器が許可する組み合わせが 1 つもない`).toBeDefined();
  if (base === undefined) return;

  // 錨(最初に作る行)。ほかの txn がこの行を消すときの重なりを作る(点検 23 回目 A23-1)。
  const anchor = world.steps.find((step) => step.kind === 'create' && !step.repeat);
  const source = harness.ports.rpcSource();
  const pg = await eqPg(harness.ports);
  const schema = await schemaOf(pg, plan.rpc);
  const problems: string[] = [];
  const unwritten: string[] = [];
  let raced = 0;
  // 書き込み経路の各点(繰り返しの件数 × 入力の形)で交錯を作る —— 子の行が 0 件の点だけでは、2 組目ができても見えない。
  for (const selection of enumerateWrites(world, base).filter((point) => point.resend === 1)) {
    const subject = subjectOfSave(world, built, selection, plan);
    const expected = saveOracle(plan, world, selection, subject, harness);
    const roles = selection.caller.session ? (selection.actor.staleRoles ?? expected.actorRoles) : expected.actorRoles;
    const argsOf = (id: string, input: Readonly<Record<string, unknown>>) => ({
      p_id: id,
      p_actor_id: subject.actorId,
      p_actor_roles: [...roles],
      p_expected: subject.expected,
      p_input: input,
    });
    const callWith = (id: string): ResendCall => (input) => source.rpc(plan.rpc, argsOf(id, input));
    const place = () => placeSaveCase(world, built, selection, subject, harness.ports);
    const clear = () => clearSaveWrites(world, built, harness.ports);

    // 1 回目に書ける入力を探す(探しに使った鍵は捨てる)。
    const written = await firstWrite(selection.label, firstInputs(world, built, subject.input), { place, clear, call: callWith(randomUUID()) });
    problems.push(...written.problems);
    if (written.input === null) {
      unwritten.push(...written.refused);
      continue;
    }
    await clear();
    const first = written.input;
    const edited = editedResendInput(world, first);
    const rounds: readonly { readonly label: string; readonly second: Readonly<Record<string, unknown>> }[] = [
      { label: '同じ入力', second: first },
      ...(edited === null ? [] : [{ label: `変えた欄 ${edited.at}`, second: edited.input }]),
    ];
    for (const { label, second } of rounds) {
      await place();
      const id = randomUUID();
      const outcome = await race(harness, schema, plan.rpc, argsOf(id, first), () => callWith(id)(second));
      raced += 1;
      const at = `${selection.label} / ${label}`;
      problems.push(...raceProblems(at, outcome, label === '同じ入力'));
      if (outcome.first.ok) {
        const later = await callWith(id)(first);
        if (later.error !== null) problems.push(`${at}: 後の押し直し(1 回目の入力)が断られた(${later.error.code} ${String(later.error.details ?? later.error.message)})`);
        else if (rowIdsOf(later.data).join(' ') !== rowIdsOf(outcome.first.data).join(' ')) {
          problems.push(`${at}: 後の押し直し(1 回目の入力)の行が 1 本目と違う(2 本目が行を足したか、要約を置き換えた)`);
        }
      }
      await clear();
    }
    // 3. 錨の行を消す txn と重なった同じ鍵の押し直し(点検 23 回目 A23-1)。1 回目はコミット済み・2 本目は消す側のコミットを待つ。
    if (anchor !== undefined) {
      await place();
      const id = randomUUID();
      const at = `${selection.label} / 錨を消す txn と重なる`;
      const committed = await callWith(id)(first);
      if (committed.error !== null) problems.push(`${at}: 1 回目が書けていない(${committed.error.code} ${String(committed.error.details ?? committed.error.message)})`);
      else {
        problems.push(...deleteRaceProblems(at, await raceDelete(harness, anchor.table, id, () => callWith(id)(first))));
        raced += 1;
      }
      await clear();
    }
  }
  // ループの外の表明 —— 交錯を 1 度も作っていなければ、性質は 1 度も実行されていない(A16)。
  expect(raced, `${key}: 交錯を作れた組み合わせが 0 件です(1 回目が書けなかったもの: ${unwritten.join(' | ') || 'なし'})`).toBeGreaterThan(0);
  expect(problems, `${key}: 1 回目がコミットする前に届いた同じ鍵の押し直しが、行を足すか書けたと偽る`).toEqual([]);
}

/** 交錯の結末(1 本目は pg の txn・2 本目は画面と同じ口)。 */
export interface Raced {
  readonly first: { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly error: string };
  readonly second: Awaited<ReturnType<ResendCall>>;
  /** 2 本目が 1 本目のコミットを待ったか(待つ前に終わったら false)。 */
  readonly waited: boolean;
}

/** 2 本目が待ちに入るのを待つ上限(ミリ秒)。 */ const WAIT_LIMIT_MS = 10_000;

/** 1 本目を開いたまま 2 本目を送り、2 本目が錠を待つのを確かめてから 1 本目をコミットする。 */
async function race(
  harness: SaveHarness,
  schema: string,
  rpc: string,
  firstArgs: Readonly<Record<string, unknown>>,
  sendSecond: () => ReturnType<ResendCall>,
): Promise<Raced> {
  const holder = await harness.ports.connectPg();
  try {
    await holder.query('begin');
    const pid = (await holder.query<{ readonly pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid ?? -1;
    let first: Raced['first'];
    try {
      const result = await holder.query<{ readonly result: unknown }>(
        `select ${identifier(schema, 'スキーマ名')}.${identifier(rpc, '関数名')}(p_id => $1::uuid, p_actor_id => $2::uuid, p_actor_roles => $3::text[], p_expected => $4::jsonb, p_input => $5::jsonb) as "result"`,
        [firstArgs['p_id'], firstArgs['p_actor_id'], firstArgs['p_actor_roles'], JSON.stringify(firstArgs['p_expected'] ?? {}), JSON.stringify(firstArgs['p_input'] ?? {})],
      );
      first = { ok: true, data: result.rows[0]?.result };
    } catch (error) {
      await holder.query('rollback');
      return { first: { ok: false, error: error instanceof Error ? error.message : String(error) }, second: await sendSecond(), waited: false };
    }
    let settled = false;
    const second = Promise.resolve(sendSecond()).finally(() => {
      settled = true;
    });
    const waited = await waitForLockWait(await eqPg(harness.ports), pid, () => settled);
    await holder.query('commit');
    return { first, second: await second, waited };
  } finally {
    await holder.end();
  }
}

/** 1 本目以外の接続が錠を待つまで待つ(2 本目が先に終わったら false)。 */
async function waitForLockWait(pg: PgClient, holderPid: number, settled: () => boolean): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < WAIT_LIMIT_MS) {
    if (settled()) return false;
    const blocked = await pg.query<{ readonly n: number }>(
      `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))`,
      [holderPid],
    );
    if ((blocked.rows[0]?.n ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * 交錯の結末の食い違い(同じ入力なら 1 本目と同じ行、変えた入力なら resend_input_mismatch)。純関数。
 * @param at - 報告に出る組み合わせの名前
 * @param raced - 交錯の結末
 * @param same - 2 本目が 1 本目と同じ入力か
 * @returns 食い違い(無ければ空)
 */
export function raceProblems(at: string, raced: Raced, same: boolean): readonly string[] {
  if (!raced.first.ok) return [`${at}: 1 本目が書けていない(${raced.first.error})`];
  const problems: string[] = [];
  if (!raced.waited) problems.push(`${at}: 2 本目が 1 本目のコミットを待たなかった(交錯を作れていない)`);
  const second = raced.second;
  if (same) {
    if (second.error !== null) problems.push(`${at}: 同じ入力の 2 本目が断られた(${second.error.code} ${String(second.error.details ?? second.error.message)})`);
    else if (rowIdsOf(second.data).join(' ') !== rowIdsOf(raced.first.data).join(' ')) {
      problems.push(`${at}: 同じ入力の 2 本目が 1 本目と違う行を返した(子の手順の行をもう 1 組作った)`);
    }
  } else if (second.error === null) {
    problems.push(`${at}: 入力を変えた 2 本目が成功として返った(直した内容を書けたと偽る)`);
  } else if (second.error.code !== MISMATCH_CODE || second.error.details !== MISMATCH_WORD) {
    problems.push(`${at}: 入力を変えた 2 本目の拒否が ${MISMATCH_CODE} ${MISMATCH_WORD} でない(${second.error.code} ${String(second.error.details)})`);
  }
  return problems;
}

/**
 * 錨の行を消す txn を開いたまま同じ鍵の 2 本目を送り、2 本目が錠を待つのを確かめてから消す側をコミットする(点検 23 回目 A23-1)。
 * 消す側は行を直に消す(どの経路の削除・外部キーの連鎖でも、錨の行が消えることは同じ)。
 */
async function raceDelete(harness: SaveHarness, table: string, id: string, sendSecond: () => ReturnType<ResendCall>): Promise<DeleteRaced> {
  const holder = await harness.ports.connectPg();
  try {
    await holder.query('begin');
    const pid = (await holder.query<{ readonly pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid ?? -1;
    await holder.query('savepoint direct');
    const removed = await holder.query(`delete from public.${identifier(table, '表名')} where id = $1::uuid`, [id]).then(
      (result) => result.rowCount ?? 0,
      // 子の表の外部キーが cascade でなければ、子を先に消す(どこかの経路で子ごと消えた形)。
      async () => (await holder.query('rollback to savepoint direct'), deleteRow(holder, table, 'id', id, 0)),
    );
    let settled = false;
    const second = Promise.resolve(sendSecond()).finally(() => {
      settled = true;
    });
    const waited = await waitForLockWait(await eqPg(harness.ports), pid, () => settled);
    await holder.query('commit');
    return { removed, second: await second, waited };
  } finally {
    await holder.end();
  }
}

/** 参照を辿って消す深さの上限(循環する参照で止まらないため)。 */ const DELETE_DEPTH = 5;

/** 行を消す(指す行を pg のカタログの外部キーから引いて先に消す —— cascade でない子の表を持つ錨でも、子ごと消えた形を作る)。消した行の数を返す。 */
async function deleteRow(holder: PgClient, table: string, column: string, value: string, depth: number): Promise<number> {
  if (depth < DELETE_DEPTH) {
    const refs = await holder.query<{ readonly child: string; readonly fk: string; readonly ref: string }>(
      `select c.conrelid::regclass::text as child, a.attname as fk, ra.attname as ref from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
        where c.contype = 'f' and c.confrelid = $1::regclass and array_length(c.conkey, 1) = 1 and c.conrelid <> c.confrelid`,
      [`public.${identifier(table, '表名')}`],
    );
    for (const ref of refs.rows) {
      const child = ref.child.replace(/^public\./u, '');
      const keys = await holder.query<{ readonly id: string }>(
        `select id::text as id from public.${identifier(child, '表名')} where ${identifier(ref.fk, '列名')} in (select ${identifier(ref.ref, '列名')} from public.${identifier(table, '表名')} where ${identifier(column, '列名')} = $1::uuid)`,
        [value],
      );
      for (const key of keys.rows) await deleteRow(holder, child, 'id', key.id, depth + 1);
    }
  }
  const removed = await holder.query(`delete from public.${identifier(table, '表名')} where ${identifier(column, '列名')} = $1::uuid`, [value]);
  return removed.rowCount ?? 0;
}

/** 錨の行を消す txn との交錯の結末(`removed` = 消す側が消した錨の行の数。1 でなければ交錯を作れていない)。 */
export interface DeleteRaced {
  readonly removed: number;
  readonly second: Awaited<ReturnType<ResendCall>>;
  readonly waited: boolean;
}

/**
 * 錨の行を消す txn と重なった押し直しの食い違い(`UC412` / `resend_target_deleted` で断られなければ赤。成功で返ると、呼び直した錨の作成が
 * 新しい行を作り、子の手順を 1 つも実行せずに「書けた」と返している)。純関数。
 * @param at - 報告に出る組み合わせの名前
 * @param raced - 交錯の結末
 * @returns 食い違い(無ければ空)
 */
export function deleteRaceProblems(at: string, raced: DeleteRaced): readonly string[] {
  if (raced.removed !== 1) return [`${at}: 消す側が錨の行を消せていない(${String(raced.removed)} 行)`];
  const problems: string[] = [];
  if (!raced.waited) problems.push(`${at}: 2 本目が消す側のコミットを待たなかった(交錯を作れていない)`);
  const second = raced.second;
  if (second.error === null) problems.push(`${at}: 錨が消えた後の押し直しが成功として返った(錨を作り直し、子の手順を実行せずに書けたと偽る)`);
  else if (second.error.code !== MISMATCH_CODE || second.error.details !== DELETED_WORD) {
    problems.push(`${at}: 錨が消えた後の押し直しの拒否が ${MISMATCH_CODE} ${DELETED_WORD} でない(${second.error.code} ${String(second.error.details)})`);
  }
  return problems;
}

/** 錨の行が消された後の同じ鍵の押し直しの拒否の語(`spec-tools/lib/sql/rpc-resend-digest.ts` の `RESEND_TARGET_DELETED`)。 */ const DELETED_WORD = 'resend_target_deleted';

/** 入力の違う押し直しの拒否(`spec-tools/lib/sql/rpc-resend.ts` の `raiseInputMismatch` / `RESEND_INPUT_MISMATCH`)。 */ const MISMATCH_CODE = 'UC412';
const MISMATCH_WORD = 'resend_input_mismatch';

/** 複合 RPC のあるスキーマ(関数名で 1 本に決まる。決まらなければ投げる)。 */
async function schemaOf(pg: PgClient, rpc: string): Promise<string> {
  const found = await pg.query<{ readonly schema: string }>(
    `select n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = $1`,
    [rpc],
  );
  if (found.rows.length !== 1) throw new Error(`関数 ${rpc} のスキーマが 1 つに決まりません(${String(found.rows.length)} 件)`);
  return found.rows[0]?.schema ?? '';
}
