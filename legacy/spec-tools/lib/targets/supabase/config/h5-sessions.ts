/**
 * H5 の部品 — 1 つの範囲(ローカルの設定そのもの / deploy 先ごとの有効な設定)で、セッションの寿命を認証フロー仕様の `sessions` に突き合わせる。
 * 綴りは Supabase のもの(後段の置き場の中だけ)。
 *
 * 見るのは 4 つのキーである:
 *   - `[auth.sessions] timebox`(絶対の寿命)と `inactivity_timeout`(無操作の時間切れ)が、宣言と**同じ長さ**であること。
 *     Supabase はどちらも既定が無く(書かなければセッションは時間で終わらない)、値は Go の期間の綴り(`24h` / `50m` / `1h30m`)
 *   - `[auth] jwt_expiry`(アクセストークンの寿命。秒。既定 3600)が、無操作の時間切れより**短い**こと。Supabase の無操作の時間切れは
 *     「最後にセッションを更新したとき」から測る(`auth` の `models.Session.CheckValidity`)ので、アクセストークンの寿命が同じか長いと、
 *     使い続けている人も次の更新で締め出され、宣言した「無操作」の意味にならない
 *   - 同じ `[auth] jwt_expiry` が、クライアントのライブラリ(`@supabase/auth-js`)の更新の余裕(90 秒)より**長い**こと。残りが余裕より短い
 *     アクセストークンはライブラリが読みのたびに更新するので、寿命が 90 秒以下だと読みのたびに更新トークンが回る(1 要求で約 7 回の実測。
 *     cookie を書けない描画が回した世代が残らず、遅れて着いた応答で締め出しの連鎖が起きた。2026-11 の測り)。手元の設定は error で止める。
 *     実行時の値(本番の管理画面・測りの環境変数)はここから見えないので、セッションの adapter が答えで見て警告する
 *     (`@kaninabe/adapter-supabase-session` の `JWT_LIFETIME_FLOOR_SECONDS`)
 *   - `[auth] enable_refresh_token_rotation`(既定 true)が false でないこと。Supabase の設定の説明は「無効にすると更新トークンは期限を持たない」で、
 *     宣言した絶対の寿命(更新トークンの絶対の期限を兼ねる)を破る
 *
 * 同時セッションの数(`sessions.concurrent`)は**設定ファイルでは見えない**: Supabase の CLI の設定(`[auth.sessions]`)が持つキーは
 * `timebox` と `inactivity_timeout` の 2 つだけで、1 人 1 セッションに絞る設定(管理画面の Single session per user。Pro 以上の機能)は
 * 設定ファイルに書く場所が無い(キーを作って突き合わせない)。なので宣言は「見ていません」(未実施の行)として毎回名指す。
 *
 * deploy 先は基の設定を引き継ぐので、deploy 先が自分で書いたキーだけを見る(引き継いだ値の指摘は基の設定の指摘と重なる)。
 */

import type { Finding } from '../../../kernel/finding.js';
import type { AuthSessionsDecl } from '../../../model/auth/sessions.js';
import { concurrentWords, formatSeconds } from '../../../model/auth/sessions.js';
import type { TomlValue } from './config-toml.js';
import { h5Finding, valueOf } from './h5-doors.js';
import type { Scope, ScopeResult } from './h5-doors.js';

/** アクセストークンの寿命の Supabase の既定(秒)。 */
const JWT_EXPIRY_DEFAULT = 3600;

/**
 * アクセストークンの寿命の下限(秒。これ**以下**は error)。`@supabase/auth-js` の `EXPIRY_MARGIN_MS`(30 秒 × 3)と同じ値で、
 * セッションの adapter の `JWT_LIFETIME_FLOOR_SECONDS` と揃える(検査器は実行時のパッケージを読まないので、値を写して持つ)。
 */
const JWT_EXPIRY_FLOOR_SECONDS = 90;

/** Go の期間の単位ごとの秒数(`time.ParseDuration` が読む単位)。 */
const GO_UNITS: Readonly<Record<string, number>> = { h: 3600, m: 60, s: 1, ms: 1e-3, us: 1e-6, µs: 1e-6, ns: 1e-9 };

/**
 * Go の期間の綴り(`24h` / `1h30m` / `1.5h`)を秒に直す。
 *
 * @param text 設定の値
 * @returns 秒数(読めなければ null)
 */
export function goDurationSeconds(text: string): number | null {
  if (!/^(?:\d+(?:\.\d+)?(?:h|m|s|ms|us|µs|ns))+$/.test(text)) return null;
  let seconds = 0;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)(ms|us|µs|ns|h|m|s)/g)) {
    seconds += Number(match[1]) * (GO_UNITS[match[2] ?? ''] ?? 0);
  }
  return seconds;
}

/** 位置の言い方(`[auth.sessions] timebox`)。deploy 先は `[remotes.{名}.auth.sessions] timebox`。 */
function whereOf(scope: Scope, section: string, key: string): string {
  return `[${scope.remote === null ? '' : `remotes.${scope.remote}.`}${section}] ${key}`;
}

/** その範囲で、このキーの指摘を出すか(ローカルは全部・deploy 先は自分で書いたキーだけ)。 */
function reports(scope: Scope, section: string, key: string): boolean {
  return scope.written === null || scope.written.has(`${section}\0${key}`);
}

/** 期間 1 つ(絶対の寿命 / 無操作の時間切れ)を宣言と比べる。 */
function lifetimeFinding(scope: Scope, key: 'timebox' | 'inactivity_timeout', declared: string, declaredSeconds: number, what: string): Finding | null {
  if (!reports(scope, 'auth.sessions', key)) return null;
  const where = whereOf(scope, 'auth.sessions', key);
  const pointer = where.replace('] ', '].');
  const written: TomlValue | undefined = valueOf(scope.doc, 'auth.sessions', key);
  const fix = `${where} = "${declared}" と書く(本番の設定〔管理画面〕にも同じ値を揃える。この検査が見るのは設定ファイルだけ)`;
  if (written === undefined) {
    return h5Finding(scope.file, pointer, {
      message: `${scope.file} の ${where} が書かれていません。既定ではセッションが${what}で終わらないので、認証フロー仕様の sessions(${declared})が効きません`,
      suggestion: fix,
      counterexample: { setting: where, declared },
    });
  }
  const seconds = typeof written === 'string' ? goDurationSeconds(written) : null;
  if (seconds === null) {
    return h5Finding(scope.file, pointer, {
      message: `${scope.file} の ${where} を期間として読めません(24h / 50m / 1h30m のような文字列ではありません)`,
      suggestion: fix,
      counterexample: { setting: where, declared },
    });
  }
  if (seconds === declaredSeconds) return null;
  return h5Finding(scope.file, pointer, {
    message: `${scope.file} の ${where} は ${formatSeconds(seconds)} ですが、認証フロー仕様の sessions は ${declared} です(${what}が宣言と食い違っています)`,
    suggestion: `${fix}。値を変えたいなら、先に認証フロー仕様の sessions を理由ごと書き直す`,
    counterexample: { setting: where, written: formatSeconds(seconds), declared },
  });
}

/** アクセストークンの寿命が無操作の時間切れより短いか。 */
function accessTokenFinding(scope: Scope, decl: AuthSessionsDecl): Finding | null {
  if (!reports(scope, 'auth', 'jwt_expiry') && !reports(scope, 'auth.sessions', 'inactivity_timeout')) return null;
  const where = whereOf(scope, 'auth', 'jwt_expiry');
  const pointer = where.replace('] ', '].');
  const written = valueOf(scope.doc, 'auth', 'jwt_expiry');
  if (written !== undefined && typeof written !== 'number') {
    return h5Finding(scope.file, pointer, {
      message: `${scope.file} の ${where} を読めません(秒の数ではありません)`,
      suggestion: `${where} は秒の数で書く(例: 3600)`,
      counterexample: { setting: where },
    });
  }
  const seconds = written ?? JWT_EXPIRY_DEFAULT;
  if (seconds <= JWT_EXPIRY_FLOOR_SECONDS) {
    return h5Finding(scope.file, pointer, {
      message:
        `${scope.file} の ${where} は ${formatSeconds(seconds)} で、ライブラリの更新の余裕 ${formatSeconds(JWT_EXPIRY_FLOOR_SECONDS)} より長くありません。` +
        '残りが余裕より短いアクセストークンは読みのたびに更新されるので、1 要求で更新トークンが何度も回り、書き戻せない世代が残って締め出しが起きます',
      suggestion: `${where} を ${String(JWT_EXPIRY_FLOOR_SECONDS)} 秒より長くする(既定 3600)`,
      counterexample: { setting: where, written: formatSeconds(seconds), floor: formatSeconds(JWT_EXPIRY_FLOOR_SECONDS) },
    });
  }
  if (seconds < decl.inactivitySeconds) return null;
  return h5Finding(scope.file, pointer, {
    message:
      `${scope.file} の ${where} は ${formatSeconds(seconds)}${written === undefined ? '(書かれておらず既定)' : ''} で、認証フロー仕様の無操作の時間切れ ${decl.inactivity} より短くありません。` +
      '無操作の時間切れは最後にセッションを更新したときから測るので、使い続けている人も次の更新で締め出されます',
    suggestion: `${where} を無操作の時間切れより短くするか、認証フロー仕様の sessions.inactivity を理由ごと長くする`,
    counterexample: { setting: where, written: formatSeconds(seconds), inactivity: decl.inactivity },
  });
}

/** 更新トークンが期限を持つ設定か(回転を無効にすると、更新トークンは期限を持たない)。 */
function rotationFinding(scope: Scope): Finding | null {
  if (!reports(scope, 'auth', 'enable_refresh_token_rotation')) return null;
  const where = whereOf(scope, 'auth', 'enable_refresh_token_rotation');
  const written = valueOf(scope.doc, 'auth', 'enable_refresh_token_rotation');
  if (written === undefined || written === true) return null;
  const unreadable = typeof written !== 'boolean';
  return h5Finding(scope.file, where.replace('] ', '].'), {
    message: unreadable
      ? `${scope.file} の ${where} を読めません(真偽値ではありません)`
      : `${scope.file} の ${where} が false です。更新トークンが期限を持たなくなり、認証フロー仕様の sessions の絶対の寿命(更新トークンの絶対の期限を兼ねる)を破ります`,
    suggestion: `${where} = true にする(または行ごと消して既定の true に戻す)`,
    counterexample: { setting: where },
  });
}

/** 同時セッションの数の宣言を、設定ファイルでは見えないことの言い方にする(ローカルの範囲だけ。deploy 先は基の設定と同じ事情なので重ねない)。 */
function concurrentSkipped(scope: Scope, sessions: AuthSessionsDecl): string[] {
  if (scope.remote !== null) return [];
  return [
    `同時セッションの数(sessions.concurrent: ${concurrentWords(sessions.concurrent)})は、設定ファイルに書く場所が無い(Supabase の設定ファイルの [auth.sessions] は timebox と inactivity_timeout だけ。` +
      '1 人 1 セッションに絞る設定は管理画面の機能でプランにも依る)ため見ていません',
  ];
}

/**
 * セッションの寿命の突合。
 *
 * @param scope 突合の範囲
 * @param sessions 宣言したセッションの寿命(読めなかったなら undefined で、何も見ない —— H0 が言っている)
 */
export function sessionsResult(scope: Scope, sessions: AuthSessionsDecl | undefined): ScopeResult {
  if (sessions === undefined) return { findings: [], skipped: [] };
  if (valueOf(scope.doc, 'auth', 'enabled') === false) {
    const where = whereOf(scope, 'auth', 'enabled');
    const skipped = reports(scope, 'auth', 'enabled') ? [`${where} = false のため、${scope.remote === null ? '' : `deploy 先 ${scope.remote} の`}セッションの寿命の突合は見ていません`] : [];
    return { findings: [], skipped };
  }
  const findings = [
    lifetimeFinding(scope, 'timebox', sessions.absolute, sessions.absoluteSeconds, '絶対の寿命'),
    lifetimeFinding(scope, 'inactivity_timeout', sessions.inactivity, sessions.inactivitySeconds, '無操作の時間切れ'),
    accessTokenFinding(scope, sessions),
    rotationFinding(scope),
  ].filter((finding): finding is Finding => finding !== null);
  return { findings, skipped: concurrentSkipped(scope, sessions) };
}
