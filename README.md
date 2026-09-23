# 플라이휠 OS · 연결 데모

세 개의 프로토타입(키오스크 · 관제 · 세션 엔진)을 **하나의 GitHub Pages 사이트**로 묶고, `localStorage` 키 `flywheel.v0`로 상태를 공유합니다.

## 라이브

| 화면 | URL |
|------|-----|
| 허브 | https://nijohiohc2-arch.github.io/flywheel-os/ |
| 키오스크 | https://nijohiohc2-arch.github.io/flywheel-os/kiosk/ |
| 관제 | https://nijohiohc2-arch.github.io/flywheel-os/ops/ |
| 세션 엔진 | https://nijohiohc2-arch.github.io/flywheel-os/session/ |


## 뷰포트 토글 · 크루 동반

- **데스크톱 / 모바일 보기**: 허브·키오스크·관제·세션 우측 상단 토글. 「모바일」을 누르면 iframe이 아니라 **실제 페이지**가 ~390px 폰 컬럼으로 좁아집니다(배경 딤 + 얇은 베젤). 선호는 `localStorage` 키 `flywheel.viewport`에 저장. 실제 폰(≤700px)에서는 토글을 숨기고 자연 반응형 CSS를 씁니다.
- **혼자 와도 크루처럼**: 세션 엔진에 고스트/실입장 크루 칩·링 마커·티커. 이동 시 「크루 이동!」 텍스트(음성은 가끔). 키오스크 성공 화면에 「오늘 크루 N명 입장」 플래시.

## 연결 플로우

1. **네이버 예약(시뮬)** — 허브 또는 관제에서 「데모 예약 시드」
2. **키오스크 입장** — 휴대폰 번호로 체크인 → 공유 스토어에 `checkIns` 기록
3. **관제 현황** — 입장·노쇼·잔여 정원 실시간 반영 (storage 이벤트 + 폴링)
4. **세션 시작 신호** — 관제 「세션 시작 신호」 → `sessionCommand: { type: 'start' }`
5. **세션 엔진** — 신호를 받으면 배너 표시 후 1초 뒤 자동 시작 (타이머·음성·링 유지)

## 공유 스토어 (`flywheel.v0`)

```json
{
  "bookings": [ { "id", "name", "phone", "slotStartISO", "slotEndISO", "hasShootingAddon", "status" } ],
  "checkIns": { "<bookingId>": { "at", "phone" } },
  "sessionCommand": null | { "type": "start"|"pause"|"reset", "at", "slotId" },
  "meta": { "capacityPeak": 10, "capacityOff": 8, "noshowGraceMin": 5 }
}
```

같은 origin(`…/flywheel-os/`)이라 하위 경로끼리 localStorage가 공유됩니다.

## 5분 데모 순서

1. 허브에서 **데모 예약 시드** 클릭 → 예약 카운트 확인
2. **키오스크** 새 탭으로 열고, 「데모 예약 목록」에서 `010-1234-5678` 등 체크인 가능 번호 선택 → 체크인
3. **관제** 탭에서 입장이 올라오는지 확인 (바로 안 보이면 2초 폴링 대기)
4. 관제에서 **「세션 시작 신호」** 클릭
5. **세션 엔진** 탭에서 배너 → 자동 시작(워밍업) 확인

## 주의사항

- **같은 브라우저 프로필**이 필요합니다. 시크릿/다른 기기/다른 프로필은 상태가 보이지 않습니다.
- `storage` 이벤트는 **다른 탭**에서 기록이 바뀔 때 발생합니다. 같은 탭은 `flywheel:store` 커스텀 이벤트로 보완합니다.
- 노쇼: `slotStart + noshowGraceMin(기본 5분)` 미입장 시 관제가 공유 스토어에 `noshow`로 기록합니다. 시계 오프셋으로 바로 테스트할 수 있습니다.

## 로컬 실행

```bash
cd flywheel-os
python3 -m http.server 8080
# http://localhost:8080/
```

## 구조

```
flywheel-os/
├── index.html          # 허브
├── shared/store.js     # 공유 localStorage
├── kiosk/              # 키오스크 체크인
├── ops/                # 관제 대시보드
├── session/            # 세션 엔진
└── README.md
```

## 라이선스

프로토타입 · 내부 데모용
