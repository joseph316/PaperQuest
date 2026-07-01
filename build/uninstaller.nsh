!macro customUnInstall
  SetShellVarContext current

  MessageBox MB_YESNO "PaperQuest 논문 데이터를 삭제하시겠습니까?" IDYES deleteData IDNO done

  deleteData:
    RMDir /r "$APPDATA\PaperQuestData"
    Goto done

  done:
!macroend