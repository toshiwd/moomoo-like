Option Explicit

' Run start-user.bat without showing console windows.

Dim shell, fso, baseDir, batPath, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = """" & fso.BuildPath(baseDir, "start-user.bat") & """"

cmd = "cmd.exe /c " & batPath
shell.Run cmd, 0, False
