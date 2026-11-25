/**
 * X7(外へ送る自由文の無害化の突合)のユニットテスト。
 *
 *   - 宣言した部品(discord_mentions / control_chars / length:N)を、アダプタが `@kaninabe/runtime/neutralize` の束縛で呼んでいること
 *   - `length:N` の呼び出しの第 2 引数が宣言と同じ数のリテラルであること
 *   - `neutralize_none` なのに、利用者が編集できる文字列の欄を送っていないこと
 *   - `bearer` の欄を外へ送っていないこと
 *   - 実装の木が無い構成ではアダプタの突合が飛び、宣言どうしの突合だけが残ること
 *
 * アダプタのソースを読むので、ここだけは一時ディレクトリに実ファイルを置く(X6 のテストと同じ扱い)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralizeGaps, verifyNeutralize } from '../../../../lib/external/verifiers/x7-neutralize.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import type { ExternalNeutralizeDecl, IntegrationDecl } from '../../../../lib/model/external/types.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { UNSELECTED, blockedInput, loadedInput } from '../../../helpers/verify-inputs.js';
import { aggregate, accessSpec, entitySpec, field, specModel, write } from '../../../helpers/model-builder.js';

/** アダプタの置き場(ビルダーの既定の `adapter` と揃える)。 */
const ADAPTER = integration('discord_webhook').adapter;
const IMPORT = "import { neutralizeDiscordMentions, allowedDiscordMentionsOf, stripControlChars, clampLength } from '@kaninabe/runtime/neutralize';";
const NO_IDEMPOTENCY = { idempotencySource: 'none', idempotencyReason: '二度届いてよい' } as const;

const domain = specModel([
  aggregate('participant', {
    entity: entitySpec('participant', { fields: [field('display_name', { kind: 'string' }), field('discord_user_id', { kind: 'string' }), field('age', { kind: 'integer' })] }),
    access: accessSpec('participant', { writes: [write('member', ['display_name', 'age'])] }),
  }),
  aggregate('invite', {
    entity: entitySpec('invite', {
      fields: [{ ...field('code', { kind: 'string' }), maxLength: 43, suppliedBy: 'db', bearer: { kind: 'reusable', reason: 'r', location: { file: 'f', pointer: 'p' } } }],
    }),
  }),
]);

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'x7-'));
  mkdirSync(path.join(root, TEST_ROOTS.app ?? '', 'src'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeAdapter(body: string): void {
  const absolute = path.join(root, ADAPTER);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
}

function decl(neutralize: ExternalNeutralizeDecl | undefined, fields: readonly string[] = []): IntegrationDecl {
  return integration('discord_webhook', { retry: 'job', ...NO_IDEMPOTENCY, sends: { fields, text: 't', ...(neutralize === undefined ? {} : { neutralize }) } });
}

function verify(integrations: IntegrationDecl, repoRoot = root, actions: ActionSpecModel | null = null) {
  return verifyNeutralize({
    domain,
    catalog: externalCatalog([integrations]),
    repoRoot,
    roots: TEST_ROOTS,
    actionSpecs: actions === null ? UNSELECTED : loadedInput(actions),
  });
}

/** `participant.discord_user_id` を入力に取る action_spec(編集の規則には載らない欄が、作成の入力としては利用者が書ける)。 */
const ACTIONS = {
  unhandled: [],
  scans: [],
  unscanned: [],
  testTagBaseline: [],
  actions: [{ id: 'participant-create-action', input: [{ raw: 'participant.discord_user_id', entity: 'participant', field: 'discord_user_id' }] }],
} as unknown as ActionSpecModel;

const apply = (...parts: Extract<ExternalNeutralizeDecl, { kind: 'apply' }>['parts']): ExternalNeutralizeDecl => ({ kind: 'apply', parts });

describe('X7: アダプタが宣言した部品を呼んでいる', () => {
  it('discord_mentions + control_chars + length を全部呼んでいれば通る', () => {
    writeAdapter(`${IMPORT}\nconst a = neutralizeDiscordMentions(stripControlChars(clampLength(t, 2000)));\nconst b = allowedDiscordMentionsOf(prefix);`);
    expect(verify(decl(apply({ kind: 'discord_mentions' }, { kind: 'control_chars' }, { kind: 'length', max: 2000 })))).toEqual([]);
  });

  it('宣言していない部品を余分に呼んでいても止めない', () => {
    writeAdapter(`${IMPORT}\nstripControlChars(t); neutralizeDiscordMentions(t); allowedDiscordMentionsOf(p);`);
    expect(verify(decl(apply({ kind: 'control_chars' })))).toEqual([]);
  });

  it('discord_mentions は本文の無害化だけでは足りず、許可の絞りも呼ぶ', () => {
    writeAdapter(`${IMPORT}\nneutralizeDiscordMentions(t);`);
    const findings = verify(decl(apply({ kind: 'discord_mentions' })));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'X7', severity: 'error', counterexample: { part: 'discord_mentions', missing: 'allowedDiscordMentionsOf' } });
  });

  it('control_chars を宣言して呼んでいなければ止まる', () => {
    writeAdapter(`${IMPORT}\nclampLength(t, 10);`);
    const findings = verify(decl(apply({ kind: 'control_chars' })));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('stripControlChars');
    expect(findings[0]?.message).toContain('呼んでいません');
  });

  it('length:N の第 2 引数が宣言と違う数なら止まる', () => {
    writeAdapter(`${IMPORT}\nclampLength(t, 1999);`);
    const findings = verify(decl(apply({ kind: 'length', max: 2000 })));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('2000 のリテラルではありません');
  });

  it('length:N を呼んでいなければ止まる', () => {
    writeAdapter('export const x = 1;');
    const findings = verify(decl(apply({ kind: 'length', max: 2000 })));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('clampLength');
    expect(findings[0]?.suggestion).toContain('clampLength(text, 2000)');
  });

  it.each([
    ['同名のローカル関数', 'function stripControlChars(t: string) { return t; }\nstripControlChars(t);'],
    ['別モジュールの import', "import { stripControlChars } from './mine';\nstripControlChars(t);"],
    ['呼ばずに import だけ', `${IMPORT}\nexport const unused = [stripControlChars];`],
    ['コメントの中の字面', `${IMPORT}\n// stripControlChars(t)\nexport const x = 1;`],
  ])('部品の字面があっても、束縛された呼び出しでなければ数えない: %s', (_name, body) => {
    writeAdapter(body);
    expect(verify(decl(apply({ kind: 'control_chars' })))).toHaveLength(1);
  });

  it('アダプタのファイルが無い・読めないときは X1 が言うので黙る', () => {
    expect(verify(decl(apply({ kind: 'control_chars' })))).toEqual([]);
  });

  it('実装の木が無い構成ではアダプタの突合を飛ばす', () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'x7-bare-'));
    try {
      expect(verify(decl(apply({ kind: 'control_chars' })), bare)).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('neutralize が未宣言の行(受信など)は突合しない', () => {
    writeAdapter('export const x = 1;');
    expect(verify(decl(undefined))).toEqual([]);
  });
});

describe('X7: neutralize_none と送る欄', () => {
  const none: ExternalNeutralizeDecl = { kind: 'none', reason: '送るのは数字の ID だけ' };

  it('利用者が編集できる文字列の欄を送りながら none は止まる', () => {
    const findings = verify(decl(none, ['participant.display_name']));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'X7', counterexample: { field: 'participant.display_name' } });
    expect(findings[0]?.message).toContain('送ってい');
  });

  it.each([
    ['編集できない文字列の欄', 'participant.discord_user_id'],
    ['文字列でない欄', 'participant.age'],
    ['実在しない欄(X3 の担当)', 'participant.nothing'],
    ['形の違う参照(X3 の担当)', 'broken'],
    ['実在しない集約(X3 の担当)', 'ghost.display_name'],
  ])('none を止めない: %s', (_name, ref) => {
    expect(verify(decl(none, [ref]))).toEqual([]);
  });

  it('action_spec の入力に載る文字列の欄(編集の規則には載らない)も、利用者が書ける欄として none を止める', () => {
    const findings = verify(decl(none, ['participant.discord_user_id']), root, ACTIONS);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ field: 'participant.discord_user_id' });
    // 対照: action_spec を読めないとき(null)は、編集の規則に載る欄だけで判定する。
    expect(verify(decl(none, ['participant.discord_user_id']))).toEqual([]);
  });

  it('入力に載る欄でも文字列でなければ none を止めない(型が違う)', () => {
    const numeric = { ...ACTIONS, actions: [{ id: 'a', input: [{ raw: 'participant.age', entity: 'participant', field: 'age' }] }] } as unknown as ActionSpecModel;
    expect(verify(decl(none, ['participant.age']), root, numeric)).toEqual([]);
  });

  it('部品を宣言していれば、編集できる欄を送ってよい', () => {
    writeAdapter(`${IMPORT}\nstripControlChars(t);`);
    expect(verify(decl(apply({ kind: 'control_chars' }), ['participant.display_name']))).toEqual([]);
  });
});

describe('X7: bearer を外へ送らない', () => {
  it.each([
    ['none', { kind: 'none', reason: 'r' } as ExternalNeutralizeDecl],
    ['apply', apply({ kind: 'control_chars' })],
  ])('bearer の欄を送る(%s)と止まる', (_name, neutralize) => {
    writeAdapter(`${IMPORT}\nstripControlChars(t);`);
    const findings = verify(decl(neutralize, ['invite.code']));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('bearer の欄 invite.code');
  });
});

describe('X7: action_spec が阻害のときの見ていないことの記録', () => {
  const none: ExternalNeutralizeDecl = { kind: 'none', reason: '送るのは数字の ID だけ' };
  const gaps = (integrations: IntegrationDecl, actionSpecs = blockedInput<ActionSpecModel>()) =>
    neutralizeGaps({ domain, catalog: externalCatalog([integrations]), repoRoot: root, roots: TEST_ROOTS, actionSpecs });

  it('阻害のとき、neutralize_none で文字列の欄を送る連携を名指す', () => {
    const notes = gaps(decl(none, ['participant.discord_user_id']));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ subjects: ['discord_webhook'], gap: { state: 'blocked' } });
  });

  it.each([
    ['未選択(入力を持つ操作は無いという事実)', () => gaps(decl(none, ['participant.discord_user_id']), UNSELECTED)],
    ['読込済み', () => gaps(decl(none, ['participant.discord_user_id']), loadedInput(ACTIONS))],
    ['阻害でも、none で欄を送らない連携しか無い', () => gaps(decl(none, []))],
    ['阻害でも、部品を宣言した連携しか無い', () => gaps(decl(apply({ kind: 'control_chars' }), ['participant.display_name']))],
  ])('何も言わない: %s', (_name, run) => {
    expect(run()).toEqual([]);
  });
});

