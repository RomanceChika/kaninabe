import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkEntityLabelUniqueness, loadSpecModel } from '../../../lib/model/loader.js';
import type { AggregateSpecs } from '../../../lib/model/types.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import { expectWellFormed, findByMessage } from './_helpers.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

function load(name: string) {
  return loadSpecModel(`${FIXTURES}${name}`, { repoRoot: FIXTURES });
}

function files(findings: readonly Finding[]): readonly string[] {
  return findings.map((finding) => finding.location.file);
}

describe('loadSpecModel（正常系）', () => {
  const result = load('domain-valid');

  it('違反ゼロでモデルを構築する', () => {
    expect(result.findings).toEqual([]);
    expect(result.model).not.toBeNull();
  });

  it('roles.md をドメイン直下から読む', () => {
    expect(result.model?.roles.roles.map((role) => role.id)).toEqual([
      'anonymous',
      'member',
      'system',
      'performer',
      'organizer',
    ]);
    expect(result.model?.roles.location.file).toBe('domain-valid/roles.md');
    expect(result.model?.roles.roles.find((role) => role.id === 'performer')?.label).toBe('発表者');
    expect(result.model?.roles.roles.find((role) => role.id === 'system')?.label).toBeUndefined();
  });

  it('状態とイベントの日本語ラベルを読む（省略した分はマップに載らない）', () => {
    const machine = result.model?.aggregates.get('entry')?.stateMachines[0];

    expect(machine?.stateLabels).toEqual({
      draft: '下書き',
      submitted: '提出済み',
      accepted: '受理',
      rejected: '却下',
      withdrawn: '取下げ',
    });
    expect(machine?.events.find((event) => event.id === 'submit')?.label).toBe('提出');
    expect(machine?.events.find((event) => event.id === 'withdraw')?.label).toBeUndefined();
    expect(result.model?.aggregates.get('workshop')?.stateMachines[1]?.stateLabels).toEqual({});
  });

  it('集約そのものの日本語名（entity_spec のトップレベル label）を読む', () => {
    expect(result.model?.aggregates.get('workshop')?.entity?.label).toBe('催し');
    expect(result.model?.aggregates.get('entry')?.entity?.label).toBe('エントリー');
  });

  it('集約ディレクトリごとに 4 種の仕様を対応付ける', () => {
    expect([...(result.model?.aggregates.keys() ?? [])]).toEqual(['entry', 'workshop']);

    const entry = result.model?.aggregates.get('entry');
    expect(entry?.entity?.entity).toBe('entry');
    expect(entry?.access?.reads).toHaveLength(5);
    expect(entry?.invariants?.invariants.map((inv) => inv.id)).toEqual([
      'INV-ENTRY-001',
      'INV-ENTRY-002',
      'INV-ENTRY-003',
    ]);
    expect(entry?.invariants?.invariants[2]?.formal).toBeUndefined();
    expect(entry?.entity?.fields.find((field) => field.name === 'title')?.description).toBe('演目名');
    expect(entry?.stateMachines.map((machine) => machine.machine)).toEqual(['entry']);
    expect(entry?.entity?.location.file).toBe('domain-valid/entry/entity.md');
  });

  it('1 つの states.md に書かれた複数の直交状態機械を読む', () => {
    const workshop = result.model?.aggregates.get('workshop');

    expect(workshop?.stateMachines.map((machine) => machine.machine)).toEqual([
      'workshop',
      'workshop_publish',
    ]);
  });

  it('check 型の不変条件（1 レコード内の行内制約）を読む', () => {
    const invariant = result.model?.aggregates.get('workshop')?.invariants?.invariants[0];

    expect(invariant?.id).toBe('INV-WORKSHOP-001');
    expect(invariant?.formal).toEqual({
      kind: 'check',
      expr: 'workshop.entry_deadline < workshop.starts_at',
    });
  });

  it('template.{doc_type}.md と README.md は読み飛ばす', () => {
    expect(result.model?.aggregates.has('template.state_spec.md')).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it('repoRoot 未指定でもリポジトリ相対のパスを付ける', () => {
    const auto = loadSpecModel(`${FIXTURES}domain-valid`);

    expect(auto.model?.roles.location.file).toBe(
      'legacy/spec-tools/__tests__/fixtures/domain-valid/roles.md',
    );
  });
});

describe('loadSpecModel（異常系）', () => {
  const result = load('domain-invalid');

  it('違反があってもモデル構築は続ける', () => {
    expect(result.model).not.toBeNull();
    expect(result.findings.length).toBeGreaterThan(0);
    expectWellFormed(result.findings);
  });

  it('各ファイルの V1 違反を、そのファイルの位置で報告する', () => {
    expect(findByMessage(result.findings, '型 "money" は使えません').location.file).toBe(
      'domain-invalid/entry/entity.md',
    );
    expect(findByMessage(result.findings, 'initial "nowhere" が states にありません').location.file).toBe(
      'domain-invalid/entry/states.md',
    );
    expect(findByMessage(result.findings, 'by が空です').location.file).toBe(
      'domain-invalid/entry/states.md',
    );
    expect(findByMessage(result.findings, 'scope "public" は使えません').location.file).toBe(
      'domain-invalid/entry/access.md',
    );
    expect(findByMessage(result.findings, 'formal.type "aggregate_limit" は使えません')).toBeDefined();
    expect(
      findByMessage(result.findings, 'state_dependency の前提は when ではなく if に書きます').location.file,
    ).toBe('domain-invalid/entry/invariants.md');
  });

  it('YAML が壊れたファイルはそのファイルだけ読み飛ばす', () => {
    const broken = result.model?.aggregates.get('broken');

    expect(broken?.entity).toBeUndefined();
    expect(broken?.access?.entity).toBe('broken');
    expect(findByMessage(result.findings, 'YAML フロントマターを解析できません').location.file).toBe(
      'domain-invalid/broken/entity.md',
    );
  });

  it('直下と集約ディレクトリの想定外ファイルを warning で知らせる', () => {
    const stray = findByMessage(result.findings, 'specs/domain 直下に想定外のファイルがあります');
    expect(stray.severity).toBe('warning');
    expect(stray.location.file).toBe('domain-invalid/stray.md');

    const notes = findByMessage(result.findings, '集約ディレクトリ entry/ に想定外のファイルがあります');
    expect(notes.location.file).toBe('domain-invalid/entry/notes.md');
  });

  it('集約に entity.md / access.md が無ければ warning を出す', () => {
    const missing = result.findings.filter((finding) =>
      finding.message.startsWith('集約 orphan に'),
    );

    expect(missing.map((finding) => finding.message)).toEqual([
      '集約 orphan に entity.md がありません',
      '集約 orphan に access.md がありません',
    ]);
    expect(missing.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(files(missing)).toEqual([
      'domain-invalid/orphan/entity.md',
      'domain-invalid/orphan/access.md',
    ]);
    expect(result.model?.aggregates.get('orphan')?.stateMachines).toHaveLength(1);
    expect(result.model?.aggregates.get('orphan')?.invariants).toBeUndefined();
  });
});

describe('loadSpecModel（継続不能な構造破壊）', () => {
  it('roles.md が無ければモデルを構築しない', () => {
    const result = load('domain-no-roles');

    expect(result.model).toBeNull();
    expect(result.findings).toHaveLength(1);
    expect(findByMessage(result.findings, 'roles.md がありません').location.file).toBe(
      'domain-no-roles/roles.md',
    );
  });

  it('ディレクトリが無ければモデルを構築しない', () => {
    const result = load('domain-missing');

    expect(result.model).toBeNull();
    expect(findByMessage(result.findings, 'ドメイン仕様のディレクトリが見つかりません')).toBeDefined();
  });
});

describe('checkEntityLabelUniqueness', () => {
  const aggregate = (name: string, entity: string, label?: string): AggregateSpecs => ({
    name,
    stateMachines: [],
    entity: {
      entity,
      ...(label === undefined ? {} : { label }),
      context: {},
      fields: [],
      location: { file: `docs/specs/domain/${name}/entity.md` },
    },
  });

  it('表示名がドメイン全体で一意なら何も言わない', () => {
    const findings: Finding[] = [];

    checkEntityLabelUniqueness(
      new Map([
        ['workshop', aggregate('workshop', 'workshop', '催し')],
        ['entry', aggregate('entry', 'entry', 'エントリー')],
        ['program', aggregate('program', 'program_item')],
      ]),
      findings,
    );

    expect(findings).toEqual([]);
  });

  it('2 つの集約が同じ表示名を宣言したら V1 でエラーにする', () => {
    const findings: Finding[] = [];

    checkEntityLabelUniqueness(
      new Map([
        ['workshop', aggregate('workshop', 'workshop', '催し')],
        ['recital', aggregate('recital', 'recital', '催し')],
      ]),
      findings,
    );

    const finding = findByMessage(findings, 'label "催し" が workshop と recital で重複しています');
    expect(finding.verifier).toBe('V1');
    expect(finding.location).toEqual({ file: 'docs/specs/domain/recital/entity.md', pointer: 'label' });
    expectWellFormed(findings);
  });
});
