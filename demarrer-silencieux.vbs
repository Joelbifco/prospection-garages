' Démarre l'application en arrière-plan (sans fenêtre ni navigateur).
' Utilisé par la tâche planifiée de Windows pour l'envoi automatique de 8h.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\joeld\CLAUDE\APP COURRIELS"
sh.Run "node server.js", 0, False
