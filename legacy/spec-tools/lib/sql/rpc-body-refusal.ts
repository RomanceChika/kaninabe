/**
 * 0 行になったときの**理由の分類**(束 ⑳-3)。
 *
 * ⑳-2 までの本文は、書けなかったときに黙って `return;` していた —— 条件は「判断時の状態」
 * だけだったので、0 行は必ず競合だったからである。⑳-3 で `by` とガードが本文に入ると、
 * 0 行の理由が 3 つに分かれる。**どれも行が 0 本という同じ見え方をする**ので、errcode で
 * 区別する(`refusal-codes.ts` が語の 1 か所)。
 *
 * ## 分類は 2 段である(束 ⑳-3b)
 *
 * 1. **照会で理由を決める** —— 状態 → ロール → ガードの順に 1 本ずつ評価し、最初に成立して
 *    いない段の errcode を上げる。
 * 2. **照会が 3 つとも通ったのに 0 行なら競合**(`UC409`)—— 照会と書き込みの間に行が動いた、
 *    という残る唯一の実在ケースである。
 *
 * 2 段にしないと 2 つの嘘が出る(⑳-3 の独立レビュー 1-A)。**ガードを 1 つも持たない関数が
 * 「ガード違反」を返す**(その関数に成立しうるガードは存在しない)。そして**照会と書き込みの
 * 間の競合がガード違反になる**。したがって**ガードを持たない形ではガードの段そのものを作らない**
 * —— 変数も宣言しない(`refusalDeclares`)。
 *
 * 判定の順は engine と同じ **状態 → ロール → ガード**である。`canFire`(machine.ts)は
 * `invalid_from`(宣言に無い遷移元)を `role_forbidden` より**先に**返す —— 設計メモは
 * 「ロール → 状態 → ガード」と書いていたが、engine の実物はこの順であり、差分テスト
 * (`rpc-engine-equivalence`)が反例で訂正した(束 ⑳-3 の実測)。`canCreate` / `canDelete` /
 * `canWrite` に状態の段は無いので、そこでは「判断時の前提が崩れたか」(競合)がその位置に入る。
 *
 * 順が違うと、同じ 1 つの拒否に対して先読みと DB が別の理由を返す —— 人が読む理由は
 * 先読みが出すので、そこがずれると監査と画面が食い違う。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { RPC_BODY_WORDS } from '../messages/messages.js';
import { raiseRefusal, raiseRefusalOf } from './refusal-codes.js';
import type { RefusalKind } from './refusal-codes.js';
import { ALWAYS } from './rpc-authz.js';
import type { RpcBodyFacts } from './rpc-facts.js';
import { TARGET_ALIAS } from './rpc-parts.js';
import { raiseAlreadySaved, raiseInputMismatch, refuseRecreated, resendInputDiffers, resendNote, resendOwnership, signalResend } from './rpc-resend.js';
import { sqlLiteral } from './guard-to-sql.js';

/** ロールの判定を受ける変数。 */
export const ROLE_OK_VAR = 'v_role_ok';

/** ガードの判定を受ける変数。 */
export const GUARD_OK_VAR = 'v_guard_ok';

/** 遷移の RPC だけは、落ちた操作が引数にしか無い(1 本で機械の全イベントを受け持つ)。 */
const EVENT_PARAM = 'p_event_id';

/** 成立しうるガードを持つか(持たない形ではガードの段を作らない)。 */
function hasGuard(facts: RpcBodyFacts): boolean {
  return facts.authz.guard !== ALWAYS;
}

/** 分類に要る変数の宣言(遷移・編集・削除)。 */
export function refusalDeclares(facts: RpcBodyFacts): readonly string[] {
  return [
    `    ${ROLE_OK_VAR} boolean;`,
    ...(hasGuard(facts) ? [`    ${GUARD_OK_VAR} boolean;`] : []),
  ];
}

/** 拒否を上げる 1 文(遷移は実行時の引数、それ以外は予約 ID)。 */
function raise(kind: RefusalKind, facts: RpcBodyFacts, indent: string): string {
  if (facts.eventId === '') return raiseRefusalOf(kind, EVENT_PARAM, indent);
  return raiseRefusal(kind, facts.eventId, indent);
}

/**
 * 書き込みの `where` に積む述語(ロール・状態・ガード)。
 *
 * 常に成立する述語(`true`)は積まない —— 読む人にとって意味の無い行が増えるだけである。
 *
 * @param facts 集め終えた事実
 * @returns `and` で並べる条件の並び
 */
export function authzConditions(facts: RpcBodyFacts): readonly string[] {
  const { role, state, guard } = facts.authz;
  return [state, role, guard].filter((predicate) => predicate !== ALWAYS);
}

/**
 * 0 行の理由を分類して raise するブロック(遷移・編集・削除)。
 *
 * @param facts 集め終えた事実
 * @param stateConditions 「判断時の前提」にあたる条件の並び(書き込みの `where` と同じもの)
 * @param stateFrom 状態の照会に使う `from` 句(条件にする集約がある形だけ)
 * @returns plpgsql の行
 */
export function refusalBlock(
  facts: RpcBodyFacts,
  stateConditions: readonly string[],
  stateFrom: readonly string[],
): readonly string[] {
  return [
    `    -- ${RPC_BODY_WORDS.refusalOrder}`,
    '    if not found then',
    '        if not exists (',
    '            select 1',
    `            from public.${facts.table} ${TARGET_ALIAS}${stateFrom.length === 0 ? '' : `, ${stateFrom.join(', ')}`}`,
    `            where ${stateConditions.join('\n              and ')}`,
    '        ) then',
    raise('conflict', facts, '            '),
    '        end if;',
    ...readAuthz(facts),
    `        if not ${ROLE_OK_VAR} then`,
    raise('forbidden', facts, '            '),
    '        end if;',
    ...(hasGuard(facts)
      ? [`        if not ${GUARD_OK_VAR} then`, raise('guard', facts, '            '), '        end if;']
      : []),
    `        -- ${RPC_BODY_WORDS.refusalRace}`,
    raise('conflict', facts, '        '),
    '    end if;',
  ];
}

/**
 * ロール(と、あればガード)を対象の行から 1 本ずつ評価する。
 *
 * 行が消えていれば変数は NULL になり、`not NULL` はどの段でも真にならない —— そのまま
 * 最後の競合に落ちる(行が動いたのだから、それが正しい分類である)。
 */
function readAuthz(facts: RpcBodyFacts): readonly string[] {
  const guarded = hasGuard(facts);
  return [
    `        select ${facts.authz.role}${guarded ? `, ${facts.authz.guard}` : ''}`,
    `          into ${ROLE_OK_VAR}${guarded ? `, ${GUARD_OK_VAR}` : ''}`,
    `          from public.${facts.table} ${TARGET_ALIAS}`,
    `         where ${TARGET_ALIAS}.id = ${facts.targetId};`,
  ];
}

/**
 * 0 行の理由を分類して raise するブロック(作成)。
 *
 * 作成だけは 0 行に**もう 1 つの意味**がある —— 同じ id の再送(冪等)である。行が実在すれば
 * それを返して終わり、実在しないときだけ残りの段に進む(束 ⑯b の `on conflict (id) do nothing`)。
 * 対象の行がまだ無いので、述語は引数と辿った先の行だけで評価できる(変数に受けない)。
 *
 * **ロールの段は再送より前に置く**(束 ⑳-3b の独立レビュー 1-B)—— 後ろに置くと、`creates` の
 * `by` が 1 つも立たない実行者が既存の id を渡したときに、拒否されずにその行が返る。冪等な再送も
 * 「その操作を実行してよい人」にだけ返すのが `by` の意味である。ガードの段は再送より後ろのままで
 * よい(締切が過ぎたあとの再送は、成立した作成をそのまま返す)。
 *
 * **再送で返してよいのは、実行者が作った行だけである**(表の `resend` の宣言。`usecase/resend-policy.ts`)。
 * id は呼ぶ側が選べる鍵なので、id の実在だけを見て返すと、他人の行の id を渡した呼び出しにその中身が
 * 返る。同じ id の行があるのに方針が返さない(作成者が違う・`returns_existing: false`)ときは、
 * 中身を返さず競合(`UC409`)にして**ここで止める** —— 後ろの段(前提・ガード)へ落とすと、
 * 同じ衝突がガードの具合で `UC412` に見えたりする。
 *
 * @param facts 集め終えた事実
 * @param occ 楽観的並行制御の `exists (…)`(条件にする集約が無ければ空)
 * @returns plpgsql の行
 */
export function createRefusalBlock(facts: RpcBodyFacts, occ: readonly string[]): readonly string[] {
  return [
    `    -- ${RPC_BODY_WORDS.createRefusalOrder}`,
    '    if not found then',
    `        if not (${facts.authz.role}) then`,
    raise('forbidden', facts, '            '),
    '        end if;',
    `        -- ${RPC_BODY_WORDS.createResend}`,
    ...resendBranch(facts),
    ...(occ.length === 0
      ? []
      : [
          `        if not ${occ.join('\n        ').trim()} then`,
          raise('conflict', facts, '            '),
          '        end if;',
        ]),
    ...(hasGuard(facts)
      ? [`        if not (${facts.authz.guard}) then`, raise('guard', facts, '            '), '        end if;']
      : []),
    `        -- ${RPC_BODY_WORDS.refusalRace}`,
    raise('conflict', facts, '        '),
    '    end if;',
    ...refuseRecreated({
      event: facts.eventId === '' ? EVENT_PARAM : sqlLiteral(facts.eventId),
      operation: facts.eventId === '' ? EVENT_PARAM : sqlLiteral(facts.eventId),
      hasActor: facts.hasActor,
      conflict: raise('conflict', facts, '        '),
      indent: '    ',
    }),
  ];
}

/**
 * 挿入の**前**に置く再送の枝(点検 26 回目 B26-1)。
 *
 * PostgreSQL は行の before insert トリガを `on conflict (id) do nothing` の衝突の判定より先に実行する。再送の判定が挿入の後ろ
 * (`createRefusalBlock`)にしか無いと、同じ鍵の押し直しでも番号のトリガが後ろの行をずらし、上端や確かめのトリガが書けた 1 回目の
 * 押し直しを断る。そこで同じ id の行が既にあれば、挿入へ進まずにここで決める —— 段の順(ロール → 再送)も、返す・断るの中身も
 * 挿入の後ろの枝と同じ 1 本(`resendBranch`)である。挿入の後ろの枝は、ここを抜けた後に同じ鍵の 1 回目がコミットした交錯のために残す。
 *
 * 置き場は掴みの文(`lockGuardRows`)の後である。掴みが同じ親の行を排他で取る形(番号のトリガの親など)では、同じ鍵の 1 回目が
 * まだコミットしていない押し直しはそこで待ち、ここで 1 回目の行を見る。
 *
 * **既にある行は先に掴んである。** 掴みの文は作成の冪等キーの行(`p_id`)も表名の順の列に入れて `for update` で掴む
 * (`rpc-body-lock.ts` の `createKey`)。掴まずに見ると、その行を消す txn がまだコミットしていない間は消える前の行が見えたまま再送として返り、
 * 消した後の押し直しが「書けた」と偽る(点検 23 回目 A23-1 の交錯。題材の保存点の押し直しの生成テストが実測した)。掴みが消す側のコミットを
 * 待つので、ここの照会(新しい snapshot)は消えた後を見て、挿入へ進んで作り直しの断り(`refuseRecreated`)に合流する。掴みの強さを排他にするのは、
 * 番号のトリガが同じ表の行を書く(共有で先に掴むと格上げになる)ため。
 *
 * @param facts 集め終えた事実
 * @returns plpgsql の行
 */
export function createResendBeforeInsert(facts: RpcBodyFacts): readonly string[] {
  return [
    `    -- ${RPC_BODY_WORDS.createResendBeforeInsert}`,
    `    if exists (select 1 from public.${facts.table} where id = p_id) then`,
    `        if not (${facts.authz.role}) then`,
    raise('forbidden', facts, '            '),
    '        end if;',
    ...resendInner(facts).map((line) => line.replace(/^ {4}/gmu, '')),
    '    end if;',
    '',
  ];
}

/**
 * 作成の再送の枝(同じ id の行が既にあるとき)。
 *
 * 方針が無い事実の束はここに来ない(`collectRpcFacts` が作成では必ず方針を引き、引けなければ
 * 事実が集まらない)。型の上で null が残るので、そのときも**返さない側**(競合)に倒す。
 * 返す方針は「持ち主の確かめ → 入力の比べ(違えば拒否の語)→ 既存の行を返す」の順(字面は `rpc-resend.ts`)。
 */
function resendBranch(facts: RpcBodyFacts): readonly string[] {
  return [`        if exists (select 1 from public.${facts.table} where id = p_id) then`, ...resendInner(facts), '        end if;'];
}

/** 再送の枝の中身(同じ id の行があると分かった後。字下げは挿入の後ろの枝の深さ)。 */
function resendInner(facts: RpcBodyFacts): readonly string[] {
  const policy = facts.resend ?? { kind: 'conflict' as const };
  const ownership = resendOwnership(policy, 't', facts.eventId);
  const differs = resendInputDiffers('v_row', facts.resendCompared);
  const own =
    ownership === null
      ? []
      : [
          `            select t.* into v_row from public.${facts.table} t`,
          `             where t.id = p_id and ${ownership};`,
          '            if found then',
          ...(differs === null
            ? []
            : [
                `                -- ${RPC_BODY_WORDS.resendInputMismatch}`,
                `                if ${differs} then`,
                raiseInputMismatch(facts.eventId === '' ? EVENT_PARAM : sqlLiteral(facts.eventId), '                    '),
                '                end if;',
              ]),
          // 同じ txn の呼び手(保存点の複合 RPC)へ「再送だった」を知らせる(点検 22 回目 A22-1。判定はこの枝の 1 か所)。
          signalResend('                '),
          '                return next v_row;',
          // `return next` は行を積むだけで**関数から出ない**。ここで抜けないと、再送が成立した
          // あとに残りの段へ落ちて raise する(束 ⑳-3 の統合テストが反例で示した)。
          '                return;',
          '            end if;',
        ];
  return [
    `            -- ${resendNote(policy)}`,
    ...own,
    // 返さない方針の表は、同じ鍵の押し直しを「既に保存されている」の語で断る(返す方針の他人の行は従来の競合のまま)。
    ownership === null
      ? raiseAlreadySaved(facts.eventId === '' ? EVENT_PARAM : sqlLiteral(facts.eventId), '            ')
      : raise('conflict', facts, '            '),
  ];
}
