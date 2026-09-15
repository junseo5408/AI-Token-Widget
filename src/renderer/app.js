'use strict';

/* Fmt 는 ../lib/format.js 가 전역으로 노출한다 (main 프로세스와 동일 구현). */
const { formatRemaining, severity, formatPercent, formatClock } = window.Fmt;

const ACCENT = { claude: 'var(--accent-claude)', codex: 'var(--accent-codex)' };

const el = {
  body: document.body,
  content: document.getElementById('content'),
  status: document.getElementById('statusText'),
  refresh: document.getElementById('btnRefresh'),
  pin: document.getElementById('btnPin'),
  theme: document.getElementById('btnTheme'),
  interval: document.getElementById('intervalSelect'),
  display: document.getElementById('displaySelect'),
};

let lastPayload = null;
let config = {};

/* ---------- 렌더 ---------- */

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderMeter(win) {
  // 서버는 항상 "쓴 양"을 준다. 남은 양 표시는 여기서만 뒤집는다.
  const remainingMode = config.display === 'remaining';
  const shown = remainingMode ? 100 - win.percent : win.percent;
  const level = severity(win.percent); // 위험도는 언제나 사용량 기준

  const meter = h('div', `meter meter--${level}`);

  const top = h('div', 'meter__top');
  top.append(h('span', 'meter__label', win.label));
  top.append(h('span', 'meter__value',
    remainingMode ? `${formatPercent(shown)} 남음` : formatPercent(shown)));
  meter.append(top);

  const bar = h('div', 'bar');
  const fill = h('div', 'bar__fill');
  bar.append(fill);
  meter.append(bar);
  // 다음 프레임에 폭을 넣어야 CSS 트랜지션이 동작한다.
  requestAnimationFrame(() => { fill.style.width = `${Math.max(0, Math.min(100, shown))}%`; });

  const remaining = formatRemaining(win.resetsAt);
  if (remaining) {
    const clock = formatClock(win.resetsAt);
    meter.append(h('div', 'meter__caption', clock ? `${remaining} · ${clock}` : remaining));
  }
  return meter;
}

function renderCard(snapshot) {
  const card = h('div', `card${snapshot.error ? ' card--error' : ''}`);
  card.style.setProperty('--accent', ACCENT[snapshot.provider] || 'var(--md-primary)');

  const head = h('div', 'card__head');
  head.append(h('span', 'card__dot'));
  head.append(h('span', 'card__name', snapshot.label));
  if (snapshot.plan) head.append(h('span', 'chip', snapshot.plan));
  card.append(head);

  if (snapshot.error) {
    card.append(h('div', 'error-body', snapshot.error.message));
    if (snapshot.error.hint) card.append(h('div', 'error-hint', snapshot.error.hint));
    return card;
  }

  // known === false 는 응답에 있지만 문서화되지 않은 항목. 기본적으로 감춘다.
  snapshot.windows
    .filter((win) => config.showUnknownWindows || win.known !== false)
    .forEach((win) => card.append(renderMeter(win)));

  if (snapshot.extra) {
    const extra = h('div', 'extra');
    extra.append(h('span', null, snapshot.extra.label));
    extra.append(h('span', 'extra__value',
      `$${snapshot.extra.used.toFixed(2)} / $${snapshot.extra.limit.toFixed(2)}`));
    card.append(extra);
  }
  return card;
}

function renderEmptyState() {
  const card = h('div', 'card card--empty');
  card.append(h('div', 'empty-body', '표시할 서비스가 없습니다'));
  card.append(h('div', 'empty-hint', '트레이 아이콘 우클릭 → 표시할 서비스 에서 선택하세요.'));
  return card;
}

function render(payload) {
  lastPayload = payload;
  el.content.replaceChildren(
    ...(payload.providers.length ? payload.providers.map(renderCard) : [renderEmptyState()])
  );
  // 모의 데이터를 실제 값으로 오해하지 않도록 눈에 띄게 표시한다.
  el.status.textContent = payload.mock
    ? `⚠ 모의 데이터 · ${formatClock(payload.fetchedAt)}`
    : `${formatClock(payload.fetchedAt)} 기준`;
  el.status.classList.toggle('status-bar__text--mock', !!payload.mock);
}

/* ---------- 데이터 ---------- */

async function refresh() {
  el.refresh.classList.add('is-spinning');
  el.status.textContent = '불러오는 중…';
  try {
    render(await window.widget.fetchUsage());
  } catch (e) {
    el.status.textContent = `오류: ${e.message || e}`;
  } finally {
    el.refresh.classList.remove('is-spinning');
  }
}

/* 카운트다운 문구만 1분마다 다시 그린다. */
setInterval(() => { if (lastPayload) render(lastPayload); }, 60000);

/* ---------- 설정 / 조작 ---------- */

function applyConfig(next) {
  config = next;
  el.body.className = next.theme === 'light' ? 'theme-light' : 'theme-dark';
  el.pin.setAttribute('aria-pressed', String(!!next.alwaysOnTop));
  el.interval.value = String(next.refreshSeconds);
  el.display.value = next.display || 'used';
  document.documentElement.style.setProperty('--widget-opacity', String(next.opacity ?? 0.96));
  if (lastPayload) render(lastPayload);
}

el.refresh.addEventListener('click', refresh);

el.pin.addEventListener('click', async () => {
  applyConfig(await window.widget.setConfig({ alwaysOnTop: !config.alwaysOnTop }));
});

el.theme.addEventListener('click', async () => {
  applyConfig(await window.widget.setConfig({ theme: config.theme === 'light' ? 'dark' : 'light' }));
});

el.display.addEventListener('change', async () => {
  applyConfig(await window.widget.setConfig({ display: el.display.value }));
});

el.interval.addEventListener('change', async () => {
  applyConfig(await window.widget.setConfig({ refreshSeconds: Number(el.interval.value) }));
});

window.widget.onUsage(render);
window.widget.onConfig(applyConfig);   // 트레이 메뉴에서 바꾼 설정 반영

(async () => {
  applyConfig(await window.widget.getConfig());
  await refresh();
})();
