/**
 * 生成物の字面: `mfa: { delegated }` が仕様書の本文(auth-body)に
 * 「IdP に任せている(受け入れた危険)」と理由つきで出ること。exempt・要求の字面は変わらないこと(対照)。
 */

import { describe, expect, it } from 'vitest';
import { authBodyGenerator } from '../../../../lib/generate/render/auth-body.js';
import type { AuthMfaDecl } from '../../../../lib/model/auth/mfa.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { loc } from '../../../helpers/model-builder.js';
import { authModel } from '../../../helpers/auth-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

const DELEGATED: AuthMfaDecl = { kind: 'delegated', provider: 'discord', evidence: 'none', reason: 'Discord に任せる', location: loc('docs/specs/backend/auth.md', 'mfa') };
const EXEMPT: AuthMfaDecl = { kind: 'exempt', reason: '敷居を上げない', location: loc('docs/specs/backend/auth.md', 'mfa') };

function body(mfa: AuthMfaDecl): string {
  const auth = authModel({ mfa, providers: ['discord'] });
  const ctx = { guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, auth, screens: { available: true, screens: [], chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] } };
  return authBodyGenerator.generate(specModel([]), ctx)[0]?.content ?? '';
}

describe('mfa.delegated の字面', () => {
  it('仕様書の本文: 任せ先・根拠なし・理由が表に出て、exempt の文言は混ざらない', () => {
    const content = body(DELEGATED);

    expect(content).toContain('| IdP に任せている(受け入れた危険) | `discord` | なし | Discord に任せる |');
    expect(content).not.toContain('外している(受け入れた危険)');
    expect(body(EXEMPT)).toContain('外している(受け入れた危険)');
  });
});
