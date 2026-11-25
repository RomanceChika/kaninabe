/**
 * 図(mermaid)に置く仕様の文字列の無害化(`escapeMermaid`)の単体テスト。
 *
 * 監査の実測(F-04): ラベルの引用符・改行・フェンスで図のブロックを破り、以降が Markdown として解釈された。ラベルは引用符・区切り・括弧・HTML・
 * 指令の記号を取り除くか実体コードにする(図の文を破らない・HTML や `click` / `%%{init}%%` を差し込めない)。
 */

import { describe, expect, it } from 'vitest';
import { escapeMermaid } from '../../../../lib/generate/render/screen-nav-graph.js';
import { renderStateDiagram, transitionLabel } from '../../../../lib/generate/render/state-machine-mermaid.js';
import type { EventDef, StateMachineSpec } from '../../../../lib/model/types.js';

describe('escapeMermaid', () => {
  it('引用符・区切りの記号で図の文を破れない(実体コードの `#93;` を除いて ; が残らない)', () => {
    const out = escapeMermaid('会議室"]; click A call alert(1)');

    expect(out.replace(/#\d+;/g, '')).not.toMatch(/["`;|%\]]/);
  });

  it('HTML・波括弧・改行・指令の記号を差し込めない', () => {
    const out = escapeMermaid('<img src=x onerror=alert(1)>\n%%{init: {"securityLevel":"loose"}}%% `x`');

    expect(out).not.toMatch(/[<>{}\n`%"]/);
    expect(out).toContain('#lt;img');
  });

  it('従来の逃がし方(角括弧・引用符・縦線)は変えない', () => {
    expect(escapeMermaid('a[b]|"c"')).toBe('a#91;b#93;c');
  });
});

describe('状態遷移図のラベル', () => {
  const event = (label: string): EventDef =>
    ({ id: 'submit', label, from: ['draft'], to: 'done', by: ['member'] }) as unknown as EventDef;

  it('イベント名のラベルに引用符・HTML があっても図の行を破らない', () => {
    const label = transitionLabel(event('提出"] --> x; <b>'));

    expect(label.replace(/#[a-z0-9]+;/g, '')).not.toMatch(/["<>;\n\]]/);
  });

  it('状態のラベルに改行以外の危険な記号があっても、図のブロックを閉じない', () => {
    const machine = { machine: 'm', initial: 'draft', states: ['draft', 'done'], final: ['done'], stateLabels: { draft: '下書き ``` <script>' }, events: [event('提出')] } as unknown as StateMachineSpec;

    const diagram = renderStateDiagram(machine);

    expect(diagram.split('\n').filter((line) => line.startsWith('```'))).toEqual(['```mermaid', '```']);
    expect(diagram).not.toContain('<script>');
  });
});
