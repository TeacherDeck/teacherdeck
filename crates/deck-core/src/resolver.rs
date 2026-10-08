// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Compatibility resolver (versioning.md §3, VER-005). The only place that decides which module
//! version runs on this host. Pure and total: any input yields a state, never a panic.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::caps::HostCaps;
use crate::manifest::CapRequirements;

/// Where a candidate version comes from. Declaration order is the tie-break priority for the
/// same version: installed > bundled > catalog (ADR-0009).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema, TS,
)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Installed from a package.
    Installed,
    /// Shipped with the installer.
    Bundled,
    /// Available in the (remote) catalog, not downloaded yet.
    Catalog,
}

/// One available version of a module.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// Where it comes from.
    pub source: Source,
    /// Module version.
    pub version: Version,
    /// Required capability ranges.
    pub requires: CapRequirements,
    /// Optional capability ranges.
    pub optional: CapRequirements,
    /// Package digest, when known. Same version with different digests is Invalid.
    pub sha256: Option<String>,
    /// Revoked in an index.
    pub revoked: bool,
    /// Whether its manifest passed validation.
    pub manifest_valid: bool,
}

/// Resolution state per module (versioning.md §3, UI badge table).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum ResolveState {
    /// Newest valid version runs.
    Ready,
    /// An older version runs; the newest needs an app update.
    NewerNeedsAppUpdate,
    /// No version runs on this app.
    NeedsAppUpdate,
    /// Every version is revoked.
    Revoked,
    /// No valid version (shown in developer mode only).
    Invalid,
}

/// A capability requirement this host does not meet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct UnmetCap {
    /// Capability name.
    pub cap: String,
    /// Range the module asks for.
    pub required: String,
    /// Version this host provides, if any.
    #[ts(type = "string | null")]
    pub available: Option<Version>,
}

/// The version chosen to run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct Picked {
    /// Chosen version.
    #[ts(type = "string")]
    pub version: Version,
    /// Where it comes from.
    pub source: Source,
}

/// Result for one module id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    /// Module id.
    pub id: String,
    /// State for the badge.
    pub state: ResolveState,
    /// Version to run, if any.
    pub picked: Option<Picked>,
    /// Newest valid, non-revoked version.
    #[ts(type = "string | null")]
    pub newest: Option<Version>,
    /// Unmet `requires` of the newest valid version (why an app update is needed).
    pub unmet_requires: Vec<UnmetCap>,
    /// Unmet `optional` caps of the picked version (features to gate with CapabilityGate).
    pub unmet_optional: Vec<UnmetCap>,
}

/// Unmet requirements of `reqs` on `host`. Unparseable ranges count as unmet.
/// Prerelease host versions match only ranges that name a prerelease (semver `VersionReq`).
pub fn unmet(host: &HostCaps, reqs: &CapRequirements) -> Vec<UnmetCap> {
    reqs.iter()
        .filter(|(cap, range)| {
            let available = host.get(cap.as_str());
            match (VersionReq::parse(range), available) {
                (Ok(req), Some(v)) => !req.matches(v),
                _ => true,
            }
        })
        .map(|(cap, range)| UnmetCap {
            cap: cap.clone(),
            required: range.clone(),
            available: host.get(cap.as_str()).cloned(),
        })
        .collect()
}

fn ranges_parse(reqs: &CapRequirements) -> bool {
    reqs.values().all(|r| VersionReq::parse(r).is_ok())
}

/// Collapses candidates that share a version into one, applying ADR-0009:
/// any revoked copy revokes the version; differing digests make it invalid;
/// otherwise the highest-priority valid source wins.
fn merge_same_version(group: &[&Candidate]) -> Option<Candidate> {
    let revoked = group.iter().any(|c| c.revoked);
    let mut digests = group.iter().filter_map(|c| c.sha256.as_deref());
    let conflicting = match digests.next() {
        Some(first) => digests.any(|d| d != first),
        None => false,
    };
    let best = group
        .iter()
        .filter(|c| c.manifest_valid && ranges_parse(&c.requires) && ranges_parse(&c.optional))
        .min_by_key(|c| c.source);
    match (best, conflicting) {
        (Some(best), false) => Some(Candidate {
            revoked,
            ..(*best).clone()
        }),
        // Invalid version; keep revoked so "everything revoked" is still detected.
        _ => group.first().map(|c| Candidate {
            revoked,
            manifest_valid: false,
            ..(*c).clone()
        }),
    }
}

/// Resolves one module.
pub fn resolve_one(host: &HostCaps, id: &str, candidates: &[Candidate]) -> Resolution {
    let mut by_version: BTreeMap<&Version, Vec<&Candidate>> = BTreeMap::new();
    for c in candidates {
        by_version.entry(&c.version).or_default().push(c);
    }
    let merged: Vec<Candidate> = by_version
        .values()
        .filter_map(|g| merge_same_version(g))
        .collect();

    // Newest first.
    let mut cands: Vec<&Candidate> = merged
        .iter()
        .filter(|c| c.manifest_valid && !c.revoked)
        .collect();
    cands.sort_by(|a, b| b.version.cmp(&a.version));

    let mut res = Resolution {
        id: id.to_owned(),
        state: ResolveState::Invalid,
        picked: None,
        newest: None,
        unmet_requires: Vec::new(),
        unmet_optional: Vec::new(),
    };
    let Some(newest) = cands.first() else {
        res.state = if !merged.is_empty() && merged.iter().all(|c| c.revoked) {
            ResolveState::Revoked
        } else {
            ResolveState::Invalid
        };
        return res;
    };
    res.newest = Some(newest.version.clone());
    res.unmet_requires = unmet(host, &newest.requires);

    match cands.iter().find(|c| unmet(host, &c.requires).is_empty()) {
        None => res.state = ResolveState::NeedsAppUpdate,
        Some(pick) => {
            res.state = if pick.version == newest.version {
                ResolveState::Ready
            } else {
                ResolveState::NewerNeedsAppUpdate
            };
            res.unmet_optional = unmet(host, &pick.optional);
            res.picked = Some(Picked {
                version: pick.version.clone(),
                source: pick.source,
            });
        }
    }
    res
}

/// Resolves every module id in `candidates`.
pub fn resolve(
    host: &HostCaps,
    candidates: &BTreeMap<String, Vec<Candidate>>,
) -> BTreeMap<String, Resolution> {
    candidates
        .iter()
        .map(|(id, cands)| (id.clone(), resolve_one(host, id, cands)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    fn host(caps: &[(&str, &str)]) -> HostCaps {
        caps.iter()
            .map(|(c, ver)| ((*c).to_owned(), v(ver)))
            .collect()
    }

    fn reqs(r: &[(&str, &str)]) -> CapRequirements {
        r.iter()
            .map(|(c, x)| ((*c).to_owned(), (*x).to_owned()))
            .collect()
    }

    fn cand(version: &str, requires: &[(&str, &str)]) -> Candidate {
        Candidate {
            source: Source::Bundled,
            version: v(version),
            requires: reqs(requires),
            optional: CapRequirements::new(),
            sha256: None,
            revoked: false,
            manifest_valid: true,
        }
    }

    struct Case {
        name: &'static str,
        host: HostCaps,
        cands: Vec<Candidate>,
        state: ResolveState,
        picked: Option<&'static str>,
        unmet_requires: &'static [&'static str],
        unmet_optional: &'static [&'static str],
    }

    fn caps_of(list: &[UnmetCap]) -> Vec<&str> {
        list.iter().map(|u| u.cap.as_str()).collect()
    }

    #[test]
    fn table() {
        let h1 = host(&[("storage", "1.2.0"), ("window", "1.0.0")]);
        let with = |mut c: Candidate, f: &dyn Fn(&mut Candidate)| {
            f(&mut c);
            c
        };
        let cases = vec![
            Case {
                name: "정상",
                host: h1.clone(),
                cands: vec![cand("0.1.0", &[("storage", "^1.0")])],
                state: ResolveState::Ready,
                picked: Some("0.1.0"),
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "optional 미충족",
                host: h1.clone(),
                cands: vec![with(cand("0.1.0", &[]), &|c| {
                    c.optional = reqs(&[("fs", "^1.0"), ("storage", "^1.1")]);
                })],
                state: ResolveState::Ready,
                picked: Some("0.1.0"),
                unmet_requires: &[],
                unmet_optional: &["fs"],
            },
            Case {
                name: "requires major 불일치",
                host: h1.clone(),
                cands: vec![cand("0.1.0", &[("storage", "^2.0")])],
                state: ResolveState::NeedsAppUpdate,
                picked: None,
                unmet_requires: &["storage"],
                unmet_optional: &[],
            },
            Case {
                name: "최신만 비호환",
                host: h1.clone(),
                cands: vec![
                    cand("0.1.0", &[("storage", "^1.0")]),
                    cand("0.2.0", &[("storage", "^1.5")]),
                ],
                state: ResolveState::NewerNeedsAppUpdate,
                picked: Some("0.1.0"),
                unmet_requires: &["storage"],
                unmet_optional: &[],
            },
            Case {
                name: "전부 비호환",
                host: h1.clone(),
                cands: vec![
                    cand("0.1.0", &[("window", "^2")]),
                    cand("0.2.0", &[("storage", "^3")]),
                ],
                state: ResolveState::NeedsAppUpdate,
                picked: None,
                unmet_requires: &["storage"],
                unmet_optional: &[],
            },
            Case {
                name: "전부 revoked",
                host: h1.clone(),
                cands: vec![
                    with(cand("0.1.0", &[]), &|c| c.revoked = true),
                    with(cand("0.2.0", &[]), &|c| c.revoked = true),
                ],
                state: ResolveState::Revoked,
                picked: None,
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "일부 revoked",
                host: h1.clone(),
                cands: vec![
                    cand("0.1.0", &[]),
                    with(cand("0.2.0", &[]), &|c| c.revoked = true),
                ],
                state: ResolveState::Ready,
                picked: Some("0.1.0"),
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "매니페스트 무효",
                host: h1.clone(),
                cands: vec![with(cand("0.1.0", &[]), &|c| c.manifest_valid = false)],
                state: ResolveState::Invalid,
                picked: None,
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "무효인 최신은 건너뜀",
                host: h1.clone(),
                cands: vec![
                    cand("0.1.0", &[]),
                    with(cand("0.2.0", &[]), &|c| c.manifest_valid = false),
                ],
                state: ResolveState::Ready,
                picked: Some("0.1.0"),
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "prerelease 호스트 캡은 명시 요청만 충족",
                host: host(&[("storage", "1.1.0-beta.2")]),
                cands: vec![cand("0.1.0", &[("storage", "^1.0")])],
                state: ResolveState::NeedsAppUpdate,
                picked: None,
                unmet_requires: &["storage"],
                unmet_optional: &[],
            },
            Case {
                name: "prerelease 범위 명시",
                host: host(&[("storage", "1.1.0-beta.2")]),
                cands: vec![cand("0.1.0", &[("storage", "^1.1.0-beta.1")])],
                state: ResolveState::Ready,
                picked: Some("0.1.0"),
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "다중 출처 중복: installed 우선",
                host: h1.clone(),
                cands: vec![
                    with(cand("0.1.0", &[]), &|c| c.source = Source::Catalog),
                    with(cand("0.1.0", &[]), &|c| c.source = Source::Installed),
                    cand("0.1.0", &[]),
                ],
                state: ResolveState::Ready,
                picked: Some("0.1.0"),
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "다중 출처 sha256 불일치는 무효",
                host: h1.clone(),
                cands: vec![
                    with(cand("0.1.0", &[]), &|c| c.sha256 = Some("a".repeat(64))),
                    with(cand("0.1.0", &[]), &|c| {
                        c.source = Source::Catalog;
                        c.sha256 = Some("b".repeat(64));
                    }),
                ],
                state: ResolveState::Invalid,
                picked: None,
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "다중 출처 중 하나라도 revoked면 revoked",
                host: h1.clone(),
                cands: vec![
                    cand("0.1.0", &[]),
                    with(cand("0.1.0", &[]), &|c| {
                        c.source = Source::Catalog;
                        c.revoked = true;
                    }),
                ],
                state: ResolveState::Revoked,
                picked: None,
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "빈 requires",
                host: HostCaps::new(),
                cands: vec![cand("1.0.0", &[])],
                state: ResolveState::Ready,
                picked: Some("1.0.0"),
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "미등록 캡",
                host: h1.clone(),
                cands: vec![cand("0.1.0", &[("ocr", "^1.0")])],
                state: ResolveState::NeedsAppUpdate,
                picked: None,
                unmet_requires: &["ocr"],
                unmet_optional: &[],
            },
            Case {
                name: "해석 불가 범위는 무효",
                host: h1.clone(),
                cands: vec![cand("0.1.0", &[("storage", "one point oh")])],
                state: ResolveState::Invalid,
                picked: None,
                unmet_requires: &[],
                unmet_optional: &[],
            },
            Case {
                name: "후보 없음",
                host: h1,
                cands: vec![],
                state: ResolveState::Invalid,
                picked: None,
                unmet_requires: &[],
                unmet_optional: &[],
            },
        ];

        for case in cases {
            let r = resolve_one(&case.host, "sample", &case.cands);
            assert_eq!(r.state, case.state, "{}", case.name);
            assert_eq!(
                r.picked.as_ref().map(|p| p.version.to_string()),
                case.picked.map(str::to_owned),
                "{}",
                case.name
            );
            assert_eq!(
                caps_of(&r.unmet_requires),
                case.unmet_requires,
                "{}",
                case.name
            );
            assert_eq!(
                caps_of(&r.unmet_optional),
                case.unmet_optional,
                "{}",
                case.name
            );
        }
    }

    #[test]
    fn duplicate_picks_highest_priority_source() {
        let mut a = cand("0.1.0", &[]);
        a.source = Source::Catalog;
        let mut b = cand("0.1.0", &[]);
        b.source = Source::Installed;
        let r = resolve_one(&HostCaps::new(), "x", &[a, b]);
        assert_eq!(r.picked.map(|p| p.source), Some(Source::Installed));
    }

    #[test]
    fn resolve_covers_every_id() {
        let mut all = BTreeMap::new();
        all.insert("a-mod".to_owned(), vec![cand("1.0.0", &[])]);
        all.insert("b-mod".to_owned(), vec![]);
        let out = resolve(&HostCaps::new(), &all);
        assert_eq!(out.len(), 2);
        assert_eq!(
            out.get("b-mod").map(|r| r.state),
            Some(ResolveState::Invalid)
        );
    }
}
