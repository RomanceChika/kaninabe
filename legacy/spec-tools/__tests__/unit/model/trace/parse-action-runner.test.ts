/**
 * action_spec の `runner: {kind: manual}`(実行器の選び方)が、ジョブの `scheduler`(鳴る場所)の改名に
 * 巻き込まれないことの固定。`runner` というキーは 2 つの別の意味を持つ —— 操作の実行器(ここ)と、
 * かつてのジョブの鳴る場所(廃止。`lib/model/job/parse-schedule.ts` が名指しで落とす)。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { YamlReader } from '../../../../lib/model/yaml-reader.js';
import { parseRunner } from '../../../../lib/model/trace/parse-action-plan.js';

/** action_spec の frontmatter 相当を読んで、`runner` の読み取りと違反を返す。 */
function read(data: Readonly<Record<string, unknown>>) {
  const reporter = new SpecReporter('docs/specs/backend/actions/example.action_spec.md');
  const runner = parseRunner(new YamlReader(data, '', reporter), reporter);
  return { runner, findings: reporter.findings() };
}

describe('action_spec の runner は scheduler の改名の影響を受けない', () => {
  it('runner: {kind: manual, reason} は従来どおり読める', () => {
    const { runner, findings } = read({ runner: { kind: 'manual', reason: '外部の署名検証を挟むため' } });

    expect(findings).toEqual([]);
    expect(runner?.kind).toBe('manual');
    expect(runner?.reason).toBe('外部の署名検証を挟むため');
  });

  it('ジョブの旧い値(vercel_cron / pg_cron)は操作の実行器の値域にも無い(別の軸)', () => {
    const { runner, findings } = read({ runner: { kind: 'pg_cron', reason: 'x' } });

    expect(runner).toBeUndefined();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).not.toContain('scheduler');
  });
});
