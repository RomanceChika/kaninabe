/**
 * 複合 RPC(保存点)の**先頭の再送の枝**と、1 回目の**入力の要約の刻み**の並べ方(`code-usecase-rpc.ts` が migration の骨格に差し込む)。
 *
 * 再送の判定(持ち主の条件・入力の比べ・拒否の語・要約の式)は `sql/rpc-resend.ts` が持ち、読み直しの式は Y12 と共有の
 * `readbackEntries` が返す。ここは錨・方針・保存点の手順をそれらに渡し、枝の中の順(持ち主 → 錨の比べ → 保持の時間 →
 * 入力の全体の比べ → 読み直し)に並べるだけである(点検 20 回目 B20-1・21 回目 A21-1)。要約の式と置き場の読み書きは
 * `sql/rpc-resend-digest.ts`。
 *
 * 規約どおりファイル I/O はせず、throw しない純関数。**アプリの語彙は 1 語も持たない。**
 */

import type { SavePlan, SaveStepPlan } from '../../usecase/step-plan.js';
import type { CompositeResolvedParam } from '../../usecase/save-renderable.js';
import type { ResendPolicy } from '../../usecase/resend-policy.js';
import { clearResendSignal, raiseAlreadySaved, raiseInputMismatch, resendNote, resendOwnership, resendSignalled } from '../../sql/rpc-resend.js';
import {
  raiseResendExpired,
  raiseResendTargetDeleted,
  recordResendDigest,
  resendDigestDiffers,
  resendDigestEvent,
  resendDigestExpired,
  resendInputDigest,
} from '../../sql/rpc-resend-digest.js';
import type { ResendDigestTable } from '../../usecase/resend-policy.js';
import { raiseRefusal } from '../../sql/refusal-codes.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { callStatement, sqlString, type ReadbackEntry } from './usecase-sql.js';

/**
 * 再送(冪等)の入口。
 *
 * 最初の作成の行が既にあれば、以降の手順を 1 つも実行せずに既存の行を読んで同じ形を返す
 * (作成 RPC は同じ id の再送に既存行を返すので、ここで止めないと 2 手順目以降が
 * 新しい行を作ってしまう)。作成手順を持たない保存点(遷移だけ)には冪等の錨が無いので
 * この節を持たない —— 遷移は判断時の状態を条件にするため、再送は競合として弾かれる。
 *
 * **式は組み立てない。** 別名と式は Y12 と共有の `readbackEntries` が返したものをそのまま
 * 並べるだけである —— 生成器が判定を持つと、条件がずれた瞬間に空の式(`'alias', `)が
 * migration に出て、壊れるのは DB に当てたときになる(束 ⑲-1 のレビュー)。
 *
 * **既存の行を返すのは、錨の行を作ったのが今回の実行者であるときだけ**(錨の表の `resend`。
 * 単発の作成 RPC と同じ宣言・同じ条件)。id は呼ぶ側が選べる鍵なので、id の実在だけで返すと、
 * 他人の行の id を渡した呼び出しに他人の行(と、そこから鎖で辿れる行)が返る。作成者が違う・
 * 表が再送で返さない宣言のときは、中身を返さず競合(`UC409`)にする —— 手順 1 へ落として
 * 呼ばれた側の作成 RPC に判定を任せない(手書きの作成 RPC がその条件を持つとは限らない)。
 */
export function resendBlock(
  readback: ReadbackShape,
  firstParams: readonly CompositeResolvedParam[],
  variables: ReadonlyMap<number, string>,
  platform: PlatformProfile,
  digest: ResendDigest | null,
): string[] {
  const anchor = readback.anchor;
  if (anchor === null) return [];
  // 錨があるのに方針が無い読み直しは Y12 が先に止める(`readbackPlans`)。型の上で残る null は返さない側に倒す。
  const policy: ResendPolicy = readback.resend ?? { kind: 'conflict' };
  const refuse = raiseRefusal('conflict', anchor.op, '        ');
  const readbackLines = [
    '        return jsonb_build_object(',
    readback.entries.map((entry) => `            ${sqlString(entry.alias)}, ${entry.expression}`).join(',\n'),
    '        );',
  ];
  const ownership = resendOwnership(policy, 't', anchor.op);
  // 錨が最初の手順なら、再送の確かめ(持ち主・入力の比べ)は錨の作成の RPC に任せる(点検 20 回目 B20-1。同じ引数でもう一度呼ぶと、
  // 1 回目の行を返すか、他人の行・入力の違う再送を断る)。確かめを 2 か所に書かない。
  const delegated = ownership !== null && anchor.index === 0 && !anchor.repeat;
  // 保存点の入力の全体の比べ(点検 21 回目 A21-1)。錨の作成の比べは錨の列しか見ないので、子の手順の入力を直した押し直しを断るのはここ。
  // 持ち主の確かめの後に置く(他人の鍵には中身の違いを言わず競合のまま)。委任する枝・しない枝の両方に出す。
  const compare =
    digest === null
      ? []
      : [
          '        -- 1 回目の入力の要約が保持の時間の内に無ければ(過ぎた・消去で消えた)、鍵はもう使えない。読み込み直しを案内する。',
          `        if ${digest.expired} then`,
          raiseResendExpired(sqlString(anchor.op), '            '),
          '        end if;',
          '        -- 保存点の入力の全体(正規化した p_input の要約)が 1 回目と違えば、1 回目の行を「書けた」と返さず断る。',
          `        if ${digest.differs} then`,
          raiseInputMismatch(sqlString(anchor.op), '            '),
          '        end if;',
        ];
  const lines =
    ownership === null
      ? [raiseAlreadySaved(sqlString(anchor.op), '        ')] // 返さない方針: 同じ鍵の押し直しは「既に保存されている」の語
      : delegated
        ? [
            '        -- 持ち主の確かめと錨の入力の比べは最初の作成の RPC が持つ(同じ引数で呼び直すと、1 回目の行を返すか断る)。',
            clearResendSignal('        '),
            callStatement(anchor, firstParams, variables, '        ', platform),
            ...delegatedRecreated(anchor),
            ...compare,
            ...readbackLines,
          ]
        : [...ownedCheck(anchor, ownership, refuse), ...compare, ...readbackLines];
  return [
    '    -- 再送(冪等): 最初に作る行が既にあれば、以降の手順を実行せずに既存の行を返す。',
    `    -- ${resendNote(policy)}`,
    `    if exists (select 1 from public.${anchor.table} where id = p_id) then`,
    ...lines,
    '    end if;',
    '',
  ];
}

/**
 * 委任する枝で呼び直した錨の作成 RPC が、再送の印を立てなかった(= 1 回目の行を返さず新しい行を作った)ときに全体を戻す文(点検 23 回目 A23-1)。
 *
 * 先頭の確かめ(錨の行の実在)の後に、錨の行を消す txn がコミットすると、呼び直しの `on conflict (id) do nothing` は消す側を待ってから
 * **新しい行を入れる**。印を見ずに進むと、残った 1 回目の要約と一致して、子の手順を 1 つも実行しないまま「書けた」と返す。
 * 再送かどうかを決めるのは作成 RPC の再送の枝の 1 か所(印)なので、印が無ければ 1 回目の行は消えている = `resend_target_deleted`。
 * (生成の作成 RPC は作り直しそのものを監査ログで断る(`refuseRecreated`)。これは手書きの錨にも効く二の線。)
 */
function delegatedRecreated(anchor: SaveStepPlan): string[] {
  return [
    '        -- 呼び直しが再送でなかった(先頭の確かめの後に錨の行が消され、作成 RPC が新しい行を作った)。作り直さずに全体を戻す(点検 23 回目 A23-1)。',
    `        if not (${resendSignalled('p_id')}) then`,
    raiseResendTargetDeleted(sqlString(anchor.op), '            '),
    '        end if;',
  ];
}

/** 錨の行を今回の実行者が作った、の確かめ(委任しない枝。持ち主の条件の字面は `rpc-resend.ts`)。 */
function ownedCheck(anchor: SaveStepPlan, ownership: string, refuse: string): string[] {
  return [`        if not exists (select 1 from public.${anchor.table} t where t.id = p_id and ${ownership}) then`, `    ${refuse}`, '        end if;'];
}

/**
 * 錨の作成の手順の前後に置く文(点検 22 回目 A22-1)。**再送かどうかは錨の作成 RPC が決める**(`rpc-resend.ts` の `signalResend`)。
 *
 * 先頭の再送の確かめ(`resendBlock`)は別の文なので、同じ鍵の 1 回目がまだコミットしていない間に届いた押し直しはそこを抜け、錨の作成 RPC
 * の再送の枝で 1 回目のコミットを待ってから既存の行を受け取る。そのまま進むと子の手順の行をもう 1 組作り、成功を返す。そこで:
 *
 * - `before`: 錨の作成を呼ぶ直前に、同じ txn の前の呼び出しの印を消す。
 * - `after`: 錨の作成の直後に印を見て、再送だったら**以降の手順を実行せず**、先頭の枝と同じ比べ(保持の時間 → 入力の全体)と読み直しへ
 *   合流する(持ち主と錨の入力の比べは作成 RPC の再送の枝が済ませている。委任しない枝では先頭の枝と同じ持ち主の確かめも置く)。
 *   錨が最初の手順でなければ、前の手順がこの txn で既に書いているので読み直して返さず、比べの後に競合(UC409)で全体を戻す。
 *
 * 返さない方針の錨(作成 RPC が再送をいつも断る)・繰り返す手順の錨では何も置かない。
 *
 * @param readback 錨・方針・読み直しの式
 * @param digest 保存点の入力の要約の字面(無ければ比べを置かない)
 * @returns 錨の作成の前と後に置く文
 */
export function resendAfterAnchor(readback: ReadbackShape, digest: ResendDigest | null): { readonly before: string[]; readonly after: string[] } {
  const anchor = readback.anchor;
  const policy: ResendPolicy = readback.resend ?? { kind: 'conflict' };
  const ownership = anchor === null ? null : resendOwnership(policy, 't', anchor.op);
  if (anchor === null || anchor.repeat || ownership === null) return { before: [], after: [] };
  const delegated = anchor.index === 0;
  const refuse = raiseRefusal('conflict', anchor.op, '        ');
  const compare =
    digest === null
      ? []
      : [
          `        if ${digest.expired} then`,
          raiseResendExpired(sqlString(anchor.op), '            '),
          '        end if;',
          `        if ${digest.differs} then`,
          raiseInputMismatch(sqlString(anchor.op), '            '),
          '        end if;',
        ];
  const finish =
    anchor.index === 0
      ? [
          '        return jsonb_build_object(',
          readback.entries.map((entry) => `            ${sqlString(entry.alias)}, ${entry.expression}`).join(',\n'),
          '        );',
        ]
      : ['        -- 前の手順がこの txn で既に書いているので、1 回目の行を返さずに全体を戻す。', refuse];
  return {
    before: ['    -- 錨の作成が再送だったかは、作成 RPC が同じ txn の中の印で知らせる(点検 22 回目 A22-1)。前の呼び出しの印を消す。', clearResendSignal('    ')],
    after: [
      '    -- 錨の作成 RPC が再送だった(先頭の確かめの後に、同じ鍵の 1 回目がコミットした)。以降の手順を実行せず、先頭の枝と同じ比べと読み直しへ。',
      `    if ${resendSignalled('p_id')} then`,
      ...(delegated ? [] : ownedCheck(anchor, ownership, refuse)),
      ...compare,
      ...finish,
      '    end if;',
    ],
  };
}

/** 保存点の入力の要約の 3 つの字面(1 回目に残す文と、再送の 2 つの条件)。 */
export interface ResendDigest {
  readonly record: string;
  readonly expired: string;
  readonly differs: string;
}

/**
 * 保存点の入力の要約の字面(既存の行を返す方針の錨があるときだけ。返さない方針は再送をいつも断るので比べない)。
 * 式も文も `sql/rpc-resend-digest.ts` が持ち、ここは保存点の手順・錨・置き場を渡すだけである。置き場(`store`)が無いのは Y12 が先に
 * 止める(`usecase/resend-policy.ts` の `resendDigestStoreProblem`)ので、生成器はここへ来る前に止まる。
 */
export function resendDigestOf(plan: SavePlan, readback: ReadbackShape, store: ResendDigestTable | null): ResendDigest | null {
  const anchor = readback.anchor;
  if (anchor === null || readback.resend === null || readback.resend.kind === 'conflict' || store === null) return null;
  const event = resendDigestEvent(plan.usecase.name, plan.save.id);
  const digest = resendInputDigest(plan.steps, 'p_input');
  return {
    record: [
      '    -- 再送で入力の全体を比べるために、保存点の入力の要約を短命の表に 1 行残す(監査ログには置かない。点検 21 回目 A21-1)。',
      recordResendDigest({ store, event, key: 'p_id', digest, indent: '    ', operation: sqlString(anchor.op) }),
    ].join('\n'),
    expired: resendDigestExpired(store, event, 'p_id'),
    differs: resendDigestDiffers(store, event, 'p_id', digest),
  };
}

/** 再送の枝に要る読み直しの結果(錨・方針・読み直しの式)。 */
export interface ReadbackShape {
  readonly anchor: SaveStepPlan | null;
  readonly resend: ResendPolicy | null;
  readonly entries: readonly ReadbackEntry[];
}
