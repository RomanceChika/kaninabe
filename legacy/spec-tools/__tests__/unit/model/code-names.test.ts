/**
 * 生成 TS にそのまま置かれる名前の文法(R17)の単体テスト。敵対的な値が読み込みで落ち、現行の書き方が通ることを見る。
 */

import { describe, expect, it } from 'vitest';
import { modulePathProblem, routePathProblem, typeNameProblem, valueNameProblem } from '../../../lib/model/code-names.js';

describe('型・ポートの名前', () => {
  it.each(['PaymentNoticeReceiver', 'DeliveryPort', 'A1'])('%s は通る', (value) => {
    expect(typeNameProblem(value)).toBeNull();
  });

  it.each(["X } from 'x'; import { Y", 'deliveryPort', 'Port;', 'Port Name', ''])('%s は落ちる', (value) => {
    expect(typeNameProblem(value)).not.toBeNull();
  });
});

describe('純関数の名前', () => {
  it.each(['calculateOrderTotal', 'claimTotalAmount', 'f'])('%s は通る', (value) => {
    expect(valueNameProblem(value)).toBeNull();
  });

  it.each(["evil } from 'x'; import { y", 'Calc', 'a-b', 'a.b', '$x'])('%s は落ちる', (value) => {
    expect(valueNameProblem(value)).not.toBeNull();
  });
});

describe('HTTP の入口の経路', () => {
  it.each(['/api/jobs/run', '/api/auth/callback', '/api/tutorial-sync/run_now'])('%s は通る', (value) => {
    expect(routePathProblem(value)).toBeNull();
  });

  it.each(["/api/x';import'evil", '/api/../x', '/api/x?y=1', 'api/x', '/api//x', '/API/x', '/'])('%s は落ちる', (value) => {
    expect(routePathProblem(value)).not.toBeNull();
  });
});

describe('TS モジュールのパス', () => {
  it.each(['app/src/infrastructure/payments/receive-notice.ts', 'app/src/x.y.ts'])('%s は通る', (value) => {
    expect(modulePathProblem(value)).toBeNull();
  });

  it.each(["app/src/x';evil.ts", 'app/../x.ts', './x.ts', '/abs/x.ts', 'app/src/x.js', 'app/src/x y.ts'])('%s は落ちる', (value) => {
    expect(modulePathProblem(value)).not.toBeNull();
  });
});
