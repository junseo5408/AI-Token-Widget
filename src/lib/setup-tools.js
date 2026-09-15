'use strict';

const { execFile, spawn } = require('child_process');
const os = require('os');

/** 설치 마법사가 쓰는 시스템 조작. provider 별로 중복되지 않도록 여기 모아둔다. */

const isWin = process.platform === 'win32';

const fs = require('fs');
const path = require('path');

/**
 * npm 전역 설치 위치. 설치 직후에는 PATH 가 아직 갱신되지 않아
 * where/which 가 못 찾는 경우가 있어서 직접 확인한다.
 */
function npmGlobalCandidates(cmd) {
  if (!isWin) return [];
  const appData = process.env.APPDATA;
  if (!appData) return [];
  return ['.cmd', '.exe', ''].map((ext) => path.join(appData, 'npm', cmd + ext));
}

/** PATH 에서 실행 파일을 찾는다. 없으면 null. */
function commandPath(cmd) {
  return new Promise((resolve) => {
    const finder = isWin ? 'where' : 'which';
    execFile(finder, [cmd], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      const first = err ? null
        : String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) return resolve(first);
      // PATH 에 없어도 npm 전역 폴더에 있으면 설치된 것으로 본다.
      for (const p of npmGlobalCandidates(cmd)) {
        try { if (fs.existsSync(p)) return resolve(p); } catch { /* 무시 */ }
      }
      resolve(null);
    });
  });
}

/** npm 자체가 있는지. 없으면 아무것도 설치할 수 없다. */
function npmAvailable() {
  return commandPath(isWin ? 'npm.cmd' : 'npm').then((p) => p || commandPath('npm'));
}

/**
 * npm 전역 설치. 패키지명은 우리 메타데이터에서만 오므로 임의 입력이 섞이지 않는다.
 * onLog 로 진행 상황을 그대로 흘려보낸다.
 */
function npmInstallGlobal(pkg, onLog) {
  return new Promise((resolve) => {
    const child = spawn(isWin ? 'npm.cmd' : 'npm', ['install', '-g', pkg], {
      shell: isWin,          // npm.cmd 는 shell 없이는 Windows 에서 실행되지 않는다
      windowsHide: true,
    });
    const push = (buf) => onLog(String(buf));
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => { onLog(`\n실행 실패: ${e.message}\n`); resolve(false); });
    child.on('close', (code) => {
      onLog(`\n${code === 0 ? '설치 완료' : `설치 실패 (종료 코드 ${code})`}\n`);
      resolve(code === 0);
    });
  });
}

/**
 * 로그인은 브라우저 인증이 필요해서 별도 콘솔 창에서 대화형으로 띄운다.
 * 창을 띄우기만 하고 기다리지 않는다 — 사용자가 끝내면 '다시 검사' 를 누르면 된다.
 */
function openLoginTerminal(command) {
  if (isWin) {
    spawn('cmd', ['/c', 'start', '"AI Token Widget - 로그인"', 'cmd', '/k', command], {
      detached: true,
      windowsHide: false,
    }).unref();
    return true;
  }
  const term = process.platform === 'darwin'
    ? ['osascript', ['-e', `tell app "Terminal" to do script "${command}"`]]
    : ['x-terminal-emulator', ['-e', command]];
  try {
    spawn(term[0], term[1], { detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { commandPath, npmAvailable, npmInstallGlobal, openLoginTerminal, isWin, homedir: os.homedir };
