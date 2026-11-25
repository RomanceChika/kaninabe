/**
 * 通知・ジョブの層で必読に数える公理の単位(`semantics/reading-layers.ts`)のテスト。
 *
 * 数える単位は宣言 1 つ(通知 1 本・ジョブ 1 本・語彙の語 1 語)。章の上段の行と手引きのブロック表が同じ関数から数えるので、
 * ここで単位と、載せる公理の種類(読み方の表の鍵)を固定する。
 */

import { describe, expect, it } from 'vitest';
import { authUnits, configUnits, guaranteeUnits, jobUnits, notificationJobIds, notificationUnits, screenUnits } from '../../../lib/semantics/reading-layers.js';
import { readingClassOf } from '../../../lib/semantics/reading-class.js';
import { authBranch, authFlow, authGate, authLanding } from '../../helpers/auth-builder.js';
import { configCatalog, configVariable } from '../../helpers/config-builder.js';
import { guarantee, guaranteeCatalog } from '../../helpers/guarantee-builder.js';
import { jobCatalog, notScheduledJob, outboxJob, scheduledJob } from '../../helpers/job-builder.js';
import { notification, notificationCatalog } from '../../helpers/notification-builder.js';
import { screenSpec } from '../../helpers/screen-builder.js';

describe('notificationUnits', () => {
  const catalog = notificationCatalog([notification('notify_a'), notification('notify_b', { audience: 'member_dm' })]);

  it('通知 1 本 = 1 単位(宛先・メンション・何を知らせるかの 3 種類)。宛先の語・メンションの語は 1 語 1 単位', () => {
    const units = notificationUnits(catalog);

    expect(units.filter((unit) => unit.kind === 'declaration').map((unit) => unit.id)).toEqual(['notify_a', 'notify_b']);
    expect(units.filter((unit) => unit.kind === 'vocabulary').map((unit) => unit.id)).toEqual([
      'audience:staff_channel',
      'audience:member_dm',
      'mention:none',
    ]);
    expect(units).toHaveLength(5);
    expect(units[0]?.elements).toEqual(['notification.audience', 'notification.mention', 'notification.summary']);
    expect(units[2]?.elements).toEqual(['notification.audience']);
    expect(units.at(-1)?.elements).toEqual(['notification.mention']);
  });

  it('経路(medium)の語は数えない。単位はカタログの仕様ファイルに数える', () => {
    const units = notificationUnits(catalog);

    expect(units.some((unit) => unit.id.startsWith('medium:'))).toBe(false);
    expect(new Set(units.map((unit) => unit.file))).toEqual(new Set(['docs/specs/backend/notifications.md']));
  });

  it('カタログが読めていなければ空', () => {
    expect(notificationUnits(null)).toEqual([]);
  });

  it('載せる種類は、どれも公理(読み方の表が決める)', () => {
    for (const unit of notificationUnits(catalog)) for (const element of unit.elements) expect(readingClassOf(element)).toBe('axiom');
  });
});

describe('jobUnits', () => {
  const catalog = jobCatalog([
    outboxJob('queued'),
    scheduledJob('timed', { dueFrom: 'workshop.entry_deadline' }),
    scheduledJob('plain_timed'),
    notScheduledJob('later', '鍵が入るまで'),
  ]);

  it('ジョブ 1 本 = 1 単位。失敗したときの語は 1 語 1 単位。種別(kind)の語は数えない', () => {
    const units = jobUnits(catalog);

    expect(units.filter((unit) => unit.kind === 'declaration').map((unit) => unit.id)).toEqual(['queued', 'timed', 'plain_timed', 'later']);
    expect(units.filter((unit) => unit.kind === 'vocabulary').map((unit) => unit.id)).toEqual([
      'on_failure:retry_then_dead_letter',
      'on_failure:skip_and_next_run',
    ]);
    expect(units.some((unit) => unit.id.startsWith('kind:'))).toBe(false);
  });

  it('時刻で起きるジョブだけが「いつ」を載せ、基準の時刻は宣言があるときだけ載せる', () => {
    const byId = new Map(jobUnits(catalog).map((unit) => [unit.id, unit.elements] as const));

    expect(byId.get('queued')).toEqual(['job.summary', 'job.on_failure']);
    expect(byId.get('timed')).toEqual(['job.schedule', 'job.due_from', 'job.summary', 'job.on_failure']);
    expect(byId.get('plain_timed')).toEqual(['job.schedule', 'job.summary', 'job.on_failure']);
    expect(byId.get('later')).toEqual(['job.schedule', 'job.summary', 'job.on_failure']);
  });

  it('カタログが読めていなければ空', () => {
    expect(jobUnits(null)).toEqual([]);
  });

  describe('通知を送るジョブ(通知カタログに同じ ID があるジョブ)は、通知の導出なので公理に数えない', () => {
    const notifications = notificationCatalog([notification('notify_a'), notification('notify_b')]);
    const mixed = jobCatalog([outboxJob('notify_a'), outboxJob('notify_b'), outboxJob('queued'), scheduledJob('timed')]);

    it('同じ ID のジョブは単位から外れ、そのほかと失敗したときの語は残る。通知カタログを渡さなければ全部数える', () => {
      const ids = (units: ReturnType<typeof jobUnits>): string[] => units.filter((unit) => unit.kind === 'declaration').map((unit) => unit.id);

      expect(ids(jobUnits(mixed, notifications))).toEqual(['queued', 'timed']);
      expect(jobUnits(mixed, notifications).filter((unit) => unit.kind === 'vocabulary')).toHaveLength(2);
      expect(ids(jobUnits(mixed, null))).toEqual(['notify_a', 'notify_b', 'queued', 'timed']);
      expect(ids(jobUnits(mixed))).toEqual(['notify_a', 'notify_b', 'queued', 'timed']);
    });

    it('通知を送るジョブの ID: 時刻で起きるジョブ(走査)は、通知と同じ ID でも自分の「いつ」を宣言するので含めない。読めていなければ空', () => {
      const clash = jobCatalog([outboxJob('notify_a'), scheduledJob('notify_b')]);

      expect([...notificationJobIds(clash, notifications)]).toEqual(['notify_a']);
      expect(notificationJobIds(null, notifications).size).toBe(0);
      expect(notificationJobIds(mixed, null).size).toBe(0);
    });
  });
});

describe('screenUnits', () => {
  it('画面 1 枚 = 1 単位。部品の宣言は別の単位にしない。共有クロームは単位にしない', () => {
    const screens = [
      screenSpec({
        name: 'a',
        reads: ['query-a'],
        slots: [{ slot: 'body.center', components: [{ name: 't', kind: 'table', reads: 'query-a' }, 'free'] }],
      }),
      screenSpec({ name: 'b' }),
    ];
    const units = screenUnits(screens);

    expect(units.map((unit) => unit.id)).toEqual(['a', 'b']);
    expect(new Set(units.map((unit) => unit.kind))).toEqual(new Set(['declaration']));
    expect(units[0]?.file).toBe(screens[0]?.location.file);
  });

  it('誰が見るかは全画面が持ち、入場条件・読むもの・束ねる操作(重ね表示の分を含む)・部品の宣言は、あるときだけ載せる', () => {
    const [full, plain, overlayOnly] = screenUnits([
      screenSpec({
        name: 'full',
        precondition: 'state == accepting',
        subject: 'workshop',
        onFail: 'screen-x',
        reads: ['query-a'],
        actions: ['workshop.publish'],
        slots: [{ slot: 'body.center', components: [{ name: 't', kind: 'table', reads: 'query-a' }] }],
      }),
      screenSpec({ name: 'plain', slots: [{ slot: 'body.center', components: ['free'] }] }),
      screenSpec({ name: 'overlay_only', overlays: [{ id: 'confirm', actions: ['workshop.update'] }] }),
    ]);

    expect(full?.elements).toEqual(['screen.for', 'screen.precondition', 'screen.reads', 'screen.actions', 'screen.parts']);
    expect(plain?.elements).not.toContain('screen.variants');
    expect(plain?.elements).toEqual(['screen.for']);
    expect(overlayOnly?.elements).toEqual(['screen.for', 'screen.actions']);
  });

  it('排他表示(variants)を持つ画面だけが `screen.variants` を載せる。画面の数(単位)は増えない', () => {
    const [withVariants, without] = screenUnits([
      screenSpec({
        name: 'v',
        slots: [{ slot: 'body.center', components: [{ name: 'a', variant: 'none' }, { name: 'b', variant: 'open' }] }],
      }),
      screenSpec({ name: 'w', slots: [{ slot: 'body.center', components: ['free'] }] }),
    ]);

    expect(withVariants?.elements).toEqual(['screen.for', 'screen.variants']);
    expect(without?.elements).toEqual(['screen.for']);
  });

  it('画面が無ければ空', () => {
    expect(screenUnits([])).toEqual([]);
  });
});

describe('authUnits', () => {
  const flow = authFlow({
    landings: [authLanding('active'), authLanding('guest')],
    branches: [authBranch('member_active'), authBranch('guest_wait', { lands: 'guest' }), authBranch('left', { lands: 'guest' })],
    gates: [authGate('session'), authGate('staff', { guards: 'role_gate', role: 'staff', onFail: 'not_found' })],
  });

  it('条件の軸(値と持つ行を直接宣言する軸)1 本・分岐 1 行・着地 1 つ・関門 1 つが 1 単位(宣言順)。主語の軸は数えない', () => {
    const units = authUnits(flow);

    expect(units.map((unit) => unit.id)).toEqual([
      'axis:invitation',
      'axis:guild',
      'axis:activate',
      'branch:member_active',
      'branch:guest_wait',
      'branch:left',
      'landing:active',
      'landing:guest',
      'gate:session',
      'gate:staff',
    ]);
    expect(units.some((unit) => unit.id === 'axis:member')).toBe(false);
    expect(new Set(units.map((unit) => unit.kind))).toEqual(new Set(['declaration']));
    expect(new Set(units.map((unit) => unit.file))).toEqual(new Set(['docs/specs/backend/auth.md']));
  });

  it('載せる種類は、条件の軸・分岐・着地・関門の順に 1 つずつで、どれも公理', () => {
    const byId = new Map(authUnits(flow).map((unit) => [unit.id, unit.elements] as const));

    expect(byId.get('axis:guild')).toEqual(['auth.condition']);
    expect(byId.get('branch:left')).toEqual(['auth.branch']);
    expect(byId.get('landing:guest')).toEqual(['auth.landing']);
    expect(byId.get('gate:staff')).toEqual(['auth.gate']);
    for (const unit of authUnits(flow)) for (const element of unit.elements) expect(readingClassOf(element)).toBe('axiom');
  });

  it('同じ ID の分岐と着地があっても、前置きが違うので単位が混ざらない', () => {
    const clash = authFlow({ landings: [authLanding('active')], branches: [authBranch('active')] });

    const ids = authUnits(clash).map((unit) => unit.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['branch:active', 'landing:active']));
  });

  it('仕様が読めていなければ空', () => {
    expect(authUnits(null)).toEqual([]);
  });
});

describe('configUnits', () => {
  const catalog = configCatalog([configVariable('API_KEY'), configVariable('MODE', { kind: 'switch', requirement: 'tooling_only', targets: [] })]);

  it('設定 1 本が 1 単位(意味と無いときの挙動をまとめて)。値の性質の語・要求度の語は 1 語 1 単位。連携・調達・置き場の語は数えない', () => {
    const units = configUnits(catalog);

    expect(units.filter((unit) => unit.kind === 'declaration').map((unit) => unit.id)).toEqual(['API_KEY', 'MODE']);
    expect(units.filter((unit) => unit.kind === 'vocabulary').map((unit) => unit.id)).toEqual([
      'kind:secret',
      'kind:endpoint',
      'kind:switch',
      'requirement:required',
      'requirement:optional_degrades',
      'requirement:tooling_only',
    ]);
    for (const axis of ['used_by:', 'provision:', 'target:']) expect(units.some((unit) => unit.id.startsWith(axis)), axis).toBe(false);
  });

  it('載せる種類: 設定は意味と無いときの挙動、語は値の性質か要求度。値は単位のどこにも持たない', () => {
    const byId = new Map(configUnits(catalog).map((unit) => [unit.id, unit.elements] as const));

    expect(byId.get('API_KEY')).toEqual(['config.summary', 'config.absence']);
    expect(byId.get('kind:secret')).toEqual(['config.kind']);
    expect(byId.get('requirement:required')).toEqual(['config.requirement']);
    expect(JSON.stringify(configUnits(catalog))).not.toContain('=');
  });

  it('カタログが読めていなければ空', () => {
    expect(configUnits(null)).toEqual([]);
  });
});

describe('guaranteeUnits', () => {
  it('保証 1 本が 1 単位。執行者の語・見張りテストは数えない', () => {
    const catalog = guaranteeCatalog([guarantee('a'), guarantee('b', { status: 'planned' })]);
    const units = guaranteeUnits(catalog);

    expect(units.map((unit) => unit.id)).toEqual(['a', 'b']);
    expect(units[0]?.elements).toEqual(['guarantee.statement']);
    expect(units).toHaveLength(2);
  });

  it('台帳が読めていなければ空', () => {
    expect(guaranteeUnits(null)).toEqual([]);
  });
});
