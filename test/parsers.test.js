'use strict';

const assert = require('assert');
const U = require('../src/lib/util');
const Fmt = require('../src/lib/format');
const anthropic = require('../src/providers/anthropic');
const openai = require('../src/providers/openai');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

console.log('\nutil');

test('toPercent: 0~1 비율을 백분율로', () => {
  assert.strictEqual(U.toPercent(0.34, { ratioHint: true }), 34);
  assert.strictEqual(U.toPercent(34, { ratioHint: true }), 34);
  assert.strictEqual(U.toPercent(140), 100);
  assert.strictEqual(U.toPercent(null), null);
  assert.strictEqual(U.toPercent('abc'), null);
});

test('toPercent: ratioHint 없으면 1 은 1%', () => {
  assert.strictEqual(U.toPercent(1), 1);
});

test('toEpochMs: 초/밀리초/RFC3339/상대초', () => {
  assert.strictEqual(U.toEpochMs(1778091218), 1778091218000);
  assert.strictEqual(U.toEpochMs(1778091218000), 1778091218000);
  assert.strictEqual(U.toEpochMs('2026-09-15T10:00:00Z'), Date.parse('2026-09-15T10:00:00Z'));
  const rel = U.toEpochMs(3600, { relative: true });
  assert.ok(Math.abs(rel - (Date.now() + 3600000)) < 1500);
  assert.strictEqual(U.toEpochMs(null), null);
});

test('pick: 중첩 경로 우선순위', () => {
  const o = { tokens: { access_token: 'A' }, access_token: 'B' };
  assert.strictEqual(U.pick(o, 'tokens.access_token', 'access_token'), 'A');
  assert.strictEqual(U.pick({ access_token: 'B' }, 'tokens.access_token', 'access_token'), 'B');
  assert.strictEqual(U.pick({}, 'a.b'), undefined);
});

console.log('\nformat');

test('severity 경계값', () => {
  assert.strictEqual(Fmt.severity(69), 'ok');
  assert.strictEqual(Fmt.severity(70), 'warn');
  assert.strictEqual(Fmt.severity(89), 'warn');
  assert.strictEqual(Fmt.severity(90), 'danger');
});

test('formatPercent: 0 초과 1 미만은 <1%', () => {
  assert.strictEqual(Fmt.formatPercent(0), '0%');
  assert.strictEqual(Fmt.formatPercent(0.4), '<1%');
  assert.strictEqual(Fmt.formatPercent(34.6), '35%');
});

test('formatRemaining', () => {
  const now = Date.now();
  assert.strictEqual(Fmt.formatRemaining(now - 1000, now), '곧 초기화');
  assert.strictEqual(Fmt.formatRemaining(now + 90 * 60000, now), '1시간 30분 후 초기화');
  assert.strictEqual(Fmt.formatRemaining(now + 30000, now), '1분 후 초기화');
  assert.strictEqual(Fmt.formatRemaining(null), null);
});

test('windowLabelFromSeconds', () => {
  assert.strictEqual(Fmt.windowLabelFromSeconds(18000), '5시간');
  assert.strictEqual(Fmt.windowLabelFromSeconds(604800), '주간');
  assert.strictEqual(Fmt.windowLabelFromSeconds(86400), '1일');
});

console.log('\nanthropic parser');

const CLAUDE_BODY = {
  subscription_type: 'max_20x',
  five_hour: { utilization: 0.42, resets_at: '2026-09-15T10:00:00Z' },
  seven_day: { utilization: 0.13, resets_at: '2026-09-20T10:00:00Z' },
  seven_day_opus: { utilization: 0.91, resets_at: '2026-09-20T10:00:00Z' },
  seven_day_sonnet: null,
  unknown_future_window: { utilization: 0.05, resets_at: null },
  extra_usage: { used_cents: 250, limit_cents: 5000 },
};

test('알려진 창 + 미지의 창을 모두 수집', () => {
  const w = anthropic.collectWindows(CLAUDE_BODY);
  const keys = w.map((x) => x.key);
  assert.deepStrictEqual(keys, ['five_hour', 'seven_day', 'seven_day_opus', 'unknown_future_window']);
  assert.strictEqual(w[0].label, '5시간');
  assert.strictEqual(w[0].percent, 42);
  assert.strictEqual(w[3].label, 'unknown future window');
});

test('알려진 키만 known=true 로 표시', () => {
  const w = anthropic.collectWindows(CLAUDE_BODY);
  assert.strictEqual(w.find((x) => x.key === 'five_hour').known, true);
  assert.strictEqual(w.find((x) => x.key === 'unknown_future_window').known, false);
});

test('null 창은 건너뛴다', () => {
  const w = anthropic.collectWindows(CLAUDE_BODY);
  assert.ok(!w.some((x) => x.key === 'seven_day_sonnet'));
});

test('used_percent 형태의 응답도 수용', () => {
  const w = anthropic.collectWindows({ five_hour: { used_percent: 77, reset_at: 1778091218 } });
  assert.strictEqual(w[0].percent, 77);
  assert.strictEqual(w[0].resetsAt, 1778091218000);
});

test('플랜명 정규화', () => {
  assert.strictEqual(anthropic.planName(CLAUDE_BODY), 'Max 20x');
  assert.strictEqual(anthropic.planName({ rate_limit_tier: 'pro' }), 'Pro');
  assert.strictEqual(anthropic.planName({}), null);
});

console.log('\nopenai parser');

const CODEX_BODY = {
  rate_limit: {
    primary_window: { used_percent: 34, limit_window_seconds: 18000, reset_at: 1778091218 },
    secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_after_seconds: 7200 },
    additional_rate_limits: [
      { name: 'Spark', used_percent: 5, limit_window_seconds: 604800, reset_at: 1778091218 },
    ],
  },
};

test('primary/secondary/additional 을 순서대로 수집', () => {
  const w = openai.collectWindows(CODEX_BODY);
  assert.strictEqual(w.length, 3);
  assert.deepStrictEqual(w.map((x) => x.label), ['5시간', '주간', 'Spark']);
  assert.deepStrictEqual(w.map((x) => x.percent), [34, 12, 5]);
});

test('reset_after_seconds 는 현재시각 기준 상대값', () => {
  const w = openai.collectWindows(CODEX_BODY);
  assert.ok(Math.abs(w[1].resetsAt - (Date.now() + 7200000)) < 1500);
});

test('rate_limit 이 없으면 빈 배열', () => {
  assert.deepStrictEqual(openai.collectWindows({}), []);
  assert.deepStrictEqual(openai.collectWindows({ rate_limit: {} }), []);
});

test('window_minutes 형태도 라벨로 변환', () => {
  const w = openai.collectWindows({
    rate_limit: { primary_window: { used_percent: 9, window_minutes: 300 } },
  });
  assert.strictEqual(w[0].label, '5시간');
});

console.log(`\n${passed}개 통과\n`);
