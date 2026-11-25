/**
 * H5 の部品 — 1 つの範囲(ローカルの設定そのもの / `[remotes.{名}]` の deploy 先ごとの有効な設定)に対して、開いているサインインの方式と
 * 外へ出すスキーマを宣言に突き合わせる。綴りは Supabase のもの(後段の置き場の中だけ)。
 *
 * 範囲の違いは 2 つだけ: 位置の言い方(`[auth.email]` と `[remotes.{名}.auth.email]`)と、何を許すか。ローカルは `providers` ∪ `local_only`、
 * deploy 先は `providers` だけ(`local_only` はローカルでだけ開けてよい方式で、deploy 先には使えない)。deploy 先は基の設定を引き継ぐので、
 * 引き継いで開いたままの `local_only` の方式も deploy 先の指摘にする(ほかの引き継ぎは基の設定の指摘と重なるので出さない)。
 */

import { H5_ID } from '../../../auth/platform-config.js';
import type { Finding } from '../../../kernel/finding.js';
import { SUPABASE_PLATFORM_PROFILE } from '../platform-profile.js';
import type { TomlDoc, TomlValue } from './config-toml.js';

/** 突合の範囲。 */
export interface Scope {
  /** 見る設定(deploy 先は基の設定に上書きを重ねたもの)。 */
  readonly doc: TomlDoc;
  /** 設定ファイルのリポジトリルート相対パス。 */
  readonly file: string;
  /** deploy 先の名前(ローカルの設定そのものなら null)。 */
  readonly remote: string | null;
  /** 開いていてよい方式。 */
  readonly allowed: readonly string[];
  /** ローカルでだけ開けてよい方式(deploy 先では、引き継いで開いていれば指摘にする)。 */
  readonly localOnly: readonly string[];
  /** deploy 先が自分で書いた `セクション\0キー`(ローカルの設定そのものなら null = 全部を見る)。 */
  readonly written: ReadonlySet<string> | null;
}

/** 開いている口 1 つの読み取り。 */
interface Door {
  /** 宣言の `providers` に載るべき語。 */
  readonly method: string;
  readonly section: string;
  readonly key: string;
  /** キーが書かれていないときの Supabase の既定。 */
  readonly fallback: boolean;
}

/** 範囲の結果。 */
export interface ScopeResult {
  readonly findings: Finding[];
  /** 見なかった部分とその理由(未実施として実行ログが名指す)。 */
  readonly skipped: string[];
}

/** セクション直下のキー 1 つ。 */
export function valueOf(doc: TomlDoc, section: string, key: string): TomlValue | undefined {
  return doc.get(section)?.get(key);
}

/** 位置の言い方(`[auth.email] enable_signup`)。deploy 先は `[remotes.{名}.auth.email] enable_signup`。 */
function whereOf(scope: Scope, section: string, key: string): string {
  return `[${scope.remote === null ? '' : `remotes.${scope.remote}.`}${section}] ${key}`;
}

/** 指摘の組み立て。 */
export function h5Finding(file: string, pointer: string, args: Pick<Finding, 'message' | 'suggestion' | 'counterexample'>): Finding {
  return { verifier: H5_ID, severity: 'error', location: { file, pointer }, ...args };
}

/** `[{prefix}.{名}]` の形のセクションの名前の一覧。 */
function namesUnder(doc: TomlDoc, prefix: string): readonly string[] {
  return [...doc.keys()].flatMap((section) => (section.startsWith(`${prefix}.`) && !section.slice(prefix.length + 1).includes('.') ? [section.slice(prefix.length + 1)] : []));
}

/** 設定から口の一覧を作る(固定の 3 つ + 外部プロバイダ・外部の認証基盤・ウォレットの名前ごと)。 */
function doorsOf(doc: TomlDoc): readonly Door[] {
  const fixed: readonly Door[] = [
    { method: 'email', section: 'auth.email', key: 'enable_signup', fallback: true },
    { method: 'phone', section: 'auth.sms', key: 'enable_signup', fallback: false },
    { method: 'anonymous_sign_in', section: 'auth', key: 'enable_anonymous_sign_ins', fallback: false },
  ];
  const named = ['auth.external', 'auth.third_party', 'auth.web3'].flatMap((prefix) =>
    namesUnder(doc, prefix).map((name): Door => ({ method: name, section: `${prefix}.${name}`, key: 'enabled', fallback: false })),
  );
  return [...fixed, ...named];
}

/** 範囲の見出し(未実施の理由に出す)。 */
function scopeWords(scope: Scope): string {
  return scope.remote === null ? '' : `deploy 先 ${scope.remote} の`;
}

/** サインインの口の突合。 */
export function signInResult(scope: Scope, providers: readonly string[]): ScopeResult {
  const { doc, file } = scope;
  if (valueOf(doc, 'auth', 'enabled') === false) {
    const skipped = scope.written === null || scope.written.has('auth\0enabled') ? [`${whereOf(scope, 'auth', 'enabled')} = false のため、${scopeWords(scope)}サインインの方式の突合は見ていません`] : [];
    return { findings: [], skipped };
  }
  const declared = providers.length === 0 ? '(なし)' : providers.join(' / ');
  const declaredLocal = scope.remote !== null || scope.localOnly.length === 0 ? '' : `・local_only: ${scope.localOnly.join(' / ')}`;
  const findings: Finding[] = [];
  for (const door of doorsOf(doc)) {
    const where = whereOf(scope, door.section, door.key);
    const pointer = where.replace('] ', '].');
    const written = valueOf(doc, door.section, door.key);
    const report = scope.written === null || scope.written.has(`${door.section}\0${door.key}`) || scope.localOnly.includes(door.method);
    if (written !== undefined && typeof written !== 'boolean') {
      findings.push(h5Finding(file, pointer, { message: `${file} の ${where} を読めません(真偽値ではありません)`, suggestion: `${where} は true か false で書く(読めない値は、開いているのか閉じているのかを検査できない)`, counterexample: { setting: where } }));
      continue;
    }
    const open = written ?? door.fallback;
    if (!open || scope.allowed.includes(door.method) || !report) continue;
    const how = written === undefined ? `${where} が書かれておらず、既定が有効です` : `${where} が true です`;
    const remoteNote = scope.remote === null ? '' : `(deploy 先は ${scope.remote} の有効な設定で見ています。ローカルでだけ開けてよい方式〔local_only〕は deploy 先では開けられません)`;
    findings.push(
      h5Finding(file, pointer, {
        message: `${file} は ${door.method} によるサインインの口が開いています(${how})が、認証フロー仕様の providers(${declared}${declaredLocal})に ${door.method} がありません${remoteNote}`,
        suggestion:
          `使わない方式なら ${where} = false にして口を閉じる。本番でも使うなら認証フロー仕様の providers に${scope.remote === null ? '、ローカル(開発・テスト)でだけ使うなら local_only に' : ''} ${door.method} を足す。` +
          '本番の設定(管理画面)にも同じ方式の開閉を揃える(この検査が見るのは設定ファイルだけ)',
        counterexample: { method: door.method, setting: where, declared },
      }),
    );
  }
  return { findings, skipped: [] };
}

/** 外へ出すスキーマの突合。 */
export function exposureResult(scope: Scope): ScopeResult {
  const { doc, file } = scope;
  if (valueOf(doc, 'api', 'enabled') === false) {
    const skipped = scope.written === null || scope.written.has('api\0enabled') ? [`${whereOf(scope, 'api', 'enabled')} = false のため、${scopeWords(scope)}外へ出すスキーマの突合は見ていません`] : [];
    return { findings: [], skipped };
  }
  const allowed = SUPABASE_PLATFORM_PROFILE.exposedSchema;
  const where = whereOf(scope, 'api', 'schemas');
  const written = valueOf(doc, 'api', 'schemas');
  if (written !== undefined && (typeof written === 'boolean' || typeof written === 'number' || typeof written === 'string' || 'unreadable' in written)) {
    return {
      findings: [h5Finding(file, where.replace('] ', '].'), { message: `${file} の ${where} を読めません(文字列の配列ではありません)`, suggestion: `schemas = ["${allowed}"] の形で書く(読めない値は、外へ出すスキーマを検査できない)`, counterexample: { setting: where } })],
      skipped: [],
    };
  }
  // deploy 先は基の設定の指摘と重ならないよう、自分で書いた schemas だけを見る。書かれていなければ、Supabase の既定(公開スキーマ + GraphQL)で開く。
  if (scope.written !== null && !scope.written.has('api\0schemas')) return { findings: [], skipped: [] };
  const exposed = written ?? ['public', 'graphql_public'];
  const findings = exposed
    .filter((schema) => schema !== allowed)
    .map((schema) =>
      h5Finding(file, where.replace('] ', '].'), {
        message: `${file} の ${where} で ${schema} が外へ出ています(${written === undefined ? '書かれておらず、既定で出ます' : '書かれています'})が、外へ出してよいスキーマは仕様の公開面の ${allowed} だけです`,
        suggestion:
          `${where} を ["${allowed}"] だけにして ${schema} を外す(使っていないスキーマの口は、公開面の列の隠し・権限の閉世界を迂回する経路になりうる)。` +
          '本番の設定(管理画面のデータ API の公開スキーマ)にも同じ設定を揃える',
        counterexample: { schema, allowed },
      }),
    );
  return { findings, skipped: [] };
}
