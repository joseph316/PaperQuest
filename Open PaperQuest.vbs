Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
shell.Run "node.exe """ & folder & "\server.mjs""", 0, False
WScript.Sleep 1200
shell.Run "http://localhost:8787", 1, False
