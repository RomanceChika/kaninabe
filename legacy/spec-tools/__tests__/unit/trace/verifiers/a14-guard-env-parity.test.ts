/**
 * A14(ガード環境の突合)の規約網羅テスト。
 *
 * 対象の要求: ADR-0012 §Implementation の当座 —— operation の手書き `guardEnv` が返す鍵の集合と、
 * 仕様のガード式に現れる変数の集合が一致すること。足りなければガードは常に評価不能(= 拒否)に
 * なり、余分なら仕様のどのガードも見ない事実を読んでいることになる。
 */

import { describe, expect, it } from 'vitest';
import { guardEnvParityVerifier } from '../../../../lib/trace/verifiers/a14-guard-env-parity.js';
import {
  accessSpec,
  aggregate,
  createRule,
  event,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { FOREIGN_LAYOUT } from '../../../helpers/platform.js';
import { scanResult, traceInput } from '../../../helpers/trace-builder.js';
import { createGuardServices } from '../../../../lib/guard/services.js';

/** submit(ガードつきの遷移)・create(条件つき)・update(条件つき)を宣言したドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [
              event({
                id: 'submit',
                from: ['draft'],
                to: 'submitted',
                by: ['member'],
                guard: 'workshop.state == accepting and now < workshop.entry_deadline',
              }),
              event({ id: 'withdraw', from: ['submitted'], to: 'draft', by: ['member'] }),
            ],
          }),
          // 集約名と違う名前の副次状態機械(業務手順は集約のディレクトリに置かれる)。
          machine({
            machine: 'entry_link',
            states: ['unresolved', 'linked'],
            events: [
              event({
                id: 'link',
                from: ['unresolved'],
                to: 'linked',
                by: ['member'],
                guard: 'workshop.state == accepting',
              }),
            ],
          }),
        ],
        access: accessSpec('entry', {
          creates: [createRule('member', 'workshop.state == accepting')],
          writes: [writeRule('member', ['title'], 'state == draft')],
        }),
      }),
    ],
  });
}

/** guardEnv の鍵を持つ走査結果で A14 を回す。 */
function verify(file: string, keys: readonly string[], unreadable = false) {
  return guardEnvParityVerifier.verify(
    traceInput({
      domain: domain(),
      guards: createGuardServices(),
      tests: scanResult({ guardEnvs: [{ file: `app/src/operation/${file}`, keys, unreadable }] }),
    }),
  );
}

describe('A14 ガード環境の突合', () => {
  it('ガード式の変数と鍵が一致していれば通る(遷移)', () => {
    expect(verify('entry/submit.ts', ['now', 'workshop.state', 'workshop.entry_deadline'])).toEqual([]);
  });

  it('順番が違っても集合が同じなら通る(鍵の並びに意味は無い)', () => {
    expect(verify('entry/submit.ts', ['workshop.entry_deadline', 'workshop.state', 'now'])).toEqual([]);
  });

  it('ガードを持たない遷移は鍵ゼロで通る', () => {
    expect(verify('entry/withdraw.ts', [])).toEqual([]);
  });

  it('鍵が足りなければ違反になる(ガードが常に評価不能 = 拒否になる)', () => {
    const findings = verify('entry/submit.ts', ['workshop.state', 'workshop.entry_deadline']);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A14');
    expect(findings[0]?.message).toContain('足りない: now');
  });

  it('仕様のどのガードも見ない鍵は違反になる', () => {
    const findings = verify('entry/withdraw.ts', ['workshop.state']);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('余分: workshop.state');
  });

  it('作成は creates の全規則の変数を集める(どの規則で通るかは実行時に決まる)', () => {
    expect(verify('entry/create.ts', ['workshop.state'])).toEqual([]);
    expect(verify('entry/create.ts', [])[0]?.message).toContain('足りない: workshop.state');
  });

  it('編集は writes の全規則の変数を集める', () => {
    expect(verify('entry/update.ts', ['state'])).toEqual([]);
  });

  it('鍵を静的に読めない形は「読めない」として報告する(黙って通さない)', () => {
    const findings = verify('entry/submit.ts', [], true);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('読めません');
  });

  it('副次状態機械の操作(集約のディレクトリに置かれる)も突合する —— 黙って外に落ちない', () => {
    // `operation/entry/link.ts` は `entry_link.link` の実装であり、パスから導く ID は
    // `entry.link` になる。機械名の綴りしか許さないと、この操作は突合の外に落ちる。
    expect(verify('entry/link.ts', ['workshop.state'])).toEqual([]);
    expect(verify('entry/link.ts', [])[0]?.message).toContain('足りない: workshop.state');
  });

  it('仕様に無い操作のファイルは A11 の担当なので、ここでは何も言わない', () => {
    expect(verify('entry/teleport.ts', ['workshop.state'])).toEqual([]);
  });

  it('集約でないディレクトリ(定型そのもの)は対象外', () => {
    expect(verify('_template/transition.ts', [], true)).toEqual([]);
  });

  it('ガード式のパーサーが無い環境では何も見ない', () => {
    const findings = guardEnvParityVerifier.verify(
      traceInput({
        domain: domain(),
        tests: scanResult({ guardEnvs: [{ file: 'app/src/operation/entry/submit.ts', keys: [], unreadable: false }] }),
      }),
    );

    expect(findings).toEqual([]);
  });

  it('app/ を走査できない環境では何も見ない', () => {
    const findings = guardEnvParityVerifier.verify(
      traceInput({
        domain: domain(),
        guards: createGuardServices(),
        tests: scanResult({ available: false, guardEnvs: [] }),
      }),
    );

    expect(findings).toEqual([]);
  });

  it('別の配置(架空の値)では、その配置の操作の本体の置き場にある実装だけを突合する(Next.js の綴りの置き場は操作の本体ではない)', () => {
    const verifyForeign = (file: string, keys: readonly string[]) =>
      guardEnvParityVerifier.verify(
        traceInput({ layout: FOREIGN_LAYOUT, domain: domain(), guards: createGuardServices(), tests: scanResult({ guardEnvs: [{ file, keys, unreadable: false }] }) }),
      );

    expect(verifyForeign('app/server_code/rules/entry__submit.rule.ts', ['now', 'workshop.state', 'workshop.entry_deadline'])).toEqual([]);
    expect(verifyForeign('app/server_code/rules/entry__submit.rule.ts', [])[0]?.message).toContain('足りない: ');
    expect(verifyForeign('app/src/operation/entry/submit.ts', [])).toEqual([]);
  });
});
