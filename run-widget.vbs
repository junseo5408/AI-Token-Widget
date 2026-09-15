' 콘솔 창 없이 위젯을 실행한다. 더블클릭하거나 바로가기를 만들어 쓰면 된다.
' PowerShell 을 닫아도 위젯은 그대로 남는다.
Option Explicit

Dim sh, fso, dir, exe
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(exe) Then
  MsgBox "Electron 이 설치되어 있지 않습니다." & vbCrLf & _
         "이 폴더에서 npm install 을 먼저 실행하세요:" & vbCrLf & dir, 48, "AI Token Widget"
  WScript.Quit 1
End If

' 세 번째 인자 False = 종료를 기다리지 않음, 두 번째 인자 0 = 창 숨김
sh.Run """" & exe & """ """ & dir & """", 0, False
