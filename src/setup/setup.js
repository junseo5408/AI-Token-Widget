'use strict';

const el = {
  rows: document.getElementById('rows'),
  log: document.getElementById('log'),
  recheck: document.getElementById('btnRecheck'),
  finish: document.getElementById('btnFinish'),
  npmWarn: document.getElementById('npmWarn'),
};

let state = { npmAvailable: false, providers: [] };
let npmMissing = false;

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function appendLog(chunk) {
  el.log.hidden = false;
  el.log.textContent += chunk;
  el.log.scrollTop = el.log.scrollHeight;
}

/**
 * 위젯이 실제로 필요한 건 CLI 가 아니라 CLI 가 저장해 둔 토큰이다.
 * 그래서 로그인 여부를 먼저 본다 — CLI 를 지웠거나 다른 곳에 설치했어도
 * 토큰만 있으면 위젯은 정상 동작한다.
 */
function statusBadge(p) {
  if (p.authenticated) return { text: '준비됨', cls: 'badge--ok' };
  if (p.installed) return { text: '로그인 필요', cls: 'badge--warn' };
  return { text: '미설치', cls: 'badge--bad' };
}

function renderRow(p) {
  const row = h('div', 'prow');

  const head = h('div', 'prow__head');
  const check = h('input', 'prow__check');
  check.type = 'checkbox';
  check.checked = p.enabled;
  check.dataset.id = p.id;
  check.addEventListener('change', updateFinishState);
  head.append(check, h('span', 'prow__name', p.label));

  const badge = statusBadge(p);
  const status = h('div', 'prow__status');
  status.append(h('span', `badge ${badge.cls}`, badge.text));
  head.append(status);
  row.append(head);

  row.append(h('p', 'prow__note', p.note));

  const buttons = h('div', 'prow__buttons');

  // 준비된 provider 에는 버튼을 띄우지 않는다.
  if (!p.authenticated && !p.installed) {
    const install = h('button', 'btn btn--filled btn--sm', `${p.cliCommand} 설치`);
    install.disabled = npmMissing;
    install.addEventListener('click', async () => {
      install.disabled = true;
      install.textContent = '설치 중…';
      await window.widget.setupInstall(p.id);
      await detect();
    });
    buttons.append(install);
  } else if (!p.authenticated) {   // 설치는 됐고 로그인만 남음
    const login = h('button', 'btn btn--filled btn--sm', '로그인');
    login.addEventListener('click', async () => {
      await window.widget.setupLogin(p.id);
      appendLog(`\n[${p.label}] 별도 콘솔 창에서 로그인하세요. ${p.loginHint}\n완료 후 '다시 검사'를 누르세요.\n`);
    });
    buttons.append(login);
  }

  if (buttons.childElementCount) row.append(buttons);
  return row;
}

function updateFinishState() {
  const anyChecked = [...el.rows.querySelectorAll('.prow__check')].some((c) => c.checked);
  el.finish.disabled = !anyChecked;
}

async function detect() {
  el.rows.replaceChildren(h('div', 'setup__loading', '검사 중…'));
  state = await window.widget.setupDetect();
  npmMissing = !state.npmAvailable;
  el.npmWarn.hidden = !npmMissing;
  el.rows.replaceChildren(...state.providers.map(renderRow));
  updateFinishState();
}

el.recheck.addEventListener('click', detect);

el.finish.addEventListener('click', async () => {
  const selection = {};
  el.rows.querySelectorAll('.prow__check').forEach((c) => { selection[c.dataset.id] = c.checked; });
  el.finish.disabled = true;
  await window.widget.setupFinish(selection);
});

window.widget.onSetupLog(({ chunk }) => appendLog(chunk));

detect();
