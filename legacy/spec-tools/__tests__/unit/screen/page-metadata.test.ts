/**
 * `generateMetadata` の形の読み取りのテスト(点検 14 回目 B14-1)。読める形は 1 つだけで、ほかは全部 `unreadable` になること。
 */

import { describe, expect, it } from 'vitest';
import { pageMetadataForm } from '../../../lib/screen/page-metadata.js';

describe('pageMetadataForm', () => {
  it.each([
    ['置いていない', 'export default async function P() { return null; }'],
    ['コメントの中の綴り', '// generateMetadata はここに無い\n/** generateMetadata */\nexport default function P() { return null; }'],
    ['static の metadata', "export const metadata = { title: 'x' };"],
  ])('%s は none', (_name, source) => {
    expect(pageMetadataForm(source)).toEqual({ kind: 'none' });
  });

  it.each([
    ['最初の文', 'export async function generateMetadata(): Promise<Metadata> {\n  await requireSession(resolveActorId);\n  return {};\n}', 'requireSession'],
    ['値を受ける形', 'export async function generateMetadata(props: Props): Promise<Metadata> { const actor = await requireStaff(resolveActorId); return { title: actor }; }', 'requireStaff'],
    ['戻り値の型なし', 'export async function generateMetadata() { await requireSession(x); return {}; }', 'requireSession'],
    ['引数の型の入れ子', 'export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> { await requireSession(x); return {}; }', 'requireSession'],
  ])('%s は gated', (_name, source, symbol) => {
    expect(pageMetadataForm(source)).toEqual({ kind: 'gated', symbol });
  });

  it('最初の文の相手が関門かどうかは S7 が表で見る(ここは読むだけ)', () => {
    expect(pageMetadataForm('export async function generateMetadata() { const row = await read(); await requireSession(x); return { title: row }; }')).toEqual({ kind: 'gated', symbol: 'read' });
  });

  it.each([
    ['関門の前の文', 'export async function generateMetadata() { const t = title(); await requireSession(x); return { title: t }; }'],
    ['関門なし', 'export async function generateMetadata() { return { title: read() }; }'],
    ['同期の関数', 'export function generateMetadata() { return {}; }'],
    ['定数の関数', 'export const generateMetadata = async () => { await requireSession(x); return {}; };'],
    ['別名の export', 'async function meta() { await requireSession(x); return {}; }\nexport { meta as generateMetadata };'],
    ['再 export', "export { generateMetadata } from '../_screens/x';"],
    ['全部の再 export', "export * from '../_screens/x';"],
    ['本体の後ろに関門の形', 'export async function generateMetadata() { const secret = await read(); return sub(async function generateMetadata() { await requireSession(x); }); }'],
    ['戻り値の型の波括弧', 'export async function generateMetadata(): Promise<{ title: string }> { await requireSession(x); return { title: "" }; }'],
    ['2 回書く', 'export async function generateMetadata() { await requireSession(x); return {}; }\n// \nconst other = "generateMetadata";'],
  ])('%s は unreadable', (_name, source) => {
    expect(pageMetadataForm(source)).toEqual({ kind: 'unreadable' });
  });
});
