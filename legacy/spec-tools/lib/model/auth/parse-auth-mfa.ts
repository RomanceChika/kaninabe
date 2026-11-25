/**
 * auth_spec の `mfa`(多要素認証の要求)の読み取り。
 *
 * parse-auth.ts が呼ぶ下位の部品。責務は 1 ファイルの中で閉じる形に限る —— 欄が必須であること・マッピングであること・
 * 外す宣言(`exempt`)・IdP に任せる宣言(`delegated`)と要求の欄が混ざらないこと・外す理由が空でないこと・要求なら送り先・実装・説明が揃うこと・
 * 範囲(`require`)が `all` か `{ roles: [...] }` であること。送り先の画面の実在・ロールの実在・外す宣言の警告は H6、
 * 設定で要素を有効にしているかは H5 が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { AuthMfaDecl, MfaScope } from './mfa.js';
import { UNSUPPORTED_DELEGATION_EVIDENCE } from './mfa.js';

/** 要求するときに書けるキー。 */
const REQUIRE_KEYS: readonly string[] = ['require', 'to', 'implementation', 'summary'];

/** `mfa` の書き方の案内。 */
const MFA_SUGGESTION =
  'mfa を書く。既定は全員に要求する —— 要求するなら "to(多要素認証を済ませていない人を送る画面)/ implementation(入場のたびに確かめる関数)/ summary" を書き、' +
  'ロールを絞るなら require: { roles: [...] } を足す。外部の IdP でログインする製品は mfa: { delegated: { provider, evidence: none, reason } } で IdP に任せるのが既定(アプリ側の 2 つ目の要素は厳しくしたい製品のオプトイン)。' +
  '外すなら mfa: { exempt: 理由 } と理由を書く(どちらも verify が毎回「受け入れた危険」として名指す)';

/** `delegated` に書けるキー。 */
const DELEGATED_KEYS: readonly string[] = ['provider', 'evidence', 'reason'];

/** 外す宣言を読む。 */
function readExempt(item: YamlReader, reporter: SpecReporter): AuthMfaDecl | undefined {
  item.rejectUnknownKeys(['exempt'], 'mfa(外す宣言)', 'exempt と要求の欄(require / to / implementation / summary)は同時に書けない。外すなら exempt だけを書く');
  const reason = item.requiredString('exempt', 'exempt に外す理由を書く');
  if (reason === null) return undefined;
  if (reason.trim() === '') {
    reporter.error(item.pointer('exempt'), 'mfa.exempt の理由が空です', 'exempt に外す理由を書く(理由の無い「外す」は、なぜ 1 要素のログインで足りるのかを誰も確かめられない免除になる)');
    return undefined;
  }
  return { kind: 'exempt', reason, location: reporter.location('mfa') };
}

/** IdP に任せる宣言(`delegated`)を読む。 */
function readDelegated(item: YamlReader, reporter: SpecReporter): AuthMfaDecl | undefined {
  item.rejectUnknownKeys(['delegated'], 'mfa(IdP に任せる宣言)', 'delegated と、要求の欄(require / to / implementation / summary)・exempt は同時に書けない。任せるなら delegated だけを書く');
  const record = asRecord(item.raw('delegated'));
  const suggestion = `delegated は { ${DELEGATED_KEYS.join(', ')} } のマッピングで書く(evidence は none = 根拠なしで任せる。verify が毎回「受け入れた危険」として名指す)`;
  if (record === null) {
    reporter.error(item.pointer('delegated'), 'mfa.delegated はマッピングで書きます', suggestion);
    return undefined;
  }
  const delegated = new YamlReader(record, item.pointer('delegated'), reporter);
  delegated.rejectUnknownKeys(DELEGATED_KEYS, 'mfa.delegated', suggestion);
  const provider = delegated.requiredString('provider', 'provider に任せる IdP を書く(providers に書いた外部の IdP)');
  const evidence = delegated.requiredString('evidence', 'evidence に任せる根拠を書く。いまは none(根拠なしで任せる)だけ');
  const reason = delegated.requiredString('reason', 'reason に IdP に任せてよい理由を書く');
  if (provider === null || evidence === null || reason === null) return undefined;
  let ok = true;
  if (provider.trim() === '') {
    reporter.error(delegated.pointer('provider'), 'mfa.delegated.provider が空です', 'provider に任せる IdP を書く');
    ok = false;
  }
  const unsupported = UNSUPPORTED_DELEGATION_EVIDENCE[evidence];
  if (unsupported !== undefined) {
    reporter.error(delegated.pointer('evidence'), `mfa.delegated.evidence: ${unsupported}`, 'evidence: none(根拠なしで任せる。verify が毎回「受け入れた危険」として名指す)で書くか、アプリ側の 2 つ目の要素(require)で要求する');
    ok = false;
  } else if (evidence !== 'none') {
    reporter.error(delegated.pointer('evidence'), `mfa.delegated.evidence ${evidence} は書けません`, '書けるのは none(根拠なしで任せる)だけ');
    ok = false;
  }
  if (reason.trim() === '') {
    reporter.error(delegated.pointer('reason'), 'mfa.delegated.reason が空です', 'reason に IdP に任せてよい理由を書く(理由の無い「任せる」は、なぜ IdP の認証で足りるのかを誰も確かめられない免除になる)');
    ok = false;
  }
  if (!ok) return undefined;
  return { kind: 'delegated', provider, evidence: 'none', reason, location: reporter.location('mfa') };
}

/** 要求の範囲(`require`)を読む。書かなければ全員。 */
function readScope(item: YamlReader, reporter: SpecReporter): MfaScope | null {
  if (!item.has('require')) return { kind: 'all' };
  const raw = item.raw('require');
  if (raw === 'all') return { kind: 'all' };
  const record = asRecord(raw);
  const suggestion = 'require は all か { roles: [ロール ID, …] } で書く(書かなければ all)';
  if (record === null) {
    reporter.error(item.pointer('require'), 'mfa.require は all か roles のマッピングで書きます', suggestion);
    return null;
  }
  const scope = new YamlReader(record, item.pointer('require'), reporter);
  scope.rejectUnknownKeys(['roles'], 'mfa.require', suggestion);
  const roles = scope.requiredStringList('roles', suggestion, false);
  if (roles === null) return null;
  return { kind: 'roles', roles };
}

/**
 * `mfa`(必須)を読む。読めなければ違反を記録して undefined(宣言を落としたものとして数える)。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 */
export function parseMfa(root: YamlReader, reporter: SpecReporter): AuthMfaDecl | undefined {
  const drop = (): undefined => {
    reporter.dropRows();
    return undefined;
  };
  if (!root.has('mfa')) {
    reporter.error(root.pointer('mfa'), 'mfa(多要素認証)がありません。既定は全員に要求しますが、多要素認証を済ませていない人の送り先がありません', MFA_SUGGESTION);
    return drop();
  }
  const record = asRecord(root.raw('mfa'));
  if (record === null) {
    reporter.error(root.pointer('mfa'), 'mfa はマッピングで書きます', MFA_SUGGESTION);
    return drop();
  }
  const item = new YamlReader(record, root.pointer('mfa'), reporter);
  if (item.has('exempt')) return readExempt(item, reporter) ?? drop();
  if (item.has('delegated')) return readDelegated(item, reporter) ?? drop();
  item.rejectUnknownKeys(REQUIRE_KEYS, 'mfa', `書けるのは ${REQUIRE_KEYS.join(' / ')}(外すなら exempt だけ・IdP に任せるなら delegated だけ)`);
  const scope = readScope(item, reporter);
  const to = item.requiredString('to', 'to に多要素認証を済ませていない人を送る画面の screen_spec の id を書く(要素の登録・確認の画面)');
  const implementation = item.requiredString('implementation', 'implementation に入場のたびに多要素認証を確かめる関数を "パス::関数名" で書く');
  const summary = item.requiredString('summary', 'summary にどういう要求かを 1 行で書く');
  if (scope === null || to === null || implementation === null || summary === null) return drop();
  return { kind: 'require', scope, to, implementation, summary, location: reporter.location('mfa') };
}
