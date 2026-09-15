# AI Token Widget

Claude(Pro/Max)와 ChatGPT(Codex) 구독의 **남은 사용량**을 바탕화면에 띄워두는 위젯.

5시간 창과 주간 창을 각각 막대로 보여주고, 언제 초기화되는지 함께 표시합니다.

## 설치

[Releases](../../releases)에서 `AI-Token-Widget-Setup-1.0.0.exe`를 받아 실행하세요.
관리자 권한이 필요 없고, 설치 중 "Windows 시작 시 자동 실행"을 선택할 수 있습니다.
서명이 없어서 처음 실행할 때 SmartScreen이 "추가 정보 → 실행"을 요구할 수 있습니다.

**Claude Code CLI 또는 Codex CLI가 설치되어 있고 로그인된 상태여야 합니다.**
둘 중 하나만 있어도 됩니다. 없으면 첫 실행 때 뜨는 설정 마법사에서 바로 설치할 수 있습니다.

## 로그인 정보를 어떻게 읽나

```
Claude Code CLI 로그인  →  ~/.claude/.credentials.json  ─┐
                                                          ├→  위젯이 읽어서 사용량 조회
Codex CLI 로그인        →  ~/.codex/auth.json          ─┘
```

- **API 키를 요구하지 않습니다.** 위젯에 무언가를 입력할 일이 없습니다.
- 이미 로그인해 둔 CLI가 저장한 토큰을 **읽기만** 합니다. 갱신하거나 무효화하지 않으므로
  CLI 세션이 로그아웃되지 않습니다.
- 토큰은 이 PC 밖으로 나가지 않습니다. 해당 서비스의 사용량 조회에만 쓰입니다.

## 무엇을 보여주나

| 항목 | 표시 |
|---|---|
| Claude 구독 사용량 | 5시간 창, 주간 창, 모델별 주간 창 |
| Codex 사용량 | 5시간 창, 주간 창 |

사용량 수치는 각 서비스가 자기 앱에서 쓰는 것과 같은 내부 경로에서 가져옵니다.
공식 문서에 없는 경로라 예고 없이 바뀌거나 동작하지 않을 수 있습니다.

## 조작

트레이 아이콘을 클릭하면 숨기기/보이기, 우클릭하면 메뉴가 열립니다.
작업 표시줄에는 뜨지 않습니다.

| 동작 | 방법 |
|---|---|
| 이동 | 위쪽 손잡이나 아래쪽 바를 드래그 |
| 새로고침 | 하단 ↻ |
| 항상 위 고정 | 하단 📌 |
| 다크 / 라이트 | 하단 ◐ |
| 사용량 ↔ 남은 양 | 하단 드롭다운 (각 서비스 공식 화면은 "남음" 기준) |
| 갱신 주기 | 하단 드롭다운 (1 / 2 / 5 / 15분) |
| 표시할 서비스 | 트레이 우클릭 → 표시할 서비스 |
| 설정 다시 하기 | 트레이 우클릭 → 설정 마법사… |
| 종료 | 트레이 우클릭 → 종료 |

설정은 `%APPDATA%\ai-token-widget\config.json`에 저장됩니다.

## 문제가 생기면

| 화면 문구 | 대처 |
|---|---|
| 로그인 정보를 찾을 수 없습니다 | 해당 CLI로 로그인하세요 (`claude` 또는 `codex login`) |
| 인증 실패 (재로그인 필요) | 같은 명령을 한 번 실행하면 갱신됩니다 |
| 조회 요청이 제한되었습니다 | 갱신 주기를 늘리세요 |
| 사용량 데이터가 비어 있습니다 | 구독 계정이 아니거나 아직 사용 이력이 없습니다 |

한쪽이 실패해도 다른 쪽은 정상으로 표시됩니다.

Claude Code를 WSL에서만 쓰신다면 위젯이 WSL 안의 자격증명도 자동으로 찾습니다.
그래도 못 찾으면 `config.json`의 `claudeCredentialsPath`에 전체 경로를 직접 넣으면 됩니다.

## 직접 빌드하기

```powershell
npm install
npm start          # 실행
npm test           # 파서 테스트
npm run build      # dist\ 에 설치본 + 무설치 exe
```

UI만 먼저 보려면 `$env:WIDGET_MOCK=1; npm start` (로그인·네트워크 불필요).

<details>
<summary>빌드가 막힐 때</summary>

**PowerShell에서 `npm`이 "앱을 선택하여 여세요" 창을 띄운다**
→ `npm.cmd`로 부르거나 cmd 창에서 실행하세요.

**`Cannot create symbolic link ... winCodeSign ...`**
→ 설정 → 시스템 → 개발자용에서 **개발자 모드**를 켜거나, 관리자 PowerShell에서 한 번만
빌드하세요. 캐시가 풀리면 이후로는 일반 권한으로 됩니다. 재시도 전에
`Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"`.

</details>

## 구조

```
providers/anthropic.js ─┐
                        ├→ 정규화된 snapshot → renderer (Material Design 3 UI)
providers/openai.js   ─┘
```

두 서비스의 응답 형태가 서로 다르지만 아래 한 가지 모양으로 맞춰서 넘기므로,
UI는 어느 서비스인지 몰라도 그릴 수 있습니다.

```js
{
  provider, label, plan,
  windows: [{ key, label, percent /* 0~100 */, resetsAt /* epoch ms */ }],
  error: null | { code, message, hint }
}
```

응답 필드명이 바뀔 수 있어서, 파서는 모르는 항목이라도 사용률 값을 가지고 있으면
버리지 않고 잡아둡니다. `test/parsers.test.js`가 이 동작을 검증합니다.

```
src/
  main.js            창 · 트레이 · IPC · 갱신 스케줄
  preload.js         contextBridge (nodeIntegration 꺼짐)
  lib/               공통 정규화 · 포맷 헬퍼
  providers/         Claude · Codex
  renderer/          위젯 UI
  setup/             설정 마법사
build/               아이콘, NSIS 설치 스크립트
test/                파서 테스트
```
