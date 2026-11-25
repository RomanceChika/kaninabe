/**
 * auth_spec の**認証の口**の読み取り —— `callback`(OAuth の帰り道)・`start`(サインインの開始)・`logout`(ログアウト)。
 *
 * parse-auth.ts が呼ぶ下位の部品。責務は 1 ファイルの中で閉じる形(マッピングであること・書けるキー・必須の 2 欄・
 * 帰り道があるなら開始とログアウトも書くこと)に限る。
 *
 * **帰り道があるなら、開始とログアウトの口も要る**(server-only-session.md の案 A)。セッションの cookie はスクリプトから読めない
 * (`HttpOnly`)ので、ブラウザの認証基盤のクライアントでサインインを始めたりログアウトしたりはできない —— どちらもサーバーの口になる。
 * 口の宣言が無いまま帰り道だけがあると、開始とログアウトがブラウザのスクリプトに残る形を仕様が許してしまう。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { AuthCallbackDecl } from './types.js';

/** 口の宣言に書けるキー(3 つの口で同じ)。 */
const ENDPOINT_KEYS: readonly string[] = ['endpoint', 'summary'];

/** ログアウトの口だけが書けるキー(ログアウトの操作の名前。H8)。 */
const LOGOUT_KEYS: readonly string[] = [...ENDPOINT_KEYS, 'control'];

/** 認証の口のキーと、人が読む名前。 */
const ENTRY_WORDS = {
  callback: 'OAuth の帰り道の口',
  start: 'サインインの開始の口(POST。ログインのボタンのフォームが叩く)',
  logout: 'ログアウトの口(POST。ログアウトのボタンのフォームが叩く)',
} as const;

/** 認証の口のキー。 */
type AuthEntryKey = keyof typeof ENTRY_WORDS;

/**
 * 認証の口 1 つを読む。**任意**。書くなら `endpoint` と `summary` が要る。
 * URL の書き方(`//`・`?`・`#`・`.` / `..`)と、実装の木に Route Handler があるか・ほかの宣言と同じ URL を取っていないかは J2 が見る
 * (ジョブの `endpoint` と同じ分担 — ここは 1 ファイルの中で閉じる形だけ)。
 */
function parseEntry(root: YamlReader, key: AuthEntryKey, reporter: SpecReporter): AuthCallbackDecl | undefined {
  if (!root.has(key)) return undefined;
  const what = ENTRY_WORDS[key];
  const suggestion = `${key} は "endpoint / summary" のマッピングで書く(${what})`;
  const record = asRecord(root.raw(key));
  if (record === null) {
    reporter.error(root.pointer(key), `${key} はマッピングで書きます`, suggestion);
    reporter.dropRows();
    return undefined;
  }
  const item = new YamlReader(record, root.pointer(key), reporter);
  const allowed = key === 'logout' ? LOGOUT_KEYS : ENDPOINT_KEYS;
  item.rejectUnknownKeys(allowed, key, `書けるのは ${allowed.join(' / ')} だけ`);
  const endpoint = item.requiredString('endpoint', `endpoint に${what}の URL のパス(/api/...)を書く`);
  const summary = item.requiredString('summary', 'summary にどういう口かを 1 行で書く');
  if (endpoint === null || summary === null) {
    reporter.dropRows();
    return undefined;
  }
  const control = key === 'logout' ? parseControl(item, reporter) : undefined;
  if (control === null) {
    reporter.dropRows();
    return undefined;
  }
  return { endpoint, summary, ...(control === undefined ? {} : { control }), location: reporter.location(key) };
}

/** ログアウトの操作の名前(`control`。任意だが、書くなら共有クロームの `on` と同じ形)。書けていなければ null。 */
function parseControl(item: YamlReader, reporter: SpecReporter): string | undefined | null {
  if (!item.has('control')) return undefined;
  const control = item.requiredString('control', 'control にログアウトの操作の名前(共有クロームの navigations の on。例: signed_out)を書く');
  if (control === null) return null;
  if (!/^[a-z][a-z0-9_]*$/.test(control)) {
    reporter.error(item.pointer('control'), `logout の control ${control} がスネークケースではありません`, 'クロームの navigations の on と同じ、ドットを含まないスネークケースに直す', { control });
    return null;
  }
  return control;
}

/** 認証の口の宣言(どれも任意。帰り道があるなら開始とログアウトも要る)。 */
export interface AuthEntries {
  readonly callback?: AuthCallbackDecl;
  readonly start?: AuthCallbackDecl;
  readonly logout?: AuthCallbackDecl;
}

/**
 * `callback` / `start` / `logout` を読み、帰り道があるのに開始かログアウトの口が無ければ H0 の違反にする。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @returns 読めた口の宣言
 */
export function parseAuthEntries(root: YamlReader, reporter: SpecReporter): AuthEntries {
  const callback = parseEntry(root, 'callback', reporter);
  const start = parseEntry(root, 'start', reporter);
  const logout = parseEntry(root, 'logout', reporter);
  if (root.has('callback')) {
    for (const key of ['start', 'logout'] as const) {
      if (root.has(key)) continue;
      reporter.error(
        key,
        `OAuth の帰り道(callback)があるのに、${ENTRY_WORDS[key]}の宣言(${key})がありません。セッションの cookie はスクリプトから読めないので、この口はサーバーに置きます`,
        `${key}: { endpoint: /api/auth/..., summary: ... } を書き、実装の木にその Route Handler を置く(server-only-session.md の案 A)`,
        { missing: key },
      );
    }
  }
  return {
    ...(callback === undefined ? {} : { callback }),
    ...(start === undefined ? {} : { start }),
    ...(logout === undefined ? {} : { logout }),
  };
}

