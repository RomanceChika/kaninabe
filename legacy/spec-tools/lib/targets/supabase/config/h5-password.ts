/**
 * H5 の部品 — 認証フロー仕様が**本番の方式にパスワードで登録・サインインできる方式を置く**(`providers` に `email` か `phone`)なら、1 つの範囲
 * (ローカルの設定そのもの / deploy 先ごとの有効な設定)で、パスワードの守りが ASVS L2 の値に届いていることを見る(点検 4 回目 B4-5・5 回目 B5-3)。
 * 綴りは Supabase のもの(後段の置き場の中だけ)。**許可表**: パスワードを持てる方式は `email` と `phone` の 2 つで(Supabase は
 * `signUp({ phone, password })` / `signInWithPassword({ phone, password })` を持つ)、どちらかを本番に置けば共通の守りを、方式ごとに確認の守りを求める。
 *
 * | 方式 | キー | 求める値 | Supabase の既定 | ASVS |
 * |---|---|---|---|---|
 * | email / phone | `[auth] minimum_password_length` | 8 以上の整数 | 6 | V6.2.1(8 文字以上。15 以上を推奨) |
 * | email / phone | `[auth.email] secure_password_change` | true(パスワードの変更に**最近のサインインか再認証のコード**を求める) | false | V7.5.1(機微な変更の前の再認証)。V6.2.3 の「今のパスワード」ではない(下) |
 * | email | `[auth.email] enable_confirmations` | true(メールアドレスの確認を済ませるまで入れない) | false | V6.3.4・V6.8.1(同じメールでの事前の乗っ取り。他人のアドレスで先に登録して席を取る) |
 * | email | `[auth.email] double_confirm_changes` | true(アドレスの変更に旧いアドレスと新しいアドレスの両方の確認を求める) | true | V7.5.1(復旧の宛先を、開いたままの端末から新しい宛先の確認だけで奪わせない) |
 * | phone | `[auth.sms] enable_confirmations` | true(電話番号の確認(SMS のコード)を済ませるまで入れない) | false | V6.3.4・V6.8.1(他人の番号で先に登録して席を取る) |
 * | email / phone | `[auth.rate_limit] sign_in_sign_ups` | 1 以上 30 以下の整数(1 つの IP からの登録・サインインの要求 / 5 分) | 30 | V6.3.1(総当たり・リスト型攻撃の抑止。点検 6 回目 B6-4) |
 * | email / phone | `[auth.rate_limit] token_verifications` | 1 以上 30 以下の整数(1 つの IP からの確認のコード・リンクの照合 / 5 分) | 30 | V6.3.1(確認・再認証のコードの総当たりの抑止。同) |
 * | email | `[auth.rate_limit] email_sent` | 1 以上 2 以下の整数(送る確認・復旧のメール / 時) | 2 | V2.4.1(送信の流量 = メールの爆撃・送信の評判。点検 7 回目 B7-7) |
 * | phone | `[auth.rate_limit] sms_sent` | 1 以上 30 以下の整数(送る確認のコードの SMS / 時) | 30 | V2.4.1(送るたびに課金される SMS の水増し。同) |
 *
 * **流量の上限の値の根拠**: 上限は Supabase の既定(30 / 5 分 / IP)にする。ASVS V6.3.1 は「総当たり・リスト型攻撃への対策」を求めるが数を
 * 定めない(NIST SP 800-63B §5.2.2 は**アカウントごと**の連続失敗を 100 回以下に絞ることを求めるが、Supabase の設定は IP ごとの流量で、
 * アカウントごとの失敗の数を書く場所が無い)。そこで「認証基盤の提供者が安全側として出荷している既定より緩めない」を許可表にする ——
 * 既定より大きい値は意図して守りを弱める変更であり、30 / 5 分でも 1 つの IP から 1 日 8,640 回試せるので、これ以上は緩めない理由が無い。
 * 0 は Supabase では「上限なし」と読まれうる(書く値として意味を持たない)ので 1 以上を求める。本番の管理画面の値は H5 の範囲の外。
 * 送信の流量(`email_sent` / `sms_sent`)も同じ方式で、Supabase の既定(2 / 時・30 / 時)より緩めない(点検 7 回目 B7-7)。
 *
 * `secure_password_change` は `[auth.email]` の見出しの下に書くが、効き目はパスワードの変更全体(方式によらない)なので、`phone` だけの製品にも求める。
 * **Supabase の意味は「最近(既定 24 時間)サインインしたか、再認証のコード(`reauthenticate`)」であって、今のパスワードの入力ではない** ——
 * 24 時間以内のセッションを盗めば今のパスワードなしで変えられる。ASVS V6.2.3(変更に今のパスワードを求める)は設定では満たせないので、
 * パスワードの変更の画面を持つ製品の責任(変更の前に `signInWithPassword` で今のパスワードを確かめる)として規約に書く(auth-spec-writing.md §H5)。
 *
 * **書かれていないキーは Supabase の既定で読む**ので、書き忘れはそのまま赤になる(`double_confirm_changes` は既定が true なので、書いて外したときだけ赤)。
 * 文字の種類の組み合わせ(`password_requirements`)は求めない —— ASVS V6.2.5 は組み合わせの規則を課さないことを求める。
 * 漏えい済みのパスワードの拒否(V6.2.12)は Supabase では有料のプランの機能で設定ファイルに書く場所が無いので見ない(本番の設定は H5 の範囲の外)。
 *
 * `local_only`(開発・テストだけ)の方式は見ない(本番にその方式のサインインが無い)。`[auth] enabled = false` なら見ない。
 * deploy 先は基の設定を引き継ぐので、deploy 先が自分で書いたキーだけを見る(引き継いだ値の指摘は基の設定の指摘と重なる)。
 */

import type { Finding } from '../../../kernel/finding.js';
import { h5Finding, valueOf } from './h5-doors.js';
import type { Scope, ScopeResult } from './h5-doors.js';

/** パスワードの最短の長さ(ASVS L2 V6.2.1)。 */
export const MIN_PASSWORD_LENGTH = 8;

/** 認証の要求の流量の上限(1 つの IP からの 5 分あたりの回数。Supabase の既定。根拠は冒頭の表の下)。 */
export const MAX_AUTH_ATTEMPTS_PER_5_MIN = 30;

/** 確認・復旧のメールの送信の上限(1 時間あたりの通数。Supabase の既定。点検 7 回目 B7-7)。 */
export const MAX_EMAIL_SENT_PER_HOUR = 2;

/** 確認のコードの SMS の送信の上限(1 時間あたりの通数。Supabase の既定。点検 7 回目 B7-7)。 */
export const MAX_SMS_SENT_PER_HOUR = 30;

/** 流量の上限の値が許可表の内か(1 以上 `max` 以下の整数)を見る判定を作る。 */
function withinLimit(max: number): (value: boolean | number) => boolean {
  return (value) => typeof value === 'number' && value >= 1 && value <= max;
}

/** 認証の要求の流量の上限の判定(1 以上 `MAX_AUTH_ATTEMPTS_PER_5_MIN` 以下の整数)。 */
const withinRateLimit = withinLimit(MAX_AUTH_ATTEMPTS_PER_5_MIN);

/** パスワードで登録・サインインできる方式(`providers` の語。許可表)。 */
export const PASSWORD_METHODS = ['email', 'phone'] as const;

/** パスワードを持てる方式。 */
type PasswordMethod = (typeof PASSWORD_METHODS)[number];

/** 見るキー 1 つ。 */
interface PasswordRule {
  /** このキーを求める方式(どれか 1 つでも本番にあれば求める)。 */
  readonly methods: readonly PasswordMethod[];
  readonly section: string;
  readonly key: string;
  /** キーが書かれていないときの Supabase の既定。 */
  readonly fallback: boolean | number;
  /** 値が求める水準に届いているか(型が違えば `unreadable`)。 */
  readonly judge: (value: boolean | number) => boolean;
  readonly type: 'boolean' | 'integer';
  /** 届いていないときの危険。 */
  readonly risk: string;
  /** 直し方。 */
  readonly fix: string;
}

/** 見るキーの一覧(Supabase の綴り)。 */
const RULES: readonly PasswordRule[] = [
  {
    methods: ['email', 'phone'],
    section: 'auth',
    key: 'minimum_password_length',
    fallback: 6,
    type: 'integer',
    judge: (value) => typeof value === 'number' && value >= MIN_PASSWORD_LENGTH,
    risk: `パスワードの最短の長さが ${MIN_PASSWORD_LENGTH} 文字に届かず、総当たり・推測で破られやすくなります(ASVS V6.2.1)`,
    fix: `minimum_password_length = ${MIN_PASSWORD_LENGTH} 以上を書く(15 以上を推奨。文字の種類の組み合わせ password_requirements は求めない —— ASVS V6.2.5)`,
  },
  {
    methods: ['email'],
    section: 'auth.email',
    key: 'enable_confirmations',
    fallback: false,
    type: 'boolean',
    judge: (value) => value === true,
    risk: 'メールアドレスの確認を済ませなくてもサインインでき、他人のアドレスで先に登録して席を取れます(同じメールでの事前の乗っ取り。ASVS V6.8.1)',
    fix: 'enable_confirmations = true を書く(確認のメールが届いた人だけが入れる)',
  },
  {
    methods: ['email', 'phone'],
    section: 'auth.email',
    key: 'secure_password_change',
    fallback: false,
    type: 'boolean',
    judge: (value) => value === true,
    risk: 'パスワードの変更に再認証が要らず、開いたままの端末・盗まれたセッションでパスワードを書き換えて乗っ取れます(ASVS V7.5.1)',
    fix:
      'secure_password_change = true を書く(最近サインインしていなければ、変更の前に再認証のコードを求める。今のパスワードの入力ではないので、' +
      'ASVS V6.2.3 は変更の画面が今のパスワードを確かめて満たす)',
  },
  {
    methods: ['email'],
    section: 'auth.email',
    key: 'double_confirm_changes',
    fallback: true,
    type: 'boolean',
    judge: (value) => value === true,
    risk: 'メールアドレスの変更が新しいアドレスの確認だけで済み、開いたままの端末・盗まれたセッションから復旧の宛先を奪えます(ASVS V7.5.1)',
    fix: 'double_confirm_changes = true を書く(または行を消して既定の true に戻す。旧いアドレスと新しいアドレスの両方の確認を求める)',
  },
  {
    methods: ['phone'],
    section: 'auth.sms',
    key: 'enable_confirmations',
    fallback: false,
    type: 'boolean',
    judge: (value) => value === true,
    risk: '電話番号の確認(SMS のコード)を済ませなくてもパスワードで登録・サインインでき、他人の番号で先に登録して席を取れます(事前の乗っ取り。ASVS V6.8.1)',
    fix: '[auth.sms] enable_confirmations = true を書く(確認のコードが届いた人だけが入れる)',
  },
  {
    methods: ['email', 'phone'],
    section: 'auth.rate_limit',
    key: 'sign_in_sign_ups',
    fallback: MAX_AUTH_ATTEMPTS_PER_5_MIN,
    type: 'integer',
    judge: withinRateLimit,
    risk: `登録・サインインの要求の流量の上限が 1〜${MAX_AUTH_ATTEMPTS_PER_5_MIN} 回 / 5 分 / IP の外で、パスワードの総当たり・リスト型攻撃を抑えられません(ASVS V6.3.1)`,
    fix: `[auth.rate_limit] sign_in_sign_ups = ${MAX_AUTH_ATTEMPTS_PER_5_MIN} 以下(1 以上)を書く(または行を消して Supabase の既定 ${MAX_AUTH_ATTEMPTS_PER_5_MIN} に戻す)`,
  },
  {
    methods: ['email', 'phone'],
    section: 'auth.rate_limit',
    key: 'token_verifications',
    fallback: MAX_AUTH_ATTEMPTS_PER_5_MIN,
    type: 'integer',
    judge: withinRateLimit,
    risk: `確認のコード・リンクの照合の流量の上限が 1〜${MAX_AUTH_ATTEMPTS_PER_5_MIN} 回 / 5 分 / IP の外で、確認・再認証のコードを総当たりで当てられます(ASVS V6.3.1)`,
    fix: `[auth.rate_limit] token_verifications = ${MAX_AUTH_ATTEMPTS_PER_5_MIN} 以下(1 以上)を書く(または行を消して Supabase の既定 ${MAX_AUTH_ATTEMPTS_PER_5_MIN} に戻す)`,
  },
  {
    methods: ['email'],
    section: 'auth.rate_limit',
    key: 'email_sent',
    fallback: MAX_EMAIL_SENT_PER_HOUR,
    type: 'integer',
    judge: withinLimit(MAX_EMAIL_SENT_PER_HOUR),
    risk: `確認・復旧のメールの送信の上限が 1〜${MAX_EMAIL_SENT_PER_HOUR} 通 / 時の外で、他人のアドレスへのメールの爆撃・送信の評判の失墜を抑えられません(ASVS V2.4.1)`,
    fix: `[auth.rate_limit] email_sent = ${MAX_EMAIL_SENT_PER_HOUR} 以下(1 以上)を書く(または行を消して Supabase の既定 ${MAX_EMAIL_SENT_PER_HOUR} に戻す)`,
  },
  {
    methods: ['phone'],
    section: 'auth.rate_limit',
    key: 'sms_sent',
    fallback: MAX_SMS_SENT_PER_HOUR,
    type: 'integer',
    judge: withinLimit(MAX_SMS_SENT_PER_HOUR),
    risk: `確認のコードの SMS の送信の上限が 1〜${MAX_SMS_SENT_PER_HOUR} 通 / 時の外で、送るたびに課金される SMS を水増しされます(ASVS V2.4.1)`,
    fix: `[auth.rate_limit] sms_sent = ${MAX_SMS_SENT_PER_HOUR} 以下(1 以上)を書く(または行を消して Supabase の既定 ${MAX_SMS_SENT_PER_HOUR} に戻す)`,
  },
];

/** 位置の言い方(`[auth.email] enable_confirmations`)。deploy 先は `[remotes.{名}.auth.email] …`。 */
function whereOf(scope: Scope, section: string, key: string): string {
  return `[${scope.remote === null ? '' : `remotes.${scope.remote}.`}${section}] ${key}`;
}

/** その範囲で、このキーの指摘を出すか(ローカルは全部・deploy 先は自分で書いたキーだけ)。 */
function reports(scope: Scope, rule: PasswordRule): boolean {
  return scope.written === null || scope.written.has(`${rule.section}\0${rule.key}`);
}

/** キー 1 つの指摘(届いている・見ない範囲なら null)。`methods` は本番に置いたパスワードの方式のうち、このキーを求めるもの。 */
function ruleFinding(scope: Scope, rule: PasswordRule, methods: readonly PasswordMethod[]): Finding | null {
  if (!reports(scope, rule)) return null;
  const written = valueOf(scope.doc, rule.section, rule.key);
  const value = written ?? rule.fallback;
  const where = whereOf(scope, rule.section, rule.key);
  const pointer = `${where.slice(0, where.indexOf(']') + 1)}.${rule.key}`;
  const typed = rule.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'number' && Number.isSafeInteger(value);
  if (!typed) {
    return h5Finding(scope.file, pointer, {
      message: `${scope.file} の ${where} を読めません(${rule.type === 'boolean' ? '真偽値' : '整数'}ではありません)`,
      suggestion: rule.fix,
      counterexample: { setting: `${rule.section}.${rule.key}` },
    });
  }
  if (rule.judge(value as boolean | number)) return null;
  return h5Finding(scope.file, pointer, {
    message:
      `${scope.file} の ${where} が ${String(value)}${written === undefined ? '(書かれていないので Supabase の既定)' : ''}ですが、` +
      `認証フロー仕様は本番の方式にパスワードで登録・サインインできる方式を置いています(providers: ${methods.join(', ')})。${rule.risk}`,
    suggestion: `${rule.fix}。本番の設定(管理画面)にも同じ値を置く。パスワードのサインインが開発・テストだけなら、${methods.join(' / ')} を local_only に移す`,
    counterexample: { setting: `${rule.section}.${rule.key}`, value: String(value), providers: methods.join(',') },
  });
}

/**
 * パスワードの守りの突合。
 *
 * @param scope 突合の範囲
 * @param providers 宣言した本番の方式(パスワードを持てる方式 `email` / `phone` が無ければ何も見ない)
 */
export function passwordResult(scope: Scope, providers: readonly string[]): ScopeResult {
  const declared = PASSWORD_METHODS.filter((method) => providers.includes(method));
  if (declared.length === 0 || valueOf(scope.doc, 'auth', 'enabled') === false) return { findings: [], skipped: [] };
  return {
    findings: RULES.flatMap((rule) => {
      const methods = declared.filter((method) => rule.methods.includes(method));
      return methods.length === 0 ? [] : (ruleFinding(scope, rule, methods) ?? []);
    }),
    skipped: [],
  };
}
