/* UMD — main 프로세스(require)와 renderer(<script>) 양쪽에서 같은 구현을 쓴다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fmt = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 남은 시간을 한국어 문구로. epochMs 가 없으면 null. */
  function formatRemaining(epochMs, now) {
    if (!epochMs) return null;
    const diff = epochMs - (now || Date.now());
    if (diff <= 0) return '곧 초기화';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}일 ${h}시간 후 초기화`;
    if (h > 0) return `${h}시간 ${m}분 후 초기화`;
    return `${Math.max(1, m)}분 후 초기화`;
  }

  /** 창 길이(초) → 라벨 */
  function windowLabelFromSeconds(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '사용량';
    if (s % 604800 === 0) return s === 604800 ? '주간' : `${s / 604800}주`;
    if (s % 86400 === 0) return `${s / 86400}일`;
    if (s % 3600 === 0) return `${s / 3600}시간`;
    return `${Math.round(s / 60)}분`;
  }

  /** 백분율 → 'ok' | 'warn' | 'danger' */
  function severity(percent) {
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warn';
    return 'ok';
  }

  /** 소수점 없이, 0%도 1% 미만 사용이면 '<1%' 로. */
  function formatPercent(percent) {
    if (percent > 0 && percent < 1) return '<1%';
    return `${Math.round(percent)}%`;
  }

  /** 오늘이면 HH:MM, 다른 날이면 M/D HH:MM. */
  function formatClock(epochMs, now) {
    if (!epochMs) return '';
    const d = new Date(epochMs);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const today = new Date(now || Date.now());
    const sameDay = d.getFullYear() === today.getFullYear()
      && d.getMonth() === today.getMonth()
      && d.getDate() === today.getDate();
    return sameDay ? hhmm : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
  }

  return { formatRemaining, windowLabelFromSeconds, severity, formatPercent, formatClock };
}));
