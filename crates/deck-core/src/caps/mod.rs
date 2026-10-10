// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Capability registry and argument/result types (capabilities.md).
//!
//! [`REGISTRY`] is the source of truth for capability names, versions (VER-002) and methods.
//! `pnpm gen` turns it into `schema/capabilities.json`, the registry table in capabilities.md and
//! SDK types (CAP-010). The host implements a handler for every method listed here; a host test
//! fails if one is missing. Adding a cap or a major change needs human approval (CAP-005).

use std::collections::BTreeMap;

use schemars::JsonSchema;
use semver::Version;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod capture;
pub mod clipboard;
pub mod fs;
pub mod global_shortcut;
pub mod overlay;
pub mod storage;
pub mod system;
pub mod window;

/// Capability name → version provided by the running host (`init.host.caps`).
pub type HostCaps = BTreeMap<String, Version>;

/// One method of a capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct MethodSpec {
    /// Method name as used in `req.method`.
    pub name: &'static str,
    /// Exempt from the SDK's default 30 s timeout (BRG-004), e.g. file dialogs.
    pub long: bool,
    /// One-line description.
    pub summary: &'static str,
}

/// One capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CapSpec {
    /// Capability name (`req.cap`).
    pub name: &'static str,
    /// Semver of this capability (VER-002; independent of the app version, VER-003).
    pub version: &'static str,
    /// One-line description.
    pub summary: &'static str,
    /// Methods.
    pub methods: &'static [MethodSpec],
}

const fn m(name: &'static str, long: bool, summary: &'static str) -> MethodSpec {
    MethodSpec {
        name,
        long,
        summary,
    }
}

/// v1 capabilities (capabilities.md §2).
pub const REGISTRY: &[CapSpec] = &[
    CapSpec {
        name: "global-shortcut",
        version: "1.0.0",
        summary: "승인된 네이티브 global-shortcut 기능",
        methods: &[
            m("status", false, "등록 단축키 조회"),
            m("register", false, "register"),
            m("replace", false, "replace"),
            m("unregister", false, "unregister"),
        ],
    },
    CapSpec {
        name: "overlay",
        version: "1.0.0",
        summary: "승인된 네이티브 overlay 기능",
        methods: &[
            m("status", false, "영역 창 현재 상태"),
            m("create", false, "create"),
            m("update", false, "update"),
            m("show", false, "show"),
            m("hide", false, "hide"),
            m("close", false, "close"),
        ],
    },
    CapSpec {
        name: "capture",
        version: "1.0.0",
        summary: "승인된 네이티브 capture 기능",
        methods: &[
            m("displays", false, "displays"),
            m("capture", true, "capture"),
            m("arm", false, "arm"),
            m("status", false, "status"),
            m("update", false, "update"),
            m("trigger", true, "시작한 세션에 한 장 저장"),
            m("resetSequence", false, "resetSequence"),
            m("stop", false, "stop"),
        ],
    },
    CapSpec {
        name: "clipboard",
        version: "1.0.0",
        summary: "구조화 클립보드 출력(읽기 없음)",
        methods: &[
            m("writeText", false, "일반 텍스트 복사(256KiB 이하)"),
            m(
                "writeRichText",
                false,
                "구조화 서식과 일반 텍스트 복사(256KiB 이하)",
            ),
        ],
    },
    CapSpec {
        name: "system",
        version: "1.0.0",
        summary: "앱·OS 정보",
        methods: &[m("info", false, "앱 버전, OS 이름·버전·빌드, 로캘")],
    },
    CapSpec {
        name: "storage",
        version: "1.0.0",
        summary: "모듈별 JSON 저장소(모듈당 5MB)",
        methods: &[
            m("get", false, "키의 값, 없으면 null"),
            m("set", false, "키에 값 저장(256KB 이하)"),
            m("delete", false, "키 삭제"),
            m("keys", false, "저장된 키 목록"),
        ],
    },
    CapSpec {
        name: "fs",
        version: "1.2.0",
        summary: "파일 선택과 핸들(경로는 노출하지 않음)",
        methods: &[
            m(
                "pickDestination",
                true,
                "명시적으로 기억할 새 파일 저장 폴더 선택",
            ),
            m("destinationStatus", false, "저장 폴더 권한 상태"),
            m("revealDestination", false, "저장 폴더 열기"),
            m("revokeDestination", false, "저장 폴더 권한 해제"),
            m("pickFiles", true, "파일 선택 대화상자 → FileHandleInfo[]"),
            m(
                "pickFolder",
                true,
                "폴더 선택 대화상자 → FolderHandleInfo | null",
            ),
            m("stat", false, "핸들의 최신 정보"),
            m("reveal", false, "탐색기에서 파일 위치 열기"),
            m("openRead", true, "파일 읽기 리소스 열기(256KiB 청크)"),
            m("closeRead", false, "파일 읽기 리소스 닫기"),
            m("createOutputFolder", true, "새 결과 폴더 만들기"),
            m("beginWrite", true, "새 결과 파일 쓰기 시작"),
            m("writeChunk", false, "64KiB 이하 순차 청크 쓰기"),
            m("commitWrite", true, "완성된 결과를 덮어쓰기 없이 게시"),
            m("abortWrite", false, "미완성 파일 쓰기 취소"),
            m("closeOutputFolder", false, "결과 폴더 작업 권한 닫기"),
        ],
    },
    CapSpec {
        name: "window",
        version: "1.0.0",
        summary: "창 상태(모듈이 숨겨지면 원래대로 복원)",
        methods: &[
            m("setAlwaysOnTop", false, "항상 위 켜기·끄기"),
            m("setFullscreen", false, "전체화면 켜기·끄기"),
        ],
    },
];

/// Looks up a capability.
pub fn cap(name: &str) -> Option<&'static CapSpec> {
    REGISTRY.iter().find(|c| c.name == name)
}

/// Looks up a method of a capability.
pub fn method(cap_name: &str, method_name: &str) -> Option<&'static MethodSpec> {
    cap(cap_name)?
        .methods
        .iter()
        .find(|m| m.name == method_name)
}

/// Versions this build provides, for the resolver and `init.host.caps`.
pub fn host_caps() -> HostCaps {
    REGISTRY
        .iter()
        .filter_map(|c| Some((c.name.to_owned(), Version::parse(c.version).ok()?)))
        .collect()
}

/// Empty argument object for methods without parameters.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct NoArgs {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::is_valid_cap_name;

    #[test]
    fn registry_is_well_formed() {
        assert_eq!(host_caps().len(), REGISTRY.len(), "every version parses");
        let mut names = std::collections::BTreeSet::new();
        for c in REGISTRY {
            assert!(is_valid_cap_name(c.name), "{}", c.name);
            assert!(names.insert(c.name), "duplicate cap {}", c.name);
            let mut methods = std::collections::BTreeSet::new();
            for m in c.methods {
                assert!(
                    methods.insert(m.name),
                    "duplicate method {}.{}",
                    c.name,
                    m.name
                );
            }
        }
        assert!(method("fs", "pickFiles").is_some_and(|m| m.long));
        assert!(method("fs", "nope").is_none());
    }
}
