Option Explicit

'============================================================
' export_pan.vbs  (Pan ActiveMarket から TXT 書き出し)
'
' 出力形式（1行）:
'   code,YYYY/MM/DD,Open,High,Low,Close,Volume
'
' 重要:
'   ActiveMarket が 32bit COM の環境が多いので、
'   64bit WSH で起動された場合は SysWOW64 の cscript に自己リランチする。
'============================================================

' ===== Progress =====
Const PROGRESS_INTERVAL = 500

' ===== FileSystemObject constants =====
Const ForReading   = 1
Const ForWriting   = 2
Const ForAppending = 8

' ===== Retry settings =====
Const COM_CREATE_RETRY_COUNT = 15
Const COM_CREATE_RETRY_SLEEP_MS = 1000

' ===== Adjusted price switch =====
Const USE_ADJUSTED_PRICE = True   ' True=調整後を試す / False=未調整のまま

Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")

Call Main()

Sub Main()

    Ensure32BitCscriptHostOrRelaunch

    Dim baseFolder, codesFile, outFolder
    Dim cal, prices
    Dim tsCodes
    Dim totalCount, okCount, errCount
    Dim sLine, code

    totalCount = 0
    okCount    = 0
    errCount   = 0

    baseFolder = fso.GetParentFolderName(WScript.ScriptFullName)
    codesFile  = baseFolder & "\code.txt"
    outFolder  = baseFolder & "\txt"

    If Not fso.FileExists(codesFile) Then
        SafeOut "ERROR: code.txt not found: " & codesFile
        WScript.Quit 1
    End If

    If Not fso.FolderExists(outFolder) Then
        On Error Resume Next
        fso.CreateFolder outFolder
        On Error GoTo 0
    End If

    Set cal = Nothing
    Set prices = Nothing
    If Not CreateActiveMarketObjectsWithRetry(cal, prices) Then
        SafeOut "ERROR: ActiveMarket objects could not be created."
        SafeOut "HOST : " & WScript.FullName
        SafeOut "HINT : Use 32bit cscript (SysWOW64)."
        SafeOut "TRY  : %SystemRoot%\SysWOW64\cscript.exe //nologo ""export_pan.vbs"""
        WScript.Quit 1
    End If

    Set tsCodes = fso.OpenTextFile(codesFile, ForReading, False)

    SafeOut "=== Pan Export Start ==="
    SafeOut "BASE : " & baseFolder
    SafeOut "CODES: " & codesFile
    SafeOut "OUT  : " & outFolder
    SafeOut "HOST : " & WScript.FullName

    Do While Not tsCodes.AtEndOfStream

        sLine = Trim(RemoveBOM(tsCodes.ReadLine))

        If Len(sLine) > 0 Then
            If Left(sLine, 1) <> "#" And Left(sLine, 1) <> "'" Then

                code = NormalizeCode(sLine)

                If Len(code) > 0 Then
                    totalCount = totalCount + 1

                    If ExportOneCode_Incremental(code, outFolder, cal, prices) Then
                        okCount = okCount + 1
                    Else
                        errCount = errCount + 1
                    End If
                End If

            End If
        End If

    Loop

    tsCodes.Close

    SafeOut "=== Pan Export Done ==="
    SafeOut "TOTAL: " & totalCount
    SafeOut "OK   : " & okCount
    SafeOut "ERR  : " & errCount

    If errCount > 0 Then
        WScript.Quit 2
    Else
        WScript.Quit 0
    End If

End Sub


'============================================================
' 32bit cscript を強制（64bit OS で System32 側 WSH の場合は SysWOW64 に寄せる）
'============================================================
Sub Ensure32BitCscriptHostOrRelaunch()

    Dim shell, env, sysRoot, hostPath
    Dim is64OS, isCscript, isSystem32Host
    Dim targetCscript, cmd, i

    hostPath = LCase(WScript.FullName)
    isCscript = (InStr(hostPath, "\cscript.exe") > 0)

    Set shell = CreateObject("WScript.Shell")
    Set env = shell.Environment("PROCESS")

    sysRoot = env("SystemRoot")
    If Len(sysRoot) = 0 Then sysRoot = "C:\Windows"

    is64OS = False
    If UCase(env("PROCESSOR_ARCHITECTURE")) = "AMD64" Then is64OS = True
    If Len(env("PROCESSOR_ARCHITEW6432")) > 0 Then is64OS = True

    isSystem32Host = (InStr(hostPath, "\system32\") > 0)

    ' 64bit OS かつ System32 側で動いていたら、SysWOW64 cscript に委譲
    If is64OS And isSystem32Host Then
        targetCscript = sysRoot & "\SysWOW64\cscript.exe"
        If fso.FileExists(targetCscript) Then
            cmd = Q(targetCscript) & " //nologo " & Q(WScript.ScriptFullName)
            If WScript.Arguments.Count > 0 Then
                For i = 0 To WScript.Arguments.Count - 1
                    cmd = cmd & " " & Q(WScript.Arguments(i))
                Next
            End If
            shell.Run cmd, 1, True
            WScript.Quit 0
        End If
    End If

    ' wscript などで起動されていたら cscript に寄せる（bit数は上の分岐で寄せ済みのはず）
    If Not isCscript Then
        targetCscript = sysRoot & "\SysWOW64\cscript.exe"
        If Not fso.FileExists(targetCscript) Then
            targetCscript = sysRoot & "\System32\cscript.exe"
        End If

        cmd = Q(targetCscript) & " //nologo " & Q(WScript.ScriptFullName)
        If WScript.Arguments.Count > 0 Then
            For i = 0 To WScript.Arguments.Count - 1
                cmd = cmd & " " & Q(WScript.Arguments(i))
            Next
        End If

        shell.Run cmd, 1, True
        WScript.Quit 0
    End If

End Sub


'============================================================
' ActiveMarket オブジェクト生成（リトライ）
'============================================================
Function CreateActiveMarketObjectsWithRetry(ByRef cal, ByRef prices)

    Dim i
    CreateActiveMarketObjectsWithRetry = False

    For i = 1 To COM_CREATE_RETRY_COUNT

        On Error Resume Next
        Err.Clear

        Set cal = Nothing
        Set prices = Nothing

        Set cal = CreateObjectByCandidates(Array("ActiveMarket.Calendar", "ActiveMarket.Calendar.1"))
        Set prices = CreateObjectByCandidates(Array("ActiveMarket.Prices", "ActiveMarket.Prices.1"))

        If (Err.Number = 0) And (Not cal Is Nothing) And (Not prices Is Nothing) Then
            CreateActiveMarketObjectsWithRetry = True
            On Error GoTo 0
            Exit Function
        End If

        Err.Clear
        On Error GoTo 0

        WScript.Sleep COM_CREATE_RETRY_SLEEP_MS
    Next

End Function


Function CreateObjectByCandidates(ByVal progIds)

    Dim i, obj
    Set obj = Nothing

    On Error Resume Next
    For i = LBound(progIds) To UBound(progIds)
        Err.Clear
        Set obj = CreateObject(CStr(progIds(i)))
        If (Err.Number = 0) And (Not obj Is Nothing) Then
            Exit For
        End If
        Set obj = Nothing
    Next
    On Error GoTo 0

    Set CreateObjectByCandidates = obj

End Function


'============================================================
' 調整後価格モードを有効化（存在しない環境でも落とさない）
'============================================================
Sub ConfigureAdjustedPriceIfAvailable(ByRef prices, ByVal code)

    If Not USE_ADJUSTED_PRICE Then Exit Sub

    On Error Resume Next
    Err.Clear

    ' まず代表候補：AdjustExRights
    prices.AdjustExRights = True
    If Err.Number <> 0 Then
        Err.Clear
        prices.AdjustExRights = 1
    End If

    If Err.Number <> 0 Then
        ' 環境差の可能性があるので、ここで落とさず警告だけ出してRAW続行
        SafeOut "WARN : " & code & " : AdjustExRights not supported -> continue RAW"
        Err.Clear
    End If

    On Error GoTo 0

End Sub


'============================================================
' Export 1 code incrementally
'============================================================
Function ExportOneCode_Incremental(ByVal code, ByVal outFolder, ByRef cal, ByRef prices)

    Dim beginPos, endPos, pos
    Dim rawName, safeName, outPath
    Dim canAppend, lastDate
    Dim tsOut
    Dim d, o, h, l, c, v
    Dim sDate, outLine
    Dim writtenCount

    ExportOneCode_Incremental = False
    writtenCount = 0
    canAppend = False
    lastDate = Empty

    SafeOut "START: " & code

    Call ConfigureAdjustedPriceIfAvailable(prices, code)

    On Error Resume Next
    Err.Clear
    prices.Read code
    If Err.Number <> 0 Then
        SafeOut "ERROR: " & code & " : prices.Read failed : " & Err.Description
        Err.Clear
        On Error GoTo 0
        Exit Function
    End If
    On Error GoTo 0

    On Error Resume Next
    Err.Clear
    beginPos = prices.Begin
    If Err.Number <> 0 Then
        SafeOut "ERROR: " & code & " : prices.Begin failed : " & Err.Description
        Err.Clear
        On Error GoTo 0
        Exit Function
    End If

    endPos = prices.End
    If Err.Number <> 0 Then
        SafeOut "ERROR: " & code & " : prices.End failed : " & Err.Description
        Err.Clear
        On Error GoTo 0
        Exit Function
    End If
    On Error GoTo 0

    If beginPos > endPos Then
        SafeOut "WARN : " & code & " : no data"
        Exit Function
    End If

    rawName = ""
    On Error Resume Next
    Err.Clear
    rawName = prices.Name
    Err.Clear
    On Error GoTo 0

    safeName = SanitizeFileName(rawName)
    If Len(safeName) = 0 Then safeName = "NONAME"

    outPath = outFolder & "\" & code & "_" & safeName & ".txt"

    If fso.FileExists(outPath) Then
        canAppend = True
        lastDate = GetLastDateFromCsv(outPath)

        On Error Resume Next
        Err.Clear
        Set tsOut = fso.OpenTextFile(outPath, ForAppending, True)
        If Err.Number <> 0 Then
            SafeOut "ERROR: " & code & " : open append failed : " & Err.Description
            Err.Clear
            On Error GoTo 0
            Exit Function
        End If
        On Error GoTo 0
    Else
        canAppend = False

        On Error Resume Next
        Err.Clear
        Set tsOut = fso.OpenTextFile(outPath, ForWriting, True)
        If Err.Number <> 0 Then
            SafeOut "ERROR: " & code & " : open write failed : " & Err.Description
            Err.Clear
            On Error GoTo 0
            Exit Function
        End If
        On Error GoTo 0
    End If

    For pos = beginPos To endPos

        On Error Resume Next
        Err.Clear

        If Not prices.IsClosed(pos) Then

            d = cal.Date(pos)
            If Err.Number = 0 Then

                If (Not canAppend) Or IsEmpty(lastDate) Or (CDate(d) > CDate(lastDate)) Then

                    o = prices.Open(pos)
                    h = prices.High(pos)
                    l = prices.Low(pos)
                    c = prices.Close(pos)
                    v = prices.Volume(pos)

                    sDate = Right("0000" & CStr(Year(d)), 4) & "/" & _
                            Right("0" & CStr(Month(d)), 2) & "/" & _
                            Right("0" & CStr(Day(d)), 2)

                    outLine = code & "," & sDate & "," & CStr(o) & "," & CStr(h) & "," & CStr(l) & "," & CStr(c) & "," & CStr(v)
                    tsOut.WriteLine outLine

                    writtenCount = writtenCount + 1
                    If (writtenCount Mod PROGRESS_INTERVAL) = 0 Then
                        SafeOut "  " & code & " ... " & writtenCount & " lines"
                    End If

                End If

            Else
                Err.Clear
            End If

        End If

        On Error GoTo 0
    Next

    tsOut.Close

    SafeOut "OK   : " & code & " : +" & writtenCount
    ExportOneCode_Incremental = True

End Function


'============================================================
' Get last date from CSV (code,YYYY/MM/DD,...)
'============================================================
Function GetLastDateFromCsv(ByVal filePath)

    Dim ts, line, lastLine, parts, dt
    GetLastDateFromCsv = Empty

    On Error Resume Next
    Set ts = fso.OpenTextFile(filePath, ForReading, False)
    If Err.Number <> 0 Then
        Err.Clear
        Exit Function
    End If
    On Error GoTo 0

    lastLine = ""
    Do While Not ts.AtEndOfStream
        line = Trim(ts.ReadLine)
        If Len(line) > 0 Then lastLine = line
    Loop
    ts.Close

    If Len(lastLine) = 0 Then Exit Function

    parts = Split(lastLine, ",")
    If UBound(parts) < 1 Then Exit Function

    dt = ParseYYYYMMDDToDate(parts(1))
    If IsDate(dt) Then
        GetLastDateFromCsv = dt
    End If

End Function


Function ParseYYYYMMDDToDate(ByVal sDate)

    Dim parts, y, mm, dd
    ParseYYYYMMDDToDate = Empty

    sDate = Trim(sDate)
    If Len(sDate) = 0 Then Exit Function

    parts = Split(sDate, "/")
    If UBound(parts) <> 2 Then Exit Function

    On Error Resume Next
    Err.Clear
    y  = CLng(parts(0))
    mm = CLng(parts(1))
    dd = CLng(parts(2))
    If Err.Number <> 0 Then
        Err.Clear
        Exit Function
    End If

    ParseYYYYMMDDToDate = DateSerial(y, mm, dd)
    If Err.Number <> 0 Then
        Err.Clear
        ParseYYYYMMDDToDate = Empty
    End If
    On Error GoTo 0

End Function


Function RemoveBOM(ByVal s)
    If Len(s) > 0 Then
        On Error Resume Next
        If AscW(Left(s, 1)) = &HFEFF Then
            RemoveBOM = Mid(s, 2)
        Else
            RemoveBOM = s
        End If
        On Error GoTo 0
    Else
        RemoveBOM = s
    End If
End Function


Function NormalizeCode(ByVal s)

    Dim x, a, i, ch, res

    x = Trim(s)

    If InStr(x, ",") > 0 Then
        a = Split(x, ",")
        x = Trim(a(0))
    End If

    If InStr(x, vbTab) > 0 Then
        a = Split(x, vbTab)
        x = Trim(a(0))
    End If

    If InStr(x, "_") > 0 Then
        a = Split(x, "_")
        x = Trim(a(0))
    End If

    If InStr(x, " ") > 0 Then
        a = Split(x, " ")
        x = Trim(a(0))
    End If

    res = ""
    For i = 1 To Len(x)
        ch = Mid(x, i, 1)
        If (ch >= "0" And ch <= "9") Or _
           (ch >= "A" And ch <= "Z") Or _
           (ch >= "a" And ch <= "z") Then
            res = res & ch
        Else
            Exit For
        End If
    Next

    NormalizeCode = UCase(res)

End Function


Function SanitizeFileName(ByVal s)

    Dim badChars, i
    s = Trim(s)

    If Len(s) = 0 Then
        SanitizeFileName = ""
        Exit Function
    End If

    ' バックスラッシュは Chr(92) を使って「文字列が壊れる系」を避ける
    badChars = Array(Chr(92), "/", ":", "*", "?", Chr(34), "<", ">", "|")

    For i = 0 To UBound(badChars)
        s = Replace(s, CStr(badChars(i)), "_")
    Next

    s = Trim(s)
    Do While Len(s) > 0 And (Right(s, 1) = "." Or Right(s, 1) = " ")
        s = Left(s, Len(s) - 1)
    Loop

    SanitizeFileName = s

End Function


Sub SafeOut(ByVal msg)
    On Error Resume Next
    WScript.StdOut.WriteLine msg
    If Err.Number <> 0 Then
        Err.Clear
        WScript.Echo msg
    End If
    On Error GoTo 0
End Sub


Function Q(ByVal s)
    Q = Chr(34) & Replace(CStr(s), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
