// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Job-scoped Hancom registry, owned-file policy and authenticated local pipe (ADR-0027).
#![allow(unsafe_code)]
#[path = "../hancom-security/src/protocol.rs"]
mod protocol;
use deck_core::{DeckError, ErrorCode};
use protocol::{Endpoint, MAX_FRAME, decode_path, encode_path, local_path, valid_token};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_NO_DATA, ERROR_PIPE_CONNECTED, ERROR_PIPE_LISTENING, HANDLE,
};
use windows::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAGS_AND_ATTRIBUTES,
    FILE_NAME_NORMALIZED, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle,
    GetFinalPathNameByHandleW, OPEN_EXISTING, PIPE_ACCESS_DUPLEX, ReadFile, WriteFile,
};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId,
    PIPE_NOWAIT, PIPE_READMODE_MESSAGE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_MESSAGE,
};
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, KEY_WOW64_32KEY,
    REG_OPTION_NON_VOLATILE, REG_SZ, REG_VALUE_TYPE, RegCloseKey, RegCreateKeyExW, RegDeleteValueW,
    RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
use windows::core::PCWSTR;

const MODULES: &str = "Software\\HNC\\HwpAutomation\\Modules";
const DLL: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/resources/native/hancom/teacherdeck_hwp_gate.dll"
));
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "한글의 작업용 파일 접근을 안전하게 연결하지 못했어요. 한글에서 직접 변환해 주세요.",
    )
}
fn unavailable_stage(stage: &'static str) -> DeckError {
    let mut error = unavailable();
    error.details = Some(serde_json::json!({"hancomGateStage": stage}));
    error
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn handle(file: &File) -> HANDLE {
    HANDLE(file.as_raw_handle())
}
fn token(job_name: &str) -> Result<&str, DeckError> {
    job_name
        .strip_prefix("Local\\TeacherDeck-Office-")
        .filter(|t| valid_token(t))
        .ok_or_else(unavailable)
}
fn normal(path: &Path) -> Result<String, DeckError> {
    // This is a trusted host Path, not a callback string. PathBuf::join can retain '/'
    // on Windows; emit one exact canonical separator spelling before calling Hancom.
    let value = path.to_str().ok_or_else(unavailable)?.replace('/', "\\");
    let value = value.strip_prefix("\\\\?\\").unwrap_or(&value);
    if !local_path(value) {
        return Err(unavailable());
    }
    Ok(value.into())
}
fn final_path(file: &File) -> Result<String, DeckError> {
    let mut buffer = [0u16; 2048];
    // SAFETY: live owned file handle and bounded writable UTF-16 buffer; only reads metadata.
    let length =
        unsafe { GetFinalPathNameByHandleW(handle(file), &mut buffer, FILE_NAME_NORMALIZED) }
            as usize;
    if length == 0 || length >= buffer.len() {
        return Err(unavailable());
    }
    normal(Path::new(
        &String::from_utf16(buffer.get(..length).ok_or_else(unavailable)?)
            .map_err(|_| unavailable())?,
    ))
}
fn open_guard(path: &Path, directory: bool) -> Result<File, DeckError> {
    let name = wide(path.to_str().ok_or_else(unavailable)?);
    // SAFETY: owned terminated path, read-only metadata handle, no delete sharing. Reparse
    // targets are not followed. Directory guards prevent ancestor swaps for the full job.
    let raw = unsafe {
        CreateFileW(
            PCWSTR(name.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS
                } else {
                    FILE_FLAGS_AND_ATTRIBUTES(0)
                },
            None,
        )
    }
    .map_err(|_| unavailable())?;
    // SAFETY: successful CreateFileW transferred exactly one owned kernel handle to File.
    let file = unsafe { File::from_raw_handle(raw.0) };
    let attributes = file
        .metadata()
        .map_err(|_| unavailable())?
        .file_attributes();
    if attributes & 0x400 != 0 || (attributes & 0x10 != 0) != directory {
        return Err(unavailable());
    }
    Ok(file)
}
#[derive(Clone, Copy, PartialEq, Eq)]
struct Identity {
    volume: u32,
    high: u32,
    low: u32,
}
fn identity(file: &File) -> Result<(Identity, u32), DeckError> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: initialized structure with correct ABI and a live owned file handle.
    unsafe { GetFileInformationByHandle(handle(file), &mut info) }.map_err(|_| unavailable())?;
    if info.dwFileAttributes & (0x400 | 0x10) != 0 {
        return Err(unavailable());
    }
    Ok((
        Identity {
            volume: info.dwVolumeSerialNumber,
            high: info.nFileIndexHigh,
            low: info.nFileIndexLow,
        },
        info.nNumberOfLinks,
    ))
}
struct Policy {
    parent: String,
    output: String,
    source: Option<(String, File, Identity)>,
    output_identity: Option<Identity>,
    _directories: Vec<File>,
}
impl Policy {
    fn new(source: Option<&Path>, output: &Path) -> Result<Self, DeckError> {
        let output = normal(output).map_err(|_| unavailable_stage("output-path"))?;
        let parent_path = Path::new(&output).parent().ok_or_else(unavailable)?;
        let parent = normal(
            &parent_path
                .canonicalize()
                .map_err(|_| unavailable_stage("parent-canonical"))?,
        )
        .map_err(|_| unavailable_stage("parent-path"))?;
        let mut directories = Vec::new();
        for ancestor in parent_path.ancestors() {
            directories
                .push(open_guard(ancestor, true).map_err(|_| unavailable_stage("ancestor-guard"))?);
        }
        if !normal(parent_path)?.eq_ignore_ascii_case(&parent)
            || Path::new(&output).try_exists().map_err(|_| unavailable())?
        {
            return Err(unavailable_stage("output-new-canonical"));
        }
        let source = source
            .map(|path| -> Result<_, DeckError> {
                let source = normal(path)?;
                if source.eq_ignore_ascii_case(&output)
                    || Path::new(&source).parent() != Some(parent_path)
                {
                    return Err(unavailable());
                }
                let file = OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(path)
                    .map_err(|_| unavailable())?;
                let (id, links) = identity(&file)?;
                if links != 1 || !final_path(&file)?.eq_ignore_ascii_case(&source) {
                    return Err(unavailable());
                }
                Ok((source, file, id))
            })
            .transpose()?;
        Ok(Self {
            parent,
            output,
            source,
            output_identity: None,
            _directories: directories,
        })
    }
    fn permits(&mut self, path: &str) -> bool {
        if encode_path(path).is_none() {
            return false;
        }
        if let Some((expected, file, id)) = self.source.as_ref()
            && path.eq_ignore_ascii_case(expected)
        {
            return identity(file).is_ok_and(|(actual, links)| actual == *id && links == 1)
                && final_path(file).is_ok_and(|actual| actual.eq_ignore_ascii_case(expected));
        }
        if !path.eq_ignore_ascii_case(&self.output) {
            return false;
        }
        let Some(parent) = Path::new(path).parent() else {
            return false;
        };
        if !parent
            .canonicalize()
            .ok()
            .and_then(|p| normal(&p).ok())
            .is_some_and(|p| p.eq_ignore_ascii_case(&self.parent))
        {
            return false;
        }
        match Path::new(path).try_exists() {
            Ok(false) => self.output_identity.is_none(),
            Ok(true) => {
                let Ok(file) = open_guard(Path::new(path), false) else {
                    return false;
                };
                let Ok((id, links)) = identity(&file) else {
                    return false;
                };
                if links != 1
                    || self
                        .source
                        .as_ref()
                        .is_some_and(|(_, _, source_id)| *source_id == id)
                    || self.output_identity.is_some_and(|prior| prior != id)
                    || !final_path(&file).is_ok_and(|p| p.eq_ignore_ascii_case(&self.output))
                {
                    return false;
                }
                self.output_identity = Some(id);
                true
            }
            Err(_) => false,
        }
    }
}
struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns the successfully opened HKCU key, never a predefined handle.
        let _ = unsafe { RegCloseKey(self.0) };
    }
}
fn key() -> Result<Key, DeckError> {
    let name = wide(MODULES);
    let mut key = HKEY::default();
    // SAFETY: fixed HKCU 32-bit module registration key, no global Uses or trust settings.
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(name.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_QUERY_VALUE | KEY_SET_VALUE | KEY_WOW64_32KEY,
            None,
            &mut key,
            None,
        )
    }
    .ok()
    .map_err(|_| unavailable())?;
    Ok(Key(key))
}
fn read_value(key: &Key, name: &str) -> Result<Option<String>, DeckError> {
    let name = wide(name);
    let mut bytes = [0u8; 4096];
    let mut length = 4096u32;
    let mut kind = REG_VALUE_TYPE::default();
    // SAFETY: fixed-size writable output and type/length fields; raw data is never logged.
    let error = unsafe {
        RegQueryValueExW(
            key.0,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            Some(bytes.as_mut_ptr()),
            Some(&mut length),
        )
    };
    if error == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if error.is_err() || kind != REG_SZ || length < 2 || !length.is_multiple_of(2) {
        return Err(unavailable());
    }
    let data = bytes.get(..length as usize).ok_or_else(unavailable)?;
    let mut units: Vec<_> = data
        .as_chunks::<2>()
        .0
        .iter()
        .map(|[lo, hi]| u16::from_le_bytes([*lo, *hi]))
        .collect();
    if units.pop() != Some(0) || units.contains(&0) {
        return Err(unavailable());
    }
    Ok(Some(String::from_utf16(&units).map_err(|_| unavailable())?))
}
/// Parent-owned cleanup survives worker cancellation/timeout. Never removes another value.
pub(crate) struct RegistrationCleanup {
    token: String,
    directory: String,
    worker_pid: u32,
}
impl RegistrationCleanup {
    pub(crate) fn new(job_name: &str, output: &Path, worker_pid: u32) -> Result<Self, DeckError> {
        let token = token(job_name)?;
        if let Some(key) = existing_key()?
            && read_value(&key, &format!("TeacherDeck-Hwp-{token}"))?.is_some()
        {
            return Err(unavailable());
        }
        Ok(Self {
            token: token.into(),
            directory: normal(output.parent().ok_or_else(unavailable)?)?,
            worker_pid,
        })
    }
}
fn existing_key() -> Result<Option<Key>, DeckError> {
    let name = wide(MODULES);
    let mut key = HKEY::default();
    // SAFETY: opens the fixed HKCU 32-bit key without creating it; cleanup must not alter
    // an installation where registration never reached its write stage.
    let result = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(name.as_ptr()),
            Some(0),
            KEY_QUERY_VALUE | KEY_SET_VALUE | KEY_WOW64_32KEY,
            &mut key,
        )
    };
    if result == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    result.ok().map_err(|_| unavailable())?;
    Ok(Some(Key(key)))
}
impl Drop for RegistrationCleanup {
    fn drop(&mut self) {
        let Ok(Some(key)) = existing_key() else {
            return;
        };
        let name = format!("TeacherDeck-Hwp-{}", self.token);
        let Ok(Some(value)) = read_value(&key, &name) else {
            return;
        };
        let path = Path::new(&value);
        let Some(endpoint) = path
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(Endpoint::from_filename)
        else {
            return;
        };
        if endpoint.token != self.token
            || endpoint.worker_pid != self.worker_pid
            || !path
                .parent()
                .and_then(|p| normal(p).ok())
                .is_some_and(|p| p.eq_ignore_ascii_case(&self.directory))
        {
            return;
        }
        let name = wide(&name);
        // SAFETY: only the unique value whose full job token, worker PID and app staging
        // parent were revalidated above is deleted. Shared keys and Uses are preserved.
        let _ = unsafe { RegDeleteValueW(key.0, PCWSTR(name.as_ptr())) };
    }
}
/// Active server lifetime; closing it makes a loaded callback deny all future access.
pub(crate) struct Gate {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    pub(crate) module_name: String,
    pub(crate) source_path: Option<String>,
    pub(crate) output_path: String,
    endpoint: Endpoint,
    hancom_pid: u32,
    _dll: File,
    _cleanup: RegistrationCleanup,
}
impl Gate {
    /// Read-only machine identifiers for the exact job-owned process, never its path.
    pub(crate) fn process_machines(&self) -> Result<(u16, u16), DeckError> {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn IsWow64Process2(
                process: *mut std::ffi::c_void,
                machine: *mut u16,
                native: *mut u16,
            ) -> i32;
        }
        let process = owned_hancom(
            &format!("Local\\TeacherDeck-Office-{}", self.endpoint.token),
            self.hancom_pid,
        )?;
        let mut machine = 0;
        let mut native = 0;
        // SAFETY: freshly revalidated exact job-owned process handle and two writable u16s.
        if unsafe { IsWow64Process2(process.as_raw_handle(), &mut machine, &mut native) } == 0 {
            return Err(unavailable_stage("process-machine"));
        }
        Ok((machine, native))
    }
}
/// Registration must precede COM activation: Hancom can cache module names on startup.
/// No pipe exists until binding, so loading this DLL early grants no file access.
pub(crate) struct PreparedRegistration {
    endpoint: Endpoint,
    policy: Policy,
    module_name: String,
    dll: File,
    cleanup: RegistrationCleanup,
}
impl PreparedRegistration {
    pub(crate) fn new(
        job_name: &str,
        source: Option<&Path>,
        output: &Path,
    ) -> Result<Self, DeckError> {
        let endpoint = Endpoint {
            token: token(job_name)?.into(),
            worker_pid: std::process::id(),
        };
        let policy = Policy::new(source, output)?;
        let path = output
            .parent()
            .ok_or_else(unavailable)?
            .join(endpoint.filename());
        let cleanup = RegistrationCleanup::new(job_name, output, endpoint.worker_pid)?;
        // Embedded build artifact is the trusted source, never a user-selected DLL.
        if DLL.get(..2) != Some(b"MZ") {
            return Err(unavailable());
        }
        let mut writer = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| unavailable())?;
        writer
            .write_all(DLL)
            .and_then(|_| writer.sync_all())
            .map_err(|_| unavailable())?;
        drop(writer);
        let dll = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .map_err(|_| unavailable())?;
        let module_name = format!("TeacherDeck-Hwp-{}", endpoint.token);
        let key = key()?;
        if read_value(&key, &module_name)?.is_some() {
            return Err(unavailable());
        }
        let name = wide(&module_name);
        let value: Vec<_> = wide(&normal(&path)?)
            .into_iter()
            .flat_map(u16::to_le_bytes)
            .collect();
        // SAFETY: unique fresh token was collision-checked; only this REG_SZ value is set.
        unsafe { RegSetValueExW(key.0, PCWSTR(name.as_ptr()), None, REG_SZ, Some(&value)) }
            .ok()
            .map_err(|_| unavailable())?;
        Ok(Self {
            endpoint,
            policy,
            module_name,
            dll,
            cleanup,
        })
    }
    pub(crate) fn bind(self, job_name: &str, hwnd: i32) -> Result<Gate, DeckError> {
        if token(job_name)? != self.endpoint.token || self.endpoint.worker_pid != std::process::id()
        {
            return Err(unavailable());
        }
        let mut pid = 0;
        // SAFETY: caller already bound this exact COM-owned window to the Office job.
        unsafe {
            GetWindowThreadProcessId(
                windows::Win32::Foundation::HWND(hwnd as isize as *mut _),
                Some(&mut pid),
            )
        };
        if pid == 0 {
            return Err(unavailable());
        }
        let process = owned_hancom(job_name, pid)?;
        let source_path = self.policy.source.as_ref().map(|(path, _, _)| path.clone());
        let output_path = self.policy.output.clone();
        let pipe = make_pipe(&self.endpoint)?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let policy = self.policy;
        let thread = std::thread::Builder::new()
            .name("hancom-path-gate".into())
            .spawn(move || {
                let _pinned_process = process;
                serve(pipe, policy, pid, flag);
            })
            .map_err(|_| unavailable())?;
        Ok(Gate {
            stop,
            thread: Some(thread),
            module_name: self.module_name,
            source_path,
            output_path,
            endpoint: self.endpoint,
            hancom_pid: pid,
            _dll: self.dll,
            _cleanup: self.cleanup,
        })
    }
}
impl Gate {
    /// Read-only diagnostic for this exact owned Hwp instance; never returns module paths.
    pub(crate) fn module_loaded(&self) -> Result<bool, DeckError> {
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW,
            TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32,
        };
        // SAFETY: only the already validated and pinned Hwp PID; read-only bounded snapshot.
        let raw = unsafe {
            CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, self.hancom_pid)
        }
        .map_err(|_| unavailable_stage("module-snapshot"))?;
        // SAFETY: transfers one successful owned snapshot handle; File only closes it.
        let snapshot = unsafe { File::from_raw_handle(raw.0) };
        let mut entry = MODULEENTRY32W {
            dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
            ..Default::default()
        };
        // SAFETY: correctly sized writable structure and a live snapshot handle.
        unsafe { Module32FirstW(handle(&snapshot), &mut entry) }
            .map_err(|_| unavailable_stage("module-first"))?;
        for _ in 0..512 {
            let count = entry
                .szModule
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szModule.len());
            let name = String::from_utf16(entry.szModule.get(..count).ok_or_else(unavailable)?)
                .map_err(|_| unavailable())?;
            if name.eq_ignore_ascii_case(&self.endpoint.filename()) {
                return Ok(true);
            }
            // SAFETY: same initialized structure and owned read-only snapshot; no foreign memory dereference.
            if unsafe { Module32NextW(handle(&snapshot), &mut entry) }.is_err() {
                return Ok(false);
            }
        }
        Err(unavailable_stage("module-limit"))
    }
}
fn owned_hancom(job_name: &str, pid: u32) -> Result<File, DeckError> {
    use windows::Win32::System::JobObjects::{IsProcessInJob, OpenJobObjectW};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: read-only process query handle pins the PID until the gate ends.
    let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .map_err(|_| unavailable())?;
    // SAFETY: transfers this valid uniquely owned process handle; File only closes it.
    let process = unsafe { File::from_raw_handle(raw.0) };
    let name = wide(job_name);
    // SAFETY: validated app-generated job name; only JOB_OBJECT_QUERY is requested.
    let raw_job =
        unsafe { OpenJobObjectW(4, false, PCWSTR(name.as_ptr())) }.map_err(|_| unavailable())?;
    // SAFETY: transfers this valid uniquely owned job handle; no file operations are used.
    let job = unsafe { File::from_raw_handle(raw_job.0) };
    let mut member = windows::core::BOOL::default();
    let mut code = 0u32;
    // SAFETY: live pinned process/job handles and initialized output structures.
    unsafe { IsProcessInJob(handle(&process), Some(handle(&job)), &mut member) }
        .map_err(|_| unavailable())?;
    // SAFETY: same live read-only process handle and one writable DWORD.
    unsafe { GetExitCodeProcess(handle(&process), &mut code) }.map_err(|_| unavailable())?;
    if !member.as_bool() || code != 259 {
        return Err(unavailable());
    }
    Ok(process)
}
impl Drop for Gate {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
fn make_pipe(endpoint: &Endpoint) -> Result<File, DeckError> {
    let name = wide(&endpoint.pipe_name());
    // SAFETY: unique app-owned local pipe, first-instance prevents server substitution;
    // message/NOWAIT mode bounds every read, write and shutdown. Remote clients are refused.
    let raw = unsafe {
        CreateNamedPipeW(
            PCWSTR(name.as_ptr()),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            8,
            MAX_FRAME as u32,
            0,
            None,
        )
    };
    if raw.is_invalid() {
        return Err(unavailable());
    }
    // SAFETY: transfers this newly created valid pipe handle to the single owning File.
    Ok(unsafe { File::from_raw_handle(raw.0) })
}
fn serve(pipe: File, mut policy: Policy, pid: u32, stop: Arc<AtomicBool>) {
    let expires = Instant::now() + Duration::from_secs(120);
    while !stop.load(Ordering::Acquire) && Instant::now() < expires {
        // SAFETY: live owned nonblocking pipe; no pending overlapped buffers.
        let connected = unsafe { ConnectNamedPipe(handle(&pipe), None) };
        let ready = connected.is_ok()
            || connected
                .as_ref()
                .err()
                .is_some_and(|e| e.code() == ERROR_PIPE_CONNECTED.to_hresult());
        if !ready {
            if connected
                .as_ref()
                .err()
                .is_some_and(|e| e.code() == ERROR_NO_DATA.to_hresult())
            {
                // SAFETY: a client closed this nonblocking connection before its request.
                let _ = unsafe { DisconnectNamedPipe(handle(&pipe)) };
                continue;
            }
            if connected
                .as_ref()
                .err()
                .is_some_and(|e| e.code() != ERROR_PIPE_LISTENING.to_hresult())
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
            continue;
        }
        let mut client = 0u32;
        // SAFETY: query actual pipe peer PID; no client-supplied ownership claim is trusted.
        if unsafe { GetNamedPipeClientProcessId(handle(&pipe), &mut client) }.is_err() {
            // NOWAIT's first successful ConnectNamedPipe means available, not connected.
            std::thread::sleep(Duration::from_millis(5));
            continue;
        }
        if client == pid {
            let deadline = Instant::now() + Duration::from_millis(500);
            while !stop.load(Ordering::Acquire)
                && Instant::now() < deadline
                && Instant::now() < expires
            {
                let mut frame = [0u8; MAX_FRAME];
                let mut read = 0u32;
                // SAFETY: bounded live message buffer and count; oversized/truncated frames deny.
                if unsafe { ReadFile(handle(&pipe), Some(&mut frame), Some(&mut read), None) }
                    .is_ok()
                    && read != 0
                {
                    let permitted = frame
                        .get(..read as usize)
                        .and_then(decode_path)
                        .is_some_and(|p| policy.permits(&p));
                    let mut written = 0u32;
                    // SAFETY: one initialized Boolean byte; synchronous NOWAIT prevents shutdown hangs.
                    if unsafe {
                        WriteFile(
                            handle(&pipe),
                            Some(&[u8::from(permitted)]),
                            Some(&mut written),
                            None,
                        )
                    }
                    .is_ok()
                        && written == 1
                    {
                        while !stop.load(Ordering::Acquire) && Instant::now() < deadline {
                            let mut ack = [0u8; 2];
                            let mut count = 0u32;
                            // SAFETY: bounded nonblocking acknowledgment ensures the reply was
                            // read before disconnect; never use an unbounded pipe flush.
                            if unsafe {
                                ReadFile(handle(&pipe), Some(&mut ack), Some(&mut count), None)
                            }
                            .is_ok()
                                && count != 0
                            {
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(5));
                        }
                    }
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        // SAFETY: this exact owned connection is reset after its single bounded request.
        let _ = unsafe { DisconnectNamedPipe(handle(&pipe)) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    struct SyntheticDir(PathBuf);
    impl SyntheticDir {
        fn new() -> Self {
            let mut bytes = [0u8; 16];
            getrandom::fill(&mut bytes).unwrap();
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(3)
                .unwrap()
                .join("target/adversarial-review/hancom-gate-tests")
                .join(deck_core::util::to_hex(&bytes));
            std::fs::create_dir_all(&path).unwrap();
            Self(PathBuf::from(normal(&path).unwrap()))
        }
    }
    impl Drop for SyntheticDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn endpoint() -> Endpoint {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).unwrap();
        Endpoint {
            token: deck_core::util::to_hex(&bytes),
            worker_pid: std::process::id(),
        }
    }
    #[test]
    fn exact_two_files_original_lock_and_replaced_output_are_checked() {
        let directory = SyntheticDir::new();
        let source = directory.0.join("합성 source.hwp");
        let output = directory.0.join("converted.hwpx");
        std::fs::write(&source, b"synthetic original").unwrap();
        let mut policy = Policy::new(Some(&source), &output).unwrap();
        assert!(policy.permits(source.to_str().unwrap()));
        assert!(policy.permits(output.to_str().unwrap()));
        assert!(!policy.permits(directory.0.join("other.hwp").to_str().unwrap()));
        assert!(!policy.permits(&format!("{}:stream", output.display())));
        assert!(
            std::fs::write(&source, b"changed").is_err(),
            "source read lock forbids mutation"
        );
        assert!(
            std::fs::rename(&directory.0, directory.0.with_extension("moved")).is_err(),
            "all staging ancestors remain pinned"
        );
        std::fs::write(&output, b"synthetic result").unwrap();
        assert!(policy.permits(output.to_str().unwrap()));
        std::fs::rename(&output, directory.0.join("retained.hwpx")).unwrap();
        std::fs::write(&output, b"replaced").unwrap();
        assert!(
            !policy.permits(output.to_str().unwrap()),
            "second open cannot adopt a replacement file"
        );
        assert_eq!(std::fs::read(&source).unwrap(), b"synthetic original");
    }
    #[test]
    fn hardlinks_existing_output_and_outside_parent_are_rejected() {
        let directory = SyntheticDir::new();
        let source = directory.0.join("source.hwp");
        let output = directory.0.join("converted.hwpx");
        std::fs::write(&source, b"synthetic").unwrap();
        std::fs::hard_link(&source, directory.0.join("alias.hwp")).unwrap();
        assert!(Policy::new(Some(&source), &output).is_err());
        std::fs::remove_file(directory.0.join("alias.hwp")).unwrap();
        std::fs::write(&output, b"existing").unwrap();
        assert!(Policy::new(Some(&source), &output).is_err());
        std::fs::remove_file(&output).unwrap();
        let nested = directory.0.join("nested");
        std::fs::create_dir(&nested).unwrap();
        assert!(Policy::new(Some(&source), &nested.join("converted.hwpx")).is_err());
    }
    fn request(endpoint: &Endpoint, frame: &[u8]) -> Option<u8> {
        use windows::Win32::System::Pipes::SetNamedPipeHandleState;
        let deadline = Instant::now() + Duration::from_secs(1);
        let file = loop {
            if let Ok(file) = OpenOptions::new()
                .read(true)
                .write(true)
                .open(endpoint.pipe_name())
            {
                break file;
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        let mode = PIPE_READMODE_MESSAGE | PIPE_NOWAIT;
        // SAFETY: test-only live local pipe and initialized mode; no external process involved.
        unsafe { SetNamedPipeHandleState(handle(&file), Some(&mode), None, None) }.ok()?;
        let mut written = 0u32;
        // SAFETY: bounded synthetic request and count, synchronous NOWAIT.
        unsafe { WriteFile(handle(&file), Some(frame), Some(&mut written), None) }.ok()?;
        if written as usize != frame.len() {
            return None;
        }
        loop {
            let mut response = [0u8; 2];
            let mut count = 0u32;
            // SAFETY: bounded test-only response and count.
            if unsafe { ReadFile(handle(&file), Some(&mut response), Some(&mut count), None) }
                .is_ok()
                && count == 1
            {
                // SAFETY: one-byte bounded acknowledgment; confirms reply consumption.
                let _ =
                    unsafe { WriteFile(handle(&file), Some(&[0xac]), Some(&mut written), None) };
                return response.first().copied();
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    #[test]
    fn authenticated_pipe_replies_survive_disconnect_and_deny_other_paths() {
        let directory = SyntheticDir::new();
        let output = directory.0.join("converted.hwpx");
        let endpoint = endpoint();
        let pipe = make_pipe(&endpoint).unwrap();
        assert!(
            make_pipe(&endpoint).is_err(),
            "a second server cannot substitute the endpoint"
        );
        let policy = Policy::new(None, &output).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let pid = std::process::id();
        let server = std::thread::spawn(move || serve(pipe, policy, pid, flag));
        for _ in 0..5 {
            assert_eq!(
                request(&endpoint, &encode_path(output.to_str().unwrap()).unwrap()),
                Some(1)
            );
        }
        assert_eq!(
            request(
                &endpoint,
                &encode_path(directory.0.join("other.hwp").to_str().unwrap()).unwrap()
            ),
            Some(0)
        );
        assert_eq!(request(&endpoint, &[1, 0, 0, 0, 0, 216]), Some(0));
        let before = Instant::now();
        stop.store(true, Ordering::Release);
        server.join().unwrap();
        assert!(before.elapsed() < Duration::from_secs(1));
        assert_eq!(
            request(&endpoint, &encode_path(output.to_str().unwrap()).unwrap()),
            None,
            "expired worker cannot grant access"
        );
    }
    #[test]
    fn another_process_id_cannot_request_even_an_allowlisted_path() {
        let directory = SyntheticDir::new();
        let output = directory.0.join("converted.hwpx");
        let endpoint = endpoint();
        let pipe = make_pipe(&endpoint).unwrap();
        let policy = Policy::new(None, &output).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let server = std::thread::spawn(move || serve(pipe, policy, u32::MAX, flag));
        assert_eq!(
            request(&endpoint, &encode_path(output.to_str().unwrap()).unwrap()),
            None
        );
        stop.store(true, Ordering::Release);
        server.join().unwrap();
    }
    #[test]
    fn preactivation_registration_denies_access_and_cleans_only_its_exact_value() {
        let directory = SyntheticDir::new();
        let output = directory.0.join("converted.hwpx");
        let endpoint = endpoint();
        let job = format!("Local\\TeacherDeck-Office-{}", endpoint.token);
        let name = format!("TeacherDeck-Hwp-{}", endpoint.token);
        let key = key().unwrap();
        assert!(read_value(&key, &name).unwrap().is_none());
        struct TestValue(String);
        impl Drop for TestValue {
            fn drop(&mut self) {
                let Ok(key) = super::key() else {
                    return;
                };
                let name = wide(&self.0);
                // SAFETY: test created this collision-checked fresh random value only.
                let _ = unsafe { RegDeleteValueW(key.0, PCWSTR(name.as_ptr())) };
            }
        }
        let _test_value = TestValue(name.clone());
        let prepared = PreparedRegistration::new(&job, None, &output).unwrap();
        assert!(read_value(&key, &name).unwrap().is_some());
        assert_eq!(
            request(&endpoint, &encode_path(output.to_str().unwrap()).unwrap()),
            None,
            "registration alone has no active server and cannot permit files"
        );
        drop(prepared);
        assert!(read_value(&key, &name).unwrap().is_none());
        let sentinel = "SYNTHETIC COLLISION";
        let set_sentinel = || {
            let bytes: Vec<_> = wide(sentinel)
                .into_iter()
                .flat_map(u16::to_le_bytes)
                .collect();
            let name = wide(&name);
            // SAFETY: modifies only the test's fresh random value; no shared settings.
            unsafe { RegSetValueExW(key.0, PCWSTR(name.as_ptr()), None, REG_SZ, Some(&bytes)) }
                .ok()
                .unwrap();
        };
        set_sentinel();
        assert!(PreparedRegistration::new(&job, None, &output).is_err());
        assert_eq!(read_value(&key, &name).unwrap().as_deref(), Some(sentinel));
        let name_wide = wide(&name);
        // SAFETY: removes only our synthetic collision value before the next case.
        unsafe { RegDeleteValueW(key.0, PCWSTR(name_wide.as_ptr())) }
            .ok()
            .unwrap();
        let prepared = PreparedRegistration::new(&job, None, &output)
            .err()
            .unwrap();
        // The first prepared DLL remains create-new; use another new output folder for replacement.
        assert_eq!(prepared.code, ErrorCode::CapabilityUnavailable);
        let nested = directory.0.join("replacement");
        std::fs::create_dir(&nested).unwrap();
        let prepared =
            PreparedRegistration::new(&job, None, &nested.join("converted.hwpx")).unwrap();
        set_sentinel();
        drop(prepared);
        assert_eq!(
            read_value(&key, &name).unwrap().as_deref(),
            Some(sentinel),
            "cleanup must preserve a changed registration value"
        );
    }
}
