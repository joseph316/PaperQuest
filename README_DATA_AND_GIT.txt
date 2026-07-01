PaperQuest 데이터 저장/업데이트/Git 세팅 안내
=============================================

1) 사용자 데이터 저장 위치
-------------------------
Electron 앱에서는 논문 목록을 설치 폴더가 아니라 사용자별 AppData 폴더에 저장합니다.

Windows 기본 위치:
C:\Users\<사용자이름>\AppData\Roaming\PaperQuest\paperquest-data.json

따라서 앱을 업데이트하거나 새 설치파일로 덮어 설치해도 기존 논문 데이터는 유지됩니다.
친구 A, 친구 B의 데이터는 각자 PC의 AppData에 따로 저장됩니다.

주의:
- 앱 제거 프로그램에서 사용자 데이터까지 삭제하는 옵션을 직접 추가하지 않는 한 보통 유지됩니다.
- AppData 폴더를 수동으로 지우면 데이터도 삭제됩니다.
- paperquest-data.json은 Git에 올리지 않는 것이 맞습니다.

2) 업데이트 배포 방식
--------------------
기능 수정 후 package.json의 version을 올립니다.
예: 0.12.2 -> 0.12.3

그 다음 빌드:
npm run dist

생성된 파일:
dist\PaperQuest Setup <버전>.exe

친구는 새 exe를 실행해서 기존 버전 위에 설치하면 됩니다.
사용자 데이터는 AppData에 있으므로 유지됩니다.

3) GitHub 저장소 처음 세팅
-------------------------
프로젝트 폴더에서 아래 순서대로 실행합니다.

 git init
 git add .
 git commit -m "Initial Electron app"
 git branch -M main
 git remote add origin https://github.com/<GitHub아이디>/<저장소이름>.git
 git push -u origin main

GitHub에서 먼저 빈 저장소를 만든 뒤 위 remote 주소를 본인 주소로 바꿔 넣으면 됩니다.

4) Git에 올리면 안 되는 것
--------------------------
.gitignore에 이미 제외해둔 항목:
- node_modules/
- dist/
- .env
- paperquest-data.json
- exe, blockmap 등 빌드 결과물

즉 Git에는 소스코드와 설정만 올리고, 개인 데이터/빌드 결과/비밀키는 올리지 않습니다.

5) 일반적인 수정-배포 흐름
-------------------------
코드 수정
-> npm run electron 으로 로컬 테스트
-> package.json version 올리기
-> git add .
-> git commit -m "Describe changes"
-> git push
-> npm run dist
-> dist의 새 설치 exe 배포

