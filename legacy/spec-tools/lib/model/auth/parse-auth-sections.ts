/**
 * auth_spec の「寿命・多要素認証・IdP とのセッション・プラットフォーム操作」の節をまとめて読む。
 *
 * parse-auth.ts が呼ぶ下位の部品。読めなかった節は欠ける(違反は各パーサーが記録し、落とした宣言として数える)。
 * `platform_ops` だけが任意の節で、書かなければ欠ける(宣言の無い製品は何も変わらない)。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { AuthFlowSpec } from './types.js';
import { parseSessions } from './parse-auth-sessions.js';
import { parseMfa } from './parse-auth-mfa.js';
import { parseIdpSession } from './parse-auth-idp.js';
import { parsePlatformOps } from './parse-auth-platform-ops.js';

/** 読めた節(読めなかった・書かれていない節は欠ける)。 */
export type DeclaredSections = Pick<AuthFlowSpec, 'sessions' | 'mfa' | 'idpSession' | 'platformOps'>;

/**
 * `sessions` / `mfa` / `idp_session` / `platform_ops` を、この順に読む。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 * @returns 読めた節(spread して使える)
 */
export function parseDeclaredSections(root: YamlReader, reporter: SpecReporter): DeclaredSections {
  const sessions = parseSessions(root, reporter);
  const mfa = parseMfa(root, reporter);
  const idpSession = parseIdpSession(root, reporter);
  const platformOps = parsePlatformOps(root, reporter);
  return {
    ...(sessions === undefined ? {} : { sessions }),
    ...(mfa === undefined ? {} : { mfa }),
    ...(idpSession === undefined ? {} : { idpSession }),
    ...(platformOps === undefined ? {} : { platformOps }),
  };
}
