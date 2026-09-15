'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/** 공통 헬퍼 모음. provider 모듈들이 전부 여기 함수를 재사용한다. */

/** JSON 파일을 안전하게 읽는다. 없거나 깨졌으면 null. */
function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** 존재하는 첫 번째 경로를 돌려준다. */
function firstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** 중첩 객체에서 첫 번째로 발견되는 값을 꺼낸다. pick(obj, 'a.b', 'c') */
function pick(obj, ...paths) {
  for (const p of paths) {
    let cur = obj;
    for (const seg of String(p).split('.')) {
      if (cur == null || typeof cur !== 'object') { cur = undefined; break; }
      cur = cur[seg];
    }
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

/**
 * 어떤 형태로 오든 0~100 백분율로 정규화한다.
 * 0~1 비율로 오는 경우(utilization=0.34)도 흡수.
 */
function toPercent(value, { ratioHint = false } = {}) {
  // null/undefined/'' 를 0 으로 오해하면 "데이터 없음"이 "0% 사용"으로 보인다.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (ratioHint && n <= 1) return clamp(n * 100);
  return clamp(n);
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

/**
 * 리셋 시각을 epoch ms 로 정규화한다.
 *  - RFC3339 문자열      ("2026-09-15T10:00:00Z")
 *  - unix 초             (1778091218)
 *  - unix 밀리초         (1778091218000)
 *  - 남은 초             ({ afterSeconds: 3600 })
 */
function toEpochMs(value, { relative = false } = {}) {
  if (value == null) return null;
  if (relative) {
    const secs = Number(value);
    return Number.isFinite(secs) ? Date.now() + secs * 1000 : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value > 1e12 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

// 표시용 포맷터는 renderer 와 같은 구현을 공유한다 (lib/format.js).
const { formatRemaining, windowLabelFromSeconds } = require('./format');

/** 정규화된 사용량 창 객체. 모든 provider 가 이 모양으로 반환한다. */
function makeWindow({ key, label, percent, resetsAt = null, note = null }) {
  return { key, label, percent, resetsAt, note };
}

/** 타임아웃 붙은 fetch. 네트워크가 죽어도 위젯이 멈추지 않게. */
async function fetchJson(url, { headers = {}, timeoutMs = 10000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: res.ok, status: res.status, body, raw: text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WIDGET_DEBUG=1 일 때 원본 응답을 파일로 떨군다.
 * 토큰은 애초에 응답 본문에 없지만, 혹시 몰라 토큰처럼 생긴 문자열은 지운다.
 */
function debugDump(name, data) {
  if (!process.env.WIDGET_DEBUG) return;
  try {
    const dir = process.env.WIDGET_DEBUG_DIR || process.cwd();
    const text = JSON.stringify(data, null, 2)
      .replace(/(sk-|eyJ)[A-Za-z0-9._~+/-]{20,}/g, '<redacted>');
    fs.writeFileSync(path.join(dir, `debug-${name}.json`), text, 'utf8');
  } catch { /* 디버그 실패로 위젯이 죽지 않게 */ }
}

/** JWT 페이로드만 디코드 (검증 없음 — 표시용 플랜명 추출에만 사용). */
function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function homePath(...segments) {
  return path.join(os.homedir(), ...segments);
}

/** provider 가 실패했을 때 UI 가 그대로 그릴 수 있는 에러 스냅샷. */
function errorSnapshot(provider, label, code, message, hint = null) {
  return { provider, label, plan: null, windows: [], extra: null, error: { code, message, hint } };
}

module.exports = {
  readJsonSafe,
  firstExisting,
  pick,
  toPercent,
  clamp,
  toEpochMs,
  formatRemaining,
  windowLabelFromSeconds,
  makeWindow,
  fetchJson,
  debugDump,
  decodeJwtPayload,
  homePath,
  errorSnapshot,
};
