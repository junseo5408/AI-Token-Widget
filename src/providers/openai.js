'use strict';

const U = require('../lib/util');

/**
 * ChatGPT 구독(Plus/Pro/Business)의 Codex 사용량.
 *
 * 비공식 엔드포인트: GET https://chatgpt.com/backend-api/wham/usage
 *   headers: Authorization: Bearer <access token>
 *            chatgpt-account-id: <account id>
 *
 * 토큰 출처: %USERPROFILE%\.codex\auth.json  ($CODEX_HOME/auth.json)
 *   { "tokens": { "access_token": "...", "account_id": "...", "id_token": "..." } }
 *
 * 주의: 여기서 보이는 건 "Codex 사용량"이다. ChatGPT 웹/앱 대화의 메시지 한도는
 *       공개된 조회 경로가 없어서 이 위젯으로 가져올 수 없다.
 */

const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';
const USER_AGENT = 'codex_cli_rs/0.56.0';

/** @returns {{token:string|null, accountId:string|null, plan:string|null, source:string}} */
function loadToken(config = {}) {
  const candidates = [
    config.codexAuthPath,
    process.env.CODEX_HOME ? `${process.env.CODEX_HOME}/auth.json` : null,
    U.homePath('.codex', 'auth.json'),
  ];
  const file = U.firstExisting(candidates);
  const json = file ? U.readJsonSafe(file) : null;
  if (!json) return { token: null, accountId: null, plan: null, source: 'none' };

  const token = U.pick(json, 'tokens.access_token', 'access_token', 'accessToken');
  const accountId = U.pick(json, 'tokens.account_id', 'account_id', 'accountId');
  const idToken = U.pick(json, 'tokens.id_token', 'id_token');
  const claims = idToken ? U.decodeJwtPayload(idToken) : null;
  const plan =
    U.pick(claims || {}, 'https://api.openai.com/auth.chatgpt_plan_type', 'chatgpt_plan_type') ||
    null;

  return {
    token: token || null,
    accountId: accountId || U.pick(claims || {}, 'https://api.openai.com/auth.chatgpt_account_id') || null,
    plan: plan ? String(plan).replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    source: file || 'none',
  };
}

/** rate limit 창 하나를 정규화. */
function normalizeWindow(key, value, fallbackLabel) {
  if (!value || typeof value !== 'object') return null;
  const percent = U.toPercent(
    U.pick(value, 'used_percent', 'usedPercent', 'utilization', 'percent'),
    { ratioHint: false }
  );
  if (percent === null) return null;

  const rawSeconds = U.pick(value, 'limit_window_seconds', 'limitWindowSeconds');
  const rawMinutes = U.pick(value, 'window_minutes', 'windowMinutes');
  const seconds = Number.isFinite(Number(rawSeconds))
    ? Number(rawSeconds)
    : Number.isFinite(Number(rawMinutes))
      ? Number(rawMinutes) * 60
      : null;

  const resetsAt =
    U.toEpochMs(U.pick(value, 'reset_at', 'resets_at', 'resetsAt')) ??
    U.toEpochMs(U.pick(value, 'reset_after_seconds', 'resets_in_seconds'), { relative: true });

  const label =
    U.pick(value, 'name', 'label') ||
    (seconds ? U.windowLabelFromSeconds(seconds) : fallbackLabel || key);

  return U.makeWindow({ key, label: String(label), percent, resetsAt });
}

/** primary/secondary + 모델별 추가 한도를 한 배열로 모은다. */
function collectWindows(body) {
  const rl = U.pick(body, 'rate_limit', 'rateLimit') || {};
  const windows = [];

  const primary = normalizeWindow('primary', U.pick(rl, 'primary_window', 'primary'), '세션');
  if (primary) windows.push(primary);

  const secondary = normalizeWindow('secondary', U.pick(rl, 'secondary_window', 'secondary'), '주간');
  if (secondary) windows.push(secondary);

  const additional = U.pick(rl, 'additional_rate_limits', 'additionalRateLimits') || [];
  if (Array.isArray(additional)) {
    additional.forEach((item, i) => {
      const w = normalizeWindow(`extra_${i}`, item, `추가 한도 ${i + 1}`);
      if (w) windows.push(w);
    });
  }
  return windows;
}

async function fetchUsage(config = {}) {
  const label = 'Codex (ChatGPT)';
  const { token, accountId, plan, source } = loadToken(config);

  if (!token) {
    return U.errorSnapshot('codex', label, 'NO_TOKEN', '로그인 정보를 찾을 수 없습니다',
      'Codex CLI 에서 `codex login` 을 실행하세요.');
  }

  const headers = {
    authorization: `Bearer ${token}`,
    'user-agent': USER_AGENT,
    accept: 'application/json',
  };
  if (accountId) headers['chatgpt-account-id'] = accountId;

  let res;
  try {
    res = await U.fetchJson(ENDPOINT, { headers });
  } catch (e) {
    return U.errorSnapshot('codex', label, 'NETWORK', '네트워크 오류', String(e.message || e));
  }

  U.debugDump('codex', { status: res.status, body: res.body, rawIfUnparsed: res.body ? undefined : res.raw });

  if (res.status === 401 || res.status === 403) {
    return U.errorSnapshot('codex', label, 'UNAUTHORIZED', '인증 실패 (재로그인 필요)',
      '`codex login` 을 다시 실행하세요.');
  }
  if (res.status === 429) {
    return U.errorSnapshot('codex', label, 'RATE_LIMITED', '조회 요청이 제한되었습니다');
  }
  if (!res.ok || !res.body) {
    return U.errorSnapshot('codex', label, 'HTTP_' + res.status, `응답 오류 (${res.status})`);
  }

  const windows = collectWindows(res.body);
  if (windows.length === 0) {
    return U.errorSnapshot('codex', label, 'EMPTY', '사용량 데이터가 비어 있습니다',
      'Codex 를 한 번이라도 사용해야 창이 생깁니다.');
  }

  return {
    provider: 'codex',
    label,
    plan,
    windows,
    extra: null,
    error: null,
    tokenSource: source,
  };
}

const meta = {
  id: 'codex',
  label: 'Codex (ChatGPT)',
  cliCommand: 'codex',
  npmPackage: '@openai/codex',
  loginCommand: 'codex login',
  loginHint: '브라우저가 열리면 ChatGPT 계정으로 로그인하세요.',
  note: 'ChatGPT 구독의 Codex 사용량. ChatGPT 웹 대화 한도는 조회할 수 없습니다.',
};

function isAuthenticated(config = {}) {
  return Boolean(loadToken(config).token);
}

module.exports = {
  meta, isAuthenticated,
  fetchUsage, loadToken, collectWindows, normalizeWindow, ENDPOINT,
};
