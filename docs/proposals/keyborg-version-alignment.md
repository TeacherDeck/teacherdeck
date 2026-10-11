# 제안: 기존 Keyborg 버전 정렬

상태: 2026-10-11 사용자 승인 후 override 설치 성공. 앞선 세 제안에 대한 “승인한다. 계속 작업해” 답변으로 아래 한 경로 override·lock 갱신·설치·타사 고지 재생성 범위를 승인받았다. 지정 lifecycle 회귀 1개가 통과했으며 전체 검증과 릴리스 빌드는 통합 담당자가 진행한다.

## 배경과 규칙 적용

정렬 전 Fluent 포커스 기반의 잠금에는 Keyborg 2.14.1과 3.498.0이 공존했다. `@fluentui/react-tabster`는 `keyborg ^2.14.1`, `tabster 8.8.1`은 `keyborg ^3.0.0`을 요구한다. 두 버전은 각 모듈 내부 카운터로 `k1`부터 인스턴스 ID를 발급하면서 같은 `window.__keyborg.refs`를 공유한다. 동일 ID가 덮이면 최초 구독이 사라지고, 그 인스턴스를 닫을 때 공유 포커스 감지 자원도 먼저 폐기할 수 있다.

GEN-004는 런타임 의존성 **추가**에 사람 승인을 요구한다. 이 제안은 이미 잠금·설치·사용 중인 Keyborg 3.498.0으로 기존 전이 의존성을 정렬하며 새 라이브러리를 추가하지 않는다. 규칙 문구만으로 새 런타임 추가라고 단정하지는 않는다. 다만 앞선 실행의 자동 승인 검토가 기존 의존성 정렬에도 GEN-004의 사람 승인이 없다는 이유로 거부해, 우회하지 않고 이 한 경로 정렬에 대한 명시적 사용자 승인을 기다렸다. 첫 offline 설치는 캐시 메타데이터 부재로 진행되지 않았으며, 그 뒤 권한을 요청한 offline 설치가 자동 승인 검토에서 차단됐다. 이후 2026-10-11 명시적 승인 후 override 설치가 성공했다. 새로운 버전·런타임 추가·라이선스 예외·보안 권한 변경은 이 제안에 포함하지 않는다.

## 제안 범위

루트 pnpm override 설정에서 **`@fluentui/react-tabster>keyborg` 한 경로만 `3.498.0`으로 고정**한다. 전역 `keyborg` override로 무관한 의존성을 바꾸지 않는다. 현재 루트의 `pnpm-workspace.yaml`에 다음 한 항목을 추가하는 범위다. 루트 `package.json`의 `packageManager`와 직접 dependencies/devDependencies는 유지한다.

```yaml
overrides:
  "@fluentui/react-tabster>keyborg": "3.498.0"
```

`pnpm-lock.yaml`은 루트의 기존 pnpm 12.10.1로 갱신한다. override 기록, 해당 react-tabster의 Keyborg 연결, 사용되지 않게 된 2.14.1의 제거와 이에 따른 snapshot/peer 경로 변경만 검토한다. 다른 라이브러리·Fluent·Tabster·pnpm 버전은 올리지 않는다. `node_modules`나 라이브러리 원문을 직접 patch하지 않는다. 생성된 타사 고지가 바뀌면 기존 생성기로 갱신하고 손으로 편집하지 않는다.

## 로컬 API 호환 근거

두 설치본의 `dist/index.d.ts`를 대조했다. `createKeyborg`, `disposeKeyborg`, `KEYBORG_FOCUSIN`, `KEYBORG_FOCUSOUT`, `nativeFocus`, `getLastFocusedProgrammatically`의 export 이름은 같다. Keyborg 인스턴스의 `isNavigatingWithKeyboard`, `subscribe`, `unsubscribe`, `setVal` 메서드도 유지된다. 포커스 이벤트의 `detail`과 이벤트 이름은 유지된다.

3.x에서 제거된 것은 `createKeyborg`의 선택적 두 번째 인자 `triggerKeys`/`dismissKeys`와 deprecated `event.details`다. 현재 설치된 react-tabster의 `lib/focus/focusVisiblePolyfill.js`, `focusWithinPolyfill.js`, `hooks/useKeyborgRef.js`, `useKeyboardNavAttribute.js`의 생성 호출은 모두 Window 하나만 전달한다. 이벤트 처리도 `composedPath()`를 사용하며 제거된 `details`를 읽지 않는다. 따라서 이 변경 경로는 제거된 API에 의존하지 않는다. 실제 React 포커스 흐름 검증은 API 대조를 대신할 수 없어 아래 게이트에 포함한다.

## 라이선스·보안·버전 영향

3.498.0은 현재 잠금에 존재하는 MIT 라이브러리다. 설치본 `package.json`의 `license=MIT`와 `LICENSE`의 Microsoft Corporation 저작자·고지 원문을 확인했다. 저작자 고지를 지우거나 약화하지 않고 기존 라이선스 생성·검사 경로를 유지한다. 새 라이선스 예외는 필요하지 않다.

새 캡·브리지·매니페스트 형식·CSP·ACL·네이티브 명령을 추가하지 않는다. 파일·네트워크·학생 자료 처리 범위도 바꾸지 않는다. 이 정렬만으로 모듈별 기능 버전을 일괄 올리지 않는다. 공통 UI의 미출시 변경 기록에 포커스 의존성 정렬과 검증 근거를 추가하고 최종 앱 릴리스 기록과 연결한다.

## 재현과 검증 계획

`target/adversarial-review/keyborg-version-collision.mjs`와 `.log`는 실제 잠긴 두 라이브러리를 별도 jsdom window에 로드해 확인한다. 혼합 2.x+3.x에서는 두 ID가 `k1`로 겹쳐 최초 인스턴스가 registry에서 사라지고 실제 `KeyboardEvent(Tab)`의 구독 결과가 최초 `[]`, 두 번째 `[true]`였다. 최초 인스턴스만 폐기해도 registry가 사라졌다. 같은 2.x+2.x와 **정렬 대상인 같은 3.498.0+3.498.0** 대조군에서는 구독자 둘 다 `[true]`를 받고 하나를 폐기해도 다른 registry가 유지됐다.

확정한 것은 라이브러리 인스턴스의 키보드 모드 구독 유실이다. 실제 TeacherDeck 화면의 접근성·포커스 실패를 전부 이 충돌로 설명하지 않는다. 역할과 학교 확인창의 실브라우저 순환 성공도 별도의 유효한 근거다.

승인 후 `pnpm-workspace.yaml`의 한 경로 override와 `pnpm-lock.yaml`에 3.498.0 정렬을 반영했고 설치가 성공했다. `packages/ui/src/keyborg-lifecycle.test.ts`의 지정 회귀 1개도 통과했다. 이 결과를 실제 화면의 모든 포커스 흐름 검수 완료로 확대하지 않는다. 공통 DeckProvider/ContentDialog, 역할·학교 취소와 즉시 재열기·확정, PDF 추가/빠른 재드롭, 키보드 Tab·마우스 전환과 반복 mount/unmount를 최종 검수 범위로 유지한다. 경고를 숨기지 않는다. 라이선스·생성물·타입 검사와 전체 `pnpm verify`, 최종 릴리스 빌드는 주 작업자가 수행한다. 최종 검증이 끝나기 전 배포 준비 완료로 표시하지 않는다.

## 검토한 대안

- 경고만 숨기면 실제 구독 유실과 자원 수명 충돌을 남긴다.
- Provider의 포커스 소유권 유지를 제거하면 조건부 대화상자 종료 후 배경 접근성 복구 결함을 되돌릴 수 있다.
- 전역 override, 새 Fluent/Tabster 버전 도입, 수제 라이브러리 patch는 이번 한 경로 정렬보다 범위가 크다.
- 최신 버전을 새로 받는 대신 현재 잠긴 3.498.0을 재사용한다.

승인받은 범위: `@fluentui/react-tabster>keyborg`를 이미 잠긴 3.498.0으로 정렬하는 위 override·lock 갱신·설치와 기존 타사 고지 재생성 범위. 새 라이브러리·라이선스 예외·캡·보안 권한은 포함하지 않는다. 의존성 구현·설치·override는 통합 담당자가 수행했다.
