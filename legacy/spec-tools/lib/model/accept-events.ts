/**
 * `accept[].events`(遷移の受け入れの名指し)の**名指しの単位を遷移の定義にする**部品(点検 5 回目 A5-1)。
 *
 * state_spec は同じイベント ID の遷移を複数定義できる(V8 が止めるのは、同じ状態・イベント・ロールでガードが重なり行き先が違うものだけ)。
 * 受け入れをイベント ID の粒度で照合すると、1 本目(有効な会社の停止)のために書いた理由が、後から足した同じ ID・同じロールの
 * 2 本目(審査中の会社の停止)にも黙って効く。そこで名指しは次の 2 つの形に限り、**受け入れのロールで起こせる定義のちょうど 1 本**に
 * 解けなければ V2 が error にする(当たらない・曖昧のどちらも):
 *
 *   - `{イベント ID}` … そのロールで起こせる定義が 1 本だけのとき
 *   - `{イベント ID}@{遷移元の状態}` … 遷移元(`from`)にその状態を持つ定義に絞る(同じ ID の定義が 2 本以上のとき)
 *
 * 純粋関数であり throw しない。
 */

import type { EventDef } from './types-state.js';

/** 名指し 1 つの読み(`id` か `id@from`)。 */
export interface AcceptEventRef {
  readonly id: string;
  /** 遷移元の状態で絞るときの状態(絞らないなら null)。 */
  readonly from: string | null;
}

/** 名指しの綴り(イベント ID と状態 ID は識別子)。 */
const REF_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)(?:@([A-Za-z_][A-Za-z0-9_]*))?$/u;

/**
 * 名指し 1 つを読む。
 *
 * @param raw - 書かれた名指し
 * @returns 読み(形が違えば null)
 */
export function parseAcceptEventRef(raw: string): AcceptEventRef | null {
  const match = REF_PATTERN.exec(raw);
  if (match === null) return null;
  return { id: match[1] as string, from: match[2] ?? null };
}

/** 名指しの解決。 */
export type AcceptEventResolution =
  /** ちょうど 1 本の定義に当たった。 */
  | { readonly kind: 'ok'; readonly event: EventDef }
  /** 形が違う(`id` / `id@from` でない)。 */
  | { readonly kind: 'malformed' }
  /** 受け入れのロールで起こせる定義に当たらない。 */
  | { readonly kind: 'unknown' }
  /** 2 本以上の定義に当たる(遷移元で絞るか、ID を分ける)。 */
  | { readonly kind: 'ambiguous'; readonly events: readonly EventDef[] };

/**
 * 名指しを、受け入れのロールで起こせる遷移の定義に解く。
 *
 * @param raw - 書かれた名指し
 * @param events - その集約の遷移の定義の全部
 * @param by - 受け入れのロール
 * @returns 解決
 */
export function resolveAcceptEvent(raw: string, events: readonly EventDef[], by: string): AcceptEventResolution {
  const ref = parseAcceptEventRef(raw);
  if (ref === null) return { kind: 'malformed' };
  const matched = events.filter((event) => event.id === ref.id && event.by.includes(by) && (ref.from === null || event.from.includes(ref.from)));
  if (matched.length === 0) return { kind: 'unknown' };
  if (matched.length > 1) return { kind: 'ambiguous', events: matched };
  return { kind: 'ok', event: matched[0] as EventDef };
}

/**
 * 定義 1 本を名指す綴りの候補(遷移元の状態のうち、同じ ID・同じロールのほかの定義に無いもの)。違反の対処の文に出す。
 *
 * @param event - 名指したい定義
 * @param events - その集約の遷移の定義の全部
 * @param by - 受け入れのロール
 * @returns 綴りの候補(同じ ID の定義がほかに無ければ `id` だけ。遷移元で分けられなければ空)
 */
export function acceptEventSpellings(event: EventDef, events: readonly EventDef[], by: string): readonly string[] {
  const siblings = events.filter((other) => other !== event && other.id === event.id && other.by.includes(by));
  if (siblings.length === 0) return [event.id];
  return event.from.filter((state) => !siblings.some((other) => other.from.includes(state))).map((state) => `${event.id}@${state}`);
}
