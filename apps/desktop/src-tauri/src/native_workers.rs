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
#[cfg(any(windows, test))]
fn verified_window_pid(
    pid: u32,
    existing: &std::collections::HashSet<u32>,
    owned_pid: Option<u32>,
) -> Result<u32, DeckError> {
    if pid == 0
        || existing.contains(&pid)
        || owned_pid.is_some_and(|expected| expected == 0 || expected != pid)
    {
        return Err(DeckError::new(
            ErrorCode::Busy,
            if owned_pid.is_some() {
                "열려 있는 한글을 닫은 뒤 다시 변환해 주세요."
            } else {
                "이미 열린 프로그램과 분리하지 못했어요. 문서를 직접 변환해 주세요."
            },
        ));
    }
    Ok(pid)
}
#[cfg(any(windows, test))]
fn single_hancom_helper_candidate(candidates: &[u32]) -> Result<Option<u32>, DeckError> {
    match candidates {
        [] => Ok(None),
        [pid] if *pid != 0 => Ok(Some(*pid)),
        _ => Err(failure()),
    }
}
#[cfg(any(windows, test))]
fn exact_hancom_helper_switches(arguments: &[String]) -> bool {
    matches!(arguments, [automation, embedding] if automation == "-Automation" && embedding == "-Embedding")
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
                if job.format == OfficeFormat::Hwpx {
                    guard.finish()?;
                }
                return Err(DeckError::new(ErrorCode::Cancelled, "변환을 중지했어요."));
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                if job.format == OfficeFormat::Hwpx {
                    guard.finish()?;
                }
                return Err(office_timeout(job.format));
            }
            if let Some(status) = child.try_wait().map_err(|_| failure())? {
                if job.format == OfficeFormat::Hwpx {
                    guard.finish()?;
                }
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
        /// Closing a Job requests asynchronous termination. A Hancom batch must not start
        /// its next item until all processes owned by the previous item have actually exited.
        pub(crate) fn finish(&self) -> Result<(), DeckError> {
            use windows::Win32::System::JobObjects::{
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JobObjectBasicAccountingInformation,
                QueryInformationJobObject, TerminateJobObject,
            };
            // SAFETY: this guard owns the exact randomly named Job. Its only members are the
            // worker, inherited children and independently verified Office processes.
            unsafe { TerminateJobObject(self.handle.0, 1) }.map_err(|_| failure())?;
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
                // SAFETY: owned Job and initialized correctly sized writable accounting data.
                unsafe {
                    QueryInformationJobObject(
                        Some(self.handle.0),
                        JobObjectBasicAccountingInformation,
                        (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                        size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                        None,
                    )
                }
                .map_err(|_| failure())?;
                if info.ActiveProcesses == 0 {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err(failure());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
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
        bind_window_process(job_name, hwnd, existing, None)
    }
    /// Hancom COM must resolve to the exact live child launched by this worker.
    pub(crate) fn bind_owned_office_process(
        job_name: &str,
        hwnd: i32,
        existing: &HashSet<u32>,
        owned_pid: u32,
    ) -> Result<(), DeckError> {
        bind_window_process(job_name, hwnd, existing, Some(owned_pid))
    }
    fn bind_window_process(
        job_name: &str,
        hwnd: i32,
        existing: &HashSet<u32>,
        owned_pid: Option<u32>,
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
        verified_window_pid(pid, existing, owned_pid)?;
        assign_verified_pid(job_name, pid)
    }
    /// Child creation may proceed only from the already isolated Office worker.
    pub(crate) fn require_worker_job(job_name: &str) -> Result<(), DeckError> {
        let token = job_name
            .strip_prefix("Local\\TeacherDeck-Office-")
            .ok_or_else(failure)?;
        if token.len() != 32 || !token.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(failure());
        }
        let wide: Vec<u16> = job_name.encode_utf16().chain(Some(0)).collect();
        // SAFETY: fixed-prefix validated job name, query-only handle closed by OwnedHandle.
        let job = OwnedHandle(
            unsafe { OpenJobObjectW(4, false, PCWSTR(wide.as_ptr())) }.map_err(|_| failure())?,
        );
        let mut member = windows::core::BOOL::default();
        // SAFETY: queries only this worker's pseudo handle and the exact owned Job.
        unsafe {
            IsProcessInJob(
                windows::Win32::System::Threading::GetCurrentProcess(),
                Some(job.0),
                &mut member,
            )
        }
        .map_err(|_| failure())?;
        if !member.as_bool() {
            return Err(failure());
        }
        Ok(())
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
        require_office_absent(
            "POWERPNT.EXE",
            "열려 있는 PowerPoint를 닫은 뒤 다시 변환해 주세요.",
        )
    }
    /// No proved new-instance switch exists; never launch into a user's open Hancom session.
    pub(crate) fn require_hancom_absent() -> Result<(), DeckError> {
        require_office_absent("HWP.EXE", "열려 있는 한글을 닫은 뒤 다시 변환해 주세요.")
    }
    fn require_office_absent(image_name: &str, busy_message: &str) -> Result<(), DeckError> {
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
                .eq_ignore_ascii_case(image_name)
            {
                // A process can remain in Toolhelp after Job accounting reaches zero.
                // Ignore only a proved exited process; unreadable/live instances stay busy.
                // SAFETY: read-only process state query; this never assigns or terminates it.
                let exited = unsafe {
                    OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION,
                        false,
                        entry.th32ProcessID,
                    )
                }
                .map(|handle| {
                    let process = OwnedHandle(handle);
                    let mut code = 0;
                    // SAFETY: live query handle and initialized writable exit status.
                    unsafe { GetExitCodeProcess(process.0, &mut code) }.is_ok()
                        && code != STILL_ACTIVE.0 as u32
                })
                .unwrap_or_else(|error| {
                    error.code() == windows::Win32::Foundation::ERROR_INVALID_PARAMETER.to_hresult()
                });
                if !exited {
                    return Err(DeckError::new(ErrorCode::Busy, busy_message));
                }
            }
            // SAFETY: same initialized structure and owned snapshot; no process is modified.
            if unsafe { Process32NextW(snapshot.0, &mut entry) }.is_err() {
                break;
            }
        }
        Ok(())
    }
    /// Extends the existing sole-new-Office-process model to Hancom's SCM helper. Call only
    /// after CoCreate and exact owned-child HWND proof, before opening any document. A fresh
    /// pre-CoCreate snapshot and the actual call interval must be supplied, never the earlier
    /// direct-launch/ROT-readiness interval. This does not claim to distinguish another
    /// simultaneous automation invocation with identical image and switches.
    pub(crate) fn bind_hancom_helper(
        job_name: &str,
        before: &HashSet<u32>,
        started: std::time::SystemTime,
        ended: std::time::SystemTime,
        image: &std::path::Path,
        owned_child_pid: u32,
    ) -> Result<(), DeckError> {
        if owned_child_pid == 0
            || ended < started
            || !image.is_absolute()
            || !image
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("HWP.EXE"))
        {
            return Err(failure());
        }
        require_worker_job(job_name)?;
        // SAFETY: owns a read-only snapshot. Every new Hwp except our retained direct child
        // participates in the uniqueness check; a normal concurrent user Hwp cannot be ignored.
        let snapshot = OwnedHandle(
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(|_| failure())?,
        );
        let mut entry = PROCESSENTRY32W {
            dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).map_err(|_| failure())?,
            ..Default::default()
        };
        let mut candidates = vec![];
        // SAFETY: initialized output and live read-only snapshot.
        unsafe { Process32FirstW(snapshot.0, &mut entry) }.map_err(|_| failure())?;
        loop {
            let count = entry
                .szExeFile
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16(entry.szExeFile.get(..count).ok_or_else(failure)?)
                .map_err(|_| failure())?;
            if name.eq_ignore_ascii_case("HWP.EXE")
                && entry.th32ProcessID != owned_child_pid
                && !before.contains(&entry.th32ProcessID)
            {
                candidates.push(entry.th32ProcessID);
            }
            // SAFETY: same initialized structure and live read-only snapshot.
            match unsafe { Process32NextW(snapshot.0, &mut entry) } {
                Ok(()) => (),
                Err(error)
                    if error.code()
                        == windows::Win32::Foundation::ERROR_NO_MORE_FILES.to_hresult() =>
                {
                    break;
                }
                Err(_) => return Err(failure()),
            }
        }
        let Some(pid) = single_hancom_helper_candidate(&candidates)? else {
            return Ok(());
        };
        // SAFETY: this new candidate handle pins identity through all checks and Job assignment.
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
        // SAFETY: live pinned process and four initialized output structures.
        unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user) }
            .map_err(|_| failure())?;
        let created = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        let ticks = |time: std::time::SystemTime| -> Result<u64, DeckError> {
            u64::try_from(
                time.duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| failure())?
                    .as_nanos()
                    / 100
                    + 116_444_736_000_000_000,
            )
            .map_err(|_| failure())
        };
        if created < ticks(started)? || created > ticks(ended)? {
            return Err(failure());
        }
        let mut path = vec![0u16; 32768];
        let mut count = u32::try_from(path.len()).map_err(|_| failure())?;
        // SAFETY: bounded writable image buffer and the same retained candidate handle.
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
        if actual != image || !helper_same_user_session(process.0)? || !helper_headless(pid)? {
            return Err(failure());
        }
        // Reuse the host's existing WbemScripting path, addressing only the already pinned
        // decimal PID. CommandLine stays private and is never returned in errors or logs.
        let service = crate::native_automation::Dispatch::create("WbemScripting.SWbemLocator")
            .and_then(|locator| {
                locator.method_object("ConnectServer", vec![".".into(), "root\\cimv2".into()])
            })
            .map_err(|_| failure())?;
        let object = service
            .method_object(
                "Get",
                vec![format!("Win32_Process.Handle=\"{pid}\"").as_str().into()],
            )
            .map_err(|_| failure())?;
        let command =
            crate::native_automation::string(&object.get("CommandLine").map_err(|_| failure())?)
                .map_err(|_| failure())?;
        if !helper_command_line(&command, image)? {
            return Err(failure());
        }
        let mut exit_code = 0;
        // SAFETY: same retained identity; verify it did not exit during the read-only checks.
        unsafe { GetExitCodeProcess(process.0, &mut exit_code) }.map_err(|_| failure())?;
        if exit_code != STILL_ACTIVE.0 as u32 || !helper_headless(pid)? {
            return Err(failure());
        }
        let wide: Vec<u16> = job_name.encode_utf16().chain(Some(0)).collect();
        // SAFETY: validated own Job; only query/assign access, no broad termination operation.
        let job = OwnedHandle(
            unsafe { OpenJobObjectW(5, false, PCWSTR(wide.as_ptr())) }.map_err(|_| failure())?,
        );
        let mut member = windows::core::BOOL::default();
        // SAFETY: exact retained candidate and Job handles with one writable Boolean.
        unsafe { IsProcessInJob(process.0, Some(job.0), &mut member) }.map_err(|_| failure())?;
        if !member.as_bool() {
            // SAFETY: only the sole new fixed-image, fixed-command, same-user/session,
            // headless helper born inside CoCreate is assigned. No process is killed by name.
            unsafe { AssignProcessToJobObject(job.0, process.0) }.map_err(|_| failure())?;
        }
        Ok(())
    }
    fn helper_command_line(command: &str, image: &std::path::Path) -> Result<bool, DeckError> {
        use windows::Win32::Foundation::{HLOCAL, LocalFree};
        use windows::Win32::UI::Shell::CommandLineToArgvW;
        if command.is_empty() || command.len() > 65536 || command.contains('\0') {
            return Ok(false);
        }
        let wide: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
        let mut count = 0;
        // SAFETY: bounded null-terminated private command and writable argument count.
        let raw = unsafe { CommandLineToArgvW(PCWSTR(wide.as_ptr()), &mut count) };
        if raw.is_null() {
            return Err(failure());
        }
        let result = (|| {
            if count != 3 {
                return Ok(false);
            }
            // SAFETY: successful parser returned three initialized null-terminated PWSTRs;
            // the single LocalAlloc block stays live until the private copies are inspected.
            let arguments = unsafe { std::slice::from_raw_parts(raw, 3) }
                .iter()
                .map(|value| unsafe { value.to_string() }.map_err(|_| failure()))
                .collect::<Result<Vec<_>, _>>()?;
            let executable = std::path::PathBuf::from(arguments.first().ok_or_else(failure)?)
                .canonicalize()
                .map_err(|_| failure())?;
            Ok(executable == image
                && exact_hancom_helper_switches(arguments.get(1..).ok_or_else(failure)?))
        })();
        // SAFETY: releases exactly the parser's one owned LocalAlloc block on every path.
        let _ = unsafe { LocalFree(Some(HLOCAL(raw.cast()))) };
        result
    }
    fn helper_same_user_session(process: HANDLE) -> Result<bool, DeckError> {
        use windows::Win32::Security::{
            EqualSid, GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenSessionId, TokenUser,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        let mut candidate = HANDLE::default();
        let mut current = HANDLE::default();
        // SAFETY: query only the pinned candidate token; each successful output is owned.
        unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut candidate) }.map_err(|_| failure())?;
        let candidate = OwnedHandle(candidate);
        // SAFETY: read-only worker token; the owned candidate token is closed on failure too.
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut current) }
            .map_err(|_| failure())?;
        let current = OwnedHandle(current);
        let identity = |token: HANDLE| -> Result<(Vec<u64>, u32), DeckError> {
            let mut bytes = 0;
            // SAFETY: size-only query with no output allocation and one writable count.
            let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut bytes) };
            if bytes < size_of::<TOKEN_USER>() as u32 || bytes > 65536 {
                return Err(failure());
            }
            let mut buffer = vec![0u64; (bytes as usize).div_ceil(8)];
            // SAFETY: live aligned allocation supplies the reported TOKEN_USER byte capacity.
            unsafe {
                GetTokenInformation(
                    token,
                    TokenUser,
                    Some(buffer.as_mut_ptr().cast()),
                    bytes,
                    &mut bytes,
                )
            }
            .map_err(|_| failure())?;
            let mut session = 0u32;
            // SAFETY: TokenSessionId writes one DWORD into the live initialized output.
            unsafe {
                GetTokenInformation(
                    token,
                    TokenSessionId,
                    Some((&mut session as *mut u32).cast()),
                    4,
                    &mut bytes,
                )
            }
            .map_err(|_| failure())?;
            Ok((buffer, session))
        };
        let (candidate_user, candidate_session) = identity(candidate.0)?;
        let (current_user, current_session) = identity(current.0)?;
        // SAFETY: successful token queries initialized both TOKEN_USER structures and their
        // embedded SIDs; both allocations and token handles remain live for this comparison.
        let same_user = unsafe {
            let candidate = &*candidate_user.as_ptr().cast::<TOKEN_USER>();
            let current = &*current_user.as_ptr().cast::<TOKEN_USER>();
            EqualSid(candidate.User.Sid, current.User.Sid).is_ok()
        };
        Ok(same_user && candidate_session == current_session)
    }
    fn helper_headless(pid: u32) -> Result<bool, DeckError> {
        use windows::Win32::Foundation::LPARAM;
        use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, IsWindowVisible};
        struct Probe {
            pid: u32,
            visible: bool,
        }
        unsafe extern "system" fn inspect(hwnd: HWND, data: LPARAM) -> windows::core::BOOL {
            // SAFETY: EnumWindows synchronously passes the live exclusive Probe address.
            let probe = unsafe { &mut *(data.0 as *mut Probe) };
            let mut pid = 0;
            // SAFETY: read-only PID query and initialized output; no window input/title access.
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            // SAFETY: read-only visibility query of this enumerated top-level HWND.
            if pid == probe.pid && unsafe { IsWindowVisible(hwnd) }.as_bool() {
                probe.visible = true;
                return windows::core::BOOL(0);
            }
            windows::core::BOOL(1)
        }
        let mut probe = Probe {
            pid,
            visible: false,
        };
        // SAFETY: callback is synchronous and the probe stays exclusively live throughout it.
        let result =
            unsafe { EnumWindows(Some(inspect), LPARAM((&mut probe as *mut Probe) as isize)) };
        if result.is_err() && !probe.visible {
            return Err(failure());
        }
        Ok(!probe.visible)
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
    JobGuard as OfficeProcessGroup, bind_hancom_helper, bind_new_office_process,
    bind_office_process, bind_owned_office_process, process_snapshot, require_hancom_absent,
    require_powerpoint_absent, require_worker_job,
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
    fn hancom_helper_rejects_ambiguous_or_invalid_candidates_before_binding() {
        assert_eq!(single_hancom_helper_candidate(&[]).unwrap(), None);
        assert_eq!(single_hancom_helper_candidate(&[17]).unwrap(), Some(17));
        assert!(single_hancom_helper_candidate(&[0]).is_err());
        assert!(single_hancom_helper_candidate(&[13, 17]).is_err());
    }
    #[test]
    fn hancom_helper_accepts_only_the_two_registered_switches_without_documents() {
        let args = |values: &[&str]| {
            values
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>()
        };
        assert!(exact_hancom_helper_switches(&args(&[
            "-Automation",
            "-Embedding"
        ])));
        for values in [
            vec![],
            vec!["-Automation"],
            vec!["-Embedding", "-Automation"],
            vec!["-Automation", "-Embedding", "synthetic.hwp"],
            vec!["/AUTOMATION", "-Embedding"],
        ] {
            assert!(!exact_hancom_helper_switches(&args(&values)));
        }
    }
    #[test]
    fn owned_window_rejects_existing_concurrent_or_zero_processes() {
        let existing = std::collections::HashSet::from([11]);
        assert!(verified_window_pid(11, &existing, Some(11)).is_err());
        assert!(verified_window_pid(17, &existing, Some(13)).is_err());
        assert!(verified_window_pid(0, &existing, Some(0)).is_err());
        assert!(verified_window_pid(13, &existing, Some(0)).is_err());
        assert_eq!(verified_window_pid(13, &existing, Some(13)).ok(), Some(13));
        assert_eq!(verified_window_pid(17, &existing, None).ok(), Some(17));
    }
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
