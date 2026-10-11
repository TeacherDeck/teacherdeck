// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Shell-owned data and owner-bound, revocable projections (ADR-0020).
pub mod output;
pub mod workbook;
use deck_core::caps::school_data::*;
use deck_core::handles::{HANDLE_BYTES, RandomSource};
use deck_core::{DeckError, ErrorCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    id: String,
    semester: String,
    kind: SchoolContextKind,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Grant {
    owner: String,
    handle: String,
    bindings: Vec<Binding>,
    scopes: Vec<SchoolScope>,
    persistent: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Disk {
    version: u8,
    document: SchoolDataDocument,
    grants: Vec<Grant>,
}
struct Pending {
    request: SchoolAccessRequest,
    sender: mpsc::Sender<Option<SchoolAccessGrant>>,
    born: Instant,
}
struct Snapshot {
    owner: String,
    grant: String,
    photos: HashMap<String, String>,
    context: Binding,
    born: Instant,
}
/// Owner and grant are checked again for every photo resource read.
pub struct PhotoResource {
    /// Bridge-authenticated module identity.
    pub owner: String,
    /// Matching grant handle.
    pub grant: String,
    /// Revocation tombstone while the file session is being closed.
    pub live: bool,
    /// Matching immutable roster snapshot.
    pub snapshot: String,
}
/// Kept under one lock, including persistence, to reject stale/revoked reads atomically.
pub struct Inner {
    blocked: Option<DeckError>,
    disk: Disk,
    grants: Vec<Grant>,
    pending: HashMap<String, Pending>,
    snapshots: HashMap<String, Snapshot>,
    /// Authenticated photo sessions, including denied close tombstones.
    pub resources: HashMap<String, PhotoResource>,
}
/// Managed independently of AppState; paths never enter projections.
pub struct SchoolDataService {
    root: PathBuf,
    /// Serialized data and authority state.
    pub inner: Mutex<Inner>,
}
fn error(code: ErrorCode) -> DeckError {
    DeckError::new(
        code,
        "학교 공통자료를 처리할 수 없어요. 자료와 허용 범위를 확인해 주세요.",
    )
}
/// PII-free persistence error.
pub fn internal() -> DeckError {
    error(ErrorCode::Internal)
}
/// PII-free authority error.
pub fn denied() -> DeckError {
    error(ErrorCode::PermissionDenied)
}
fn invalid() -> DeckError {
    error(ErrorCode::InvalidArgs)
}
/// Opaque random identifier, unrelated to paths or student identifiers.
pub fn token() -> String {
    let mut bytes = [0; HANDLE_BYTES];
    crate::platform::OsRng.fill(&mut bytes);
    deck_core::util::to_hex(&bytes)
}
fn summary(c: &SchoolContext, d: &SchoolDataDocument) -> SchoolContextSummary {
    SchoolContextSummary {
        context_id: c.id.clone(),
        semester_id: c.semester_id.clone(),
        kind: c.kind,
        label: c.label.clone(),
        member_count: c.enrollment_ids.len() as u16,
        revision: d.revision,
    }
}
fn bound(g: &Grant, c: &SchoolContext) -> bool {
    g.bindings
        .iter()
        .any(|b| b.id == c.id && b.semester == c.semester_id && b.kind == c.kind)
}
impl Inner {
    fn ready(&self) -> Result<(), DeckError> {
        self.blocked.clone().map_or(Ok(()), Err)
    }
    fn grant(
        &self,
        owner: &str,
        handle: &str,
        scope: Option<SchoolScope>,
    ) -> Result<&Grant, DeckError> {
        self.ready()?;
        self.grants
            .iter()
            .find(|g| {
                g.owner == owner
                    && g.handle == handle
                    && scope.is_none_or(|s| g.scopes.contains(&s))
            })
            .ok_or_else(denied)
    }
    fn public_grant(&self, g: &Grant) -> SchoolAccessGrant {
        SchoolAccessGrant {
            grant_handle: g.handle.clone(),
            scopes: g.scopes.clone(),
            contexts: self
                .disk
                .document
                .contexts
                .iter()
                .filter(|c| bound(g, c))
                .map(|c| summary(c, &self.disk.document))
                .collect(),
            persistent: g.persistent,
        }
    }
    fn revision(&self, expected: Option<u32>) -> Result<(), DeckError> {
        self.ready()?;
        if expected.is_some_and(|v| v != self.disk.document.revision) {
            Err(error(ErrorCode::Busy))
        } else {
            Ok(())
        }
    }
    /// Authority check shared by the bridge and authenticated photo route.
    pub fn authorize_resource(
        &self,
        owner: &str,
        handle: &str,
        snapshot: &str,
    ) -> Result<(), DeckError> {
        let g = self.grant(owner, handle, Some(SchoolScope::Photos))?;
        let s = self
            .snapshots
            .get(snapshot)
            .filter(|s| {
                s.owner == owner && s.grant == handle && s.born.elapsed() < Duration::from_secs(300)
            })
            .ok_or_else(denied)?;
        if !self.disk.document.contexts.iter().any(|c| {
            c.id == s.context.id
                && c.semester_id == s.context.semester
                && c.kind == s.context.kind
                && bound(g, c)
        }) {
            return Err(denied());
        }
        Ok(())
    }
}
impl SchoolDataService {
    /// A storage failure disables only school data; it never prevents app startup or writes empty data.
    pub fn open(root: PathBuf) -> Result<Self, DeckError> {
        match Self::open_ready(root.clone()) {
            Ok(service) => Ok(service),
            Err(error) => Ok(Self {
                root,
                inner: Mutex::new(Inner {
                    blocked: Some(error),
                    disk: Disk {
                        version: 1,
                        document: SchoolDataDocument::default(),
                        grants: vec![],
                    },
                    grants: vec![],
                    pending: HashMap::new(),
                    snapshots: HashMap::new(),
                    resources: HashMap::new(),
                }),
            }),
        }
    }
    fn open_ready(root: PathBuf) -> Result<Self, DeckError> {
        std::fs::create_dir_all(root.join("photos")).map_err(|_| internal())?;
        let path = root.join("school-data.json");
        let disk = match std::fs::metadata(&path) {
            Ok(m) => {
                if !m.is_file() || m.len() > 32 * 1024 * 1024 {
                    return Err(invalid());
                }
                let bytes = std::fs::read(path).map_err(|_| internal())?;
                serde_json::from_slice::<Disk>(&bytes).map_err(|_| invalid())?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Disk {
                version: 1,
                document: SchoolDataDocument::default(),
                grants: vec![],
            },
            Err(_) => return Err(internal()),
        };
        disk.document.validate()?;
        if disk.version != 1
            || disk.grants.len() > 256
            || disk.grants.iter().any(|g| {
                !g.persistent
                    || !deck_core::util::is_valid_module_id(&g.owner)
                    || g.handle.len() != 32
                    || g.bindings.is_empty()
                    || g.scopes.is_empty()
                    || g.bindings.len() > 1000
                    || g.scopes.iter().any(|s| {
                        *s == SchoolScope::Photos && !g.scopes.contains(&SchoolScope::RosterBasic)
                    })
            })
        {
            return Err(invalid());
        }
        let grants = disk.grants.clone();
        Ok(Self {
            root,
            inner: Mutex::new(Inner {
                blocked: None,
                disk,
                grants,
                pending: HashMap::new(),
                snapshots: HashMap::new(),
                resources: HashMap::new(),
            }),
        })
    }
    /// Explicit trusted recovery preserves the unreadable app-owned file before any replacement.
    pub fn recover(&self, args: SaveSchoolDataArgs) -> Result<SchoolDataDocument, DeckError> {
        let mut i = self.inner.lock().map_err(|_| internal())?;
        if i.blocked.is_none() || args.expected_revision != 0 {
            return Err(denied());
        }
        let mut d = args.document;
        d.validate()?;
        // JSON cannot carry image binaries: reattach only host-owned, validated existing files.
        for photo in &d.photos {
            let source = crate::file_read::FileReadSession::open(
                &self.root.join("photos").join(format!("{}.bin", photo.id)),
            )?;
            if source.size() != u64::from(photo.size) {
                return Err(invalid());
            }
        }
        std::fs::create_dir_all(&self.root).map_err(|_| internal())?;
        let old = self.root.join("school-data.json");
        if old.exists() {
            if std::fs::metadata(&old).map_err(|_| internal())?.len() > 32 * 1024 * 1024 {
                return Err(invalid());
            }
            let source = std::fs::File::open(&old).map_err(|_| internal())?;
            let mut destination = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(
                    self.root
                        .join(format!("school-data-preserved-{}.json", token())),
                )
                .map_err(|_| internal())?;
            std::io::copy(
                &mut std::io::Read::take(source, 32 * 1024 * 1024 + 1),
                &mut destination,
            )
            .map_err(|_| internal())?;
            destination.sync_all().map_err(|_| internal())?;
            if std::fs::metadata(&old).map_err(|_| internal())?.len() > 32 * 1024 * 1024 {
                return Err(invalid());
            }
        }
        d.revision = d.revision.checked_add(1).ok_or_else(invalid)?;
        self.persist(&i, &d, &[])?;
        i.disk.document = d.clone();
        i.disk.grants.clear();
        i.grants.clear();
        i.pending.clear();
        i.snapshots.clear();
        i.resources.clear();
        i.blocked = None;
        Ok(d)
    }
    fn persist(
        &self,
        inner: &Inner,
        document: &SchoolDataDocument,
        grants: &[Grant],
    ) -> Result<(), DeckError> {
        let disk = Disk {
            version: 1,
            document: document.clone(),
            grants: grants.iter().filter(|g| g.persistent).cloned().collect(),
        };
        let bytes = serde_json::to_vec(&disk).map_err(|_| internal())?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(invalid());
        }
        crate::storage::write_atomic(&self.root, "school-data.json", &bytes)
            .map_err(|_| internal())?;
        let _ = inner;
        Ok(())
    }
    /// Trusted shell document read; blocked data is never exposed as empty.
    pub fn load(&self) -> Result<SchoolDataDocument, DeckError> {
        let i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        Ok(i.disk.document.clone())
    }
    /// Stale saves and edits to already protected semesters are rejected before writing.
    pub fn save(&self, args: SaveSchoolDataArgs) -> Result<SchoolDataDocument, DeckError> {
        let mut i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        i.revision(Some(args.expected_revision))?;
        let mut d = args.document;
        d.validate()?;
        protect(&i.disk.document, &d)?;
        if d.photos != i.disk.document.photos {
            return Err(denied());
        }
        d.revision = i
            .disk
            .document
            .revision
            .checked_add(1)
            .ok_or_else(invalid)?;
        self.persist(&i, &d, &i.grants)?;
        i.disk.document = d.clone();
        Ok(d)
    }
    /// Atomically publishes a reviewed native import and new host-owned photos.
    /// Photo files use fresh ids; failed document publication leaves existing data intact.
    pub fn apply_native_import(
        &self,
        args: SaveSchoolDataArgs,
        photos: &std::collections::BTreeMap<String, Vec<u8>>,
    ) -> Result<SchoolDataDocument, DeckError> {
        let mut inner = self.inner.lock().map_err(|_| internal())?;
        inner.revision(Some(args.expected_revision))?;
        let mut document = args.document;
        document.validate()?;
        protect(&inner.disk.document, &document)?;
        // The shell cannot alter existing photo metadata or import arbitrary ids.
        if inner
            .disk
            .document
            .photos
            .iter()
            .any(|old| !document.photos.contains(old))
            || document.photos.iter().any(|photo| {
                if inner.disk.document.photos.contains(photo) {
                    return photos.contains_key(&photo.id);
                }
                photos.get(&photo.id).is_none_or(|bytes| {
                    bytes.len() != photo.size as usize
                        || crate::timealert::projection::photo_mime(bytes).ok()
                            != Some(photo.mime_type.as_str())
                })
            })
            || photos
                .keys()
                .any(|key| !document.photos.iter().any(|photo| photo.id == *key))
        {
            return Err(denied());
        }
        document.revision = inner
            .disk
            .document
            .revision
            .checked_add(1)
            .ok_or_else(invalid)?;
        for (id, bytes) in photos {
            let name = format!("{id}.bin");
            if self.root.join("photos").join(&name).exists() {
                return Err(denied());
            }
            crate::storage::write_atomic(&self.root.join("photos"), &name, bytes)
                .map_err(|_| internal())?;
        }
        self.persist(&inner, &document, &inner.grants)?;
        inner.disk.document = document.clone();
        Ok(document)
    }
    /// Reads saved photo bytes through retained filesystem guards for a main-only backup.
    pub fn backup_photos(
        &self,
        expected_revision: u32,
    ) -> Result<
        (
            SchoolDataDocument,
            std::collections::BTreeMap<String, Vec<u8>>,
        ),
        DeckError,
    > {
        let inner = self.inner.lock().map_err(|_| internal())?;
        inner.revision(Some(expected_revision))?;
        let mut photos = std::collections::BTreeMap::new();
        for photo in &inner.disk.document.photos {
            let mut read = crate::file_read::FileReadSession::open(
                &self.root.join("photos").join(format!("{}.bin", photo.id)),
            )?;
            if read.size() != u64::from(photo.size) {
                return Err(invalid());
            }
            let mut bytes = Vec::with_capacity(photo.size as usize);
            while bytes.len() < photo.size as usize {
                bytes.extend(read.read_chunk(
                    bytes.len() as u64,
                    (photo.size as usize - bytes.len()).min(crate::file_read::READ_CHUNK_BYTES),
                )?);
            }
            photos.insert(photo.id.clone(), bytes);
        }
        Ok((inner.disk.document.clone(), photos))
    }
    /// Returns only grants owned by this bridge-authenticated module.
    pub fn status(&self, owner: &str) -> Result<SchoolAccessStatus, DeckError> {
        let i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        let grants: Vec<_> = i
            .grants
            .iter()
            .filter(|g| g.owner == owner)
            .map(|g| i.public_grant(g))
            .collect();
        let mut contexts = vec![];
        let mut scopes = vec![];
        for g in &grants {
            for c in &g.contexts {
                if !contexts
                    .iter()
                    .any(|v: &SchoolContextSummary| v.context_id == c.context_id)
                {
                    contexts.push(c.clone());
                }
            }
            for s in &g.scopes {
                if !scopes.contains(s) {
                    scopes.push(*s);
                }
            }
        }
        Ok(SchoolAccessStatus {
            permitted: !grants.is_empty(),
            revision: i.disk.document.revision,
            contexts,
            scopes,
            grants,
        })
    }
    /// Creates a bounded pending approval with host-supplied owner identity.
    pub fn request(
        &self,
        owner: &str,
        name: &str,
        args: SchoolRequestedAccess,
    ) -> Result<(String, mpsc::Receiver<Option<SchoolAccessGrant>>), DeckError> {
        if args.kinds.is_empty()
            || args.kinds.len() > 2
            || args.scopes.is_empty()
            || args.scopes.len() > 3
            || args
                .kinds
                .iter()
                .enumerate()
                .any(|(n, k)| args.kinds.iter().take(n).any(|v| v == k))
            || args
                .scopes
                .iter()
                .enumerate()
                .any(|(n, s)| args.scopes.iter().take(n).any(|v| v == s))
            || args.scopes.contains(&SchoolScope::Photos)
                && !args.scopes.contains(&SchoolScope::RosterBasic)
        {
            return Err(invalid());
        }
        let mut i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        i.pending
            .retain(|_, p| p.born.elapsed() < Duration::from_secs(120));
        if i.pending.len() >= 16 || i.pending.values().any(|p| p.request.module_id == owner) {
            return Err(error(ErrorCode::Busy));
        }
        let id = token();
        let contexts = i
            .disk
            .document
            .contexts
            .iter()
            .filter(|c| args.kinds.contains(&c.kind))
            .map(|c| summary(c, &i.disk.document))
            .collect();
        let (tx, rx) = mpsc::channel();
        i.pending.insert(
            id.clone(),
            Pending {
                request: SchoolAccessRequest {
                    request_id: id.clone(),
                    module_id: owner.into(),
                    module_name: name.into(),
                    requested: args,
                    contexts,
                },
                sender: tx,
                born: Instant::now(),
            },
        );
        Ok((id, rx))
    }
    /// Removes a completed, cancelled or timed-out approval request.
    pub fn cancel_request(&self, id: &str) {
        if let Ok(mut i) = self.inner.lock() {
            i.pending.remove(id);
        }
    }
    /// Lists pending requests for the trusted shell.
    pub fn pending(&self) -> Result<Vec<SchoolAccessRequest>, DeckError> {
        let mut i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        i.pending
            .retain(|_, p| p.born.elapsed() < Duration::from_secs(120));
        Ok(i.pending.values().map(|p| p.request.clone()).collect())
    }
    /// Narrows a pending request to explicit teacher-approved contexts and fields.
    pub fn resolve(&self, args: SchoolAccessResolution) -> Result<(), DeckError> {
        let mut i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        let p = i.pending.get(&args.request_id).ok_or_else(denied)?;
        if !args.allow {
            let p = i.pending.remove(&args.request_id).ok_or_else(denied)?;
            let _ = p.sender.send(None);
            return Ok(());
        }
        if p.born.elapsed() >= Duration::from_secs(120)
            || args.context_ids.is_empty()
            || args.scopes.is_empty()
            || args.context_ids.len() > 1000
            || args
                .context_ids
                .iter()
                .enumerate()
                .any(|(n, id)| args.context_ids.iter().take(n).any(|v| v == id))
            || args
                .scopes
                .iter()
                .enumerate()
                .any(|(n, s)| args.scopes.iter().take(n).any(|v| v == s))
            || args
                .scopes
                .iter()
                .any(|s| !p.request.requested.scopes.contains(s))
            || args.remember && !p.request.requested.remember
            || args.scopes.contains(&SchoolScope::Photos)
                && !args.scopes.contains(&SchoolScope::RosterBasic)
            || i.grants.len() >= 256
        {
            return Err(invalid());
        }
        let bindings: Vec<_> = args
            .context_ids
            .iter()
            .map(|id| {
                let c = i
                    .disk
                    .document
                    .contexts
                    .iter()
                    .find(|c| {
                        c.id == *id
                            && p.request.requested.kinds.contains(&c.kind)
                            && p.request.contexts.iter().any(|v| {
                                v.context_id == c.id
                                    && v.semester_id == c.semester_id
                                    && v.kind == c.kind
                            })
                    })
                    .ok_or_else(denied)?;
                Ok(Binding {
                    id: c.id.clone(),
                    semester: c.semester_id.clone(),
                    kind: c.kind,
                })
            })
            .collect::<Result<_, DeckError>>()?;
        let g = Grant {
            owner: p.request.module_id.clone(),
            handle: token(),
            bindings,
            scopes: args.scopes,
            persistent: args.remember,
        };
        let mut grants = i.grants.clone();
        grants.push(g.clone());
        self.persist(&i, &i.disk.document, &grants)?;
        i.grants = grants;
        let public = i.public_grant(&g);
        let p = i.pending.remove(&args.request_id).ok_or_else(denied)?;
        let _ = p.sender.send(Some(public));
        Ok(())
    }
    /// Lists grant records for trusted settings only.
    pub fn grants(&self) -> Result<Vec<SchoolGrantRecord>, DeckError> {
        let i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        Ok(i.grants
            .iter()
            .map(|g| SchoolGrantRecord {
                module_id: g.owner.clone(),
                grant: i.public_grant(g),
            })
            .collect())
    }
    /// Persists revocation before dropping in-memory authority. Returns resources to close.
    pub fn revoke(&self, owner: &str, handle: &str) -> Result<Vec<String>, DeckError> {
        let mut i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        i.grant(owner, handle, None)?;
        let grants: Vec<_> = i
            .grants
            .iter()
            .filter(|g| !(g.owner == owner && g.handle == handle))
            .cloned()
            .collect();
        self.persist(&i, &i.disk.document, &grants)?;
        i.grants = grants;
        i.snapshots
            .retain(|_, s| s.owner != owner || s.grant != handle);
        let resources = i
            .resources
            .iter()
            .filter(|(_, r)| r.owner == owner && r.grant == handle)
            .map(|(k, _)| k.clone())
            .collect();
        for resource in i
            .resources
            .values_mut()
            .filter(|r| r.owner == owner && r.grant == handle)
        {
            resource.live = false;
        }
        Ok(resources)
    }
    /// Drops session approvals, snapshots and photo authority for one owner.
    pub fn unload(&self, owner: &str) -> Vec<String> {
        let Ok(mut i) = self.inner.lock() else {
            return vec![];
        };
        i.grants.retain(|g| g.owner != owner || g.persistent);
        i.pending.retain(|_, p| p.request.module_id != owner);
        i.snapshots.retain(|_, s| s.owner != owner);
        let resources = i
            .resources
            .iter()
            .filter(|(_, r)| r.owner == owner)
            .map(|(k, _)| k.clone())
            .collect();
        for resource in i.resources.values_mut().filter(|r| r.owner == owner) {
            resource.live = false;
        }
        resources
    }
    /// Removes only closed resource tombstones; until then the photo route must deny them.
    pub fn forget_resources(&self, owner: &str, resources: &[String]) {
        if let Ok(mut i) = self.inner.lock() {
            i.resources
                .retain(|id, r| r.owner != owner || !resources.contains(id));
        }
    }
    /// Returns only contexts bound to this owner grant.
    pub fn list(
        &self,
        owner: &str,
        args: SchoolGrantArgs,
    ) -> Result<Vec<SchoolContextSummary>, DeckError> {
        let i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        let g = i.grant(owner, &args.grant_handle, None)?;
        Ok(i.public_grant(g).contexts)
    }
    /// Captures one permitted context and its enrollment identities.
    pub fn roster(
        &self,
        owner: &str,
        args: SchoolReadRosterArgs,
    ) -> Result<SchoolRosterSnapshot, DeckError> {
        let mut i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        i.revision(args.expected_revision)?;
        i.snapshots
            .retain(|_, s| s.born.elapsed() < Duration::from_secs(300));
        let g = i.grant(owner, &args.grant_handle, Some(SchoolScope::RosterBasic))?;
        let d = &i.disk.document;
        let c = d
            .contexts
            .iter()
            .find(|c| c.id == args.context_id && bound(g, c))
            .ok_or_else(denied)?;
        let semester = d
            .semesters
            .iter()
            .find(|s| s.id == c.semester_id)
            .ok_or_else(invalid)?
            .clone();
        let context = summary(c, d);
        let mut photos = HashMap::new();
        let enrollments: HashMap<_, _> = d.enrollments.iter().map(|e| (e.id.as_str(), e)).collect();
        let masters: HashMap<_, _> = d.students.iter().map(|s| (s.id.as_str(), s)).collect();
        let students = c
            .enrollment_ids
            .iter()
            .map(|id| {
                let e = enrollments.get(id.as_str()).ok_or_else(invalid)?;
                let s = masters.get(e.student_id.as_str()).ok_or_else(invalid)?;
                let photo_handle = if g.scopes.contains(&SchoolScope::Photos) {
                    s.photo_id.as_ref().map(|p| {
                        let handle = token();
                        photos.insert(handle.clone(), p.clone());
                        handle
                    })
                } else {
                    None
                };
                Ok(SchoolStudentSummary {
                    student_id: s.id.clone(),
                    enrollment_id: e.id.clone(),
                    grade: e.grade,
                    class_number: e.class_number,
                    student_number: e.student_number,
                    display_student_code: format!(
                        "{}-{}-{}",
                        e.grade, e.class_number, e.student_number
                    ),
                    name: s.name.clone(),
                    status: e.status,
                    photo_handle,
                })
            })
            .collect::<Result<Vec<_>, DeckError>>()?;
        if i.snapshots.values().filter(|s| s.owner == owner).count() >= 16 {
            return Err(error(ErrorCode::Busy));
        }
        let snapshot_id = token();
        let result = SchoolRosterSnapshot {
            snapshot_id: snapshot_id.clone(),
            revision: d.revision,
            semester,
            context,
            students,
        };
        i.snapshots.insert(
            snapshot_id,
            Snapshot {
                owner: owner.into(),
                grant: args.grant_handle,
                photos,
                context: Binding {
                    id: result.context.context_id.clone(),
                    semester: result.context.semester_id.clone(),
                    kind: result.context.kind,
                },
                born: Instant::now(),
            },
        );
        Ok(result)
    }
    /// Filters every timetable entry to granted contexts.
    pub fn timetable(
        &self,
        owner: &str,
        args: SchoolReadTimetableArgs,
    ) -> Result<SchoolTimetableSnapshot, DeckError> {
        let i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        i.revision(args.expected_revision)?;
        let g = i.grant(owner, &args.grant_handle, Some(SchoolScope::Timetable))?;
        let d = &i.disk.document;
        let contexts: Vec<_> = d
            .contexts
            .iter()
            .filter(|c| c.semester_id == args.semester_id && bound(g, c))
            .map(|c| summary(c, d))
            .collect();
        if contexts.is_empty() {
            return Err(denied());
        }
        let semester = d
            .semesters
            .iter()
            .find(|s| s.id == args.semester_id)
            .ok_or_else(invalid)?
            .clone();
        let mut timetable = d.timetable.clone();
        timetable
            .day_templates
            .retain(|t| t.semester_id == args.semester_id);
        timetable
            .weekly_tables
            .retain(|t| t.semester_id == args.semester_id);
        for t in &mut timetable.weekly_tables {
            t.entries
                .retain(|e| contexts.iter().any(|c| c.context_id == e.context_id));
        }
        timetable
            .day_overrides
            .retain(|t| t.semester_id == args.semester_id);
        timetable.date_changes.retain(|t| {
            t.semester_id == args.semester_id
                && contexts.iter().any(|c| c.context_id == t.context_id)
        });
        Ok(SchoolTimetableSnapshot {
            snapshot_id: token(),
            revision: d.revision,
            semester,
            contexts,
            timetable,
        })
    }
    /// Resolves only a captured photo identity under the same live owner/grant/snapshot.
    pub fn photo_path(
        &self,
        i: &Inner,
        owner: &str,
        args: &SchoolOpenPhotoArgs,
    ) -> Result<(PathBuf, SchoolPhotoInfo), DeckError> {
        i.authorize_resource(owner, &args.grant_handle, &args.snapshot_id)?;
        let s = i
            .snapshots
            .get(&args.snapshot_id)
            .filter(|s| s.owner == owner && s.grant == args.grant_handle)
            .ok_or_else(denied)?;
        let id = s.photos.get(&args.photo_handle).ok_or_else(denied)?;
        let info = i
            .disk
            .document
            .photos
            .iter()
            .find(|p| p.id == *id)
            .ok_or_else(denied)?
            .clone();
        Ok((self.root.join("photos").join(format!("{id}.bin")), info))
    }
    /// App-owned photo append and optimistic metadata commit; selected original is read only.
    pub fn import_photo(
        &self,
        args: SchoolImportPhotoArgs,
        path: PathBuf,
    ) -> Result<SchoolDataDocument, DeckError> {
        let mut source = crate::file_read::FileReadSession::open(&path)?;
        if source.size() == 0 || source.size() > 16 * 1024 * 1024 {
            return Err(invalid());
        }
        let mut bytes = Vec::with_capacity(source.size() as usize);
        while bytes.len() < source.size() as usize {
            bytes.extend(source.read_chunk(
                bytes.len() as u64,
                (source.size() as usize - bytes.len()).min(crate::file_read::READ_CHUNK_BYTES),
            )?);
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            "image/jpeg"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice()) {
            "image/webp"
        } else {
            return Err(invalid());
        };
        let mut i = self.inner.lock().map_err(|_| internal())?;
        i.ready()?;
        i.revision(Some(args.expected_revision))?;
        let mut d = i.disk.document.clone();
        let student = d
            .students
            .iter_mut()
            .find(|s| s.id == args.student_id)
            .ok_or_else(invalid)?;
        if i.disk.document.enrollments.iter().any(|e| {
            e.student_id == args.student_id
                && i.disk
                    .document
                    .semesters
                    .iter()
                    .any(|s| s.id == e.semester_id && (s.read_only || s.archived))
        }) {
            return Err(denied());
        }
        let id = token();
        student.photo_id = Some(id.clone());
        d.photos.push(SchoolPhotoInfo {
            id: id.clone(),
            size: bytes.len() as u32,
            mime_type: mime.into(),
        });
        d.revision = d.revision.checked_add(1).ok_or_else(invalid)?;
        d.validate()?;
        crate::storage::write_atomic(&self.root.join("photos"), &format!("{id}.bin"), &bytes)
            .map_err(|_| internal())?;
        self.persist(&i, &d, &i.grants)?;
        i.disk.document = d.clone();
        Ok(d)
    }
}
fn protect(old: &SchoolDataDocument, new: &SchoolDataDocument) -> Result<(), DeckError> {
    for s in old.semesters.iter().filter(|s| s.read_only || s.archived) {
        if !new.semesters.contains(s) {
            return Err(denied());
        }
        let before: Vec<_> = old
            .enrollments
            .iter()
            .filter(|e| e.semester_id == s.id)
            .collect();
        let after: Vec<_> = new
            .enrollments
            .iter()
            .filter(|e| e.semester_id == s.id)
            .collect();
        if before != after
            || old
                .contexts
                .iter()
                .filter(|c| c.semester_id == s.id)
                .collect::<Vec<_>>()
                != new
                    .contexts
                    .iter()
                    .filter(|c| c.semester_id == s.id)
                    .collect::<Vec<_>>()
        {
            return Err(denied());
        }
        for e in before {
            if old.students.iter().find(|v| v.id == e.student_id)
                != new.students.iter().find(|v| v.id == e.student_id)
            {
                return Err(denied());
            }
        }
        if old
            .timetable
            .day_templates
            .iter()
            .filter(|t| t.semester_id == s.id)
            .collect::<Vec<_>>()
            != new
                .timetable
                .day_templates
                .iter()
                .filter(|t| t.semester_id == s.id)
                .collect::<Vec<_>>()
            || old
                .timetable
                .weekly_tables
                .iter()
                .filter(|t| t.semester_id == s.id)
                .collect::<Vec<_>>()
                != new
                    .timetable
                    .weekly_tables
                    .iter()
                    .filter(|t| t.semester_id == s.id)
                    .collect::<Vec<_>>()
            || old
                .timetable
                .day_overrides
                .iter()
                .filter(|t| t.semester_id == s.id)
                .collect::<Vec<_>>()
                != new
                    .timetable
                    .day_overrides
                    .iter()
                    .filter(|t| t.semester_id == s.id)
                    .collect::<Vec<_>>()
            || old
                .timetable
                .date_changes
                .iter()
                .filter(|t| t.semester_id == s.id)
                .collect::<Vec<_>>()
                != new
                    .timetable
                    .date_changes
                    .iter()
                    .filter(|t| t.semester_id == s.id)
                    .collect::<Vec<_>>()
        {
            return Err(denied());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
