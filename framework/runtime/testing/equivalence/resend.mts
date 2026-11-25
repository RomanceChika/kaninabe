import { expect } from 'vitest';
import type { RunPlan } from '@kaninabe/runtime/plan';
import type { EqWorld } from './types.mjs';
import type { BuiltEqWorld } from './world.mjs';
import { eqPg, subjectOf } from './world.mjs';
import { clearCreated, placeCase } from './place.mjs';
import { eqArgs } from './args.mjs';
import { oracleDecision } from './oracle.mjs';
import type { EqHarness } from './expect.mjs';
import { enumerate } from './expect.mjs';
import { classifyDbFailure } from '@kaninabe/runtime/refusal';
import { frameworkRefusalText } from '@kaninabe/runtime/result';

/**
 * **作成の送り直しの性質**(点検 20 回目 B20-1)。生成した一致の証明が、作成の操作ごとに 1 本ずつ呼ぶ。
 *
 * 「同じ入力を同じ冪等キーで 2 回送ると、2 回目は 1 回目の行を返し(成功)、行は 1 つのまま」を、engine が許可して 1 回目が
 * 書けた全部の組み合わせで実 DB に当てる。書けた後に応答を失った利用者の押し直しがこの形である(画面の実行器は押し直しで同じ鍵を
 * 送る)。2 回目が競合・ガード・入力の誤り(一意の索引)で断られれば食い違いである —— 偶然の一意の索引に頼らない。
 *
 * **アプリの語彙は 1 語も持たない。**
 *
 * @param world 集約 1 つぶんの設計図(生成物)
 * @param built 実 DB に作った world
 * @param op 操作 ID(作成)
 * @param harness 製品が渡す口と実行計画
 */
export async function expectResendReturnsSameRow(world: EqWorld, built: BuiltEqWorld, op: string, harness: EqHarness): Promise<void> {
  const operation = world.operations.find((candidate) => candidate.op === op);
  expect(operation?.kind, `${op}: 設計図に作成の操作がありません`).toBe('create');
  const plan: RunPlan | undefined = harness.plans[op];
  expect(plan, `${op}: 実行計画がありません`).toBeDefined();
  if (operation === undefined || plan === undefined) return;

  const source = harness.ports.rpcSource();
  const pg = await eqPg(harness.ports);
  const mismatches: string[] = [];
  let resent = 0;
  // 許可されたのに 1 回目が書けなかった組み合わせの errcode(0 件のときの失敗の文言に使う)。
  const unwritten: string[] = [];
  for (const selection of enumerate(world, operation)) {
    const subject = subjectOf(world, built, selection);
    if (selection.branch !== null || !oracleDecision(plan, selection, subject).allowed) continue;
    await placeCase(world, built, selection, subject, harness.ports);
    const args = eqArgs(plan, selection, subject);
    const first = await source.rpc(plan.rpc, args);
    if (first.error !== null && first.error !== undefined) unwritten.push(`${first.error.code} ${first.error.message}`);
    if (first.error === null || first.error === undefined) {
      resent += 1;
      const second = await source.rpc(plan.rpc, args);
      const rows = Number((await pg.query<{ n: string }>(`select count(*) as n from public.${world.table} where id = $1`, [selection.newId])).rows[0]?.n ?? '0');
      const returned = Array.isArray(second.data) ? (second.data[0] as { readonly id?: unknown } | undefined)?.id : undefined;
      if (second.error !== null && second.error !== undefined) {
        mismatches.push(`${selection.label}: 送り直しが断られた(${second.error.code} ${second.error.message})`);
      } else if (returned !== selection.newId || rows !== 1) {
        mismatches.push(`${selection.label}: 送り直しが 1 回目の行を返さない(返した id ${String(returned)} / 行 ${String(rows)})`);
      }
    }
    await clearCreated(world, selection, harness.ports);
  }
  // ループの外の表明 —— 書けた組み合わせが 1 つも無ければ、送り直しを 1 度も確かめていない。理由が何であれ赤にする
  // (以前は、許可された組み合わせが全部制約違反(クラス 23)で止まったときを「書けないことの記録」として緑にしていた。設計図の行が
  // 一意の索引に当たる形はそれで黙って通り、性質は 1 度も実行されなかった。点検 20 回目 B20-1 の残り 2)。直すのは設計図の側である ——
  // 作成の入力の一意の鍵は world の行と当たらない値に置き直す(`operation.fresh`)。
  expect(
    resent,
    `${op}: 送り直しを確かめた組み合わせが 0 件です(engine が許可した組み合わせ ${String(unwritten.length)} 件は 1 回目が書けなかった: ${[...new Set(unwritten)].join(', ') || 'なし'})`,
  ).toBeGreaterThan(0);
  expect(mismatches, `${op}: 作成の送り直しが 1 回目の行を返さない組み合わせがある`).toEqual([]);
}

/** 同じ鍵の押し直しの拒否の語(生成した作成 RPC が UC409 の detail に載せる。`spec-tools/lib/sql/rpc-resend.ts` の RESEND_ALREADY_SAVED)。 */
const ALREADY_SAVED_WORD = 'resend_already_saved';

/**
 * **再送で既存の行を返さない表の、作成の送り直しの性質**(`resend.returns_existing: false`。)。
 *
 * 同じ入力を同じ冪等キーで 2 回送ると、(1) 2 回目は行を増やさず、(2) 2 回目の拒否が画面に出す文言は「既に保存されている」の
 * 種類である(入力の誤り・失敗の文言ではない)。文言は実行時の分類(`classifyDbFailure`)が運ぶ拒否の語を、画面と同じ閉じた表
 * (`frameworkRefusalText`)で引いて確かめる。engine が許可して 1 回目が書けた全部の組み合わせで実 DB に当てる。
 *
 * **アプリの語彙は 1 語も持たない。**
 *
 * @param world 集約 1 つぶんの設計図(生成物)
 * @param built 実 DB に作った world
 * @param op 操作 ID(作成)
 * @param harness 製品が渡す口と実行計画
 */
export async function expectResendAlreadySaved(world: EqWorld, built: BuiltEqWorld, op: string, harness: EqHarness): Promise<void> {
  const operation = world.operations.find((candidate) => candidate.op === op);
  expect(operation?.kind, `${op}: 設計図に作成の操作がありません`).toBe('create');
  const plan: RunPlan | undefined = harness.plans[op];
  expect(plan, `${op}: 実行計画がありません`).toBeDefined();
  if (operation === undefined || plan === undefined) return;

  const source = harness.ports.rpcSource();
  const pg = await eqPg(harness.ports);
  const mismatches: string[] = [];
  let resent = 0;
  for (const selection of enumerate(world, operation)) {
    const subject = subjectOf(world, built, selection);
    if (selection.branch !== null || !oracleDecision(plan, selection, subject).allowed) continue;
    await placeCase(world, built, selection, subject, harness.ports);
    const args = eqArgs(plan, selection, subject);
    const first = await source.rpc(plan.rpc, args);
    if (first.error === null || first.error === undefined) {
      resent += 1;
      const second = await source.rpc(plan.rpc, args);
      const rows = Number((await pg.query<{ n: string }>(`select count(*) as n from public.${world.table} where id = $1`, [selection.newId])).rows[0]?.n ?? '0');
      const failure = second.error ?? null;
      const classified =
        failure === null
          ? undefined
          : classifyDbFailure({ sqlstate: failure.code, message: failure.message, detail: failure.details ?? null, hint: failure.hint ?? null }, () => undefined);
      const word = classified !== undefined && 'word' in classified ? classified.word : undefined;
      const text = word === undefined ? undefined : frameworkRefusalText(word);
      if (rows !== 1) mismatches.push(`${selection.label}: 押し直しで行が ${String(rows)} 行になった`);
      if (classified?.kind !== 'conflict' || word !== ALREADY_SAVED_WORD || text === undefined) {
        mismatches.push(`${selection.label}: 押し直しの拒否が「既に保存されている」の語でない(${failure === null ? '成功' : `${String(failure.code)} ${String(failure.details)}`})`);
      } else if (!/既に保存されています/.test(text)) {
        mismatches.push(`${selection.label}: 押し直しの文言が「既に保存されている」の種類でない(${text})`);
      }
    }
    await clearCreated(world, selection, harness.ports);
  }
  expect(resent, `${op}: 送り直しを確かめた組み合わせが 0 件です`).toBeGreaterThan(0);
  expect(mismatches, `${op}: 同じ鍵の押し直しが「既に保存されている」にならない組み合わせがある`).toEqual([]);
}
