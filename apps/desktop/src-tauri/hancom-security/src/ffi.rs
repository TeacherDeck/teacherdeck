// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Only Hancom's fixed callback ABI and bounded local Win32 pipe calls (ADR-0027).
#![allow(unsafe_code)]
use crate::protocol::{Endpoint, MAX_FRAME, MAX_UNITS, decode_path, encode_path};
use std::ffi::c_void;
use std::time::{Duration, Instant};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetModuleHandleExW(flags: u32, address: *const u16, module: *mut isize) -> i32;
    fn GetModuleFileNameW(module: isize, path: *mut u16, length: u32) -> u32;
    fn ReadProcessMemory(
        process: isize,
        address: *const c_void,
        output: *mut c_void,
        length: usize,
        read: *mut usize,
    ) -> i32;
    fn MultiByteToWideChar(
        code_page: u32,
        flags: u32,
        input: *const u8,
        length: i32,
        output: *mut u16,
        capacity: i32,
    ) -> i32;
    fn CreateFileW(
        path: *const u16,
        access: u32,
        share: u32,
        attributes: *const c_void,
        disposition: u32,
        flags: u32,
        template: isize,
    ) -> isize;
    fn CloseHandle(handle: isize) -> i32;
    fn GetNamedPipeServerProcessId(handle: isize, pid: *mut u32) -> i32;
    fn SetNamedPipeHandleState(
        handle: isize,
        mode: *const u32,
        count: *const u32,
        timeout: *const u32,
    ) -> i32;
    fn ReadFile(
        handle: isize,
        output: *mut u8,
        size: u32,
        read: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
    fn WriteFile(
        handle: isize,
        input: *const u8,
        size: u32,
        written: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
}
struct Handle(isize);
impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns one valid CreateFileW handle and is never cloned.
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn endpoint() -> Option<Endpoint> {
    let mut module = 0isize;
    // SAFETY: FROM_ADDRESS queries the module containing this function, without changing
    // loader reference counts or interpreting this address as a UTF-16 string.
    if unsafe { GetModuleHandleExW(0x6, endpoint as *const () as *const u16, &mut module) } == 0 {
        return None;
    }
    let mut path = [0u16; 2048];
    // SAFETY: the live module handle and writable buffer/capacity belong to this call.
    let length = unsafe { GetModuleFileNameW(module, path.as_mut_ptr(), 2048) } as usize;
    if length == 0 || length >= path.len() {
        return None;
    }
    let path = String::from_utf16(path.get(..length)?).ok()?;
    let filename = path.rsplit('\\').next()?;
    let endpoint = Endpoint::from_filename(filename)?;
    (endpoint.filename() == filename).then_some(endpoint)
}
fn read_memory(address: usize, output: &mut [u8]) -> bool {
    let mut read = 0usize;
    // SAFETY: ReadProcessMemory checks the foreign pointer rather than dereferencing it
    // in Rust. -1 is this process's documented pseudo-handle; output is a live bounded slice.
    (unsafe {
        ReadProcessMemory(
            -1,
            address as *const c_void,
            output.as_mut_ptr().cast(),
            output.len(),
            &mut read,
        ) != 0
    }) && read == output.len()
}
fn callback_path(pointer: *const c_void) -> Option<String> {
    let address = pointer as usize;
    if address == 0 {
        return None;
    }
    let mut prefix = [0u8; 6];
    if !read_memory(address, &mut prefix) {
        return None;
    }
    // Official sample's _MBCS ABI is ANSI. Current Unicode providers are recognized only
    // by the unambiguous drive-prefix bytes; URL/UNC/device/relative paths are never accepted.
    let wide = prefix.get(1) == Some(&0)
        && prefix.get(2) == Some(&b':')
        && prefix.get(3) == Some(&0)
        && prefix.get(4) == Some(&b'\\')
        && prefix.get(5) == Some(&0);
    if wide {
        let mut units = Vec::new();
        for offset in 0..=MAX_UNITS {
            let mut bytes = [0u8; 2];
            if !read_memory(address.checked_add(offset.checked_mul(2)?)?, &mut bytes) {
                return None;
            }
            let unit = u16::from_le_bytes(bytes);
            if unit == 0 {
                return String::from_utf16(&units).ok();
            }
            units.push(unit);
        }
    } else {
        if prefix.get(1) != Some(&b':') || prefix.get(2) != Some(&b'\\') {
            return None;
        }
        let mut bytes = Vec::new();
        for offset in 0..=MAX_UNITS * 2 {
            let mut byte = [0u8; 1];
            if !read_memory(address.checked_add(offset)?, &mut byte) {
                return None;
            }
            let value = *byte.first()?;
            if value == 0 {
                let mut units = [0u16; MAX_UNITS];
                // SAFETY: CP_ACP with invalid-byte rejection converts this owned bounded
                // ANSI string, excluding NUL, into a live UTF-16 output buffer.
                let count = unsafe {
                    MultiByteToWideChar(
                        0,
                        8,
                        bytes.as_ptr(),
                        i32::try_from(bytes.len()).ok()?,
                        units.as_mut_ptr(),
                        i32::try_from(units.len()).ok()?,
                    )
                };
                return String::from_utf16(units.get(..usize::try_from(count).ok()?)?).ok();
            }
            bytes.push(value);
        }
    }
    None
}
fn ask_host(path: &str) -> Option<bool> {
    let endpoint = endpoint()?;
    // The host starts this endpoint only after binding its exact new Hwp PID, and
    // verifies the pipe client's kernel-provided PID before reading any request.
    let frame = encode_path(path)?;
    if frame.len() > MAX_FRAME {
        return None;
    }
    if decode_path(&frame).as_deref() != Some(path) {
        return None;
    }
    let name: Vec<_> = endpoint.pipe_name().encode_utf16().chain(Some(0)).collect();
    let deadline = Instant::now() + Duration::from_millis(750);
    let handle = loop {
        // SAFETY: fixed random local named-pipe endpoint, owned terminated string, no
        // inherited handles. SECURITY_IDENTIFICATION prevents a server impersonating us.
        let raw = unsafe {
            CreateFileW(
                name.as_ptr(),
                0xc000_0000,
                0,
                std::ptr::null(),
                3,
                0x0011_0000,
                0,
            )
        };
        if raw != -1 {
            break Handle(raw);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let mut pid = 0u32;
    // SAFETY: live pipe handle and writable PID output; never trust a response from another process.
    if unsafe { GetNamedPipeServerProcessId(handle.0, &mut pid) } == 0 || pid != endpoint.worker_pid
    {
        return None;
    }
    let mode = 3u32; // PIPE_READMODE_MESSAGE | PIPE_NOWAIT
    // SAFETY: live duplex pipe and initialized mode; optional mutable settings are omitted.
    if unsafe { SetNamedPipeHandleState(handle.0, &mode, std::ptr::null(), std::ptr::null()) } == 0
    {
        return None;
    }
    let mut written = 0u32;
    // SAFETY: frame is bounded and alive for this synchronous nonblocking write.
    if unsafe {
        WriteFile(
            handle.0,
            frame.as_ptr(),
            u32::try_from(frame.len()).ok()?,
            &mut written,
            std::ptr::null_mut(),
        )
    } == 0
        || usize::try_from(written).ok()? != frame.len()
    {
        return None;
    }
    loop {
        let mut response = [0u8; 2];
        let mut read = 0u32;
        // SAFETY: fixed two-byte output rejects oversized responses; no overlapped I/O.
        if unsafe {
            ReadFile(
                handle.0,
                response.as_mut_ptr(),
                2,
                &mut read,
                std::ptr::null_mut(),
            )
        } != 0
            && read == 1
        {
            let mut written = 0u32;
            // SAFETY: acknowledge the single bounded reply before the server disconnects.
            // DisconnectNamedPipe discards unread replies; no blocking flush is permitted.
            if unsafe {
                WriteFile(
                    handle.0,
                    [0xacu8].as_ptr(),
                    1,
                    &mut written,
                    std::ptr::null_mut(),
                )
            } == 0
                || written != 1
            {
                return None;
            }
            return Some(response.first() == Some(&1));
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Hancom's official four-argument stdcall ABI. Every failure denies access.
#[unsafe(export_name = "IsAccessiblePath")]
pub extern "system" fn is_accessible_path(
    _window: isize,
    _id: i32,
    path: *const c_void,
    _site: *const c_void,
) -> i32 {
    // A panic must not unwind through the foreign callback; it can never become permission.
    i32::from(
        std::panic::catch_unwind(|| {
            callback_path(path)
                .and_then(|path| ask_host(&path))
                .unwrap_or(false)
        })
        .unwrap_or(false),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_foreign_string_ansi_unicode_and_invalid_pointer() {
        let ansi = b"C:\\synthetic\\source.hwp\0";
        assert_eq!(
            callback_path(ansi.as_ptr().cast()).as_deref(),
            Some(r"C:\synthetic\source.hwp")
        );
        let wide: Vec<_> = "C:\\합성 자료\\source.hwp"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        assert_eq!(
            callback_path(wide.as_ptr().cast()).as_deref(),
            Some("C:\\합성 자료\\source.hwp")
        );
        assert!(callback_path(std::ptr::null()).is_none());
        assert!(callback_path(std::ptr::dangling::<c_void>()).is_none());
        let oversized = vec![b'a'; MAX_UNITS * 2 + 10];
        assert!(callback_path(oversized.as_ptr().cast()).is_none());
        assert_eq!(
            is_accessible_path(0, 0, ansi.as_ptr().cast(), std::ptr::null()),
            0,
            "test executable has no exact DLL endpoint; never permit outside a live host job"
        );
    }
    #[cfg(target_arch = "x86")]
    #[test]
    fn trusted_x86_artifact_loads_and_exports_exact_callback() {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn LoadLibraryW(path: *const u16) -> isize;
            fn GetProcAddress(module: isize, name: *const u8) -> *const c_void;
            fn FreeLibrary(module: isize) -> i32;
            fn GetLastError() -> u32;
        }
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("resources/native/hancom/teacherdeck_hwp_gate.dll");
        use std::os::windows::fs::OpenOptionsExt;
        let _locked_artifact = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        let path: Vec<_> = path
            .to_str()
            .unwrap()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // SAFETY: test-only fixed artifact compiled from this crate; never a caller-selected DLL.
        let module = unsafe { LoadLibraryW(path.as_ptr()) };
        // SAFETY: thread-local numeric diagnostic only; no OS strings or filenames are logged.
        let code = unsafe { GetLastError() };
        assert_ne!(
            module, 0,
            "fixed artifact LoadLibraryW numeric error: {code}"
        );
        // SAFETY: live trusted test module and terminated fixed export name, not invoked.
        let callback = unsafe { GetProcAddress(module, c"IsAccessiblePath".as_ptr().cast()) };
        // SAFETY: releases exactly the reference acquired by LoadLibraryW above.
        unsafe {
            FreeLibrary(module);
        }
        assert!(!callback.is_null(), "exact callback export unavailable");
    }
}
