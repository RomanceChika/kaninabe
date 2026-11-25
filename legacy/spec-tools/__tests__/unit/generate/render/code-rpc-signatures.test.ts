/**
 * code-rpc-signatures(RPC の署名表)のユニットテスト。
 *
 * 署名表は「RPC 名の閉世界」で、引数の順・型・名前に加えて**戻り値の形(`returns`)**を持つ。
 * 戻り値の形は、接続の方式(PostgREST は JSON を返し、直結のドライバは列を返す)が結果を同じ形に読むために
 * 要る宣言である。ここで固定するのは「どの出どころの RPC がどちらの形になるか」の 2 点だけである。
 */

import { describe, expect, it } from 'vitest';
import { rpcSignaturesGenerator } from '../../../../lib/generate/render/code-rpc-signatures.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';

/** 保存点を 1 つ持つユースケース(複合 RPC `usecase_demo_register` が生成される)。 */
function registerUsecase(): ReturnType<typeof usecaseSpec> {
  return usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')], {
        migration: '20260909000050_usecase_demo_register.sql',
        name: 'demo',
      }),
    ],
  });
}

/** 生成器に渡す文脈。 */
function context(overrides: Partial<GenerateContext>): GenerateContext {
  return { ...GEN_CTX, actions: rpcActions(), dataTables: rpcDataTables(), ...overrides };
}

/** 署名表の本文を 1 つだけ取り出す。 */
function render(ctx: GenerateContext): string {
  const sections = rpcSignaturesGenerator.generate(rpcDomain(), ctx);
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-rpc-signatures', () => {
  it('署名の型に戻り値の形(rows / scalar / document)の宣言が載る', () => {
    const content = render(context({}));

    expect(content).toContain("readonly returns: 'rows' | 'scalar' | 'document';");
  });

  it('data_table に宣言した RPC は rows・生成した複合 RPC は document になる', () => {
    const content = render(context({ usecases: { available: true, usecases: [registerUsecase()] } }));

    // data_table に宣言した RPC(定型 5 形・手書きの本文)は setof の行を返す。
    for (const fn of dataTableRpcNames()) {
      expect(content).toMatch(new RegExp(`  ${fn}: \\{[^}]*returns: 'rows',`, 'u'));
    }
    // 保存点の複合 RPC は jsonb を 1 つ返す。
    expect(content).toMatch(/ {2}usecase_demo_register: \{[^}]*returns: 'document',/u);
    expect(content).not.toMatch(/ {2}usecase_demo_register: \{[^}]*returns: 'rows',/u);
  });

  it('定型に乗らない RPC は宣言した戻り値の形が載る(行でない RPC を rows と書かない)', () => {
    const content = render(
      context({
        dataTables: dataTableModel([
          dataTable('items', {
            entity: 'item',
            functions: [
              { name: 'purge_items', args: ['uuid'], params: ['p_id'], kind: 'rpc', shape: 'composite', returns: 'scalar', alsoWrites: [] },
              { name: 'list_items', args: ['uuid'], params: ['p_id'], kind: 'rpc', shape: 'composite', returns: 'rows', alsoWrites: [] },
            ],
          }),
        ]),
      }),
    );

    expect(content).toMatch(/ {2}purge_items: \{[^}]*returns: 'scalar',/u);
    expect(content).toMatch(/ {2}list_items: \{[^}]*returns: 'rows',/u);
  });

  it('kind が rpc でない関数は署名表に載らない(returns を持つ行は rpc だけ)', () => {
    const content = render(
      context({
        dataTables: dataTableModel([
          dataTable('items', {
            entity: 'item',
            functions: [
              { name: 'update_item', args: ['uuid'], params: ['p_id'], kind: 'rpc', shape: 'update', alsoWrites: [] },
              { name: 'check_item', args: [], params: [], kind: 'trigger', alsoWrites: [] },
            ],
          }),
        ]),
      }),
    );

    expect(content).toContain("returns: 'rows'");
    expect(content).not.toContain('check_item');
  });
});

/** `rpcDataTables()` が宣言する RPC の名前。 */
function dataTableRpcNames(): readonly string[] {
  return rpcDataTables().tables.flatMap((table) => table.functions.filter((fn) => fn.kind === 'rpc').map((fn) => fn.name));
}
