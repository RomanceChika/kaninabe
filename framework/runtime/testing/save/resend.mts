import { isDeepStrictEqual } from 'node:util';
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

/**
 * **保存点の作成の、入力を直した押し直しの性質**(点検 21 回目 A21-1 / B21-1)。生成した保存点の一致の証明が、
 * 再送で既存の行を返す保存点(`resend: idempotent` = 複合の作成)ごとに 1 本ずつ呼ぶ。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 書けた後に応答を失った利用者が、フォームの**子の手順の入力**(同行の参加者・資料・自分の参加者の欄など)だけを直して押し直すと、
 * 画面の実行器は同じ鍵を送る。複合 RPC が錨の作成の入力しか比べないと、1 回目の行を「書けた」と返す(直した内容は保存されない)。
 * ここでは実行器が許可する組み合わせの上で、書き込み経路の各点について次を実 DB で確かめる:
 *
 * 1. 1 回目(書ける)→ 2 回目(同じ入力・同じ鍵)は成功し、行は 1 回目のまま(同じ行の id)。
 * 2. 3 回目(同じ鍵・錨の入力は同じ・**子の手順の入力を 1 欄だけ変えた**)は `UC412` / `resend_input_mismatch` で断られる。
 * 3. 4 回目(元の入力)は成功し、読み直した結果は 2 回目と同じ(3 回目で行が増えも書き換わりもしていない)。
 * 4. 書いた行を消して(world を置き直して)から元の入力で同じ鍵を送ると、`UC412` / `resend_target_deleted` で断られる(1 回目は書けて
 *    その後に消えた。「既に保存されています」と言わず、新しい作成としても受けない。
 *
 * 変える欄は子の手順を先に探す(錨しか入力を持たない保存点だけ錨の欄を変える)。変える値は宣言の範囲の中である(`edits`)。
 * 1 回目は**書ける入力**で始める —— 設計図のままの入力が不変条件の執行点(SQLSTATE 23)で落ちたら、欄を 1 つ別の値にした入力・
 * 参照の欄を world の同じ集約の別の行へ向けた入力を順に試す(`firstInputs`)。設計図のままの入力が不変条件以外の理由で書けなければ反例である。
 * 変えた押し直しを 1 つも確かめられなければ赤である(そのとき 1 回目を書けなかった理由を並べる)。
 *
 * **アプリの語彙は 1 語も持たない。**
 *
 * @param world その保存点の設計図(生成物)
 * @param built 実 DB に作った world
 * @param harness 製品が渡す口と宣言
 */
export async function expectSaveResendEdited(world: EqSaveWorld, built: BuiltEqWorld, harness: SaveHarness): Promise<void> {
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

  const source = harness.ports.rpcSource();
  const mismatches: string[] = [];
  const unwritten: string[] = [];
  let edited = 0;
  for (const selection of enumerateWrites(world, base).filter((point) => point.resend === 1)) {
    const subject = subjectOfSave(world, built, selection, plan);
    const expected = saveOracle(plan, world, selection, subject, harness);
    const roles = selection.caller.session ? (selection.actor.staleRoles ?? expected.actorRoles) : expected.actorRoles;
    const call: ResendCall = (input) =>
      source.rpc(plan.rpc, { p_id: selection.id, p_actor_id: subject.actorId, p_actor_roles: [...roles], p_expected: subject.expected, p_input: input });
    const written = await firstWrite(selection.label, firstInputs(world, built, subject.input), {
      place: () => placeSaveCase(world, built, selection, subject, harness.ports),
      clear: () => clearSaveWrites(world, built, harness.ports),
      call,
    });
    mismatches.push(...written.problems);
    if (written.input === null) {
      unwritten.push(...written.refused);
      continue;
    }
    const change = editedResendInput(world, written.input);
    if (change !== null) {
      edited += 1;
      mismatches.push(...(await editedResendProblems(`${selection.label} / 変えた欄 ${change.at}`, written.input, change.input, call)));
    }
    await clearSaveWrites(world, built, harness.ports);
    // 4: 書いた行が消された後の同じ鍵の押し直し(要約は短命の表に残っている)。
    await placeSaveCase(world, built, selection, subject, harness.ports);
    const gone = await call(written.input);
    if (gone.error === null) mismatches.push(`${selection.label}: 書いた行を消した後の同じ鍵の押し直しが成功として返った(新しい作成として受けた)`);
    else if (gone.error.code !== MISMATCH_CODE || gone.error.details !== TARGET_DELETED_WORD) {
      mismatches.push(`${selection.label}: 書いた行を消した後の同じ鍵の押し直しの拒否が ${MISMATCH_CODE} ${TARGET_DELETED_WORD} でない(${gone.error.code} ${String(gone.error.details)})`);
    }
    await clearSaveWrites(world, built, harness.ports);
  }
  // ループの外の表明 —— 変えた押し直しを 1 つも確かめていなければ、性質は 1 度も実行されていない(A16)。
  // 0 件のときは、1 回目を書けなかった理由を並べる(赤の理由が見えないと、world の直しどころが分からない)。
  expect(edited, `${key}: 入力を変えた押し直しを確かめた組み合わせが 0 件です(1 回目が書けなかったもの: ${unwritten.join(' | ') || 'なし'})`).toBeGreaterThan(0);
  expect(mismatches, `${key}: 同じ鍵で入力を変えた押し直しが断られない組み合わせがある`).toEqual([]);
}

/** 複合 RPC を同じ鍵で 1 回呼ぶ口(入力だけを変えられる)。 */
export type ResendCall = (
  input: Readonly<Record<string, unknown>>,
) => PromiseLike<{ data: unknown; error: { readonly code: string; readonly message: string; readonly details?: string | null } | null }>;

/** 1 回目の書き込みの始末の口(置く・消す・呼ぶ)。 */
interface FirstWritePorts {
  readonly place: () => Promise<void>;
  readonly clear: () => Promise<void>;
  readonly call: ResendCall;
}

/** 1 回目の書き込みの結末(書けた入力か、書けなかった理由)。 */
interface FirstWrite {
  /** 書けた入力(書けた行は残したまま返す)。書けなければ null。 */
  readonly input: Readonly<Record<string, unknown>> | null;
  /** 不変条件の執行点(SQLSTATE 23)で書けなかった候補の理由(候補を尽くしたときだけ意味がある)。 */
  readonly refused: readonly string[];
  /** 不変条件以外の理由で書けなかった(それ自体が反例)。 */
  readonly problems: readonly string[];
}

/** 不変条件の執行点(制約違反)の SQLSTATE クラス。 */
const INTEGRITY_CLASS = '23';

/**
 * 1 回目を書ける入力を、候補の順に探す(書けたら行を残して返す)。
 *
 * 候補が不変条件の執行点(SQLSTATE 23。2 つの参照の欄が同じ行を指して「自分を承認者にしない」の CHECK に当たる等)で
 * 落ちたら、作られた行を消して次の候補へ進む。それ以外の失敗は世界の置き方では直らないので反例として返す。
 */
export async function firstWrite(label: string, candidates: readonly FirstInput[], ports: FirstWritePorts): Promise<FirstWrite> {
  const refused: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    await ports.place();
    const first = await ports.call(candidate.input);
    if (first.error === null) return { input: candidate.input, refused, problems: [] };
    await ports.clear();
    const at = `${label}${candidate.at === '' ? '' : ` / 置き換え ${candidate.at}`}`;
    // 設計図のままの入力が不変条件以外で落ちるのは反例。置き換えた候補は別の宣言(境界・ガード)に当たりうるので、理由を残して次へ。
    if (index === 0 && !first.error.code.startsWith(INTEGRITY_CLASS)) {
      return { input: null, refused, problems: [`${at}: 1 回目が書けていない(${first.error.code} ${first.error.message})`] };
    }
    refused.push(`${at}: ${first.error.code} ${first.error.message}`);
  }
  return { input: null, refused, problems: [] };
}

/** 1 回目に試す入力 1 つ(どの参照の欄を置き換えたか)。 */
export interface FirstInput {
  readonly input: Readonly<Record<string, unknown>>;
  /** 置き換えた欄(`{別名}.{欄}={値}` か参照の `{別名}.{欄}={行の名前}`)。設計図のままなら空。 */
  readonly at: string;
}

/** 参照の置き換えの候補の上限(world の行の数ぶん掛けると大きくなるので、先頭から打ち切る)。 */
const MAX_FIRST_INPUTS = 32;

/**
 * 1 回目に試す入力の並び(純関数)。先頭は設計図のままの入力で、その後に**欄を 1 つだけ宣言の範囲の中の別の値(`edits`)に
 * した**入力、**参照の欄を 1 つだけ world の同じ集約の別の行へ向けた**入力が続く(どちらも子の手順が先・錨が最後。繰り返す手順は
 * 全要素を同じ値・同じ行にする)。
 *
 * 設計図は参照の欄を「実行者の系統のその集約の行」へ向けるので、同じ集約を指す参照が 2 つあると同じ行になり、
 * 「2 つは違う行」を言う不変条件(`a != b` の CHECK)に必ず当たる。どの参照をどう向ければ通るかは不変条件の式を読まずに、
 * DB に聞く(候補を順に試す)。
 *
 * @param world その保存点の設計図(手順と world の行)
 * @param built 実 DB に作った world(行の名前 → id)
 * @param input 設計図のままの入力
 * @returns 試す入力(先頭は設計図のまま)
 */
export function firstInputs(
  world: Pick<EqSaveWorld, 'steps' | 'rows'>,
  built: Pick<BuiltEqWorld, 'rows'>,
  input: Readonly<Record<string, unknown>>,
): readonly FirstInput[] {
  const out: FirstInput[] = [{ input, at: '' }];
  const order = [...world.steps.slice(1), ...world.steps.slice(0, 1)];
  // 欄の別の値(`edits`。宣言の範囲の中)を 1 欄だけ当てた入力 —— 形式定義の無い CHECK(向きと符号の組など)は、別の enum の値で通ることがある。
  for (const step of order) {
    const value = input[step.alias];
    const rows = step.repeat ? (Array.isArray(value) ? (value as readonly unknown[]) : []) : [value];
    const edits = (step.repeat ? step.elements[0] : step.input)?.edits ?? {};
    for (const [field, edit] of Object.entries(edits)) {
      if (!rows.some((element) => isRecord(element) && field in element && element[field] !== edit)) continue;
      const moved = rows.map((element) => (isRecord(element) && field in element ? { ...element, [field]: edit } : element));
      out.push({ input: { ...input, [step.alias]: step.repeat ? moved : moved[0] }, at: `${step.alias}.${field}=${String(edit)}` });
      if (out.length >= MAX_FIRST_INPUTS) return out;
    }
  }
  for (const step of order) {
    const value = input[step.alias];
    const rows = step.repeat ? (Array.isArray(value) ? (value as readonly unknown[]) : []) : [value];
    const refs = (step.repeat ? step.elements[0] : step.input)?.refs ?? {};
    for (const [column, entity] of Object.entries(refs)) {
      if (column === TARGET_ID) continue;
      for (const row of world.rows.filter((candidate) => candidate.entity === entity)) {
        const id = built.rows.get(row.key)?.id;
        if (id === undefined || rows.every((element) => isRecord(element) && element[column] === id)) continue;
        const moved = rows.map((element) => (isRecord(element) ? { ...element, [column]: id } : element));
        out.push({ input: { ...input, [step.alias]: step.repeat ? moved : moved[0] }, at: `${step.alias}.${column}=${row.key}` });
        if (out.length >= MAX_FIRST_INPUTS) return out;
      }
    }
  }
  return out;
}

/** 対象そのものの識別子の入力の鍵(動かすと的を失うので置き換えない)。 */
const TARGET_ID = 'id';

/** 行の形の値か。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 1 回目が書けた後の 3 回(同じ入力 → 変えた入力 → 同じ入力)の食い違い。 */
async function editedResendProblems(
  at: string,
  original: Readonly<Record<string, unknown>>,
  changed: Readonly<Record<string, unknown>>,
  call: (input: Readonly<Record<string, unknown>>) => PromiseLike<{ data: unknown; error: { readonly code: string; readonly message: string; readonly details?: string | null } | null }>,
): Promise<readonly string[]> {
  const same = await call(original);
  if (same.error !== null) return [`${at}: 同じ入力の押し直しが断られた(${same.error.code} ${same.error.message})`];
  const problems: string[] = [];
  const refused = await call(changed);
  if (refused.error === null) {
    problems.push(`${at}: 入力を変えた押し直しが成功として返った(直した内容は保存されていない)`);
  } else if (refused.error.code !== MISMATCH_CODE || refused.error.details !== MISMATCH_WORD) {
    problems.push(`${at}: 入力を変えた押し直しの拒否が ${MISMATCH_CODE} ${MISMATCH_WORD} でない(${refused.error.code} ${String(refused.error.details)})`);
  }
  const again = await call(original);
  if (again.error !== null) return [...problems, `${at}: 元の入力の押し直しが断られた(${again.error.code} ${again.error.message})`];
  if (rowIdsOf(again.data).join(' ') !== rowIdsOf(same.data).join(' ') || !isDeepStrictEqual(again.data, same.data)) {
    problems.push(`${at}: 入力を変えた押し直しの後で行が変わった`);
  }
  return problems;
}

/** 入力の違う押し直しの拒否(`spec-tools/lib/sql/rpc-resend.ts` の `raiseInputMismatch` / `RESEND_INPUT_MISMATCH`)。 */
const MISMATCH_CODE = 'UC412';
const MISMATCH_WORD = 'resend_input_mismatch';

/** 書いた行を消した後の同じ鍵の押し直しの拒否の語(`spec-tools/lib/sql/rpc-resend-digest.ts` の `RESEND_TARGET_DELETED`。同じ UC412)。 */
const TARGET_DELETED_WORD = 'resend_target_deleted';

/**
 * 同じ鍵の押し直しで変える 1 欄を選び、その欄だけを変えた入力を返す(純関数)。
 *
 * 探す順は**錨より後の手順(子)が先**・錨が最後である —— 確かめたいのは子の入力の違いである。手順の中では、設計図が
 * **宣言の範囲の中の別の値**を用意した欄(`edits`。enum は別の要素・数は範囲の中・文字列は長さと書式の中。生成器の
 * `editedValueOf`)のうち、今回の入力に載っている最初の 1 つを変える。範囲の外へ変えると、押し直しの比べより先に欄の
 * CHECK で落ちて確かめたい拒否に届かない(点検 21 回目の後の samples:db の赤)。繰り返す手順は先頭の要素を変える。
 * 変えられる欄が無ければ null。
 *
 * @param world その保存点の設計図
 * @param input 1 回目の入力(`p_input`)
 * @returns 変えた入力と、どの欄を変えたか(`{別名}.{欄}`)
 */
export function editedResendInput(
  world: Pick<EqSaveWorld, 'steps'>,
  input: Readonly<Record<string, unknown>>,
): { readonly input: Readonly<Record<string, unknown>>; readonly at: string } | null {
  const order = [...world.steps.slice(1), ...world.steps.slice(0, 1)];
  for (const step of order) {
    const value = input[step.alias];
    const row = step.repeat ? (Array.isArray(value) ? value[0] : undefined) : value;
    if (!isRecord(row)) continue;
    const edits = (step.repeat ? step.elements[0] : step.input)?.edits ?? {};
    const chosen = Object.entries(edits).find(([field, edit]) => field in row && row[field] !== null && row[field] !== edit);
    if (chosen === undefined) continue;
    const [field, edit] = chosen;
    const changedRow = { ...row, [field]: edit };
    const changed = step.repeat ? [changedRow, ...(value as readonly unknown[]).slice(1)] : changedRow;
    return { input: { ...input, [step.alias]: changed }, at: `${step.alias}.${field}` };
  }
  return null;
}
