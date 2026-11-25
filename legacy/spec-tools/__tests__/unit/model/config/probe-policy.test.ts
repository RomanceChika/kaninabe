/**
 * `probe` の閉じた許可表(3 回目の点検 C-2 / C-5)のテスト。
 *
 * `kind: command` は宣言した argv をそのまま実行する。仕様の 1 行を変える PR で任意のコマンドが走らないよう、
 * argv の形と位置を表で縛る。ここでは (1) 判定の表(正例と負例)、(2) 検証器(`parseConfigCatalog`)がエラーにすること、
 * 実行器の写し(製品の実行器の `probe-guard.ts`)との一致は `dev-repo/unit/model/config/probe-guard-parity.test.ts` が見る(製品の実装の木を読むので配布の木では回さない)。
 */

import { describe, expect, it } from 'vitest';
import { ARGV_ACCEPTED, ARGV_REFUSED, CWD_ACCEPTED, CWD_REFUSED, PATHS_ACCEPTED, PATHS_REFUSED } from '../../../helpers/probe-cases.js';
import { parseConfigCatalog } from '../../../../lib/model/config/parse-config.js';
import { commandCwdProblem, commandProbeProblem, rootRelativePathProblem } from '../../../../lib/model/config/probe-policy.js';
import { SpecReporter } from '../../../../lib/model/parse-common.js';

describe('commandProbeProblem(argv の許可表)', () => {
  it.each(ARGV_ACCEPTED)('許可: %j', (...argv) => {
    expect(commandProbeProblem(argv)).toBeNull();
  });

  it.each(ARGV_REFUSED)('拒否: %s', (_name, argv) => {
    expect(commandProbeProblem(argv)).not.toBeNull();
  });
});

describe('commandCwdProblem(cwd の閉じた表。4 回目 C4-3)', () => {
  it.each(CWD_ACCEPTED)('許可: %s', (value) => {
    expect(commandCwdProblem(value)).toBeNull();
  });

  it.each(CWD_REFUSED)('拒否: %s', (_name, value) => {
    expect(commandCwdProblem(value)).not.toBeNull();
  });
});

describe('rootRelativePathProblem(cwd / dotenv.path の綴り)', () => {
  it.each(PATHS_ACCEPTED)('許可: %s', (value) => {
    expect(rootRelativePathProblem(value)).toBeNull();
  });

  it.each(PATHS_REFUSED)('拒否: %s', (_name, value) => {
    expect(rootRelativePathProblem(value)).not.toBeNull();
  });
});

/** 最小の語彙(置き場の probe だけを差し替える)。 */
function catalogWith(probe: unknown): Record<string, unknown> {
  return {
    doc_type: 'config_spec',
    scope: 'backend',
    id: 'config-catalog',
    vocabulary: {
      kind: [{ id: 'secret' }],
      requirement: [{ id: 'required', default_targets: ['t'] }],
      used_by: [{ id: 'svc' }],
      provision: [{ id: 'prompt' }],
      target: [{ id: 't', probe }],
    },
    variables: [{ id: 'A_KEY', kind: 'secret', requirement: 'required', used_by: ['svc'], summary: 's', absence: 'a' }],
  };
}

function messagesFor(probe: unknown): string[] {
  const result = parseConfigCatalog(catalogWith(probe), new SpecReporter('spec.md'));
  return result.findings.map((finding) => finding.message);
}

describe('K0: 検証器は許可表の外の probe をエラーにする', () => {
  it('正例: 許可表の形と根の中の cwd は違反なし', () => {
    expect(messagesFor({ kind: 'command', argv: ['vercel', 'env', 'ls', 'production'], cwd: 'app' })).toEqual([]);
    expect(messagesFor({ kind: 'command', argv: ['vercel', 'env', 'ls', 'production'], cwd: '.' })).toEqual([]);
    expect(messagesFor({ kind: 'command', argv: ['vercel', 'env', 'ls', 'production'] })).toEqual([]);
    expect(messagesFor({ kind: 'dotenv', path: 'sub/.env.local' })).toEqual([]);
  });

  it.each(ARGV_REFUSED.filter(([, argv]) => argv.length > 0))('負例 argv: %s', (_name, argv) => {
    const messages = messagesFor({ kind: 'command', argv });
    expect(messages.some((message) => message.startsWith('probe.argv を実行できません'))).toBe(true);
  });

  it('cwd が根の外(C-5): ../.. と絶対パス', () => {
    for (const cwd of ['../..', '/', 'a/../../b']) {
      const messages = messagesFor({ kind: 'command', argv: ['gh', 'secret', 'list', '--json', 'name'], cwd });
      expect(messages.some((message) => message.startsWith('probe.cwd が安全な位置ではありません')), cwd).toBe(true);
    }
  });

  it.each(CWD_REFUSED.filter(([, cwd]) => cwd !== '' && rootRelativePathProblem(cwd) === null))('cwd が閉じた表の外(C4-3): %s', (_name, cwd) => {
    const messages = messagesFor({ kind: 'command', argv: ['vercel', 'env', 'ls', 'production'], cwd });
    expect(messages.some((message) => /^probe\.cwd が安全な位置ではありません: cwd .* は書ける位置の表/.test(message))).toBe(true);
  });

  it('dotenv.path が根の外(C-5)', () => {
    for (const value of ['../../.env', '/etc/passwd', '~/.env']) {
      const messages = messagesFor({ kind: 'dotenv', path: value });
      expect(messages.some((message) => message.startsWith('probe.path が安全な位置ではありません')), value).toBe(true);
    }
  });
});
