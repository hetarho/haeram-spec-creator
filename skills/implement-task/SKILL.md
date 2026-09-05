---
name: implement-task
description: >-
  spec/tasks/의 태스크 하나를 구현하고 검증한다. "구현해줘 / T003 해줘 / 다음 태스크 진행" 일 때 사용.
  인자가 없으면 STATE에서 dep이 충족된 다음 todo를 스스로 고른다. 시작 즉시 doing으로 선점해 병렬
  세션 충돌을 막고, SSOT rev 신선도를 확인한 뒤, 완료기준과 verify를 통과해야 done. 결과는 태스크
  파일과 STATE에 반영한다.
---

# implement-task — 태스크 구현

**역할: 엔지니어.** SSOT와 ARCH가 법이다. 구현 중 기획 공백을 발견하면 임의로 정하지 말고 update-ssot를 제안하거나 blocked 처리한다.

## 공통 규칙 (모든 spec 스킬)
1. 먼저 spec/STATE.md를 읽는다. 없으면 중단하고 create-architecture 실행을 안내한다.
2. **문서 먼저**: 질문·추론·구현을 시작하기 전에 STATE.md에 시작을 기록하고(log 1줄 + 해당 st), 상태가 바뀔 때마다 즉시 반영한다. 병렬 세션은 STATE.md로만 서로를 안다.
3. 산출 문서는 spec/FORMAT.md 표기를 따른다. 규칙에 없는 표기는 만들지 않는다.
4. 질문·확인·보고는 cfg.lang 언어로, 상세도는 cfg.level대로. 산출 문서는 영어로 쓴다(FORMAT 언어 규칙). 선택지형 질문 도구(AskUserQuestion 등)가 있으면 사용.

## 1. 선택 + 선점 (다른 무엇보다 먼저)
- 인자 T###이 없으면 STATE tasks에서 dep이 전부 done인 첫 todo를 고른다. doing인 태스크는 다른 세션 소유 — 절대 잡지 않는다. 회수는 사용자가 명시적으로 지시할 때만(todo 복귀 후 진행).
- **즉시 선점**: 세션 태그(2~4자)를 정하고 STATE st→`doing@YYMMDD.tag` + log `- YYMMDD T### claimed (tag)`, 태스크 인용줄 st도 갱신. 코드 읽기·추론은 그 다음이다.
- **선점 확인**: 쓰기 직후 STATE를 다시 읽어 그 태스크의 doing이 자기 tag인지 확인한다. 다른 세션 tag면 경합에서 진 것 — 물러나서 다음 todo를 잡는다.

## 2. 신선도
태스크 base(`<ID>@rev`)와 STATE의 현재 rev 비교. 뒤처져 있으면 SSOT chg 델타를 읽고:
- 이 태스크와 무관 → base만 갱신하고 진행.
- 영향 있음 → 선점 해제(todo 복귀) + log, create-task로 태스크를 갱신하라고 안내하고 중단.

## 3. 구현
- 정독: 태스크 전체 + ssot가 가리키는 결정 원문 + ARCH 컨벤션.
- 완료기준을 위에서부터 구현. 범위 밖 발견(버그·개선거리)은 손대지 말고 log에 1줄(필요시 next에 태스크화 제안).
- 태스크는 질문 없이 완주 가능해야 정상이다. 구현 중 결정이 필요한 질문이 생기면 분해 실패 신호 — 임의로 정하지 말고, 기획 공백·모순이면 update-ssot 제안, 기술 결정 누락이면 blocked 후 create-task 재분해 제안.

## 4. 검증 (항상 이 순서로 마친다)
① acceptance를 하나씩 실제로 확인하고 `[v]`로 채운다 ② test ③ lint ④ formatter ⑤ ARCH에 CI/CD가 정의돼 있으면 그 파이프라인이 검사하는 항목을 로컬에서 재현하고, 원격에 푸시된 상태면 CI/CD 결과까지 확인한다. 명령은 전부 ARCH의 verify 결정에서 가져온다. 마지막으로 done 직전 신선도 재확인(2단계와 동일) — 구현 중 rev가 올랐으면 델타 영향을 재평가한다. 어느 하나라도 실패한 채 done 금지 — 해결하거나 blocked(사유 1줄은 ## result에).

## 5. 마감
- 태스크 `## result`: 변경 파일, 특이사항, SSOT와 달라진 점(있으면 update-ssot 제안까지).
- STATE: st→`done@YYMMDD`, next 갱신(다음 todo), log 1줄.
- 보고는 cfg.level대로 — novice: 무엇이 가능해졌고 어떻게 확인하는지 / expert: 변경 요약과 리뷰 포인트. 커밋은 요청받았을 때만.
