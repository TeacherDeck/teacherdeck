// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Fixed self-executable workers; only owned processes enter the Office kill-on-close job.
#![allow(unsafe_code)]
use deck_core::caps::office::OfficeFormat;
use deck_core::{DeckError, ErrorCode};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Host-private worker request; paths never cross the module bridge.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OfficeJob {
    pub source: PathBuf,
    pub output: PathBuf,
    pub format: OfficeFormat,
    pub job_name: String,
}
fn failure() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "작업자를 실행하지 못했어요. 도구를 다시 열어 주세요.",
    )
}
#[cfg(any(windows, test))]
fn office_timeout(format: OfficeFormat) -> DeckError {
    let message = if format == OfficeFormat::Hwpx {
        "응답 시간이 지나 한글 변환을 중지하고 작업 창을 정리했어요. 한글에서 직접 변환해 주세요."
    } else {
        "응답 시간이 지나 변환을 중지했어요. 다시 시도할 때 문서 접근 승인 창을 확인해 주세요."
    };
    DeckError::new(ErrorCode::Timeout, message)
}
#[cfg(any(windows, test))]
fn single_office_candidate(candidates: &[u32], owned_pid: Option<u32>) -> Result<u32, DeckError> {
    if candidates.len() != 1 {
        return Err(failure());
    }
    let pid = *candidates.first().ok_or_else(failure)?;
    if pid == 0 || owned_pid.is_some_and(|expected| pid != expected) {
        return Err(failure());
    }
    Ok(pid)
}
/// Recognizes only fixed worker modes before Tauri/single-instance initialization.
pub fn dispatch_worker_mode() -> Option<i32> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args
        .first()
        .is_none_or(|value| value != "--deck-native-worker")
    {
        return None;
    }
    let mode = args.get(1).and_then(|value| value.to_str());
    let result = match mode {
        Some("office") if args.len() == 2 => office_worker(),
        Some("network-elevated") if args.len() == 3 => args
            .get(2)
            .and_then(|value| value.to_str())
            .ok_or_else(failure)
            .and_then(crate::network_host::run_elevated_request),
        Some("network-routine") if args.len() == 3 => args
            .get(2)
            .and_then(|value| value.to_str())
            .ok_or_else(failure)
            .and_then(crate::network_host::run_saved_routine),
        _ => Err(failure()),
    };
    Some(if result.is_ok() { 0 } else { 1 })
}
fn office_worker() -> Result<(), DeckError> {
    let mut bytes = vec![];
    std::io::stdin()
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| failure())?;
    if bytes.len() > 65536 {
        return Err(failure());
    }
    let job: OfficeJob = serde_json::from_slice(&bytes).map_err(|_| failure())?;
    let result = crate::native_automation::convert(&job);
    let response = serde_json::to_vec(&result).map_err(|_| failure())?;
    // This is a bounded private protocol, not a log. Never forward it to tracing or UI diagnostics.
    std::io::stdout()
        .write_all(&response)
        .map_err(|_| failure())?;
    std::io::stdout().flush().map_err(|_| failure())?;
    Ok(())
}

/// Runs one conversion with a hard 120-second deadline and module-owned cancellation flag.
pub(crate) fn run_office(job: OfficeJob, cancel: &AtomicBool) -> Result<(), DeckError> {
    run_office_with_timeout(job, cancel, Duration::from_secs(120))
}

/// Uses the same owned worker with a shorter bounded deadline for synthetic timeout proof.
/// The module-facing entry always uses 120 seconds and never accepts a deadline argument.
pub(crate) fn run_office_with_timeout(
    mut job: OfficeJob,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<(), DeckError> {
    if timeout.is_zero() || timeout > Duration::from_secs(120) {
        return Err(failure());
    }
    #[cfg(windows)]
    let guard = OfficeProcessGroup::new()?;
    #[cfg(windows)]
    {
        job.job_name.clone_from(&guard.name);
    }
    #[cfg(not(windows))]
    {
        let _ = &mut job;
        return Err(DeckError::new(
            ErrorCode::CapabilityUnavailable,
            "Windows에서 문서를 변환해 주세요.",
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut child = std::process::Command::new(std::env::current_exe().map_err(|_| failure())?)
            .args(["--deck-native-worker", "office"])
            .creation_flags(0x08000000)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|_| failure())?;
        if let Err(error) = guard.assign_child(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let _hancom_registration = if job.format == OfficeFormat::Hwpx {
            match crate::native_automation::HancomRegistrationCleanup::new(
                &job.job_name,
                &job.output,
                child.id(),
            ) {
                Ok(cleanup) => Some(cleanup),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            }
        } else {
            None
        };
        let bytes = serde_json::to_vec(&job).map_err(|_| failure())?;
        if bytes.len() > 65536 {
            let _ = child.kill();
            let _ = child.wait();
            return Err(failure());
        }
        let mut input = child.stdin.take().ok_or_else(failure)?;
        if input.write_all(&bytes).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(failure());
        }
        drop(input);
        let mut output = child.stdout.take().ok_or_else(failure)?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = vec![];
            let result = output
                .by_ref()
                .take(65537)
                .read_to_end(&mut bytes)
                .map(|_| bytes);
            let _ = sender.send(result);
        });
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(DeckError::new(ErrorCode::Cancelled, "변환을 중지했어요."));
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(office_timeout(job.format));
            }
            if let Some(status) = child.try_wait().map_err(|_| failure())? {
                if !status.success() {
                    return Err(failure());
                }
                let response = receiver
                    .recv_timeout(Duration::from_secs(2))
                    .map_err(|_| failure())?
                    .map_err(|_| failure())?;
                if response.len() > 65536 {
                    return Err(failure());
                }
                return serde_json::from_slice::<Result<(), DeckError>>(&response)
                    .map_err(|_| failure())?;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::collections::HashSet;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, STILL_ACTIVE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, OpenJobObjectW, SetInformationJobObject,
    };
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    use windows::core::PCWSTR;
    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: this wrapper owns exactly one successful Win32 handle and never duplicates ownership.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
    pub(crate) struct JobGuard {
        handle: OwnedHandle,
        pub(crate) name: String,
    }
    impl JobGuard {
        pub(crate) fn new() -> Result<Self, DeckError> {
            let mut token = [0u8; 16];
            getrandom::fill(&mut token).map_err(|_| failure())?;
            let name = format!(
                "Local\\TeacherDeck-Office-{}",
                deck_core::util::to_hex(&token)
            );
            let wide: Vec<_> = name.encode_utf16().chain(Some(0)).collect();
            // SAFETY: randomly named app-owned job, no inherited security attributes or module-chosen name.
            let handle = OwnedHandle(
                unsafe { CreateJobObjectW(None, PCWSTR(wide.as_ptr())) }.map_err(|_| failure())?,
            );
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: information pointer and exact initialized structure size remain alive during call.
            unsafe {
                SetInformationJobObject(
                    handle.0,
                    JobObjectExtendedLimitInformation,
                    (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                        .map_err(|_| failure())?,
                )
            }
            .map_err(|_| failure())?;
            Ok(Self { handle, name })
        }
        pub(crate) fn assign_child(&self, child: &std::process::Child) -> Result<(), DeckError> {
            // SAFETY: std Child retains this exact process handle, freshly spawned by this service.
            unsafe { AssignProcessToJobObject(self.handle.0, HANDLE(child.as_raw_handle())) }
                .map_err(|_| failure())
        }
    }
    pub(crate) fn process_snapshot() -> Result<HashSet<u32>, DeckError> {
        // SAFETY: read-only process snapshot has no borrowed pointers and is owned until enumeration ends.
        let handle = OwnedHandle(
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(|_| failure())?,
        );
        let mut entry = PROCESSENTRY32W {
            dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).map_err(|_| failure())?,
            ..Default::default()
        };
        let mut ids = HashSet::new();
        // SAFETY: structure has the required size, snapshot remains alive and entry is writable.
        if unsafe { Process32FirstW(handle.0, &mut entry) }.is_err() {
            return Err(failure());
        }
        loop {
            ids.insert(entry.th32ProcessID);
            // SAFETY: same initialized writable structure and live read-only snapshot.
            if unsafe { Process32NextW(handle.0, &mut entry) }.is_err() {
                break;
            }
        }
        Ok(ids)
    }
    pub(crate) fn bind_office_process(
        job_name: &str,
        hwnd: i32,
        existing: &HashSet<u32>,
    ) -> Result<(), DeckError> {
        let token = job_name
            .strip_prefix("Local\\TeacherDeck-Office-")
            .ok_or_else(failure)?;
        if token.len() != 32 || !token.bytes().all(|c| c.is_ascii_hexdigit()) || hwnd == 0 {
            return Err(failure());
        }
        let mut pid = 0u32;
        // SAFETY: HWND was returned by this newly created COM object; API only queries ownership.
        unsafe {
            GetWindowThreadProcessId(HWND(hwnd as isize as *mut std::ffi::c_void), Some(&mut pid))
        };
        if pid == 0 || existing.contains(&pid) {
            return Err(DeckError::new(
                ErrorCode::Busy,
                "이미 열린 프로그램과 분리하지 못했어요. 문서를 직접 변환해 주세요.",
            ));
        }
        assign_verified_pid(job_name, pid)
    }
    fn assign_verified_pid(job_name: &str, pid: u32) -> Result<(), DeckError> {
        // SAFETY: own COM HWND identifies this new PID; only assign/terminate rights are requested.
        let process = OwnedHandle(
            unsafe {
                OpenProcess(
                    PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                    false,
                    pid,
                )
            }
            .map_err(|_| {
                DeckError::new(
                    ErrorCode::PermissionDenied,
                    "새 프로그램의 작업자 권한을 확인하지 못했어요.",
                )
            })?,
        );
        let wide: Vec<_> = job_name.encode_utf16().chain(Some(0)).collect();
        // SAFETY: app-generated job name is fixed-prefix validated; only assign rights are requested.
        let job = OwnedHandle(
            unsafe { OpenJobObjectW(5, false, PCWSTR(wide.as_ptr())) }.map_err(|_| failure())?,
        );
        let mut in_job = windows::core::BOOL::default();
        // SAFETY: owned process/job handles are live; query writes one initialized BOOL. A COM
        // server inherited by our child may already be assigned to this exact job.
        unsafe { IsProcessInJob(process.0, Some(job.0), &mut in_job) }.map_err(|_| failure())?;
        if in_job.as_bool() {
            return Ok(());
        }
        // SAFETY: process absent from pre-existing snapshot and identified by own new COM HWND.
        unsafe { AssignProcessToJobObject(job.0, process.0) }.map_err(|_| {
            DeckError::new(
                ErrorCode::CapabilityUnavailable,
                "새 프로그램을 전용 작업자와 분리하지 못했어요.",
            )
        })
    }
    /// PowerPoint is a MultiUse server: never attach a conversion to a pre-existing instance.
    pub(crate) fn require_powerpoint_absent() -> Result<(), DeckError> {
        // SAFETY: owned read-only process snapshot and correctly sized initialized entry.
        let snapshot = OwnedHandle(
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(|_| failure())?,
        );
        let mut entry = PROCESSENTRY32W {
            dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).map_err(|_| failure())?,
            ..Default::default()
        };
        // SAFETY: initialized output structure remains live throughout enumeration.
        unsafe { Process32FirstW(snapshot.0, &mut entry) }.map_err(|_| failure())?;
        loop {
            let length = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            if String::from_utf16(entry.szExeFile.get(..length).ok_or_else(failure)?)
                .map_err(|_| failure())?
                .eq_ignore_ascii_case("POWERPNT.EXE")
            {
                return Err(DeckError::new(
                    ErrorCode::Busy,
                    "열려 있는 PowerPoint를 닫은 뒤 다시 변환해 주세요.",
                ));
            }
            // SAFETY: same initialized structure and owned snapshot; no process is modified.
            if unsafe { Process32NextW(snapshot.0, &mut entry) }.is_err() {
                break;
            }
        }
        Ok(())
    }
    pub(crate) fn bind_new_office_process(
        job_name: &str,
        existing: &HashSet<u32>,
        started: std::time::SystemTime,
        image: &std::path::Path,
        owned_pid: Option<u32>,
    ) -> Result<(), DeckError> {
        let is_powerpoint = image
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("POWERPNT.EXE"));
        if (is_powerpoint && owned_pid.is_none())
            || !image
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.eq_ignore_ascii_case("WINWORD.EXE")
                        || name.eq_ignore_ascii_case("POWERPNT.EXE")
                })
        {
            return Err(failure());
        }
        let token = job_name
            .strip_prefix("Local\\TeacherDeck-Office-")
            .ok_or_else(failure)?;
        if token.len() != 32 || !token.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(failure());
        }
        // SAFETY: owns a read-only bounded process snapshot; fixed executable filter only.
        let snapshot = OwnedHandle(
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(|_| failure())?,
        );
        let mut entry = PROCESSENTRY32W {
            dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).map_err(|_| failure())?,
            ..Default::default()
        };
        let mut candidates = vec![];
        // SAFETY: initialized writable structure and owned snapshot remain live through enumeration.
        unsafe { Process32FirstW(snapshot.0, &mut entry) }.map_err(|_| failure())?;
        loop {
            let length = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16(entry.szExeFile.get(..length).ok_or_else(failure)?)
                .map_err(|_| failure())?;
            if image
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|expected| name.eq_ignore_ascii_case(expected))
                && !existing.contains(&entry.th32ProcessID)
            {
                candidates.push(entry.th32ProcessID);
            }
            // SAFETY: same initialized structure and read-only snapshot.
            if unsafe { Process32NextW(snapshot.0, &mut entry) }.is_err() {
                break;
            }
        }
        let pid = single_office_candidate(&candidates, owned_pid)?;
        // SAFETY: candidate is new; this handle pins its identity while creation/image are inspected.
        let process = OwnedHandle(
            unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                    false,
                    pid,
                )
            }
            .map_err(|_| failure())?,
        );
        let mut created = windows::Win32::Foundation::FILETIME::default();
        let mut exited = windows::Win32::Foundation::FILETIME::default();
        let mut kernel = windows::Win32::Foundation::FILETIME::default();
        let mut user = windows::Win32::Foundation::FILETIME::default();
        // SAFETY: live process handle and four initialized FILETIME output structures.
        unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user) }
            .map_err(|_| failure())?;
        let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        let to_ticks = |time: std::time::SystemTime| -> Result<u64, DeckError> {
            u64::try_from(
                time.duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| failure())?
                    .as_nanos()
                    / 100
                    + 116_444_736_000_000_000,
            )
            .map_err(|_| failure())
        };
        if ticks < to_ticks(started)?.saturating_sub(10_000_000)
            || ticks > to_ticks(std::time::SystemTime::now())?.saturating_add(10_000_000)
        {
            return Err(failure());
        }
        let mut path = vec![0u16; 32768];
        let mut count = u32::try_from(path.len()).map_err(|_| failure())?;
        // SAFETY: sized UTF-16 output buffer and process query handle remain live.
        unsafe {
            QueryFullProcessImageNameW(
                process.0,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(path.as_mut_ptr()),
                &mut count,
            )
        }
        .map_err(|_| failure())?;
        let actual = std::path::PathBuf::from(
            String::from_utf16(
                path.get(..usize::try_from(count).map_err(|_| failure())?)
                    .ok_or_else(failure)?,
            )
            .map_err(|_| failure())?,
        )
        .canonicalize()
        .map_err(|_| failure())?;
        if actual != image {
            return Err(failure());
        }
        let mut exit_code = 0u32;
        // SAFETY: the retained query handle pins this verified process identity. A terminated
        // process must not be assigned after its image/time checks; this writes one u32 only.
        unsafe { GetExitCodeProcess(process.0, &mut exit_code) }.map_err(|_| failure())?;
        if exit_code != STILL_ACTIVE.0 as u32 {
            return Err(failure());
        }
        // Retain the verified process handle while assigning, so a recycled PID cannot substitute.
        let wide: Vec<u16> = job_name.encode_utf16().chain(Some(0)).collect();
        // SAFETY: validated app-generated job name and a verified newly activated Word process.
        let job = OwnedHandle(
            unsafe { OpenJobObjectW(5, false, PCWSTR(wide.as_ptr())) }.map_err(|_| failure())?,
        );
        let mut in_job = windows::core::BOOL::default();
        // SAFETY: live owned handles and initialized BOOL output.
        unsafe { IsProcessInJob(process.0, Some(job.0), &mut in_job) }.map_err(|_| failure())?;
        if in_job.as_bool() {
            return Ok(());
        }
        // SAFETY: Word SingleUse, or the exact live PowerPoint Child PID, plus the sole new
        // candidate, fixed image, creation time and hidden empty COM object establish ownership.
        // A retained handle prevents PID substitution; pre-existing/user processes are rejected.
        unsafe { AssignProcessToJobObject(job.0, process.0) }.map_err(|_| failure())
    }
}
#[cfg(windows)]
pub(crate) use win::{
    JobGuard as OfficeProcessGroup, bind_new_office_process, bind_office_process, process_snapshot,
    require_powerpoint_absent,
};

/// Executes only the host's own executable and fixed bounded UAC request token.
#[cfg(windows)]
pub(crate) fn run_elevated(exe: &std::path::Path, argument: &str) -> Result<(), DeckError> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
    };
    use windows::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
    use windows::core::PCWSTR;
    let (nonce, hash) = argument.split_once('~').ok_or_else(failure)?;
    if nonce.len() != 32
        || hash.len() != 64
        || !nonce
            .bytes()
            .chain(hash.bytes())
            .all(|c| c.is_ascii_hexdigit())
        || exe != std::env::current_exe().map_err(|_| failure())?
    {
        return Err(failure());
    }
    let path: Vec<u16> = exe
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let parameters: Vec<u16> = format!("--deck-native-worker network-elevated {argument}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let verb: Vec<u16> = "runas".encode_utf16().chain(Some(0)).collect();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: u32::try_from(std::mem::size_of::<SHELLEXECUTEINFOW>()).map_err(|_| failure())?,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(path.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    // SAFETY: fixed self-exe/verb/ASCII request token strings remain live; Shell returns our exact child.
    unsafe { ShellExecuteExW(&mut info) }.map_err(|error| {
        if error.code().0 as u32 == 0x800704c7 {
            DeckError::new(
                ErrorCode::Cancelled,
                "관리자 승인을 취소했어요. 현재 네트워크는 유지해요.",
            )
        } else {
            DeckError::new(
                ErrorCode::PermissionDenied,
                "관리자 권한 승인을 확인해 주세요.",
            )
        }
    })?;
    let process = info.hProcess;
    if process.is_invalid() {
        return Err(failure());
    }
    // SAFETY: hProcess belongs to this fixed child and is retained until wait/exit-code read ends.
    let waited = unsafe { WaitForSingleObject(process, 120000) };
    let result = if waited == WAIT_OBJECT_0 {
        let mut exit = 1;
        // SAFETY: live process handle and writable exit-code output.
        unsafe { GetExitCodeProcess(process, &mut exit) }
            .map_err(|_| failure())
            .and_then(|_| if exit == 0 { Ok(()) } else { Err(failure()) })
    } else {
        if waited == WAIT_TIMEOUT {
            // SAFETY: terminate only the exact elevated child returned by this service, never a name/PID search.
            let _ = unsafe { TerminateProcess(process, 1) };
        }
        Err(DeckError::new(
            ErrorCode::Timeout,
            "네트워크 작업 시간이 지났어요. 현재 상태를 다시 확인해 주세요.",
        ))
    };
    // SAFETY: close exactly the one ShellExecuteEx process handle after all accesses complete.
    let _ = unsafe { CloseHandle(process) };
    result
}
#[cfg(not(windows))]
pub(crate) fn run_elevated(_exe: &std::path::Path, _argument: &str) -> Result<(), DeckError> {
    Err(failure())
}
/// Current OS token SID, independent of user-editable environment names.
#[cfg(windows)]
pub(crate) fn current_sid() -> Result<String, DeckError> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::core::PWSTR;
    let mut token = HANDLE::default();
    // SAFETY: query-only own process token, output is immediately owned and closed on every branch.
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|_| failure())?;
    let result = (|| {
        let mut needed = 0u32;
        // SAFETY: size-only query passes no output allocation and a live length pointer.
        let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut needed) };
        if needed < u32::try_from(std::mem::size_of::<TOKEN_USER>()).map_err(|_| failure())?
            || needed > 65536
        {
            return Err(failure());
        }
        let mut buffer = vec![0u64; usize::try_from(needed).map_err(|_| failure())?.div_ceil(8)];
        // SAFETY: u64 allocation provides TOKEN_USER alignment and at least required bytes.
        unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                Some(buffer.as_mut_ptr().cast()),
                needed,
                &mut needed,
            )
        }
        .map_err(|_| failure())?;
        // SAFETY: successful query initialized the TOKEN_USER and embedded SID within this live buffer.
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let mut text = PWSTR::null();
        // SAFETY: embedded SID remains alive; API allocates a null-terminated owned string.
        unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) }.map_err(|_| failure())?;
        // SAFETY: successful conversion returned a valid null-terminated allocation.
        let value = unsafe { text.to_string() }.map_err(|_| failure());
        // SAFETY: ConvertSidToStringSidW allocated this exact pointer with LocalAlloc.
        let _ = unsafe { LocalFree(Some(HLOCAL(text.0.cast()))) };
        value
    })();
    // SAFETY: closes the one query-only process token handle, after buffer/string accesses end.
    let _ = unsafe { CloseHandle(token) };
    result
}
#[cfg(not(windows))]
pub(crate) fn current_sid() -> Result<String, DeckError> {
    Err(failure())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn office_timeout_advice_distinguishes_cleaned_hancom_job_from_other_office() {
        let hancom = office_timeout(OfficeFormat::Hwpx);
        assert_eq!(hancom.code, ErrorCode::Timeout);
        assert!(hancom.message.contains("한글 변환을 중지"));
        assert!(hancom.message.contains("작업 창을 정리"));
        assert!(hancom.message.contains("한글에서 직접 변환"));
        assert!(!hancom.message.contains("접근 허용"));
        assert!(!hancom.message.contains("모두 허용"));
        assert!(!hancom.message.contains("열린 승인 창"));
        let excel = office_timeout(OfficeFormat::Xlsx);
        assert_eq!(excel.code, ErrorCode::Timeout);
        assert!(!excel.message.contains("한글"));
    }

    #[test]
    fn process_candidates_reject_concurrent_server_or_wrong_owned_child() {
        assert!(single_office_candidate(&[], Some(13)).is_err());
        assert!(single_office_candidate(&[13, 17], Some(13)).is_err());
        assert!(single_office_candidate(&[17], Some(13)).is_err());
        assert!(single_office_candidate(&[0], Some(0)).is_err());
        assert_eq!(single_office_candidate(&[13], Some(13)).ok(), Some(13));
        assert_eq!(single_office_candidate(&[17], None).ok(), Some(17));
    }

    #[cfg(windows)]
    #[test]
    fn powerpoint_requires_explicit_child_before_process_discovery() {
        assert!(
            bind_new_office_process(
                "Local\\TeacherDeck-Office-00000000000000000000000000000000",
                &std::collections::HashSet::new(),
                std::time::SystemTime::now(),
                std::path::Path::new("POWERPNT.EXE"),
                None,
            )
            .is_err()
        );
    }
}
