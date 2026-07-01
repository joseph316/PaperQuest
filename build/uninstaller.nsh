!macro customUnInstall
  MessageBox MB_YESNO "PaperQuest 사용자 데이터를 삭제하시겠습니까?$\r$\n아니오를 선택하면 논문 목록과 설정이 보존됩니다." IDYES deleteData IDNO keepData

  deleteData:
    Delete "$APPDATA\PaperQuest\paperquest-data.json"
    RMDir /r "$APPDATA\PaperQuest"
    Delete "$LOCALAPPDATA\PaperQuest\paperquest-data.json"
    RMDir /r "$LOCALAPPDATA\PaperQuest"
    Goto done

  keepData:
    Goto done

  done:
!macroend