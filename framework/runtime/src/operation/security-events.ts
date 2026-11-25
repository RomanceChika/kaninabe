/**
 * **セキュリティログの事象の目録**(ASVS V16.3.1〜V16.3.3・V16.1.1)。語彙の正はこの 1 ファイルである。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/logging.md(§セキュリティの事象)
 *
 * 目録は 3 つの読み手を持つ。①出す側(`security-log.ts` が事象の ID だけを受ける)②ハンドブックの「ログの目録」
 * (生成器がこの表をそのまま章に出す)③ユニットテスト(事象ごとの出力を表で固定する)。**同じ表を 3 者が読む**ので、
 * 事象を足すとき書き換える場所はここだけである(PRIN-0007)。
 *
 * 値は ID と分類だけで、個人の値(メールアドレス・トークン・cookie・入力値)を載せる欄は無い。何を出さないかは
 * `LOG_FIELD_NAMES` の閉じた集合が決める。
 */

/** どこで出すか(出す場所の種類)。 */
export type SecurityEventSource = 'server_action' | 'request_gate' | 'auth_route' | 'route_guard';

/** 事象 1 つの宣言。 */
export interface SecurityEventSpec {
  /** 事象の ID(ログの `security_event` の値)。 */
  readonly id: string;
  /** 重大度(`warn` = 仕様どおりに拒否された / 認証の失敗、`info` = 起きてよいことが起きた)。 */
  readonly level: 'info' | 'warn';
  /** どこで出すか。 */
  readonly source: SecurityEventSource;
  /** 何が起きたか(人が読む 1 行)。 */
  readonly summary: string;
  /** 行に載る `refusal_code` / `decision` の値の集合(その事象が運ぶ分類)。 */
  readonly codes: readonly string[];
  /** 載る分類の欄(`refusal_code` か `decision`。無ければ空)。 */
  readonly codeField: 'refusal_code' | 'decision' | null;
}

/**
 * 事象の目録(出す順ではなく、読む順)。
 *
 * Server Action の拒否は 5 つに分かれる —— `ActionError` の 4 分類(`forbidden` は権限と多要素認証に割る)。例外で終わった Action は
 * `action_failed`(`ActionError` の一時的な失敗。業務の拒否ではない)。
 * 「流量の天井」の拒否は DB の制約トリガが不変条件違反(`enforced_by` の不変条件 ID)として返すので、
 * `invariant_refused` の `invariant` で見分ける(別の事象にはしない)。
 */
export const SECURITY_EVENTS = [
  {
    id: 'authz_refused',
    level: 'warn',
    source: 'server_action',
    summary: '権限の拒否(実行者のロールが操作の `by` に無い)',
    codes: ['role_forbidden'],
    codeField: 'refusal_code',
  },
  {
    id: 'mfa_refused',
    level: 'warn',
    source: 'server_action',
    summary: '多要素認証を済ませていないセッションの書き込みの拒否',
    codes: ['mfa_required'],
    codeField: 'refusal_code',
  },
  {
    id: 'input_rejected',
    level: 'warn',
    source: 'server_action',
    summary: '入力の検証の失敗(形が仕様の制約に合わない。入力値は載せない)',
    codes: ['invalid_input'],
    codeField: 'refusal_code',
  },
  {
    id: 'rule_refused',
    level: 'warn',
    source: 'server_action',
    summary: '業務の規則の拒否(状態が合わない・ガードが成立しない)',
    codes: ['state_conflict', 'guard_unsatisfied'],
    codeField: 'refusal_code',
  },
  {
    id: 'invariant_refused',
    level: 'warn',
    source: 'server_action',
    summary: '不変条件の拒否(流量の天井を含む。`invariant` が不変条件 ID)',
    codes: ['invariant_violated'],
    codeField: 'refusal_code',
  },
  {
    id: 'action_failed',
    level: 'warn',
    source: 'server_action',
    summary: 'Server Action が例外で終わった(通信の失敗・想定外の DB の失敗。生成した入口が投げ直す前に 1 行出す。例外の文言は載せない。点検 19 回目 O19-2)',
    codes: ['action_threw'],
    codeField: 'refusal_code',
  },
  {
    id: 'origin_refused',
    level: 'warn',
    source: 'request_gate',
    summary: '出どころを確かめられない状態変更の要求の拒否(CSRF の守り)',
    codes: ['cross_origin'],
    codeField: 'refusal_code',
  },
  {
    id: 'redirect_refused',
    level: 'warn',
    source: 'route_guard',
    summary: 'Route Handler の応答の行き先を出口の関所が止めた(同じオリジンの相対パスでも宣言した外の行き先でもない `Location`・`Refresh`・転送の合図。行き先の値は載せない)',
    codes: ['unsafe_location', 'refresh_header', 'unsafe_redirect_signal'],
    codeField: 'refusal_code',
  },
  {
    id: 'response_type_refused',
    level: 'warn',
    source: 'route_guard',
    summary: 'Route Handler の応答の `Content-Type` を出口の関所が止めた(閉じた表の外の型・宣言の無いダウンロード・本文があるのに型が無い応答。値は載せない)',
    codes: ['unsafe_content_type'],
    codeField: 'refusal_code',
  },
  {
    id: 'response_cache_refused',
    level: 'warn',
    source: 'route_guard',
    summary: 'Route Handler の応答のキャッシュの見出しを出口の関所が止めた(`no-store` の外の `Cache-Control`・CDN に宛てた見出し。値は載せない)',
    codes: ['unsafe_cache_control'],
    codeField: 'refusal_code',
  },
  {
    id: 'sign_in_started',
    level: 'info',
    source: 'auth_route',
    summary: 'サインインの開始(認可の URL へ転送した)',
    codes: ['redirected'],
    codeField: 'decision',
  },
  {
    id: 'sign_in_start_failed',
    level: 'warn',
    source: 'auth_route',
    summary: 'サインインを始められなかった(本文が不正・認証基盤が URL を返さない)',
    codes: ['invalid_form', 'start_failed'],
    codeField: 'decision',
  },
  {
    id: 'sign_in_callback_succeeded',
    level: 'info',
    source: 'auth_route',
    summary: 'サインインの帰り道が成功した(`decision` は認証フロー仕様の決定表の着地)',
    codes: [],
    codeField: 'decision',
  },
  {
    id: 'sign_in_callback_failed',
    level: 'warn',
    source: 'auth_route',
    summary: 'サインインの帰り道が失敗した(`decision` は失敗の固定のコード)',
    codes: [],
    codeField: 'decision',
  },
  {
    id: 'signed_out',
    level: 'info',
    source: 'auth_route',
    summary: 'ログアウトした(この端末のセッションを閉じた)',
    codes: ['session_ended'],
    codeField: 'decision',
  },
  {
    id: 'sign_out_degraded',
    level: 'warn',
    source: 'auth_route',
    summary: 'ログアウトで認証基盤のセッションを閉じられなかった(この端末の cookie は消した)',
    codes: ['backend_failed'],
    codeField: 'decision',
  },
  {
    id: 'sessions_ended',
    level: 'info',
    source: 'auth_route',
    summary: 'セッションの管理の操作で、ログイン状態を終えた(`actor_id` は操作した人。`decision` は範囲: 自分の 1 本・自分以外・アカウントの全部・全員)',
    codes: ['own_one', 'own_others', 'member_all', 'every'],
    codeField: 'decision',
  },
] as const satisfies readonly SecurityEventSpec[];

/** 事象の ID。 */
export type SecurityEventId = (typeof SECURITY_EVENTS)[number]['id'];

/**
 * ログの行に載せてよいフィールドの全数(`LogRecord` のキーと 1 対 1)と、各欄の値の出どころ。
 *
 * 型の正は `@kaninabe/runtime/ports` の `LogRecord`。この配列は**ハンドブックの目録とテストが読む実体**で、
 * `LogRecord` にキーを足してここに書き忘れる(またはその逆)と型検査が落ちる(`security-log.ts` の末尾の対応の確認)。
 * 個人の値(メールアドレス・トークン・cookie・入力値)を載せる欄は無い。
 */
export const LOG_FIELDS = [
  { name: 'level', value: '重大度(info / warn / error)' },
  { name: 'event', value: 'ドメインイベント ID(仕様のイベント)' },
  { name: 'operation', value: '操作の関数名' },
  { name: 'actor_id', value: '実行者の ID(null は未ログインまたは system)' },
  { name: 'entity', value: '対象の集約名' },
  { name: 'entity_id', value: '対象の識別子' },
  { name: 'error_kind', value: '拒否の 4 分類と一時的な失敗(invalid_input / guard_unsatisfied / forbidden / invariant_violated / temporarily_unavailable)' },
  { name: 'invariant', value: '破られた不変条件の ID' },
  { name: 'security_event', value: 'セキュリティの事象の ID(下の事象の目録)' },
  { name: 'refusal_code', value: '拒否の細かい分類(権限と多要素認証、状態とガードなど)' },
  { name: 'decision', value: '認証の結末(サインインの帰り道の着地、または失敗の固定のコード)' },
  { name: 'commit', value: '一時的な失敗が書けたかどうか(not_committed = 届く前に落ちた / unknown = 分からない)' },
  { name: 'request_id', value: '要求の識別子(配置先が付けた ID。要求ログとの突き合わせ用)' },
  { name: 'job_id', value: 'ジョブ識別子' },
  { name: 'job_type', value: 'ジョブ種別' },
  { name: 'duration_ms', value: '所要時間(ミリ秒)' },
  { name: 'message', value: '人が読む添え物(機械は読まない。外部から来た例外の文言など)' },
] as const;

/** ログの欄の名前の全数(`LOG_FIELDS` の `name`)。 */
export const LOG_FIELD_NAMES = LOG_FIELDS.map((field) => field.name);

/** 拒否の分類(`refusal_code`)の値域。 */
export type RefusalCode =
  | 'role_forbidden'
  | 'mfa_required'
  | 'invalid_input'
  | 'state_conflict'
  | 'guard_unsatisfied'
  | 'invariant_violated'
  | 'action_threw'
  | 'cross_origin'
  | 'unsafe_location'
  | 'refresh_header'
  | 'unsafe_redirect_signal'
  | 'unsafe_content_type'
  | 'unsafe_cache_control';
