/**
 * 認証基盤の操作(`platform_ops`。ADR-0019)の戻り値の型と、拒否の写し。
 *
 * 画面が叩く操作はドメインイベントではないので、`ActionResult`(ARCH-BE-0013 の拒否 3 分類 + 入力検証)に載せない —— 拒否の語彙が違う
 * (配線先が宣言した理由。例: 「いまの端末が不明」)。ここは**生成された入口と組み立ての根・画面が共有する最小の型**だけを持つ。
 *
 *   - 拒否は 3 つだけ: 入力の検証(`invalid_input`)・多要素認証(`mfa_required`)・配線先が返した理由(`refused`。理由は宣言の閉じた集合)
 *   - 画面に出す文言は仕様(`platform_ports` の `refusals`)が持つ。ここは理由をそのまま渡し、文言は表から引くだけ
 *   - 拒否の記録は既存の口(`recordRefusal`)に載せるため、`ActionError` へ写す(`refusalAsActionError`)。理由文・入力値は載せない
 */

import type { ActionError, FieldIssue } from './result';

/** 拒否。 */
export type PlatformRefusal =
  | { readonly kind: 'invalid_input'; readonly issues: readonly FieldIssue[] }
  | { readonly kind: 'mfa_required' }
  | { readonly kind: 'refused'; readonly reason: string };

/** 認証基盤の操作の戻り値(成功は値、失敗は拒否)。 */
export type PlatformOpResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: PlatformRefusal };

/**
 * 組み立ての根が受ける、実行者の側の事実。メンバー ID は拒否の記録に使う(認可は配線先がリクエストのセッションから導く —— 入力にも、ここにも、
 * 認可の根拠としては渡さない)。`actorMfa` は多要素認証を要求する製品でだけ渡す(セッションが済ませたか)。
 */
export interface PlatformActorFacts {
  readonly actorId: string | null;
  readonly actorMfa?: boolean;
}

/** 生成テストの場面の実行者(未ログインは `null`)。 */
export interface PlatformScenarioActor {
  /** メンバー ID。 */
  readonly id: string;
  /** いまの DB の行で有効メンバーか(ロールの操作の資格の一部)。 */
  readonly activeMember: boolean;
  /** いまの DB の行で持っているロール(ロールの操作の資格)。 */
  readonly roles: readonly string[];
}

/** 生成テストの場面の指定。 */
export interface PlatformScenarioSpec {
  readonly actor: PlatformScenarioActor | null;
  /** いまの端末が分かるか(省略は分かる)。「ほかを終える」のような、自分を締め出さないための拒否を確かめる。 */
  readonly currentSession?: 'known' | 'unknown';
}

/** 行から受ける識別子の出どころ 1 つ(操作 ID か読みの ID)の、場面の中の持ち主別の ID。 */
export interface PlatformScenarioTargets {
  /** 場面の実行者自身の持ち物の ID。 */
  readonly own: readonly string[];
  /** 別のメンバーの持ち物の ID。 */
  readonly foreign: readonly string[];
  /** その ID の対象が手つかずか(効いてはいけない呼び出しの後に確かめる)。 */
  readonly intact: (id: string) => boolean;
}

/**
 * 生成テストの場面(配線先の手書きの場面の組み立てが返す)。配線先の**本物の組み立て**に偽の部品(実行者・資格・DB の写し)を渡したもので、
 * 権限表・引数の対応・結果の写し・負例の試験が、宣言から導いた期待を実際の配線に当てる。
 */
export interface PlatformScenarioWorld<Port> {
  readonly port: Port;
  /** 読みの操作 ID → 場面の実行者の読みが返す行(配線先の形のまま。接続の試験が宣言した対応表で写して比べる)。 */
  readonly rows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /** 行から受ける識別子の出どころ(`of`)→ 持ち主別の ID。 */
  readonly targets: Readonly<Record<string, PlatformScenarioTargets>>;
}

/** 配線先の場面の組み立て(手書き。配線のモジュールの隣の `{配線}.scenario` が `{ポート名}Scenario` で export する)。 */
export type PlatformScenarioFactory<Port> = (spec: PlatformScenarioSpec) => PlatformScenarioWorld<Port>;

/** 画面に出す文言の表(理由 → 文言)。 */
export type PlatformRefusalMessages = Readonly<Record<string, string>>;

/** 入力の検証の失敗の文言。 */
export const INVALID_INPUT_MESSAGE = '入力を確認してください';

/** 多要素認証を済ませていないセッションの文言。 */
export const MFA_REQUIRED_MESSAGE = '多要素認証を済ませてから、もう一度お試しください';

/** 表に無い理由の文言(宣言に無い理由が来ても、理由の語を画面に出さない)。 */
export const UNKNOWN_REFUSAL_MESSAGE = 'この操作はできません';

/**
 * 拒否を人向けの文言にする。
 *
 * @param refusal - 拒否
 * @param messages - 配線先が宣言した理由 → 文言の表(仕様の `refusals`)
 * @returns 文言(宣言に無い理由は一般の文言。理由の語そのものは画面に出さない)
 */
export function refusalMessage(refusal: PlatformRefusal, messages: PlatformRefusalMessages): string {
  switch (refusal.kind) {
    case 'invalid_input':
      return INVALID_INPUT_MESSAGE;
    case 'mfa_required':
      return MFA_REQUIRED_MESSAGE;
    case 'refused':
      return messages[refusal.reason] ?? UNKNOWN_REFUSAL_MESSAGE;
  }
}

/**
 * 拒否を `ActionError` に写す(拒否の記録 `recordRefusal` に載せるためだけの写し。画面には出さない)。
 *
 * 配線先の理由はすべて権限の拒否(`forbidden`)として数える —— 記録は「誰が・どの操作で・どの分類で拒まれたか」だけを持ち、理由の語は載せない。
 *
 * @param op - 操作の ID(`session.end_mine` の形。記録の `event`)
 * @param refusal - 拒否
 * @returns 記録用の拒否
 */
export function refusalAsActionError(op: string, refusal: PlatformRefusal): ActionError {
  switch (refusal.kind) {
    case 'invalid_input':
      return { kind: 'invalid_input', issues: refusal.issues };
    case 'mfa_required':
      return { kind: 'forbidden', event: op, role: '', mfaRequired: true };
    case 'refused':
      return { kind: 'forbidden', event: op, role: '' };
  }
}

/**
 * 成功を作る。
 *
 * @param value - 値
 * @returns 成功
 */
export function platformOk<T>(value: T): PlatformOpResult<T> {
  return { ok: true, value };
}

/**
 * 配線先が返した理由での拒否を作る。
 *
 * @param reason - 配線先の理由(宣言の閉じた集合の 1 つ)
 * @returns 拒否
 */
export function platformRefused(reason: string): PlatformOpResult<never> {
  return { ok: false, refusal: { kind: 'refused', reason } };
}

/** 申告の外の理由に落とす、固定の一般の理由(理由の語を外へ出さない。文言の表には無いので一般の文言になる)。 */
export const GENERIC_REFUSAL_REASON = 'refused';

/**
 * 配線先が返した理由での拒否を、**申告した理由の集合の中に限って**作る(閉じた出口)。
 *
 * 型の上で理由を絞っていても、実行時に未申告の生の理由(例外の文・内部の語)が返ると、画面の文言が一般化されても、返り値(Server Action の
 * ペイロード)にはその語が残りブラウザへ届く。そこで申告の外の理由は固定の一般の理由(`GENERIC_REFUSAL_REASON`)に落とし、生の理由は返さない。
 *
 * @param reason - 配線先の理由
 * @param declared - 申告した理由 → 文言の表(仕様の `refusals`。鍵が許可の集合)
 * @returns 申告内なら理由のまま、外なら一般の理由の拒否
 */
export function platformRefusedWithin(reason: string, declared: PlatformRefusalMessages): PlatformOpResult<never> {
  return platformRefused(typeof reason === 'string' && Object.hasOwn(declared, reason) ? reason : GENERIC_REFUSAL_REASON);
}

/**
 * 入力の検証の失敗での拒否を作る。
 *
 * @param issues - 指摘
 * @returns 拒否
 */
export function platformInvalid(issues: readonly FieldIssue[]): PlatformOpResult<never> {
  return { ok: false, refusal: { kind: 'invalid_input', issues } };
}

/**
 * 多要素認証の要求に掛かった拒否を作る。
 *
 * @returns 拒否
 */
export function platformMfaRequired(): PlatformOpResult<never> {
  return { ok: false, refusal: { kind: 'mfa_required' } };
}
