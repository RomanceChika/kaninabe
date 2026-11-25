/**
 * ローダーのテスト共通ヘルパー。
 * vitest の収集対象は *.test.ts のみなので、このファイルはテストとしては実行されない。
 */

import { expect } from 'vitest';
import type { Finding } from '../../../lib/kernel/finding.js';

/**
 * Finding が「何が・どこで・どう直すか」の 3 点セットを満たしていることを確認する。
 * 規約(scripts-code-quality.md / domain-spec-writing.md)が全 Finding に要求する形。
 */
export function expectWellFormed(findings: readonly Finding[]): void {
  for (const finding of findings) {
    expect(finding.verifier).toBe('V1');
    expect(finding.message.length).toBeGreaterThan(0);
    expect(finding.suggestion.length).toBeGreaterThan(0);
    expect(finding.location.file.length).toBeGreaterThan(0);
  }
}

/** Finding の YAML パス(pointer)の一覧。期待する箇所が指されているかの確認に使う。 */
export function pointers(findings: readonly Finding[]): readonly (string | undefined)[] {
  return findings.map((finding) => finding.location.pointer);
}

/** message に部分文字列を含む Finding を 1 件だけ取り出す(見つからなければテストを失敗させる)。 */
export function findByMessage(findings: readonly Finding[], substring: string): Finding {
  const matched = findings.filter((finding) => finding.message.includes(substring));
  expect(matched, `message に "${substring}" を含む Finding が 1 件あること`).toHaveLength(1);
  return matched[0] as Finding;
}
