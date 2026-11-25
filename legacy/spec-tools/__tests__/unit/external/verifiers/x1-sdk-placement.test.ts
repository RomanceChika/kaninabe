/**
 * X1 の (d) **外部の SDK の置き場の閉世界**(`lib/external/sdk-placement.ts`。点検 9 回目 B9-4)のユニットテスト。
 *
 * 一時ディレクトリに製品の木(`app/src/...`)を組み、1 ファイルずつ置いて X1 を回す。配置は本番と同じ(Next.js。土台の
 * `infrastructure/supabase` が `@supabase/*` を、枠の基盤が next / react / react-dom / zod / server-only を宣言する)。
 * 表: 正例(adapter_root の下の SDK・土台の SDK・client_ui・型だけ・基盤・Node 組み込み・仕組みの部品・別名・テスト)/
 * 負例(探り台本の集約ディレクトリ・Composition・ページ・宣言の無いパッケージ・字句でない動的 import・export from・require・
 * client_ui の名指していない包み)/ 境界(グロブ `@ai-sdk/*` の下位の包み・`ai/rsc` の下位パス・スコープだけの綴り)。
 * 加えて、綴りの部品(`sdk-packages.ts`)と、パーサーが `sdk_packages` / `client_ui` の形を確かめることを見る。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyAdapterClosedWorld } from '../../../../lib/external/verifiers/x1-adapter-closed-world.js';
import { anyPackageMatches, classifySpecifier, isPackageName, isPackagePattern } from '../../../../lib/model/external/sdk-packages.js';
import { OUTBOUND_PRIMITIVE_MODULES, outboundPrimitiveOf } from '../../../../lib/model/external/outbound-primitives.js';
import { parseExternalCatalog } from '../../../../lib/model/external/parse-external.js';
import { aggregate, entitySpec, specModel } from '../../../helpers/model-builder.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import { dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { loadedInput } from '../../../helpers/verify-inputs.js';
import { SpecReporter } from '../../../../lib/model/parse-common.js';

/** item の集約(ディレクトリ `infrastructure/item` を集約として分類する)。 */
const DOMAIN = specModel([aggregate('item', { entity: entitySpec('item') })]);

/** 外部連携の語彙(anthropic が SDK と client_ui を宣言する)。 */
const CATALOG = {
  ...externalCatalog([integration('anthropic_chat', { service: 'anthropic', port: 'ChatPort', adapter: 'app/src/infrastructure/anthropic/chat.ts' })]),
  vocabulary: {
    service: [
      {
        id: 'anthropic',
        adapterRoot: 'app/src/infrastructure/anthropic',
        sdkPackages: ['@ai-sdk/*', 'ai'],
        clientUi: [{ file: 'app/src/app/tutorial/_components/chat-panel.tsx', packages: ['@ai-sdk/react', 'ai'] }],
      },
    ],
  },
};

/** 木に常に置くファイル(宣言どおりのアダプタと client_ui の部品)。 */
const BASE_FILES: Readonly<Record<string, string>> = {
  'app/src/infrastructure/anthropic/chat.ts': "import { createAnthropic } from '@ai-sdk/anthropic';\nexport interface ChatPort {}\nexport const f = createAnthropic;\n",
  'app/src/app/tutorial/_components/chat-panel.tsx': "'use client';\nimport { useChat } from '@ai-sdk/react';\nexport const f = useChat;\n",
  'app/src/infrastructure/item/repository.ts': "import 'server-only';\nexport const x = 1;\n",
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * 木を組んで X1 を回し、(d) の指摘(SDK と外部パッケージと動的 import の文面)だけを返す。
 *
 * @param files 足すファイル(リポジトリルート相対 → 本文)
 * @returns 指摘の文面
 */
function run(files: Readonly<Record<string, string>>): readonly string[] {
  const root = mkdtempSync(path.join(tmpdir(), 'x1-sdk-'));
  roots.push(root);
  for (const [file, body] of Object.entries({ ...BASE_FILES, ...files })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  return verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT, domain: DOMAIN, dataTables: loadedInput(dataTableModel([])), catalog: CATALOG, repoRoot: root })
    .map((finding) => finding.message)
    .filter((message) => /SDK|外部パッケージ|動的 import|client_ui|外へ送る口/u.test(message));
}

describe('X1 (d): 外部の SDK は宣言した置き場の下でだけ値として引ける', () => {
  it('宣言どおりの木(アダプタと client_ui)は 0 件', () => {
    expect(run({})).toEqual([]);
  });

  it.each([
    ['adapter_root の下で ai の値', 'app/src/infrastructure/anthropic/stream.ts', "import { streamText } from 'ai';\nexport const f = streamText;"],
    ['グロブ @ai-sdk/* の別の包み(境界)', 'app/src/infrastructure/anthropic/x.ts', "import { createOpenAI } from '@ai-sdk/openai';\nexport const f = createOpenAI;"],
    ['下位パス ai/rsc(境界)', 'app/src/infrastructure/anthropic/x.ts', "import { x } from 'ai/rsc';\nexport const f = x;"],
    ['土台の SDK(@supabase/*)は土台の下で', 'app/src/infrastructure/supabase/client.ts', "import { createClient } from '@supabase/supabase-js';\nexport const f = createClient;"],
    ['client_ui は名指した包みを引ける', 'app/src/app/tutorial/_components/chat-panel.tsx', "import { useChat } from '@ai-sdk/react';\nimport { TextStreamChatTransport } from 'ai';\nexport const f = [useChat, TextStreamChatTransport];"],
    ['型だけの import はどこでも', 'app/src/infrastructure/item/x.ts', "import type { ModelMessage } from 'ai';\nimport { type UIMessage } from 'ai';\nexport type M = ModelMessage | UIMessage;"],
    ['基盤の層の基盤のパッケージ', 'app/src/infrastructure/item/x.ts', "import { cookies } from 'next/headers';\nimport { cache } from 'react';\nimport { z } from 'zod';\nexport const f = [cookies, cache, z];"],
    ['基盤の層の Node 組み込み(接頭辞あり・なし)', 'app/src/infrastructure/item/x.ts', "import { randomUUID } from 'node:crypto';\nimport path from 'path';\nexport const f = [randomUUID, path];"],
    ['仕組みの部品(外へ送る口でない)・別名・相対', 'app/src/infrastructure/item/x.ts', "import { jsonResponse } from '@kaninabe/runtime/http/response';\nimport { y } from '@/domain/y';\nimport { z } from './z';\nexport const f = [jsonResponse, y, z];"],
    ['外へ送る口は adapter_root の下で(safeFetch)', 'app/src/infrastructure/anthropic/rest.ts', "import { safeFetch } from '@kaninabe/runtime/http/safe-fetch';\nexport const f = safeFetch;"],
    ['外へ送る口は土台の下で(safeFetch)', 'app/src/infrastructure/supabase/client.ts', "import { safeFetch } from '@kaninabe/runtime/http/safe-fetch';\nexport const f = safeFetch;"],
    ['外へ送る口は adapter_root の下で(node:https・undici)', 'app/src/infrastructure/anthropic/raw.ts', "import https from 'node:https';\nimport { request } from 'undici';\nexport const f = [https, request];"],
    ['外へ送る口の型だけの import はどこでも', 'app/src/infrastructure/item/x.ts', "import type { SafeFetchInit } from '@kaninabe/runtime/http/safe-fetch';\nexport type I = SafeFetchInit;"],
    ['テストと __tests__ は見ない', 'app/src/infrastructure/__tests__/probe.ts', "import { generateText } from 'ai';\nimport pg from 'pg';\nexport const f = [generateText, pg];"],
    ['.test. のファイルは見ない', 'app/src/composition/x.test.ts', "import { generateText } from 'ai';\nexport const f = generateText;"],
    ['基盤の層の外の宣言の無いパッケージは (d) の外(ESLint の許可表が見る)', 'app/src/composition/x.ts', "import _ from 'lodash';\nexport const f = _;"],
  ])('通る: %s', (_name, file, body) => {
    expect(run({ [file]: body })).toEqual([]);
  });

  it.each([
    ['探り台本の形: 集約ディレクトリの infrastructure/item に SDK', 'app/src/infrastructure/item/blurb-draft.ts', "import 'server-only';\nimport { createAnthropic } from '@ai-sdk/anthropic';\nimport { generateText } from 'ai';\nexport const f = [createAnthropic, generateText];", 2],
    ['Composition から SDK', 'app/src/composition/blurb.ts', "import { generateText } from 'ai';\nexport const f = generateText;", 1],
    ['ページから SDK の下位パス', 'app/src/app/guest/page.tsx', "import { x } from 'ai/rsc';\nexport const f = x;", 1],
    ['集約ディレクトリから土台の SDK', 'app/src/infrastructure/item/admin.ts', "import { createClient } from '@supabase/supabase-js';\nexport const f = createClient;", 1],
    ['基盤の層の宣言の無いパッケージ', 'app/src/infrastructure/item/x.ts', "import OpenAI from 'openai';\nexport const f = OpenAI;", 1],
    ['基盤の層の宣言の無いスコープつきパッケージ', 'app/src/infrastructure/anthropic/x.ts', "import { Client } from '@notionhq/client';\nexport const f = Client;", 1],
    ['export from で SDK を再輸出', 'app/src/infrastructure/item/x.ts', "export { generateText } from 'ai';", 1],
    ['export * from で SDK を再輸出', 'app/src/composition/x.ts', "export * from '@ai-sdk/anthropic';", 1],
    ['動的 import の字句', 'app/src/composition/x.ts', "export const f = () => import('ai');", 1],
    ['require の字句', 'app/src/infrastructure/item/x.ts', "export const f = require('@ai-sdk/anthropic');", 1],
    ['動的 import の非字句(fail-closed)', 'app/src/infrastructure/item/x.ts', "const name = 'ai';\nexport const f = () => import(name);", 1],
    ['副作用の import', 'app/src/infrastructure/item/x.ts', "import 'ai';", 1],
    ['client_ui が名指していない包み(提供元の SDK)', 'app/src/app/tutorial/_components/chat-panel.tsx', "import { createAnthropic } from '@ai-sdk/anthropic';\nexport const f = createAnthropic;", 1],
    ['名指していないクライアントの部品', 'app/src/app/tutorial/_components/other-panel.tsx', "import { useChat } from '@ai-sdk/react';\nexport const f = useChat;", 1],
    ['adapter_root と同じ接頭辞の別ディレクトリ(境界)', 'app/src/infrastructure/anthropic-x/x.ts', "import { generateText } from 'ai';\nexport const f = generateText;", 1],
    // 10 回目 B10-3 の探り台本(SDK を REST に替えて集約名のディレクトリから外へ出す)と、外へ送る口の閉じた表の各行
    ['探り台本: 集約ディレクトリから safeFetch で REST', 'app/src/infrastructure/item/probe-r10-notify.ts', "import 'server-only';\nimport { safeFetch } from '@kaninabe/runtime/http/safe-fetch';\nexport const f = () => safeFetch('https://api.example/v1/messages', { method: 'POST' });", 1],
    ['safeFetch の .js の綴り', 'app/src/infrastructure/item/x.ts', "import { safeFetch } from '@kaninabe/runtime/http/safe-fetch.js';\nexport const f = safeFetch;", 1],
    ['Composition から safeFetch', 'app/src/composition/x.ts', "import { safeFetch } from '@kaninabe/runtime/http/safe-fetch';\nexport const f = safeFetch;", 1],
    ['safeFetch の再輸出', 'app/src/composition/x.ts', "export { safeFetch } from '@kaninabe/runtime/http/safe-fetch';", 1],
    ['node:https', 'app/src/infrastructure/item/x.ts', "import https from 'node:https';\nexport const f = https;", 1],
    ['接頭辞の無い https', 'app/src/infrastructure/item/x.ts', "import https from 'https';\nexport const f = https;", 1],
    ['node:http', 'app/src/infrastructure/item/x.ts', "import { request } from 'node:http';\nexport const f = request;", 1],
    ['node:http2', 'app/src/infrastructure/item/x.ts', "import { connect } from 'node:http2';\nexport const f = connect;", 1],
    ['node:net', 'app/src/infrastructure/item/x.ts', "import { connect } from 'node:net';\nexport const f = connect;", 1],
    ['node:tls', 'app/src/infrastructure/item/x.ts', "import { connect } from 'node:tls';\nexport const f = connect;", 1],
    ['node:dgram', 'app/src/infrastructure/item/x.ts', "import { createSocket } from 'node:dgram';\nexport const f = createSocket;", 1],
    ['node:dns/promises(下位パス)', 'app/src/infrastructure/item/x.ts', "import { lookup } from 'node:dns/promises';\nexport const f = lookup;", 1],
    ['undici', 'app/src/infrastructure/item/x.ts', "import { request } from 'undici';\nexport const f = request;", 1],
    ['undici の下位パス', 'app/src/infrastructure/item/x.ts', "import { x } from 'undici/types';\nexport const f = x;", 1],
    ['外へ送る口の動的 import の字句', 'app/src/infrastructure/item/x.ts', "export const f = () => import('node:http');", 1],
    ['外へ送る口の require の字句', 'app/src/infrastructure/item/x.ts', "export const f = require('https');", 1],
    ['ページから node:net', 'app/src/app/guest/page.tsx', "import { connect } from 'node:net';\nexport const f = connect;", 1],
    ['adapter_root と同じ接頭辞の別ディレクトリから safeFetch(境界)', 'app/src/infrastructure/anthropic-x/x.ts', "import { safeFetch } from '@kaninabe/runtime/http/safe-fetch';\nexport const f = safeFetch;", 1],
  ])('赤: %s', (_name, file, body, count) => {
    expect(run({ [file]: body })).toHaveLength(count);
  });

  it('指摘は置き場と直し方(sdk_packages / adapter_root)を名指す', () => {
    const [message] = run({ 'app/src/infrastructure/item/blurb-draft.ts': "import { generateText } from 'ai';\nexport const f = generateText;" });
    expect(message).toMatch(/app\/src\/infrastructure\/item\/blurb-draft\.ts:1 が SDK のパッケージ ai/u);
    expect(message).toMatch(/app\/src\/infrastructure\/anthropic/u);
  });

  it('client_ui に名指したファイルが実在しなければ赤', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'x1-sdk-'));
    roots.push(root);
    mkdirSync(path.join(root, 'app/src/infrastructure/anthropic'), { recursive: true });
    writeFileSync(path.join(root, 'app/src/infrastructure/anthropic/chat.ts'), 'export interface ChatPort {}\n');
    const messages = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT, domain: DOMAIN, dataTables: loadedInput(dataTableModel([])), catalog: CATALOG, repoRoot: root }).map((f) => f.message);
    expect(messages).toContain('client_ui に名指した app/src/app/tutorial/_components/chat-panel.tsx が実在しません');
  });
});

describe('SDK のパッケージの綴り', () => {
  it.each([
    ['ai', true],
    ['@ai-sdk/anthropic', true],
    ['@ai-sdk/*', true],
    ['*', false],
    ['@ai-sdk/**', false],
    ['@ai-sdk', false],
    ['ai/*', false],
    ['AI', false],
    ['', false],
  ])('綴り %s は書ける形か = %s', (text, expected) => {
    expect(isPackagePattern(text)).toBe(expected);
  });

  it.each([
    ['@ai-sdk/*', '@ai-sdk/react', true],
    ['@ai-sdk/*', '@ai-sdkx/react', false],
    ['@ai-sdk/*', '@ai-sdk/', false],
    ['ai', 'ai', true],
    ['ai', 'aix', false],
  ])('%s は %s に当たる = %s', (pattern, name, expected) => {
    expect(anyPackageMatches([pattern], name)).toBe(expected);
  });

  it('client_ui の包みはグロブを書けない', () => {
    expect(isPackageName('@ai-sdk/react')).toBe(true);
    expect(isPackageName('@ai-sdk/*')).toBe(false);
  });

  it.each([
    ['ai/rsc', 'package', 'ai'],
    ['@ai-sdk/anthropic/internal', 'package', '@ai-sdk/anthropic'],
    ['node:fs', 'core', null],
    ['fs/promises', 'core', null],
    ['@kaninabe/runtime/url', 'internal', null],
    ['@/domain/x', 'internal', null],
    ['~srv/domain/x', 'package', '~srv'],
    ['./x', 'internal', null],
  ])('指定子 %s の分類(別名は @/ だけを渡す)', (specifier, kind, name) => {
    expect(classifySpecifier(specifier, new Set(['fs']), ['@/'])).toEqual({ kind, name });
  });
});

describe('パーサー: sdk_packages / client_ui の形', () => {
  /** service 1 行だけのカタログを読み、vocabulary の違反の文面を返す。 */
  function parse(service: Record<string, unknown>) {
    const reporter = new SpecReporter('docs/specs/backend/external.md');
    const result = parseExternalCatalog({ doc_type: 'external_spec', id: 'external-catalog', vocabulary: { service: [service] }, integrations: [] }, reporter);
    return { terms: result.value?.vocabulary.service ?? [], messages: result.findings.map((finding) => finding.message) };
  }

  it('省略は空で読める', () => {
    const { terms } = parse({ id: 'notion', adapter_root: 'app/src/infrastructure/notion' });
    expect(terms[0]).toMatchObject({ sdkPackages: [], clientUi: [] });
  });

  it('宣言を読む', () => {
    const { terms } = parse({ id: 'anthropic', adapter_root: 'a', sdk_packages: ['@ai-sdk/*', 'ai'], client_ui: [{ file: 'x.tsx', packages: ['@ai-sdk/react'] }] });
    expect(terms[0]).toMatchObject({ sdkPackages: ['@ai-sdk/*', 'ai'], clientUi: [{ file: 'x.tsx', packages: ['@ai-sdk/react'] }] });
  });

  it.each([
    ['パッケージの綴りでない', { sdk_packages: ['*'] }, /sdk_packages の \* はパッケージの綴りではありません/u],
    ['client_ui の包みが sdk_packages の外', { sdk_packages: ['ai'], client_ui: [{ file: 'x.tsx', packages: ['@ai-sdk/react'] }] }, /client_ui の x\.tsx の packages\(@ai-sdk\/react\)/u],
    ['client_ui の包みにグロブ', { sdk_packages: ['@ai-sdk/*'], client_ui: [{ file: 'x.tsx', packages: ['@ai-sdk/*'] }] }, /client_ui の x\.tsx の packages/u],
    ['知らないキー', { sdk: ['ai'] }, /sdk/u],
  ])('赤: %s', (_name, extra, pattern) => {
    const { messages } = parse({ id: 'anthropic', adapter_root: 'a', ...extra });
    expect(messages.join('\n')).toMatch(pattern);
  });
});

describe('外へ送る口の閉じた表(outbound-primitives.ts。点検 10 回目 B10-3)', () => {
  it.each([
    ['@kaninabe/runtime/http/safe-fetch', '@kaninabe/runtime/http/safe-fetch'],
    ['@kaninabe/runtime/http/safe-fetch.js', '@kaninabe/runtime/http/safe-fetch'],
    ['node:https', 'node:https'],
    ['https', 'node:https'],
    ['http', 'node:http'],
    ['node:dns/promises', 'node:dns'],
    ['dns', 'node:dns'],
    ['undici', 'undici'],
    ['undici/types', 'undici'],
    ['node:crypto', null],
    ['path', null],
    ['@kaninabe/runtime/http/response', null],
    ['httpx', null],
    ['undici-types', null],
    ['@kaninabe/runtime/http/safe-fetchx', null],
  ] as const)('outboundPrimitiveOf(%s) = %s', (specifier, expected) => {
    expect(outboundPrimitiveOf(specifier)).toBe(expected);
  });

  it('表は Node の通信の組み込みを接頭辞つきで、仕組みの送る口と undici を 1 行ずつ持つ(閉じた表の全部)', () => {
    expect([...OUTBOUND_PRIMITIVE_MODULES].sort()).toEqual(['@kaninabe/runtime/http/safe-fetch', 'node:dgram', 'node:dns', 'node:http', 'node:http2', 'node:https', 'node:net', 'node:tls', 'undici']);
  });
});
