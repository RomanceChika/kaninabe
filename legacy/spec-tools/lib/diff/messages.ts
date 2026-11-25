/**
 * 差分の文(日本語)を組む**ただ 1 か所**。
 *
 * 軸の判定器は「何が・どちら向きに・何から何へ」だけを作り、助詞も語尾もここが付ける ——
 * 仕組み側の日本語を 1 か所に閉じるための分け方である(設計メモ §3-4)。
 *
 * 文に出る名詞は**仕様の label と ID** から来る(`slots` に入って渡ってくる)。ここには
 * アプリの語彙を 1 語も書かない。
 *
 * 純粋関数であり throw しない。
 */

import type { DiffAxis, DiffDirection } from './types.js';

/** 文の型(軸の中の「何についての行か」)。 */
export type MessageTopic =
  | 'permission_case'
  | 'permission_op'
  | 'permission_actor'
  | 'permission_rule'
  | 'permission_blind'
  | 'operation'
  | 'rls_policy'
  | 'rls_filter'
  | 'rls_when'
  | 'api_column'
  | 'api_masked'
  | 'api_rpc'
  | 'notification_decl'
  | 'notification_field'
  | 'notification_effect'
  | 'screen_action'
  | 'screen_navigation'
  | 'screen_gate'
  | 'screen_role'
  | 'screen_role_gate';

/** 文に差し込む語(すべて ID か仕様の label。無い枠は省く)。 */
export interface MessageSlots {
  /** 主語になる ID(操作・通知・画面・表.欄 など)。 */
  readonly subject: string;
  /** 主語の表示名(仕様の label)。 */
  readonly subjectLabel?: string;
  /** 実行者・ロールの ID。 */
  readonly actor?: string;
  /** 実行者・ロールの表示名。 */
  readonly actorLabel?: string;
  /** 状態の並び(表示名つきで組み立て済みの語)。 */
  readonly states?: readonly string[];
  /** 場面を絞る付帯(ロール配列・動かす欄・境界)。 */
  readonly qualifiers?: readonly string[];
  /** 基点側の中身。 */
  readonly before?: string | null;
  /** 比較先の中身。 */
  readonly after?: string | null;
  /** 通知の軸名・RLS の範囲など、生成物が持つ欄の名前。 */
  readonly field?: string;
  /** 数を添える枠(判定できなかった件数・畳んだ件数)。 */
  readonly counts?: readonly string[];
}

/** 方向の記号(🔓 は「広がった」= レビューの主役)。 */
export const DIRECTION_MARK: Readonly<Record<DiffDirection, string>> = {
  widened: '🔓',
  narrowed: '🔒',
  added: '➕',
  removed: '➖',
  changed: '🔁',
};

/** 軸の見出し。 */
export const AXIS_TITLE: Readonly<Record<DiffAxis, string>> = {
  permission: '権限(誰が・どの状態で実行できるか)',
  operations: '操作の増減',
  rows: '見える行',
  columns: '公開される欄',
  notifications: '通知',
  screens: '画面',
};

/**
 * `{ラベル}(\`id\`)` の形(label が無ければ `` `id` `` だけ)。
 *
 * **label を前に出す**のは、読む人が見るのは仕様の言葉であって ID ではないからである
 * (設計メモ §1「仕様の label を使う」)。ID を消さないのは、直す先を引けるようにするため。
 */
export function named(id: string, label?: string): string {
  return label === undefined || label === '' || label === id ? `\`${id}\`` : `${label}(\`${id}\`)`;
}

/** 付帯を括弧にまとめる(無ければ空文字)。 */
function tail(qualifiers: readonly string[] | undefined): string {
  return qualifiers === undefined || qualifiers.length === 0 ? '' : `(${qualifiers.join('・')})`;
}

/** 「A → B」の形(片側が無ければ「無し」)。 */
function arrow(before: string | null | undefined, after: string | null | undefined): string {
  return `${before ?? '無し'} → ${after ?? '無し'}`;
}

/** 状態の並び(無ければ空文字)。 */
function where(states: readonly string[] | undefined): string {
  return states === undefined || states.length === 0 ? '' : ` ${states.join(' / ')} で`;
}

/**
 * 権限の 1 行(状態は畳んで並べる)。
 *
 * 出入り(組み合わせそのものが増えた / 消えた)と、可否が動いた変化で**文の骨を変える** ——
 * 「…で という組み合わせが増えた」のように助詞が宙に浮く形を作らないためである。
 */
function permissionCase(direction: DiffDirection, slots: MessageSlots): string {
  const who = named(slots.actor ?? '', slots.actorLabel);
  const subject = named(slots.subject, slots.subjectLabel);
  const scene = `${subject} を ${who}${tail(slots.qualifiers)}が${where(slots.states)}`;
  if (direction === 'added') return `${scene}実行する組み合わせが結果表に増えた(結末 ${slots.after ?? ''})`;
  if (direction === 'removed') return `${scene}実行する組み合わせが結果表から消えた(結末 ${slots.before ?? ''})`;
  const verb =
    direction === 'widened' ? 'できるようになった' : direction === 'narrowed' ? 'できなくなった' : '落ち方が変わった';
  return `${scene}${verb}(${arrow(slots.before, slots.after)})`;
}

/** 隠し列の 1 行(**解ける相手**の話であって、列そのものの出入りではない)。 */
function apiMasked(direction: DiffDirection, slots: MessageSlots): string {
  const subject = named(slots.subject, slots.subjectLabel);
  if (direction === 'widened' && slots.after === null) {
    return `${subject} の隠しが外れ、その行を読める相手すべてに見えるようになった(それまで解けたのは ${slots.before ?? ''})`;
  }
  if (direction === 'narrowed' && slots.before === null) {
    return `${subject} が隠し列になった(解けるのは ${slots.after ?? ''} だけ)`;
  }
  if (direction === 'widened') return `${subject} の隠しが解ける相手が増えた(${arrow(slots.before, slots.after)})`;
  if (direction === 'narrowed') return `${subject} の隠しが解ける相手が減った(${arrow(slots.before, slots.after)})`;
  return `${subject} の隠しが解ける相手が入れ替わった(${arrow(slots.before, slots.after)})`;
}

/** 軸ごとの文(1 行)。 */
function body(topic: MessageTopic, direction: DiffDirection, slots: MessageSlots): string {
  const subject = named(slots.subject, slots.subjectLabel);
  const who = named(slots.actor ?? '', slots.actorLabel);
  switch (topic) {
    case 'permission_case':
      return permissionCase(direction, slots);
    case 'permission_op':
      return direction === 'added'
        ? `${subject} の結末(${slots.after ?? ''})が結果表に増えた`
        : `${subject} の結末(${slots.before ?? ''})が結果表から消えた`;
    case 'permission_actor':
      return direction === 'added'
        ? `実行者 ${who} が結果表に増えた(${(slots.counts ?? []).join('・')})`
        : `実行者 ${who} が結果表から消えた(${(slots.counts ?? []).join('・')})`;
    case 'permission_rule':
      return direction === 'widened'
        ? `${subject} を ${who} ができるようになった(宣言 ${slots.after ?? ''})`
        : direction === 'narrowed'
          ? `${subject} を ${who} ができなくなった(宣言 ${slots.before ?? ''})`
          : `${subject} を ${who} が実行できる条件が変わった(${arrow(slots.before, slots.after)})`;
    case 'permission_blind':
      return `${subject} の結末を結果表が出していません(${slots.field ?? ''})`;
    case 'operation':
      return direction === 'added' ? `操作 ${subject}が増えた` : `操作 ${subject}が消えた`;
    case 'rls_policy':
      return direction === 'widened'
        ? `${subject} の行を ${who} が読めるようになった(範囲 ${slots.field ?? ''})`
        : `${subject} の行を ${who} が読めなくなった(範囲 ${slots.field ?? ''})`;
    case 'rls_filter':
      return `${subject} を見せる条件の在処が入れ替わった(${arrow(slots.before, slots.after)})`;
    case 'rls_when':
      // 状態の条件が増えれば見える行は減る(🔒)、消えれば増える(🔓)。
      if (direction === 'narrowed') return `${subject} は行の状態で見え方が絞られた(${slots.after ?? ''})`;
      if (direction === 'widened') return `${subject} の行の状態による絞りが外れた(${slots.before ?? ''})`;
      return `${subject} の行の状態による絞りが変わった(${arrow(slots.before, slots.after)})`;
    case 'api_column':
      return direction === 'widened'
        ? `${subject} が外に出る面に載った(新しく公開される欄)`
        : `${subject} が外に出る面から外れた`;
    case 'api_masked':
      return apiMasked(direction, slots);
    case 'api_rpc':
      return direction === 'widened'
        ? `RPC ${subject} が外から呼べるようになった`
        : `RPC ${subject} が外から呼べなくなった`;
    case 'notification_decl':
      return direction === 'added' ? `通知 ${subject}が増えた` : `通知 ${subject}が消えた`;
    case 'notification_field':
      return direction === 'widened'
        ? `通知 ${subject} の宛先が広がった(${slots.field ?? ''}: ${arrow(slots.before, slots.after)})`
        : direction === 'narrowed'
          ? `通知 ${subject} の宛先が狭まった(${slots.field ?? ''}: ${arrow(slots.before, slots.after)})`
          : `通知 ${subject} の ${slots.field ?? ''} が ${arrow(slots.before, slots.after)} に変わった`;
    case 'notification_effect':
      return direction === 'added'
        ? `遷移 ${subject}が通知 \`${slots.after ?? ''}\` を飛ばすようになった`
        : `遷移 ${subject}が通知 \`${slots.before ?? ''}\` を飛ばさなくなった`;
    case 'screen_action':
      return direction === 'added'
        ? `画面 ${subject} から操作 ${named(slots.after ?? '', slots.field)}を起こせるようになった`
        : `画面 ${subject} から操作 ${named(slots.before ?? '', slots.field)}を起こせなくなった`;
    case 'screen_navigation':
      return direction === 'added'
        ? `画面 ${subject} から \`${slots.after ?? ''}\` へ出られるようになった(きっかけ \`${slots.field ?? ''}\`)`
        : `画面 ${subject} から \`${slots.before ?? ''}\` へ出られなくなった(きっかけ \`${slots.field ?? ''}\`)`;
    case 'screen_gate':
      return direction === 'widened'
        ? `画面 ${subject} がサインインなしで開くようになった`
        : `画面 ${subject} にサインインの関門が付いた`;
    case 'screen_role':
      return direction === 'widened'
        ? `画面 ${subject} を ${who} が開けるようになった`
        : `画面 ${subject} を ${who} が開けなくなった`;
    case 'screen_role_gate':
      return direction === 'widened'
        ? `画面 ${subject} を見るロールの絞りが外れた(それまでは ${slots.before ?? ''})`
        : `画面 ${subject} を見るロールが ${slots.after ?? ''} に絞られた`;
  }
}

/**
 * 差分の 1 行の日本語を組む。
 *
 * @param topic 軸の中の文の型
 * @param direction 方向の記号
 * @param slots 差し込む ID と label
 * @returns 記号つきの 1 行
 */
export function changeText(topic: MessageTopic, direction: DiffDirection, slots: MessageSlots): string {
  return `${DIRECTION_MARK[direction]} ${body(topic, direction, slots)}`;
}

/** 可否の表示(通ったか、どの理由で落ちたか)。 */
export const DECISION_ALLOWED = '✅';

/** 落ちた側の表示(理由を添える)。 */
export function decisionRefused(reason: string): string {
  return `❌ ${reason}`;
}

/** 権限の文に添える「ロール配列」の付帯。 */
export function callerQualifier(value: string): string {
  return `ロール配列 \`${value}\``;
}

/** 保存点の文に添える「呼び出し元の文脈」の付帯。 */
export function contextQualifier(value: string): string {
  return `呼び出し元 \`${value}\``;
}

/** 権限の文に添える「動かす欄」の付帯。 */
export function fieldQualifier(value: string): string {
  return `動かす欄 \`${value}\``;
}

/** 権限の文に添える「境界」の付帯(ガード変数の置き場)。 */
export function axisQualifier(value: string): string {
  return `境界 ${value}`;
}

/** 保存点の文に添える「入力の形・件数」の付帯。 */
export function shapeQualifier(value: string): string {
  return `入力の形 ${value}`;
}

/** 保存点で落ちた手順の表示。 */
export function blockedAtStep(step: number, op: string): string {
  return `手順 ${step + 1} \`${op}\` で停止`;
}

/** 数を添える枠(実行者が増えたときの畳み)。 */
export const COUNTS = {
  operations: (count: number): string => `操作 ${count} 本`,
  allowed: (count: number): string => `✅ ${count} 件`,
  refused: (count: number): string => `❌ ${count} 件(内訳は省く)`,
} as const;

/** CLI が出す表記(基点の決め方・止まり方)。 */
export const NOTICES = {
  /** 基点が使えず直前のコミットに倒したとき(**黙って切り替えない**)。 */
  fellBack: (given: string): string =>
    `基点 ${given} がこのクローンに無いため HEAD~1 に倒します(force push・初回 push・浅いクローン)。見える範囲が 1 コミット分に縮んでいます`,
  /** 比べられる歴史がそもそも無いとき(「差分なし」とは言わない)。 */
  noHistory: '比較できる歴史がありません(最初のコミット)。意味の差分は判定していません',
  /** git が答えなかったとき(判定できない = 赤)。 */
  unavailable: (reason: string): string => `意味の差分を判定できませんでした: ${reason}`,
  /** 判定できなかったときの直し方。 */
  remedy:
    '基点と比較先の ref が実在するか、このクローンに歴史があるか(CI なら fetch-depth: 0)を確かめてください',
  /** どちらかの版の生成物が読めなかったとき(**基点側でも赤**)。 */
  unreadable: '生成物を読めなかった軸があります。まず `npm run generate:check` を通してください',
  /** 使い方。 */
  usage: '使い方: npm run spec:diff -- --base <ref> [--head <ref>] [--out <path>]',
} as const;
