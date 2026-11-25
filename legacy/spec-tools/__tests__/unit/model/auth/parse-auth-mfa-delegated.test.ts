/**
 * H0(auth_spec のスキーマ適合)のうち、`mfa: { delegated: … }`(IdP に任せる)の読み取りのテスト。
 *
 * 規約網羅:
 *   - 正例: provider / evidence: none / reason を読む(位置つき)
 *   - 負例: 理由が空・空白・欠落 / provider の欠落・空 / evidence の欠落 / 知らない evidence
 *   - 未対応の根拠(workspace_domain・amr)は理由つきで止める(黙って保証扱いにしない)
 *   - delegated と exempt・要求の欄は混ぜられない / delegated の形・知らない鍵
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseAuthFlow } from '../../../../lib/model/auth/parse-auth.js';
import type { AuthFlowSpec } from '../../../../lib/model/auth/types.js';

/** 最小の正しいフロントマター(mfa は差し替える)。 */
function base(mfa: unknown): Record<string, unknown> {
  return {
    doc_type: 'auth_spec',
    id: 'auth-flow',
    subject: 'membership',
    providers: ['oauth_a'],
    sessions: { inactivity: '8h', absolute: '24h', reason: '確かめた理由', concurrent: { unbounded: '既定のまま' } },
    idp_session: { logout: 'keeps_idp', idp_ends: 'app_continues', lifetime: 'independent', reason: '確かめた理由' },
    mfa,
    axes: [{ id: 'member', kind: 'state', summary: 'メンバー行の状態', of: 'membership', absent: 'none' }],
    landings: [{ id: 'active', screen: 'screen-home', summary: '通常の入口へ' }],
    sign_in: [{ id: 'member_active', member: 'active', lands: 'active', summary: '通す' }],
    gates: [],
    test_cases: [{ id: 'TC-AUTH-SIGNIN-001', type: 'unit', covers: ['success'], spec_ids: ['auth-flow'], implementation: 'legacy/spec-tools/__tests__/unit/model/auth/parse-auth-mfa-delegated.test.ts::x' }],
  };
}

function parse(mfa: unknown): { value: AuthFlowSpec | null; messages: readonly string[] } {
  const reporter = new SpecReporter('docs/specs/backend/auth.md');
  const result = parseAuthFlow(base(mfa), reporter);
  return { value: result.value, messages: result.findings.map((finding) => finding.message) };
}

const OK = { provider: 'oauth_a', evidence: 'none', reason: 'IdP に任せる' };

describe('H0: mfa.delegated(IdP に任せる)の読み取り', () => {
  it('正例: provider / evidence / reason を位置つきで読む', () => {
    const { value, messages } = parse({ delegated: OK });

    expect(messages).toEqual([]);
    expect(value?.mfa).toEqual({ kind: 'delegated', provider: 'oauth_a', evidence: 'none', reason: 'IdP に任せる', location: { file: 'docs/specs/backend/auth.md', pointer: 'mfa' } });
  });

  it('負例: 理由が空・空白だけ・無ければエラー(理由の無い「任せる」は免除の穴になる)', () => {
    for (const reason of ['', '  ', null]) {
      const { value, messages } = parse({ delegated: { ...OK, reason } });
      expect(messages.length, String(reason)).toBeGreaterThan(0);
      expect(value?.mfa, String(reason)).toBeUndefined();
    }
  });

  it('負例: provider / evidence が無い・provider が空ならエラー', () => {
    for (const key of ['provider', 'evidence'] as const) {
      const partial: Record<string, string> = { ...OK };
      delete partial[key];
      const { value, messages } = parse({ delegated: partial });
      expect(messages.some((message) => message.includes(`${key} がありません`)), key).toBe(true);
      expect(value?.mfa).toBeUndefined();
    }
    const empty = parse({ delegated: { ...OK, provider: '  ' } });
    expect(empty.messages.some((message) => message.includes('provider が空です'))).toBe(true);
    expect(empty.value?.mfa).toBeUndefined();
  });

  it('未対応の根拠(workspace_domain・amr)は、理由つきで止める(保証扱いにしない)', () => {
    const domain = parse({ delegated: { ...OK, evidence: 'workspace_domain', domains: ['example.com'] } });
    expect(domain.messages.some((message) => message.includes('workspace_domain') && message.includes('未対応'))).toBe(true);
    expect(domain.value?.mfa).toBeUndefined();

    const amr = parse({ delegated: { ...OK, evidence: 'amr' } });
    expect(amr.messages.some((message) => message.includes('amr') && message.includes('未対応'))).toBe(true);
    expect(amr.value?.mfa).toBeUndefined();
  });

  it('負例: 知らない根拠はエラー', () => {
    const { value, messages } = parse({ delegated: { ...OK, evidence: 'trust_me' } });
    expect(messages.some((message) => message.includes('evidence trust_me は書けません'))).toBe(true);
    expect(value?.mfa).toBeUndefined();
  });

  it('負例: delegated は exempt・要求の欄と混ぜられない・マッピング以外・知らない鍵はエラー', () => {
    expect(parse({ delegated: OK, exempt: '理由' }).messages.some((message) => message.includes('delegated は書けません'))).toBe(true);
    expect(parse({ delegated: OK, to: 'screen-mfa' }).messages.some((message) => message.includes('to は書けません'))).toBe(true);
    expect(parse({ delegated: 'discord' }).messages.some((message) => message.includes('mfa.delegated はマッピングで書きます'))).toBe(true);
    expect(parse({ delegated: { ...OK, extra: 1 } }).messages.some((message) => message.includes('extra は書けません'))).toBe(true);
  });
});
