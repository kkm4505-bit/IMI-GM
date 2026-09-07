# GM 인사이트 게시판

아이템매니아 게임전략파트 GM 인사이트 등록/공유용 게시판입니다.
Node.js(Express) + SQLite로 만든 실서비스용 웹앱이며, 정적 HTML 파일이 아니라
서버가 있는 서비스라 GM 여러 명이 같은 URL로 접속해 같은 데이터를 함께 봅니다.

## 로컬에서 실행해보기

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 접속.

## GitHub에 올리기

이 폴더 전체(server.js, package.json, public/, README.md, .gitignore)를 그대로
깃허브 저장소에 올리면 됩니다. `node_modules`, `data`, `uploads`는 `.gitignore`에
포함되어 있어 올라가지 않습니다 — 정상입니다. Railway가 배포 시 `node_modules`는
자동으로 설치하고, `data`(데이터베이스 파일)와 `uploads`(첨부파일)는 서버가
처음 켜질 때 자동으로 만듭니다.

```bash
git init
git add .
git commit -m "GM 인사이트 게시판 초기 배포"
git branch -M main
git remote add origin <본인의 깃허브 저장소 주소>
git push -u origin main
```

## Railway로 배포하기

1. Railway 대시보드 → New Project → **Deploy from GitHub repo** → 방금 올린 저장소 선택
2. Railway가 Node 프로젝트를 자동 인식합니다(Nixpacks). 별도 설정 없이 `npm install` →
   `npm start`가 자동 실행됩니다.
3. 배포가 끝나면 Railway가 `xxx.up.railway.app` 형태의 URL을 발급합니다. 이 URL을 GM들에게
   공유하면 모두 같은 게시판을 보게 됩니다.

### ⚠️ 반드시 설정해야 하는 것 — Volume(영구 저장 공간)

이 앱은 게시글을 `data/board.sqlite` 파일에, 첨부 이미지·파일을 `uploads/` 폴더에
저장합니다. Railway 컨테이너의 기본 디스크는 **재배포할 때마다(=새 커밋을 push할
때마다) 초기화**되므로, Volume을 연결하지 않으면 코드를 업데이트할 때마다
게시글이 전부 사라집니다. **딱 한 번만** 아래처럼 설정해두면, 이후로는 코드를
아무리 자주 바꿔서 재배포해도 게시글과 첨부파일이 그대로 유지됩니다.

1. Railway 프로젝트 → 서비스 선택 → **Settings → Volumes → New Volume**
2. Mount Path를 `/app/data` 로 하나 추가
3. Mount Path를 `/app/uploads` 로 또 하나 추가 (총 2개)
4. 저장 후 서비스가 재시작되면 설정 완료

설정 후에는 실제로 게시글을 하나 등록해보고, 대시보드에서 재배포(Redeploy)를 한 번
실행해서 그 게시글이 그대로 남아있는지 꼭 확인해보세요. 이 확인이 끝나면 이후로는
안심하고 계속 기능을 추가/수정해서 배포하셔도 됩니다.

## 지금 데이터 상태

이번에 아키텍처를 "브라우저 저장" 방식에서 "실제 서버+데이터베이스" 방식으로
바꾸면서, 이전에 테스트용으로 브라우저에 쌓여있던 더미 게시글은 이 서버와는
완전히 별개의 저장소이므로 자동으로 들어오지 않습니다 — 즉 서버는 항상 빈
데이터베이스로 시작합니다. 배포 후 처음 접속하면 게시글이 0건인 깨끗한 상태일
것이고, 이제부터 등록하는 게시글만 쌓입니다.

## 참고 — 지금 구조의 한계와 향후 개선 여지

- 첨부 이미지/파일은 서버 로컬 디스크(위 Volume)에 저장됩니다. 첨부가 아주 많아지면
  Volume 용량을 늘리거나, 추후 S3 등 외부 스토리지로 옮기는 것을 고려할 수 있습니다.
- 비밀번호는 게시글 수정·삭제 시 본인 확인용 숫자 4자리이고, 계정 로그인 개념은
  아닙니다. 관리자용 마스터 비밀번호가 서버 코드(`server.js`)에 하드코딩되어 있어
  누구 글이든 수정/삭제가 가능합니다 — 필요하면 이 값을 바꾸거나 환경변수로 옮길 수
  있습니다.
- 별도 로그인/권한 관리는 없습니다. 사내망 전용으로 쓰거나, 필요하다면 Railway의
  접근 제한 기능/사내 VPN과 함께 사용하는 것을 권장합니다.
