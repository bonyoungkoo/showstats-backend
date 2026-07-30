# ⚾ ShowStats Backend

ShowStats 서비스의 백엔드 서버입니다.  
MLB The Show API로부터 데이터를 수집하고,  
수집한 데이터를 자체적으로 분석 및 가공하여 프론트엔드 앱에 제공합니다.

---

## 주요기능

- MLB The Show API 데이터 수집
- 경기 로그 파싱 및 정규화
- 팀 단위 기록을 플레이어 개인 기록으로 분리
- 경기 데이터 분석
- 선수 카드 데이터 가공

---

## 기술 스택

- **NestJS**
- **TypeScript**
- **MongoDB**
- **Mongoose**

---

## 로컬 실행

### 1. 환경변수

프로젝트 루트에 `.env` 파일을 만들고 MongoDB 연결 주소를 설정합니다.

```env
MONGODB_URI=mongodb://localhost:27017/showstats
PORT=3003
```

- `MONGODB_URI`: 필수. 로컬 또는 원격 MongoDB 연결 주소
- `PORT`: 선택. 생략하면 `3003` 사용

### 2. 설치 및 실행

```bash
npm ci
npm run start:dev
```

서버 확인:

- 기본 응답: `http://localhost:3003/api`
- 전적 목록: `http://localhost:3003/api/games/history?username=bonyoungkoo&page=1`

프론트엔드보다 먼저 백엔드를 실행합니다.
