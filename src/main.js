'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const PROVIDERS = require('./providers');
const setupTools = require('./lib/setup-tools');

// Windows 에서 투명 창 + setOpacity 를 같이 쓰면 모서리에 잔상이 남는다.
// 투명도는 렌더러 CSS 로 주고, GPU 합성도 끈다.
app.disableHardwareAcceleration();

const DEFAULT_CONFIG = {
  refreshSeconds: 120,
  theme: 'dark',          // 'dark' | 'light'
  display: 'used',        // 'used' = 사용량, 'remaining' = 남은 양
  opacity: 0.96,
  alwaysOnTop: true,
  bounds: null,           // { x, y }
  providers: null,        // { claude: true, codex: true } — null 이면 전부 사용
  showUnknownWindows: false, // 문서화되지 않은 사용량 항목까지 보여줄지
  setupDone: false,
  claudeCredentialsPath: null,
  codexAuthPath: null,
};

let win = null;
let setupWin = null;
let tray = null;
let config = { ...DEFAULT_CONFIG };
let refreshTimer = null;

/* ---------- config ---------- */

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

function saveConfig(patch = {}) {
  config = { ...config, ...patch };
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch { /* 저장 실패해도 동작은 계속 */ }
  return config;
}

/* ---------- usage ---------- */

/** WIDGET_MOCK=1 로 실행하면 네트워크 없이 UI 를 미리 볼 수 있다. */
function mockSnapshots() {
  const hours = (n) => Date.now() + n * 3600000;
  return {
    fetchedAt: Date.now(),
    mock: true,
    providers: [
      { provider: 'claude', label: 'Claude', plan: 'Max 20x', error: null,
        extra: { label: '추가 사용량', used: 2.5, limit: 50, unit: 'USD' },
        windows: [
          { key: 'five_hour', label: '5시간', percent: 42, resetsAt: hours(2.4), known: true },
          { key: 'seven_day', label: '주간', percent: 13, resetsAt: hours(96), known: true },
          { key: 'seven_day_opus', label: '주간 Opus', percent: 91, resetsAt: hours(96), known: true },
          { key: 'nimbus_quill', label: 'nimbus quill', percent: 0, resetsAt: null, known: false },
        ] },
      { provider: 'codex', label: 'Codex (ChatGPT)', plan: 'Plus', error: null, extra: null,
        windows: [
          { key: 'primary', label: '5시간', percent: 74, resetsAt: hours(1.2) },
          { key: 'secondary', label: '주간', percent: 28, resetsAt: hours(52) },
        ] },
    ],
  };
}

async function fetchAll() {
  if (process.env.WIDGET_MOCK) {
    const on = new Set(PROVIDERS.enabled(config).map((p) => p.meta.id));
    const m = mockSnapshots();
    return { ...m, providers: m.providers.filter((s) => on.has(s.provider)) };
  }
  const results = await Promise.all(
    PROVIDERS.enabled(config).map((p) =>
      p.fetchUsage(config).catch((e) => ({
        provider: 'unknown',
        label: 'unknown',
        plan: null,
        windows: [],
        extra: null,
        error: { code: 'CRASH', message: String(e && e.message ? e.message : e), hint: null },
      }))
    )
  );
  return { fetchedAt: Date.now(), providers: results };
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const ms = Math.max(30, Number(config.refreshSeconds) || 120) * 1000;
  refreshTimer = setInterval(async () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('usage:push', await fetchAll());
  }, ms);
}

/* ---------- window ---------- */

const TRAY_ICON = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));

/**
 * 개발용 스모크 테스트. WIDGET_SMOKE=1 이면 렌더러 콘솔을 찍고 DOM 상태를 보고한 뒤 종료한다.
 * WIDGET_SMOKE_TARGET 으로 어떤 창을 검사할지 고른다 ('widget' 기본 | 'setup').
 */
function attachSmoke(target, probe) {
  if (!process.env.WIDGET_SMOKE) return;
  const want = process.env.WIDGET_SMOKE_TARGET || 'widget';
  if (target.smokeName !== want) return;

  target.webContents.on('console-message', (_e, level, message) =>
    console.log(`[renderer:${level}] ${message}`));
  target.webContents.on('render-process-gone', (_e, d) => console.log('[renderer gone]', d));
  setTimeout(async () => {
    try {
      console.log('[smoke] dom:', await target.webContents.executeJavaScript(probe));
      if (process.env.WIDGET_SMOKE_SHOT) {
        fs.writeFileSync(process.env.WIDGET_SMOKE_SHOT, (await target.webContents.capturePage()).toPNG());
      }
    } catch (e) {
      console.log('[smoke] error:', e.message);
    }
    app.exit(0);
  }, 6000);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 380;
  const height = 620;
  const saved = config.bounds;

  win = new BrowserWindow({
    width,
    height,
    x: saved ? saved.x : workArea.x + workArea.width - width - 24,
    y: saved ? saved.y : workArea.y + 24,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 320,
    minHeight: 220,
    maximizable: false,
    skipTaskbar: true,   // 작업 표시줄에 띄우지 않는다 (트레이 아이콘으로만 조작)
    alwaysOnTop: config.alwaysOnTop,
    backgroundColor: '#00000000',
    hasShadow: false,      // 네이티브 그림자는 투명 창 모서리를 더럽힌다
    roundedCorners: false, // Win11 DWM 라운딩과 CSS 라운딩이 겹치는 것을 막는다
    thickFrame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.smokeName = 'widget';
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  attachSmoke(win,
    'document.querySelectorAll(".meter").length + " meters / " + document.getElementById("statusText").textContent');

  const persistBounds = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    saveConfig({ bounds: { x: b.x, y: b.y } });
  };
  win.on('moved', persistBounds);
  win.on('close', persistBounds);
  win.on('closed', () => { win = null; });
}

function toggleWindow() {
  if (!win) return createWindow();
  if (win.isVisible()) win.hide();
  else win.show();
}

async function pushUsage() {
  if (win && !win.isDestroyed()) win.webContents.send('usage:push', await fetchAll());
}

/* ---------- 시작 프로그램 등록 ----------
 * 설치 프로그램(build/installer.nsh)도 같은 HKCU\...\Run 값을 쓴다.
 * Electron 의 loginItem API 가 그 값을 그대로 읽고 쓰므로 둘이 어긋나지 않는다.
 * 개발 중(npm start)에는 electron.exe 가 등록되어 버리므로 건드리지 않는다.
 */
/* ---------- 시작 프로그램 ----------
 * 등록/해제는 설치 프로그램(build/installer.nsh)만 담당한다. 앱이 따로 관리하면
 * 값 이름이 어긋나 같은 exe 를 가리키는 항목이 두 개 생긴다.
 * 사용자는 작업 관리자 → 시작 프로그램에서 언제든 끌 수 있다.
 *
 * 앱이 직접 관리하던 시절에 만들어진 항목만 시작할 때 한 번 지운다.
 */
const LEGACY_AUTOSTART_NAMES = ['ai-token-widget', 'Electron'];

function clearLegacyAutoStart() {
  if (!app.isPackaged) return;
  for (const name of LEGACY_AUTOSTART_NAMES) {
    try { app.setLoginItemSettings({ name, openAtLogin: false }); } catch { /* 없으면 그만 */ }
  }
}

/** provider 를 켜고 끈 뒤 메뉴와 위젯을 함께 갱신한다. */
function setProviderEnabled(id, enabled) {
  // 전부 꺼도 된다. 그 경우 위젯은 빈 상태 안내를 보여준다.
  saveConfig({ providers: { ...(config.providers || {}), [id]: enabled } });
  buildTrayMenu();
  pushUsage();
}

function buildTrayMenu() {
  if (!tray) return;
  const flags = config.providers || {};
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '위젯 표시 / 숨기기', click: toggleWindow },
    { label: '지금 새로고침', click: pushUsage },
    { type: 'separator' },
    {
      label: '표시할 서비스',
      submenu: PROVIDERS.list.map((p) => ({
        label: p.meta.label,
        type: 'checkbox',
        checked: flags[p.meta.id] !== false,
        click: (item) => setProviderEnabled(p.meta.id, item.checked),
      })),
    },
    { type: 'separator' },
    { label: '설정 마법사…', click: () => createSetupWindow() },
    { label: '설정 파일 열기', click: () => shell.showItemInFolder(configPath()) },
    { type: 'separator' },
    { label: '종료', click: () => { app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(TRAY_ICON);
  tray.setToolTip('AI Token Widget');
  buildTrayMenu();
  tray.on('click', toggleWindow);
}

/* ---------- 설치 마법사 ---------- */

function createSetupWindow() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return setupWin; }
  setupWin = new BrowserWindow({
    width: 560,
    height: 640,
    title: 'AI Token Widget 설정',
    autoHideMenuBar: true,
    backgroundColor: '#141218',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWin.smokeName = 'setup';
  setupWin.loadFile(path.join(__dirname, 'setup', 'index.html'));
  attachSmoke(setupWin, 'document.querySelectorAll(".prow").length + " rows / " + document.querySelectorAll(".badge").length + " badges"');
  setupWin.on('closed', () => { setupWin = null; });
  return setupWin;
}

/** 각 provider 의 CLI 설치 여부 / 로그인 여부를 한 번에 조사한다. */
async function detectProviders() {
  const npm = await setupTools.npmAvailable();
  const rows = await Promise.all(PROVIDERS.list.map(async (p) => ({
    ...p.meta,
    installed: Boolean(await setupTools.commandPath(p.meta.cliCommand)),
    authenticated: p.isAuthenticated(config),
    enabled: (config.providers || {})[p.meta.id] !== false,
  })));
  return { npmAvailable: Boolean(npm), providers: rows };
}

/* ---------- ipc ---------- */

ipcMain.handle('usage:fetch', fetchAll);
ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', (_e, patch) => {
  const next = saveConfig(patch || {});
  if (win && !win.isDestroyed() && 'alwaysOnTop' in (patch || {})) {
    win.setAlwaysOnTop(!!next.alwaysOnTop);
  }
  if ('refreshSeconds' in (patch || {})) scheduleRefresh();
  return next;
});
ipcMain.handle('setup:detect', detectProviders);

ipcMain.handle('setup:install', async (e, id) => {
  const p = PROVIDERS.byId(id);
  if (!p) return false;
  const send = (chunk) => {
    if (!e.sender.isDestroyed()) e.sender.send('setup:log', { id, chunk });
  };
  send(`npm install -g ${p.meta.npmPackage}\n`);
  const ok = await setupTools.npmInstallGlobal(p.meta.npmPackage, send);
  if (ok && process.platform === 'win32') {
    // 흔한 함정: PowerShell 실행 정책이 npm 이 만든 .ps1 셰임을 막는다.
    send(`\n참고: PowerShell 에서 '${p.meta.cliCommand}' 가 "디지털 서명되지 않았습니다"로 거부되면\n` +
         `      설치가 안 된 게 아니라 실행 정책 문제입니다. 다음 중 하나로 해결합니다.\n` +
         `      · Set-ExecutionPolicy -Scope CurrentUser RemoteSigned\n` +
         `      · 또는 cmd 에서 실행 (${p.meta.cliCommand}.cmd 가 쓰입니다)\n` +
         `      이 마법사의 로그인 버튼은 cmd 를 쓰므로 영향을 받지 않습니다.\n`);
  }
  return ok;
});

ipcMain.handle('setup:login', (_e, id) => {
  const p = PROVIDERS.byId(id);
  return p ? setupTools.openLoginTerminal(p.meta.loginCommand) : false;
});

ipcMain.handle('setup:finish', (_e, selection) => {
  saveConfig({ providers: selection || null, setupDone: true });
  buildTrayMenu();
  if (!win || win.isDestroyed()) createWindow(); else pushUsage();
  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  return config;
});

ipcMain.on('window:hide', () => { if (win) win.hide(); });
ipcMain.on('window:quit', () => app.quit());
ipcMain.on('shell:open', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

/* ---------- lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

  app.whenReady().then(() => {
    loadConfig();
    clearLegacyAutoStart();   // 예전 방식으로 남은 중복 등록 정리
    createTray();
    // 첫 실행이면 위젯 대신 설정 마법사부터 띄운다.
    const forceSetup = process.env.WIDGET_SMOKE_TARGET === 'setup';
    if (!forceSetup && (config.setupDone || process.env.WIDGET_MOCK || process.env.WIDGET_SMOKE)) createWindow();
    else createSetupWindow();
    scheduleRefresh();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // 위젯이므로 창을 닫아도 트레이에 남는다.
  app.on('window-all-closed', (e) => { e.preventDefault && e.preventDefault(); });
}
