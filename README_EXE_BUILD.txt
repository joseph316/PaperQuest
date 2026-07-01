PaperQuest EXE 빌드 방법
========================

1. 압축을 풉니다.
2. package.json이 있는 폴더에서 명령 프롬프트를 엽니다.
3. 아래 명령을 실행합니다.

npm install
npm run dist

성공하면 dist 폴더 안에 설치파일이 생성됩니다.
예: dist\PaperQuest Setup 0.12.2.exe

친구에게는 이 exe 파일만 보내면 됩니다.
Node.js나 Anaconda는 친구 PC에 필요하지 않습니다.

데이터 보존
----------
논문 목록은 설치 폴더가 아니라 아래 사용자별 폴더에 저장됩니다.

C:\Users\<사용자이름>\AppData\Roaming\PaperQuest\paperquest-data.json

그래서 새 버전 exe로 업데이트 설치해도 기존 데이터는 유지됩니다.

