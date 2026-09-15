; electron-builder NSIS 커스터마이즈
; 설치 경로 선택 다음에 "Windows 시작 시 자동 실행" 체크박스 페이지를 하나 끼워 넣는다.
; 앱 안(트레이 메뉴 / 설정 마법사)에서도 같은 레지스트리 값을 쓰므로 양쪽이 항상 일치한다.
;
; 주의: 이 파일은 설치 프로그램과 언인스톨러 양쪽 컴파일에 include 된다.
; 언인스톨러 패스(BUILD_UNINSTALLER 정의됨)에는 설치 페이지가 없어서, 커스텀 페이지
; 함수를 그대로 두면 "function not referenced" 경고가 나고 NSIS 는 경고를 에러로 처리한다.
; 그래서 설치 쪽 코드는 전부 !ifndef BUILD_UNINSTALLER 로 감싼다.

!define AUTOSTART_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define AUTOSTART_REG_NAME "AI Token Widget"

!ifndef BUILD_UNINSTALLER

  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var AutoStartCheckbox
  Var AutoStartState

  !macro customPageAfterChangeDir
    Page custom AutoStartPageCreate AutoStartPageLeave
  !macroend

  Function AutoStartPageCreate
    ; MUI_HEADER_TEXT 가 이 시점에 없을 수 있으므로 있을 때만 쓴다.
    !ifmacrodef MUI_HEADER_TEXT
      !insertmacro MUI_HEADER_TEXT "추가 옵션" "설치 후 동작을 선택하세요."
    !endif

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 10u 100% 12u "Windows 시작 시 자동 실행"
    Pop $AutoStartCheckbox
    ${NSD_SetState} $AutoStartCheckbox ${BST_CHECKED}

    ${NSD_CreateLabel} 0 28u 100% 30u "로그인할 때 위젯이 트레이에 자동으로 뜹니다.$\r$\n설치 후에도 트레이 메뉴에서 언제든 켜고 끌 수 있습니다."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function AutoStartPageLeave
    ${NSD_GetState} $AutoStartCheckbox $AutoStartState
  FunctionEnd

  !macro customInstall
    ${If} $AutoStartState == ${BST_CHECKED}
      WriteRegStr HKCU "${AUTOSTART_REG_KEY}" "${AUTOSTART_REG_NAME}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    ${Else}
      DeleteRegValue HKCU "${AUTOSTART_REG_KEY}" "${AUTOSTART_REG_NAME}"
    ${EndIf}
  !macroend

!endif

; 제거할 때는 시작 프로그램 등록도 같이 지운다.
!macro customUnInstall
  DeleteRegValue HKCU "${AUTOSTART_REG_KEY}" "${AUTOSTART_REG_NAME}"
!macroend
