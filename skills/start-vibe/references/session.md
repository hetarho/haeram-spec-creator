# 함께 모드와 실행기 밖 세션

시작 질문은 한 번에 모은다: 함께/맡김, route:choose의 기획/구현 우선순위, 다른 기기의 배정(이어받기는 사용자 지시 필요), 미정 cfg push 브랜치. 인자로 답한 것은 묻지 않는다. 함께 모드가 기본이며 질문 도구가 없으면 텍스트 질문 뒤 답을 기다린다.

함께는 `vibe status --section inbox --no-fetch --json`으로 결정함만 확인받는다. 승인 항목은 삭제+log, 수정은 update-ssot 후 삭제. 열린 보고서는 to를 채운다. 결정은 cfg.level에 맞춰 모아 묻는다.

맡김으로 전환하면 preflight(push 권한·명령 가용성·실제 헤드리스 권한), active, 보고서, macOS awake를 시작 때 한 번 준비한다. 사람이 고쳐야 할 실패는 떠나기 전 한 번 확인한다. 이후 질문 0회. 장기 맡김은 vibe loop로 넘겨 새 세션을 사용한다.

실행기 밖 세션은 마감 때 보고서 to/next와 STATE next를 채우고 beat --end, 묶음 검증·push, awake --stop을 한다. 함께는 단위마다 다음 단위가 새 대화에서 빠르다고 알린다. 보고는 한 일·inbox/parked·다음 일·보고서 경로만 짧게 한다.
