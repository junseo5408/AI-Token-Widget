'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const U = require('../lib/util');

/**
 * Claude 구독(Pro/Max) 사용량.
 *
 * 비공식 엔드포인트: GET https://api.anthropic.com/api/oauth/usage
 *   headers: Authorization: Bearer <oauth access token>
 *            anthropic-beta: oauth-2025-04-20
 *            User-Agent: claude-cli/... (다른 UA 는 429 를 맞는다)
 *
 * 토큰 출처 우선순위
 *   1. CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_OAUTH_TOKEN 환경변수
 *   2. config.json 의 claudeCredentialsPath
 *   3. ~/.claude/.credentials.json  (Windows: %USERPROFILE%\.claude\.credentials.json)
 *   4. WSL 안의 ~/.claude/.credentials.json  (\\wsl.localhost\<distro>\home\<user>\...)
 *   5. macOS 키체인 "Claude Code-credentials"
 */

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const USER_AGENT = 'claude-cli/2.0.14 (external, cli)';

const WINDOW_LABELS = {
  five_hour: '5시간',
  seven_day: '주간',
  seven_day_opus: '주간 Opus',
  seven_day_sonnet: '주간 Sonnet',
  seven_day_haiku: '주간 Haiku',
  seven_day_cowork: '주간 Cowork',
  seven_day_routines: '주간 Routines',
};

const WINDOW_ORDER = Object.keys(WINDOW_LABELS);

/** WSL 배포판 안의 홈 디렉터리 후보를 찾는다. 실패해도 조용히 넘어간다. */
function wslCredentialCandidates() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('wsl.exe', ['-l', '-q'], { timeout: 2500, windowsHide: true })
      .toString('utf16le');
    const distros = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const found = [];
    for (const distro of distros) {
      const homeRoot = `\\\\wsl.localhost\\${distro}\\home`;
      if (!fs.existsSync(homeRoot)) continue;
      for (const user of fs.readdirSync(homeRoot)) {
        found.push(path.join(homeRoot, user, '.claude', '.credentials.json'));
      }
    }
    return found;
  } catch {
    return [];
  }
}

/** macOS 키체인 fallback. */
function keychainCredentials() {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 3000 }
    ).toString('utf8');
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** @returns {{token:string|null, expiresAt:number|null, source:string}} */
function loadToken(config = {}) {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_OAUTH_TOKEN;
  if (envToken) return { token: envToken, expiresAt: null, source: 'env' };

  const candidates = [
    config.claudeCredentialsPath,
    U.homePath('.claude', '.credentials.json'),
    U.homePath('.config', 'claude', '.credentials.json'),
    ...wslCredentialCandidates(),
  ];
  const file = U.firstExisting(candidates);
  const json = file ? U.readJsonSafe(file) : keychainCredentials();
  if (!json) return { token: null, expiresAt: null, source: 'none' };

  const token = U.pick(json, 'claudeAiOauth.accessToken', 'accessToken', 'access_token');
  const expiresAt = U.pick(json, 'claudeAiOauth.expiresAt', 'expiresAt', 'expires_at');
  return {
    token: token || null,
    expiresAt: expiresAt ? U.toEpochMs(expiresAt) : null,
    source: file || 'keychain',
  };
}

/** 응답의 창 하나를 정규화한다. 필드명이 바뀌어도 최대한 흡수. */
function normalizeWindow(key, value) {
  if (!value || typeof value !== 'object') return null;
  const rawPercent = U.pick(value, 'utilization', 'used_percent', 'usedPercent', 'percent');
  const percent = U.toPercent(rawPercent, { ratioHint: true });
  if (percent === null) return null;

  const resetsAt =
    U.toEpochMs(U.pick(value, 'resets_at', 'resetsAt', 'reset_at')) ??
    U.toEpochMs(U.pick(value, 'resets_in_seconds', 'reset_after_seconds'), { relative: true });

  return {
    ...U.makeWindow({
      key,
      label: WINDOW_LABELS[key] || key.replace(/_/g, ' '),
      percent,
      resetsAt,
    }),
    // 문서화되지 않은 키는 UI 에서 기본적으로 숨긴다.
    known: Object.prototype.hasOwnProperty.call(WINDOW_LABELS, key),
  };
}

/** 알려진 키를 먼저, 모르는 키는 뒤에 붙여서 창 목록을 만든다. */
function collectWindows(body) {
  const seen = new Set();
  const windows = [];

  for (const key of WINDOW_ORDER) {
    const w = normalizeWindow(key, body[key]);
    seen.add(key);
    if (w) windows.push(w);
  }
  for (const [key, value] of Object.entries(body)) {
    if (seen.has(key)) continue;
    const w = normalizeWindow(key, value);
    if (w) windows.push(w);
  }
  return windows;
}

function planName(body) {
  const sub = U.pick(body, 'subscription_type', 'subscriptionType');
  const tier = U.pick(body, 'rate_limit_tier', 'rateLimitTier');
  const raw = sub || tier;
  if (!raw) return null;
  return String(raw).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extraUsage(body) {
  const extra = U.pick(body, 'extra_usage', 'extraUsage');
  if (!extra || typeof extra !== 'object') return null;
  const used = Number(U.pick(extra, 'used_cents', 'usedCents', 'used'));
  const limit = Number(U.pick(extra, 'limit_cents', 'limitCents', 'limit'));
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return { label: '추가 사용량', used: used / 100, limit: limit / 100, unit: 'USD' };
}

async function fetchUsage(config = {}) {
  const label = 'Claude';
  const { token, expiresAt, source } = loadToken(config);

  if (!token) {
    return U.errorSnapshot('claude', label, 'NO_TOKEN', '로그인 정보를 찾을 수 없습니다',
      'Claude Code 에서 `claude` 로 로그인했는지 확인하세요.');
  }
  if (expiresAt && expiresAt < Date.now()) {
    return U.errorSnapshot('claude', label, 'EXPIRED', '토큰이 만료되었습니다',
      'Claude Code 를 한 번 실행하면 자동으로 갱신됩니다.');
  }

  let res;
  try {
    res = await U.fetchJson(ENDPOINT, {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'user-agent': USER_AGENT,
        accept: 'application/json',
      },
    });
  } catch (e) {
    return U.errorSnapshot('claude', label, 'NETWORK', '네트워크 오류', String(e.message || e));
  }

  U.debugDump('claude', { status: res.status, body: res.body, rawIfUnparsed: res.body ? undefined : res.raw });

  if (res.status === 401 || res.status === 403) {
    return U.errorSnapshot('claude', label, 'UNAUTHORIZED', '인증 실패 (재로그인 필요)');
  }
  if (res.status === 429) {
    return U.errorSnapshot('claude', label, 'RATE_LIMITED', '조회 요청이 제한되었습니다',
      '새로고침 주기를 늘려보세요.');
  }
  if (!res.ok || !res.body) {
    return U.errorSnapshot('claude', label, 'HTTP_' + res.status, `응답 오류 (${res.status})`);
  }

  const windows = collectWindows(res.body);
  if (windows.length === 0) {
    return U.errorSnapshot('claude', label, 'EMPTY', '사용량 데이터가 비어 있습니다',
      '구독 플랜이 아닌 API 계정일 수 있습니다.');
  }

  return {
    provider: 'claude',
    label,
    plan: planName(res.body),
    windows,
    extra: extraUsage(res.body),
    error: null,
    tokenSource: source,
  };
}

/** 설치 마법사가 쓰는 메타데이터. */
const meta = {
  id: 'claude',
  label: 'Claude',
  cliCommand: 'claude',
  npmPackage: '@anthropic-ai/claude-code',
  loginCommand: 'claude',
  loginHint: '브라우저가 열리면 로그인하고, 프롬프트가 뜨면 Ctrl+C 로 빠져나오세요.',
  note: 'Pro/Max 구독 사용량. Claude Code CLI 의 로그인 토큰을 읽습니다.',
};

/** 로그인이 되어 있는지 (토큰 파일/환경변수 존재 여부). */
function isAuthenticated(config = {}) {
  return Boolean(loadToken(config).token);
}

module.exports = {
  meta, isAuthenticated,
  fetchUsage, loadToken, collectWindows, normalizeWindow, planName, ENDPOINT,
};
