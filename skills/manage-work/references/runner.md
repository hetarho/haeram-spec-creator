# 실행기 연결

작업 목록·배정·리뷰 승인·완료의 기준은 haeram runtime이다. 실행기는 에이전트를 시작하고 결과를 전달한다. 같은 clone의 worktree 사이에서 사용하며, 원격 clone 간 조정은 제공하지 않는다.

## 일반 터미널: work run

사용자가 여러 태스크의 지속 실행을 요청했을 때 사용한다. 어댑터는 에이전트 실행 도구에 맞춘 로컬 프로그램이며 자동으로 특정 제품을 추정하거나 설치하지 않는다. 기존 어댑터가 없으면 사용 중인 실행 도구의 실제 명령/출력 규약을 확인한 뒤 연결한다. 실행기는 리뷰·검증 통과 후 작업 묶음 브랜치까지 자동 통합한다. main 반영·push는 수행하지 않는다.

```bash
npx haeram-spec-creator work start feature --workers 4 --reviewers 1 --max-pending 8 --json
npx haeram-spec-creator work run --work feature --adapter /absolute/path/adapter.json --verify 'npm ci && npm test' --json
```

기존 그룹은 기록된 한도를 사용하고, 한도 기록이 없는 그룹은 4/1/8을 사용한다. `--verify`를 반복해 ARCH 검증 명령을 전달한다. worker/review 작업 공간과 통합 후보는 필요한 환경이 설치되지 않았을 수 있다. 작업자가 환경 준비를 할 수 있도록 지시하고 검증 명령에도 필요한 준비를 포함한다.

어댑터 JSON 예:

```json
{
  "command": "node",
  "args": ["/absolute/path/my-agent-adapter.mjs"],
  "timeoutMs": 3600000,
  "maxDispatches": 200,
  "maxTaskRuns": 3
}
```

command는 셸을 거치지 않고 실행한다. 상대 command 경로는 설정 파일 기준, args의 경로는 절대 경로 사용을 권장한다. 매 작업마다 지정 workspace에서 새 프로세스를 실행하며, 동일 세션 유지 여부는 어댑터가 결정한다. 모델과 reasoning 설정도 어댑터가 맡는다. 워커 4개는 동시 실행 슬롯 수이며 항상 같은 대화 세션 4개를 뜻하지 않는다.

stdin은 JSON 객체 한 줄이다:
- `schemaVersion:1`, `dispatchId`, `role:worker|reviewer`, `slot`, `group`, `attempt`, `taskId`, `workspace`, `groupBranch`.
- `instruction`: 실행 역할과 완료 절차. worker는 commit까지, reviewer는 결과 JSON 반환까지 수행한다. submit/review-finish는 runner 소유이므로 중복 호출하지 않는다.
- `verify`: 실제 검증 명령 배열. `boardCommand`: 최신 상태 조회용 CLI 인자.
- `correction`: 수정 요청을 재배정할 때 이전 리뷰와 findings; 없으면 null.
- `review`: 리뷰 배정 시 id, submissionId, commit, baseCommit, workspace, owner. 없으면 null.

stdout은 최종 JSON 객체 하나만 출력하고 진행 로그는 stderr로 보낸다. 실행 도구의 JSONL/마크다운 출력은 어댑터에서 아래 형식으로 변환한다. raw CLI 출력을 그대로 연결해 이 규약을 만족한다고 가정하지 않는다.

```json
{"outcome":"completed","summary":"Implemented and committed the task."}
```

워커가 막히면 `{"outcome":"blocked","summary":"Reason and required decision."}`. completed여도 runner가 실제 커밋·acceptance·spec 변경 범위와 검증 명령을 다시 검사한다.

리뷰어는 review-task의 JSON 형식(`verdict`, `summary`, `findings`)을 반환한다. 코드가 바뀌면 재제출이 필요하고, 상위 브랜치가 바뀌면 이전 승인도 재리뷰한다. 현재 구현은 상위의 무관한 변경도 재리뷰하므로 넓은 병렬 리뷰보다 reviewer=1부터 시작한다.

runner는 빈 슬롯을 채우고 수정 요청을 우선 배정하며 리뷰 대기열을 처리한다. 대기 중 모델 호출은 하지 않는다. 살아 있는 자식 프로세스의 heartbeat는 10초마다 기록하지만 에이전트의 의미 있는 진행을 보장하지는 않는다. 장시간 작업자는 board를 다시 읽고 정책 변경을 판단해야 한다.

완료 시 `outcome:completed`. 더 진행할 수 없으면 `needs-attention`과 남은 작업을 반환한다. 횟수 한도는 `dispatch-limit`, 종료 신호/heartbeat 실패는 `interrupted`. maxTaskRuns는 한 번의 run 안에서 태스크별·역할별 최대 실행 횟수이며 재실행 전에 반복 실패 원인을 확인한다. 자동 통합 실패는 같은 run에서 무한 재시도하지 않는다.

## Orca 또는 다른 coordinator

Orca를 사용하면 work run 대신 coordinator가 위 역할을 수행할 수 있다. [Orca 공식 orchestration 문서](https://www.onorca.dev/docs/cli/orchestration)와 설치된 CLI의 `orca skills get orchestration --full`을 확인해 실제 버전의 명령을 사용한다. 제품별 자동 감지·모델 실행 명령을 하드코딩한 Orca 전용 어댑터는 이 패키지에 포함하지 않는다.

1. 빈 worker 슬롯: `work resume`로 수정 요청을 확인하고, 없으면 `work claim-next`. 반환된 attempt/workspace로 실행한다. 외부 도구가 이미 공간을 만들었다면 그 공간에서 `--workspace current`로 선점한다.
2. worker 완료 알림: 알림의 dispatch↔attempt 매핑을 확인하고 `work submit` 실행. 실행 완료 메시지를 태스크 done으로 취급하지 않는다.
3. 빈 reviewer 슬롯: `work review-claim`으로 제출물을 확보하고 반환된 고정 workspace에서 review-task를 실행한다.
4. reviewer 완료: 정확한 review ID로 `work review-finish`. approved만 `work integrate`로 통합한다. 상위 기준이 바뀌어 거부되면 새로운 review ID로 재검토한다.
5. 매 완료 시 board를 다시 읽고 빈 슬롯을 채운다. 알림은 중복될 수 있으므로 runtime의 attempt/review 상태로 이미 처리한 결과를 확인한다. 재시작 후에도 runtime을 먼저 읽는다.

Orca의 task/dispatch ID는 실행 추적용으로 매핑한다. 의존성 충족·선점·승인·통합 여부를 두 시스템에서 독립적으로 결정하지 않는다. 원격 실행기는 파일을 공유하지 않는 다른 clone을 같은 로컬 그룹에 연결할 수 없다.

## 중단과 복구

Ctrl-C/종료 신호는 runner가 시작한 자식 프로세스만 중단하고 파일·기록을 보존한다. 강제 종료 뒤에는 runner와 기록된 자식 PID가 모두 종료됐는지 확인하고 `work runner-recover --work <group>`를 실행한다. PID 기록 전 중단처럼 확인이 불가능한 경우 자동 회수하지 않는다.

진행 중 검증·통합 명령이 남았다면 `work recover --attempt <id>`, 남은 리뷰 선점은 리뷰어 종료 확인 후 `work review-release --review <id>`. 작업자의 미완료 변경은 검토하고 `work update --attempt <id> --status doing`으로 명시적으로 재개한다. runtime JSON을 직접 고치거나 timeout만으로 다른 작업자의 소유권을 빼앗지 않는다.

통합된 작업 공간의 정리는 작업자 종료 확인 후 `work cleanup`으로 별도 수행한다. runner는 실패 원인 조사와 최종 검토를 위해 작업 공간을 남긴다.
