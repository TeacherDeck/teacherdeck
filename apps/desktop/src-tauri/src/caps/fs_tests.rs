// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
use super::*;
use crate::file_transfer::FileTransfers;
use crate::modules::ModuleStore;
use crate::platform::{OsRng, TempArea, TempDir};
use crate::storage::StorageService;
use deck_core::catalog::CatalogIndex;
use deck_core::handles::{HANDLE_BYTES, HandleTable, RandomSource};
use deck_core::package::build_package;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, RwLock};

fn store_with(fs_declared: bool) -> ModuleStore {
    let mut packages = HashMap::new();
    let mut entries = serde_json::Map::new();
    for id in ["sample-tool", "other-tool"] {
        let requires = if fs_declared || id == "other-tool" {
            json!({"fs":"^1.1"})
        } else {
            json!({})
        };
        let manifest = json!({"manifestVersion":1,"id":id,"name":"합성 도구","description":"합성 시험","version":"0.1.0","category":"utility","icon":"icon.svg","entry":"index.html","authors":[{"name":"가상 기여자"}],"requires":requires,"optional":{}});
        let (bytes, package) = build_package(&[
            (
                "module.json".to_owned(),
                serde_json::to_vec(&manifest).unwrap(),
            ),
            ("index.html".to_owned(), b"<!doctype html>".to_vec()),
            ("icon.svg".to_owned(), b"<svg/>".to_vec()),
        ])
        .unwrap();
        entries.insert(id.to_owned(), json!([{"version":"0.1.0","requires":package.manifest.requires,"optional":package.manifest.optional,"sha256":package.sha256,"size":bytes.len(),"url":format!("{id}/0.1.0/"),"revoked":false}]));
        packages.insert(id.to_owned(), bytes);
    }
    let index = CatalogIndex::parse(
        &json!({"format":1,"seq":1,"generatedAt":"2026-01-01T00:00:00Z","modules":entries})
            .to_string(),
    )
    .unwrap();
    ModuleStore::from_index(&index, &deck_core::caps::host_caps(), |id, _| {
        packages.get(id).cloned()
    })
}
struct Fixture {
    state: Option<AppState>,
    guard: Option<TempDir>,
    root: PathBuf,
}
impl Fixture {
    fn new(fs_declared: bool) -> Self {
        let mut random = [0; HANDLE_BYTES];
        OsRng.fill(&mut random);
        let root = std::env::temp_dir().join(format!(
            "deck-fs-cap-test-{}",
            deck_core::util::to_hex(&random)
        ));
        let area = TempArea::init(root.clone()).unwrap();
        let guard = area.create_dir(&mut OsRng).unwrap();
        let state = AppState {
            app_version: "0.1.0".to_owned(),
            host_caps: deck_core::caps::host_caps(),
            modules: RwLock::new(store_with(fs_declared)),
            handles: Mutex::new(HandleTable::new(OsRng)),
            transfers: Mutex::new(FileTransfers::default()),
            destinations: Mutex::new(
                crate::destination::DestinationService::open(guard.path().join("grants")).unwrap(),
            ),
            storage: StorageService::new(guard.path().join("storage")),
            overrides: Mutex::new(HashMap::new()),
            active: Mutex::new(Some("sample-tool".to_owned())),
            mica: AtomicBool::new(false),
            sec_probe: false,
            temp: None,
            file_temp: Some(TempArea::init(guard.path().join("file-temp")).unwrap()),
            log_dir: guard.path().join("logs"),
        };
        Self {
            state: Some(state),
            guard: Some(guard),
            root,
        }
    }
    fn state(&self) -> &AppState {
        self.state.as_ref().unwrap()
    }
    fn path(&self) -> &Path {
        self.guard.as_ref().unwrap().path()
    }
    fn input(&self) -> String {
        let path = self.path().join("synthetic-input.bin");
        std::fs::write(&path, b"synthetic bytes").unwrap();
        issue(
            self.state(),
            "sample-tool",
            path,
            FileHandleKind::ReadFile,
            0,
        )
        .unwrap()
    }
    fn parent(&self) -> String {
        issue(
            self.state(),
            "sample-tool",
            self.path().to_path_buf(),
            FileHandleKind::OutputParent,
            0,
        )
        .unwrap()
    }
    fn invoke(&self, op: Op, args: Value) -> Result<Value, DeckError> {
        transfer_call(self.state(), "sample-tool", 0, op, args)
    }
    fn read(&self) -> deck_core::caps::fs::FileRead {
        serde_json::from_value(
            self.invoke(Op::OpenRead, json!({"handle":self.input()}))
                .unwrap(),
        )
        .unwrap()
    }
    fn request(
        &self,
        owner: &str,
        token: &str,
        query: &str,
        method: Method,
        origin: Option<&str>,
    ) -> Request<Vec<u8>> {
        let mut request = Request::builder().method(method).uri(format!(
            "deckmod://{owner}.modules.localhost/_resources/{token}?{query}"
        ));
        if let Some(origin) = origin {
            request = request.header("origin", origin);
        }
        request.body(vec![]).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.state.take());
        drop(self.guard.take());
        let _ = std::fs::remove_dir(&self.root);
    }
}

#[test]
fn file_folder_handles_reject_wrong_kind_owner_and_stale_generation() {
    let fixture = Fixture::new(true);
    let input = fixture.input();
    let parent = fixture.parent();
    assert_eq!(
        fixture
            .invoke(Op::OpenRead, json!({"handle":parent}))
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        fixture
            .invoke(
                Op::CreateOutputFolder,
                json!({"parentHandle":input,"suggestedName":"results"})
            )
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        transfer_call(
            fixture.state(),
            "other-tool",
            0,
            Op::OpenRead,
            json!({"handle":input})
        )
        .unwrap_err()
        .code,
        ErrorCode::PermissionDenied
    );
    fixture
        .state()
        .transfers
        .lock()
        .unwrap()
        .unload("sample-tool");
    assert_eq!(
        transfer_call(
            fixture.state(),
            "sample-tool",
            1,
            Op::OpenRead,
            json!({"handle":input})
        )
        .unwrap_err()
        .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        fixture
            .invoke(Op::OpenRead, json!({"handle":"unknown"}))
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}

#[test]
fn http_ranges_head_and_headers_preserve_bounded_real_bytes() {
    let fixture = Fixture::new(true);
    let read = fixture.read();
    let request = fixture.request(
        "sample-tool",
        &read.read_id,
        "offset=0&length=9",
        Method::GET,
        Some(&crate::origins::module_origin("sample-tool")),
    );
    let response = serve_file_resource(fixture.state(), &request);
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body(), b"synthetic");
    assert_eq!(response.headers().get("content-length").unwrap(), "9");
    assert_eq!(
        response
            .headers()
            .get("cross-origin-resource-policy")
            .unwrap(),
        "same-origin"
    );
    assert_eq!(
        response.headers().get("x-content-type-options").unwrap(),
        "nosniff"
    );
    let response = serve_file_resource(
        fixture.state(),
        &fixture.request(
            "sample-tool",
            &read.read_id,
            "offset=10&length=5",
            Method::HEAD,
            None,
        ),
    );
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.body().is_empty());
    assert_eq!(response.headers().get("content-length").unwrap(), "5");
    let response = serve_file_resource(
        fixture.state(),
        &fixture.request(
            "sample-tool",
            &read.read_id,
            "offset=15&length=0",
            Method::GET,
            None,
        ),
    );
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.body().is_empty());
    for query in [
        "offset=16&length=0",
        "offset=14&length=2",
        "offset=0&length=262145",
    ] {
        assert_eq!(
            serve_file_resource(
                fixture.state(),
                &fixture.request("sample-tool", &read.read_id, query, Method::GET, None)
            )
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
}

#[test]
fn http_rejects_origin_mismatch_cross_module_tokens_and_undeclared_caps() {
    let fixture = Fixture::new(true);
    let read = fixture.read();
    let query = "offset=0&length=1";
    let wrong_origin = fixture.request(
        "sample-tool",
        &read.read_id,
        query,
        Method::GET,
        Some(&crate::origins::module_origin("other-tool")),
    );
    assert_eq!(
        serve_file_resource(fixture.state(), &wrong_origin).status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        serve_file_resource(
            fixture.state(),
            &fixture.request("other-tool", &read.read_id, query, Method::GET, None)
        )
        .status(),
        StatusCode::FORBIDDEN
    );
    *fixture.state().modules.write().unwrap() = store_with(false);
    assert_eq!(
        serve_file_resource(
            fixture.state(),
            &fixture.request("sample-tool", &read.read_id, query, Method::GET, None)
        )
        .status(),
        StatusCode::FORBIDDEN
    );
}

#[test]
fn resource_query_requires_exact_token_and_unique_unsigned_ranges() {
    let token = "a".repeat(32);
    for query in [
        "",
        "offset=0",
        "length=1",
        "offset=-1&length=1",
        "offset=1.0&length=1",
        "offset=0&length=1&length=1",
        "offset=0&offset=0&length=1",
        "offset=0&length=1&owner=other",
        "offset=0&length=262145",
        "offset=18446744073709551616&length=1",
    ] {
        let uri = format!("deckmod://sample-tool.modules.localhost/_resources/{token}?{query}")
            .parse()
            .unwrap();
        assert_eq!(
            resource_args(&uri).unwrap_err().code,
            ErrorCode::InvalidArgs
        );
    }
    for token in [
        "a".repeat(31),
        "A".repeat(32),
        "g".repeat(32),
        "a".repeat(33),
    ] {
        let uri =
            format!("deckmod://sample-tool.modules.localhost/_resources/{token}?offset=0&length=1")
                .parse()
                .unwrap();
        assert_eq!(
            resource_args(&uri).unwrap_err().code,
            ErrorCode::InvalidArgs
        );
    }
}

#[test]
fn typed_write_boundary_rejects_non_u8_and_oversized_data_then_can_commit_valid_bytes() {
    let fixture = Fixture::new(true);
    let batch: OutputBatch = serde_json::from_value(
        fixture
            .invoke(
                Op::CreateOutputFolder,
                json!({"parentHandle":fixture.parent(),"suggestedName":"results"}),
            )
            .unwrap(),
    )
    .unwrap();
    let write: deck_core::caps::fs::FileWrite = serde_json::from_value(
        fixture
            .invoke(
                Op::BeginWrite,
                json!({"batchId":batch.batch_id,"suggestedName":"synthetic-result.bin","size":2}),
            )
            .unwrap(),
    )
    .unwrap();
    for value in [json!(256), json!(-1), json!(1.5), json!("1"), Value::Null] {
        assert_eq!(
            fixture
                .invoke(
                    Op::WriteChunk,
                    json!({"writeId":write.write_id,"offset":0,"data":[value]})
                )
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgs
        );
    }
    assert_eq!(
        fixture
            .invoke(
                Op::WriteChunk,
                json!({"writeId":write.write_id,"offset":0,"data":vec![0;65537]})
            )
            .unwrap_err()
            .code,
        ErrorCode::InvalidArgs
    );
    assert_eq!(
        fixture
            .invoke(
                Op::WriteChunk,
                json!({"writeId":write.write_id,"offset":0,"data":[0,255]})
            )
            .unwrap()["nextOffset"],
        2
    );
    let output: FileHandleInfo = serde_json::from_value(
        fixture
            .invoke(Op::CommitWrite, json!({"writeId":write.write_id}))
            .unwrap(),
    )
    .unwrap();
    let path = resolve(
        fixture.state(),
        "sample-tool",
        &output.handle,
        0,
        Some(FileHandleKind::ReadFile),
    )
    .unwrap();
    assert_eq!(std::fs::read(path).unwrap(), vec![0, 255]);
    fixture
        .invoke(Op::AbortWrite, json!({"writeId":write.write_id}))
        .unwrap();
    fixture
        .invoke(Op::CloseOutputFolder, json!({"batchId":batch.batch_id}))
        .unwrap();
    let read: deck_core::caps::fs::FileRead = serde_json::from_value(
        fixture
            .invoke(Op::OpenRead, json!({"handle":output.handle}))
            .unwrap(),
    )
    .unwrap();
    let response = serve_file_resource(
        fixture.state(),
        &fixture.request(
            "sample-tool",
            &read.read_id,
            "offset=0&length=2",
            Method::GET,
            None,
        ),
    );
    assert_eq!(response.body(), &vec![0, 255]);
}
