import { describe, expect, it } from 'vitest';
import { unverifiedNotesOf } from '../../../../lib/job/target-unverified.js';
import { jobTargetsOf, selectTargetSet } from '../../../../lib/target-api/contract.js';
import type { Target } from '../../../../lib/target-api/contract.js';
import { describeTargetUnverified, isCheckRunNote } from '../../../../lib/verify/check-run-report.js';
import { NO_ABUSE_EXPOSURE } from '../../../../lib/model/external/abuse-exposure.js';
import type { AbuseExposure } from '../../../../lib/model/external/abuse-exposure.js';
import { IP_RATE_LIMIT_UNVERIFIED } from '../../../../lib/targets/vercel/ip-rate-limit.js';
import { VERCEL_TARGET } from '../../../../lib/targets/vercel/target.js';
import { runRisk } from '../../../../lib/verify/risk-group.js';
import type { RiskInputs } from '../../../../lib/risk/run.js';
import { NO_JOB_TARGETS } from '../../../../lib/job/target-checks.js';
import { catalogInput } from '../../../../lib/kernel/input-state.js';
import { accessSpec, aggregate, create, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';

/**
 * ホスト(Vercel)の「IP 単位の流量制限は見えていない」の名指し。濫用の口(未ログインの作成・有料の口)があるときだけ出る。
 * 名指しは未実施の行で、違反(error / warning)ではない。
 */

const CASES: readonly { readonly title: string; readonly exposure: AbuseExposure; readonly appears: boolean }[] = [
  { title: '濫用の口が無ければ名指さない', exposure: NO_ABUSE_EXPOSURE, appears: false },
  { title: '未ログインの作成だけでも名指す', exposure: { anonymousCreates: ['inquiry'], paidEndpoints: [] }, appears: true },
  { title: '有料の口だけでも名指す', exposure: { anonymousCreates: [], paidEndpoints: ['anthropic_chat'] }, appears: true },
  { title: '両方あれば名指す', exposure: { anonymousCreates: ['inquiry'], paidEndpoints: ['anthropic_chat'] }, appears: true },
];

describe('IP_RATE_LIMIT_UNVERIFIED: いつ出るか', () => {
  for (const { title, exposure, appears } of CASES) {
    it(title, () => {
      expect(IP_RATE_LIMIT_UNVERIFIED.note(exposure) !== null).toBe(appears);
    });
  }

  it('文は、見えていない・未検証であること・設定の置き場(vercel.json に書けない / ダッシュボード・SDK・CLI)・リージョンごとのカウンターと、対象の名前を言う', () => {
    const text = IP_RATE_LIMIT_UNVERIFIED.note({ anonymousCreates: ['inquiry'], paidEndpoints: ['anthropic_chat'] }) ?? '';
    for (const word of ['IP 単位の流量制限', '未検証', 'vercel.json には書けず', 'ダッシュボード', '@vercel/firewall', 'CLI', 'リージョンごと', 'inquiry', 'anthropic_chat']) {
      expect(text, word).toContain(word);
    }
  });
});

describe('名指しの行', () => {
  const exposure: AbuseExposure = { anonymousCreates: ['inquiry'], paidEndpoints: [] };

  it('ホストの後段 vercel が登録し、集められる。濫用の口が無ければ空', () => {
    const registry = jobTargetsOf([VERCEL_TARGET]);
    expect(unverifiedNotesOf(registry.targets, exposure).map((note) => [note.target, note.role])).toEqual([['vercel', 'host']]);
    expect(unverifiedNotesOf(registry.targets, NO_ABUSE_EXPOSURE)).toEqual([]);
  });

  it('未登録の後段(unverified を持たない)は何も名指さない', () => {
    expect(unverifiedNotesOf([{ id: 'other', role: 'host', notApplicable: {} }], exposure)).toEqual([]);
  });

  it('行は「R5: 未実施 — …」で、範囲サマリの件数に入る(H5 と同じ語)。違反ではないので Finding を作らない', () => {
    const [note] = unverifiedNotesOf(jobTargetsOf([VERCEL_TARGET]).targets, exposure);
    const line = note === undefined ? '' : describeTargetUnverified('R5', note);
    expect(line.startsWith('R5: 未実施 — ホストの後段 vercel の範囲: IP 単位の流量制限')).toBe(true);
    expect(line.endsWith('。')).toBe(true);
    expect(isCheckRunNote(line)).toBe(true);
  });
});

describe('契約: unverified', () => {
  const tweak = (unverified: Target['unverified']): Target => ({ ...VERCEL_TARGET, ...(unverified === undefined ? {} : { unverified }) });
  const dummy = (id: string) => ({ id, note: () => null });
  const select = (target: Target) => selectTargetSet([target], { app: null, generated: 'generated' } as never, new Set());

  it('空の名前・重なった名前は契約違反。ほかのホストは unverified を持たなくてよい', () => {
    const problems = (target: Target): readonly string[] => {
      const result = select(target);
      return result.ok ? [] : result.problems.filter((problem) => problem.includes('未検証の名指し'));
    };
    expect(problems(tweak([dummy('')]))).toHaveLength(1);
    expect(problems(tweak([dummy('a'), dummy('a')]))).toHaveLength(1);
    expect(problems(tweak([dummy('a'), dummy('b')]))).toEqual([]);
    expect(problems(tweak(undefined))).toEqual([]);
  });
});

describe('実行口: runRisk', () => {
  const FIELDS = [field('id', { kind: 'uuid' }, { auto: true }), field('created_at', { kind: 'datetime' }, { auto: true })];
  const modelWith = (by: readonly string[]) =>
    specModel([
      aggregate('inquiry', {
        entity: entitySpec('inquiry', { fields: FIELDS }),
        access: accessSpec('inquiry', { creates: by.map((who) => ({ ...create(who), abuse: { globalCeiling: { max: 30, per: '1 hour' }, location: { file: 'a.md', pointer: 'p' } } })), writes: [], deletes: [] }),
      }),
    ]);
  const inputsOf = (model: ReturnType<typeof modelWith>, external: RiskInputs['external'] = catalogInput('unselected')): RiskInputs => ({
    model,
    actions: catalogInput('unselected'),
    dataTables: catalogInput('unselected'),
    auth: catalogInput('unselected'),
    external,
    config: catalogInput('unselected'),
    jobs: catalogInput('unselected'),
    richText: { available: false, sites: [] },
    screenRoutes: null,
  });
  const linesOf = (inputs: RiskInputs, targets = jobTargetsOf([VERCEL_TARGET])): string[] => {
    const lines: string[] = [];
    runRisk(inputs, (line) => lines.push(line), targets);
    return lines.filter((line) => line.startsWith('R5:'));
  };

  it('未ログインの作成があれば 1 行出る(違反は 0 件のまま。後段が無ければ出ない)', () => {
    const inputs = inputsOf(modelWith(['anonymous']));
    expect(linesOf(inputs)).toHaveLength(1);
    expect(linesOf(inputs)[0]).toContain('inquiry');
    expect(linesOf(inputs, NO_JOB_TARGETS)).toEqual([]);
    expect(runRisk(inputs, () => undefined, jobTargetsOf([VERCEL_TARGET]))).toEqual([]);
  });

  it('有料の口があれば出る。どちらも無ければ出ない', () => {
    const paid: RiskInputs['external'] = { state: 'loaded', value: externalCatalog([integration('chat', { spend: 'paid', endpoints: ['/api/ai/x'] })]), findings: [] };
    expect(linesOf(inputsOf(modelWith([]), paid))).toHaveLength(1);
    expect(linesOf(inputsOf(modelWith([])))).toEqual([]);
    expect(linesOf(inputsOf(modelWith(['member'])))).toEqual([]);
  });
});
