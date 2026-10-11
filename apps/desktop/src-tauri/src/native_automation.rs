// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Approved Windows COM boundary. Automation objects never cross a COM thread.
#![allow(unsafe_code)]
use deck_core::{DeckError, ErrorCode};

/// A privacy-safe installed-provider failure.
pub(crate) fn failed() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "설치된 프로그램과 문서 접근 승인을 확인해 주세요.",
    )
}

#[cfg(windows)]
fn failed_hresult(error: windows::core::Error) -> DeckError {
    let mut failure = failed();
    // Numeric HRESULT is system metadata. Never copy the COM exception message or arguments.
    failure.details = Some(serde_json::json!({ "automationHresult": error.code().0 }));
    failure
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::marker::PhantomData;
    use std::mem::ManuallyDrop;
    use std::rc::Rc;
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, CLSCTX_LOCAL_SERVER, CLSIDFromProgID, COINIT_APARTMENTTHREADED,
        CoCreateInstance, CoInitializeEx, CoUninitialize, DISPATCH_FLAGS, DISPATCH_METHOD,
        DISPATCH_PROPERTYGET, DISPATCH_PROPERTYPUT, DISPPARAMS, IDispatch,
    };
    use windows::Win32::System::Ole::{
        SafeArrayCreateVector, SafeArrayDestroy, SafeArrayGetDim, SafeArrayGetElement,
        SafeArrayGetLBound, SafeArrayGetUBound, SafeArrayPutElement,
    };
    use windows::Win32::System::Variant::{
        VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_ARRAY, VT_BSTR, VT_ERROR, VT_NULL,
        VT_VARIANT,
    };
    use windows::core::{BSTR, GUID, Interface, PCWSTR};
    /// STA guard deliberately cannot be moved to another thread.
    pub(crate) struct Apartment(PhantomData<Rc<()>>);
    impl Apartment {
        pub(crate) fn enter() -> Result<Self, DeckError> {
            // SAFETY: this dedicated worker enters one STA and releases it on the same thread.
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
                .ok()
                .map_err(|_| failed())?;
            Ok(Self(PhantomData))
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            // SAFETY: exactly one successful CoInitializeEx is balanced on its original thread.
            unsafe { CoUninitialize() };
        }
    }
    /// Owned IDispatch and all VARIANT parameters remain on this STA.
    pub(crate) struct Dispatch {
        object: IDispatch,
        _thread: PhantomData<Rc<()>>,
    }
    impl Dispatch {
        pub(crate) fn registered(progid: &str) -> bool {
            let name: Vec<u16> = progid.encode_utf16().chain(Some(0)).collect();
            // SAFETY: null-terminated fixed host ProgID remains alive for this synchronous call.
            unsafe { CLSIDFromProgID(PCWSTR(name.as_ptr())) }.is_ok()
        }
        pub(crate) fn create(progid: &str) -> Result<Self, DeckError> {
            let name: Vec<u16> = progid.encode_utf16().chain(Some(0)).collect();
            // SAFETY: fixed host allowlist ProgID, no aggregation, current worker owns its STA.
            let object = unsafe {
                let clsid = CLSIDFromProgID(PCWSTR(name.as_ptr())).map_err(|_| failed())?;
                CoCreateInstance::<_, IDispatch>(
                    &clsid,
                    None,
                    if matches!(progid, "WbemScripting.SWbemLocator" | "Schedule.Service") {
                        CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER
                    } else {
                        CLSCTX_LOCAL_SERVER
                    },
                )
            }
            .map_err(failed_hresult)?;
            Ok(Self {
                object,
                _thread: PhantomData,
            })
        }
        pub(crate) fn from_variant(value: &VARIANT) -> Result<Self, DeckError> {
            Ok(Self {
                object: IDispatch::try_from(value).map_err(|_| failed())?,
                _thread: PhantomData,
            })
        }
        /// Read-only COM window query. An unsupported/windowless object fails before any mutation.
        pub(crate) fn ole_window(&self) -> Result<i32, DeckError> {
            let window = self
                .object
                .cast::<windows::Win32::System::Ole::IOleWindow>()
                .map_err(|_| failed())?;
            // SAFETY: queried interface belongs to this live STA COM object; GetWindow only reads HWND.
            let hwnd = unsafe { window.GetWindow() }.map_err(|_| failed())?;
            i32::try_from(hwnd.0 as isize).map_err(|_| failed())
        }
        /// Office command bars are IAccessible objects belonging to this exact Application.
        /// Never creates a document or changes the visible application to obtain a window.
        pub(crate) fn command_bar_window(&self) -> Result<i32, DeckError> {
            use windows::Win32::UI::Accessibility::{IAccessible, WindowFromAccessibleObject};
            let bars = self.get_object("CommandBars")?;
            let count = number(&bars.get("Count")?)?;
            if !(1..=512).contains(&count) {
                return Err(failed());
            }
            for index in 1..=count {
                let bar = bars.method_object("Item", vec![index.into()])?;
                let Ok(accessible) = bar.object.cast::<IAccessible>() else {
                    continue;
                };
                // SAFETY: IAccessible belongs to a live COM command bar on this STA. API only
                // queries its corresponding HWND; interface lifetime covers the synchronous call.
                let mut hwnd = windows::Win32::Foundation::HWND::default();
                if unsafe { WindowFromAccessibleObject(&accessible, Some(&mut hwnd)) }.is_ok()
                    && !hwnd.0.is_null()
                {
                    return i32::try_from(hwnd.0 as isize).map_err(|_| failed());
                }
            }
            Err(failed())
        }
        fn call(
            &self,
            name: &str,
            flags: DISPATCH_FLAGS,
            mut args: Vec<VARIANT>,
        ) -> Result<VARIANT, DeckError> {
            let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
            let mut id = 0i32;
            let mut result = VARIANT::default();
            let iid = GUID::zeroed();
            let pname = PCWSTR(wide.as_ptr());
            // SAFETY: the owned name and DISPID output are live, one name is passed, IID_NULL is required.
            unsafe { self.object.GetIDsOfNames(&iid, &pname, 1, 0x0409, &mut id) }
                .map_err(failed_hresult)?;
            args.reverse();
            let mut put = -3i32;
            let property_put = flags == DISPATCH_PROPERTYPUT;
            let params = DISPPARAMS {
                rgvarg: if args.is_empty() {
                    std::ptr::null_mut()
                } else {
                    args.as_mut_ptr()
                },
                rgdispidNamedArgs: if property_put {
                    &mut put
                } else {
                    std::ptr::null_mut()
                },
                cArgs: u32::try_from(args.len()).map_err(|_| failed())?,
                cNamedArgs: u32::from(property_put),
            };
            // SAFETY: reverse-order VARIANT arguments and named property-put DISPID stay alive for Invoke.
            // Result is initialized and owned; VARIANT Drop releases strings/interfaces/arrays exactly once.
            unsafe {
                self.object.Invoke(
                    id,
                    &iid,
                    0x0409,
                    flags,
                    &params,
                    Some(&mut result),
                    None,
                    None,
                )
            }
            .map_err(failed_hresult)?;
            Ok(result)
        }
        pub(crate) fn get(&self, name: &str) -> Result<VARIANT, DeckError> {
            self.call(name, DISPATCH_PROPERTYGET, vec![])
        }
        pub(crate) fn get_object(&self, name: &str) -> Result<Self, DeckError> {
            Self::from_variant(&self.get(name)?)
        }
        pub(crate) fn invoke(&self, name: &str, args: Vec<VARIANT>) -> Result<VARIANT, DeckError> {
            self.call(name, DISPATCH_METHOD, args)
        }
        pub(crate) fn method_object(
            &self,
            name: &str,
            args: Vec<VARIANT>,
        ) -> Result<Self, DeckError> {
            Self::from_variant(&self.call(name, DISPATCH_METHOD | DISPATCH_PROPERTYGET, args)?)
        }
        pub(crate) fn put(&self, name: &str, value: VARIANT) -> Result<(), DeckError> {
            self.call(name, DISPATCH_PROPERTYPUT, vec![value])
                .map(|_| ())
        }
    }
    pub(crate) fn string(value: &VARIANT) -> Result<String, DeckError> {
        if value.vt() != VT_BSTR {
            return Err(failed());
        }
        // SAFETY: checked VT_BSTR discriminator; borrow the live BSTR without stealing/freeing it.
        Ok(unsafe { &value.Anonymous.Anonymous.Anonymous.bstrVal }.to_string())
    }
    pub(crate) fn number(value: &VARIANT) -> Result<i32, DeckError> {
        i32::try_from(value).map_err(|_| failed())
    }
    pub(crate) fn boolean(value: &VARIANT) -> Result<bool, DeckError> {
        bool::try_from(value).map_err(|_| failed())
    }
    pub(crate) fn missing() -> VARIANT {
        VARIANT {
            Anonymous: VARIANT_0 {
                Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                    vt: VT_ERROR,
                    Anonymous: VARIANT_0_0_0 { scode: -2147352572 },
                    ..Default::default()
                }),
            },
        }
    }
    pub(crate) fn null() -> VARIANT {
        VARIANT {
            Anonymous: VARIANT_0 {
                Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                    vt: VT_NULL,
                    ..Default::default()
                }),
            },
        }
    }
    pub(crate) fn strings(values: &[String]) -> Result<VARIANT, DeckError> {
        // SAFETY: allocate a one-dimensional BSTR array with bounded caller-validated length.
        let array = unsafe {
            SafeArrayCreateVector(
                VT_BSTR,
                0,
                u32::try_from(values.len()).map_err(|_| failed())?,
            )
        };
        if array.is_null() {
            return Err(failed());
        }
        for (index, text) in values.iter().enumerate() {
            let bstr = BSTR::from(text.as_str());
            let index = i32::try_from(index).map_err(|_| failed())?;
            // SAFETY: index is inside allocation; API copies BSTR while its temporary owner remains alive.
            if unsafe { SafeArrayPutElement(array, &index, bstr.as_ptr().cast()) }.is_err() {
                // SAFETY: failed construction has not transferred array ownership to a VARIANT.
                let _ = unsafe { SafeArrayDestroy(array) };
                return Err(failed());
            }
        }
        Ok(VARIANT {
            Anonymous: VARIANT_0 {
                Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                    vt: VT_ARRAY | VT_BSTR,
                    Anonymous: VARIANT_0_0_0 { parray: array },
                    ..Default::default()
                }),
            },
        })
    }
    pub(crate) fn read_strings(value: &VARIANT) -> Result<Vec<String>, DeckError> {
        if value.is_empty() || value.vt() == VT_NULL {
            return Ok(vec![]);
        }
        if value.vt() != (VT_ARRAY | VT_BSTR) && value.vt() != (VT_ARRAY | VT_VARIANT) {
            return Err(failed());
        }
        // SAFETY: checked array discriminator; array is borrowed from the live owning VARIANT.
        let array = unsafe { value.Anonymous.Anonymous.Anonymous.parray };
        if array.is_null() {
            return Err(failed());
        }
        // SAFETY: valid borrowed SAFEARRAY; require one dimension and bound each element read.
        let (lower, upper) = unsafe {
            if SafeArrayGetDim(array) != 1 {
                return Err(failed());
            }
            (
                SafeArrayGetLBound(array, 1).map_err(|_| failed())?,
                SafeArrayGetUBound(array, 1).map_err(|_| failed())?,
            )
        };
        let span = i64::from(upper) - i64::from(lower);
        if span == -1 {
            return Ok(vec![]);
        }
        if !(0..=255).contains(&span) {
            return Err(failed());
        }
        let mut result = vec![];
        for index in lower..=upper {
            if value.vt() == (VT_ARRAY | VT_BSTR) {
                let mut text = BSTR::new();
                // SAFETY: bounds checked; API returns an allocated copy into owned BSTR, Drop frees it.
                unsafe { SafeArrayGetElement(array, &index, (&mut text as *mut BSTR).cast()) }
                    .map_err(|_| failed())?;
                result.push(text.to_string());
            } else {
                let mut element = VARIANT::default();
                // SAFETY: bounds checked; API initializes an owned copied VARIANT, Drop releases it.
                unsafe {
                    SafeArrayGetElement(array, &index, (&mut element as *mut VARIANT).cast())
                }
                .map_err(|_| failed())?;
                result.push(string(&element)?);
            }
        }
        Ok(result)
    }
    pub(crate) use windows::Win32::System::Variant::VARIANT as Value;
    /// Exact executable registered for the fixed Word COM class, used only for identity proof.
    pub(crate) fn registered_office_image(
        provider: deck_core::caps::office::OfficeProvider,
    ) -> Result<std::path::PathBuf, DeckError> {
        use deck_core::caps::office::OfficeProvider;
        let expected = match provider {
            OfficeProvider::Word => "WINWORD.EXE",
            OfficeProvider::Powerpoint => "POWERPNT.EXE",
            _ => return Err(failed()),
        };
        use windows::Win32::System::Registry::{
            HKEY_CLASSES_ROOT, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ, RegGetValueW,
        };
        let progid: Vec<u16> = provider_class(provider)
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // SAFETY: fixed allowlisted null-terminated ProgID, read-only registration lookup.
        let clsid = unsafe { CLSIDFromProgID(PCWSTR(progid.as_ptr())) }.map_err(|_| failed())?;
        let key: Vec<u16> = format!("CLSID\\{{{clsid:?}}}\\LocalServer32")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut data = vec![0u16; 32768];
        let mut bytes = u32::try_from(data.len() * 2).map_err(|_| failed())?;
        // SAFETY: fixed-class registration value only; aligned UTF-16 buffer and byte size remain
        // live. RegGetValue expands REG_EXPAND_SZ; no environment or authentication values are read.
        unsafe {
            RegGetValueW(
                HKEY_CLASSES_ROOT,
                PCWSTR(key.as_ptr()),
                PCWSTR::null(),
                RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ,
                None,
                Some(data.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        }
        .ok()
        .map_err(|_| failed())?;
        let count = usize::try_from(bytes / 2).map_err(|_| failed())?;
        let data = data.get(..count).ok_or_else(failed)?;
        let text = String::from_utf16(data.split(|c| *c == 0).next().unwrap_or_default())
            .map_err(|_| failed())?;
        let text = text.trim();
        let executable = if let Some(quoted) = text.strip_prefix('"') {
            quoted
                .split_once('"')
                .map(|(path, _)| path)
                .ok_or_else(failed)?
        } else {
            let end = text.to_ascii_lowercase().find(".exe").ok_or_else(failed)? + 4;
            text.get(..end).ok_or_else(failed)?
        };
        let path = std::path::Path::new(executable)
            .canonicalize()
            .map_err(|_| failed())?;
        if !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(expected))
        {
            return Err(failed());
        }
        Ok(path)
    }
}
#[cfg(windows)]
pub(crate) use win::*;

/// Fixed provider registration name, never module-controlled.
pub(crate) const fn provider_class(
    provider: deck_core::caps::office::OfficeProvider,
) -> &'static str {
    use deck_core::caps::office::OfficeProvider;
    match provider {
        OfficeProvider::Hancom => "HWPFrame.HwpObject",
        OfficeProvider::Excel => "Excel.Application",
        OfficeProvider::Powerpoint => "PowerPoint.Application",
        OfficeProvider::Word => "Word.Application",
    }
}
/// Registry discovery on a dedicated COM thread.
pub(crate) fn availability() -> Result<deck_core::caps::office::OfficeAvailability, DeckError> {
    use deck_core::caps::office::{OfficeAvailability, OfficeProvider, OfficeProviderStatus};
    #[cfg(windows)]
    let _apartment = Apartment::enter()?;
    Ok(OfficeAvailability {
        providers: [
            OfficeProvider::Hancom,
            OfficeProvider::Excel,
            OfficeProvider::Powerpoint,
            OfficeProvider::Word,
        ]
        .into_iter()
        .map(|provider| {
            #[cfg(windows)]
            let ready = Dispatch::registered(provider_class(provider));
            #[cfg(not(windows))]
            let ready = false;
            OfficeProviderStatus {
                provider,
                registered: ready,
                // Registration is not proof of successful activation, secure open and SaveAs.
                ready: false,
            }
        })
        .collect(),
    })
}

/// Own application object; Quit is called only after process ownership was proved.
#[cfg(windows)]
pub(crate) struct LaunchedOffice(std::process::Child);
#[cfg(windows)]
impl LaunchedOffice {
    /// Only the fixed registered PowerPoint image; no caller-controlled switches or files.
    pub(crate) fn powerpoint(image: &std::path::Path) -> Result<Self, DeckError> {
        use std::os::windows::process::CommandExt;
        if !image.is_absolute()
            || !image
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case("POWERPNT.EXE"))
        {
            return Err(failed());
        }
        let child = std::process::Command::new(image)
            // Fixed switch used by the registered PowerPoint LocalServer32.
            .arg("/AUTOMATION")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|_| failed())?;
        let mut owned = Self(child);
        use std::os::windows::io::AsRawHandle;
        // SAFETY: std Child retains this exact process handle. This bounded read-only wait
        // lets its message queue initialize before COM activation can launch a competing server.
        // No HWND, input event, or process discovered by name is manipulated.
        let idle = unsafe {
            windows::Win32::System::Threading::WaitForInputIdle(
                windows::Win32::Foundation::HANDLE(owned.0.as_raw_handle()),
                30_000,
            )
        };
        if idle != windows::Win32::Foundation::WAIT_OBJECT_0.0 {
            return Err(failed());
        }
        owned.live_pid()?;
        Ok(owned)
    }
    pub(crate) fn live_pid(&mut self) -> Result<u32, DeckError> {
        if self.0.try_wait().map_err(|_| failed())?.is_some() {
            return Err(failed());
        }
        Ok(self.0.id())
    }
    pub(crate) fn annotate_failure(&mut self, mut error: DeckError) -> DeckError {
        if let Ok(status) = self.0.try_wait() {
            let details = error.details.get_or_insert_with(|| serde_json::json!({}));
            if let Some(fields) = details.as_object_mut() {
                fields.insert(
                    "ownedChildExited".into(),
                    serde_json::json!(status.is_some()),
                );
                fields.insert(
                    "ownedChildExitCode".into(),
                    serde_json::json!(status.and_then(|status| status.code())),
                );
            }
        }
        error
    }
}
#[cfg(windows)]
impl Drop for LaunchedOffice {
    fn drop(&mut self) {
        // Child retains its process handle; this never terminates a process found by name.
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[cfg(windows)]
struct OfficeInstance {
    app: Dispatch,
    provider: deck_core::caps::office::OfficeProvider,
}
#[cfg(windows)]
impl Drop for OfficeInstance {
    fn drop(&mut self) {
        let _ = self.app.invoke("Quit", vec![]);
    }
}

/// Opens securely and performs actual installed-provider SaveAs and a second read-only open.
#[cfg(windows)]
pub(crate) fn convert(request: &crate::native_workers::OfficeJob) -> Result<(), DeckError> {
    convert_with_progress(request, |_| {})
}

/// Fixed, content-free progress labels for the development-only installed-provider proof.
#[cfg(windows)]
pub(crate) fn convert_with_progress(
    request: &crate::native_workers::OfficeJob,
    mut progress: impl FnMut(&'static str),
) -> Result<(), DeckError> {
    use deck_core::caps::office::{OfficeFormat, OfficeProvider};
    if request.format.provider() == OfficeProvider::Excel {
        progress("excel-preflight-begin");
        let mut file = std::fs::File::open(&request.source).map_err(|_| failed())?;
        let length = file.metadata().map_err(|_| failed())?.len();
        let extension = request
            .source
            .extension()
            .and_then(|value| value.to_str())
            .ok_or_else(failed)?
            .to_ascii_lowercase();
        deck_core::caps::office::validate_excel_source(&mut file, length, &extension)?;
    }
    progress("apartment-begin");
    let _apartment = Apartment::enter()?;
    progress("snapshot-begin");
    let existing = crate::native_workers::process_snapshot()?;
    let office_image = if matches!(
        request.format.provider(),
        OfficeProvider::Word | OfficeProvider::Powerpoint
    ) {
        Some(registered_office_image(request.format.provider())?)
    } else {
        None
    };
    if request.format.provider() == OfficeProvider::Powerpoint {
        progress("absence-begin");
        crate::native_workers::require_powerpoint_absent()?;
    }
    let activation_started = std::time::SystemTime::now();
    let mut launched = if request.format.provider() == OfficeProvider::Powerpoint {
        progress("child-begin");
        let image = office_image.as_ref().ok_or_else(failed)?;
        Some(LaunchedOffice::powerpoint(image)?)
    } else {
        None
    };
    progress("activation-begin");
    let app = Dispatch::create(provider_class(request.format.provider())).map_err(|error| {
        launched.as_mut().map_or_else(
            || error.clone(),
            |child| child.annotate_failure(error.clone()),
        )
    })?;
    progress("guards-begin");
    if request.format.provider() == OfficeProvider::Word && boolean(&app.get("UserControl")?)? {
        return Err(failed());
    }
    if request.format.provider() == OfficeProvider::Powerpoint
        && (number(&app.get("Visible")?)? != 0
            || number(&app.get_object("Presentations")?.get("Count")?)? != 0)
    {
        return Err(DeckError::new(
            ErrorCode::Busy,
            "사용 중인 PowerPoint를 바꾸지 않았어요. 직접 변환하거나 프로그램을 닫은 뒤 다시 시도해 주세요.",
        ));
    }
    if let Some(image) = office_image.as_ref() {
        progress("image-bind-begin");
        // Word SingleUse activation creates its own server. PowerPoint MultiUse additionally
        // requires the exact live Child handle we launched; a concurrent server fails closed.
        crate::native_workers::bind_new_office_process(
            &request.job_name,
            &existing,
            activation_started,
            image,
            launched
                .as_mut()
                .map(LaunchedOffice::live_pid)
                .transpose()?,
        )?;
    } else {
        progress("window-bind-begin");
        let hwnd = match request.format.provider() {
            OfficeProvider::Hancom => {
                let windows = app.get_object("XHwpWindows")?;
                let window = windows.method_object("Item", vec![0i32.into()])?;
                number(&window.get("WindowHandle")?)?
            }
            OfficeProvider::Word | OfficeProvider::Powerpoint => app
                .get("HWND")
                .and_then(|v| number(&v))
                .or_else(|_| app.ole_window())
                .or_else(|_| app.command_bar_window())?,
            OfficeProvider::Excel => number(&app.get("Hwnd")?)?,
        };
        // A reused pre-existing process is never entered, Quit, or terminated.
        crate::native_workers::bind_office_process(&request.job_name, hwnd, &existing)?;
    }
    let instance = OfficeInstance {
        app,
        provider: request.format.provider(),
    };
    let source = request.source.to_str().ok_or_else(failed)?;
    let output = request.output.to_str().ok_or_else(failed)?;
    progress("secure-options-begin");
    match instance.provider {
        OfficeProvider::Excel => {
            instance.app.put("AutomationSecurity", 3i32.into())?;
            instance.app.put("EnableEvents", false.into())?;
            instance.app.put("DisplayAlerts", false.into())?;
            instance.app.put("AskToUpdateLinks", false.into())?;
            let books = instance.app.get_object("Workbooks")?;
            let open = |path: &str| {
                books.method_object(
                    "Open",
                    vec![
                        path.into(),
                        0i32.into(),
                        true.into(),
                        missing(),
                        "".into(),
                        "".into(),
                        true.into(),
                        missing(),
                        missing(),
                        false.into(),
                        false.into(),
                        missing(),
                        false.into(),
                        false.into(),
                        0i32.into(),
                    ],
                )
            };
            let book = open(source)?;
            if number(&book.get_object("Excel4MacroSheets")?.get("Count")?)? > 0
                || number(&book.get_object("Excel4IntlMacroSheets")?.get("Count")?)? > 0
            {
                let _ = book.invoke("Close", vec![false.into()]);
                return Err(DeckError::new(
                    ErrorCode::InvalidArgs,
                    "Excel 4.0 매크로 문서는 직접 확인해 주세요.",
                ));
            }
            if boolean(&book.get("HasVBProject")?)? && !request.format.retains_macros() {
                let _ = book.invoke("Close", vec![false.into()]);
                return Err(DeckError::new(
                    ErrorCode::InvalidArgs,
                    "매크로를 보존하는 XLSM 형식을 선택해 주세요.",
                ));
            }
            book.invoke(
                "SaveAs",
                vec![
                    output.into(),
                    (if request.format == OfficeFormat::Xlsm {
                        52i32
                    } else {
                        51i32
                    })
                    .into(),
                ],
            )?;
            book.invoke("Close", vec![false.into()])?;
            let check = open(output)?;
            check.get_object("Worksheets")?.get("Count")?;
            check.invoke("Close", vec![false.into()])?;
        }
        OfficeProvider::Word => {
            instance.app.put("AutomationSecurity", 3i32.into())?;
            instance.app.put("DisplayAlerts", 0i32.into())?;
            instance
                .app
                .get_object("Options")?
                .put("UpdateLinksAtOpen", false.into())?;
            let documents = instance.app.get_object("Documents")?;
            let open = |path: &str| {
                documents.method_object(
                    "Open",
                    vec![
                        path.into(),
                        false.into(),
                        true.into(),
                        false.into(),
                        "".into(),
                        "".into(),
                        false.into(),
                        "".into(),
                        "".into(),
                        missing(),
                        missing(),
                        false.into(),
                        false.into(),
                        missing(),
                        true.into(),
                        missing(),
                    ],
                )
            };
            let document = open(source)?;
            if boolean(&document.get("HasVBProject")?)? && !request.format.retains_macros() {
                let _ = document.invoke("Close", vec![0i32.into()]);
                return Err(DeckError::new(
                    ErrorCode::InvalidArgs,
                    "매크로를 보존하는 DOCM 형식을 선택해 주세요.",
                ));
            }
            document.invoke(
                "SaveAs2",
                vec![
                    output.into(),
                    (if request.format == OfficeFormat::Docm {
                        13i32
                    } else {
                        12i32
                    })
                    .into(),
                ],
            )?;
            document.invoke("Close", vec![0i32.into()])?;
            let check = open(output)?;
            check.get_object("Content")?.get("Text")?;
            check.invoke("Close", vec![0i32.into()])?;
        }
        OfficeProvider::Powerpoint => {
            instance.app.put("AutomationSecurity", 3i32.into())?;
            instance.app.put("DisplayAlerts", 1i32.into())?;
            let presentations = instance.app.get_object("Presentations")?;
            let open = |path: &str| {
                presentations.method_object(
                    "Open",
                    vec![path.into(), (-1i32).into(), 0i32.into(), 0i32.into()],
                )
            };
            progress("source-open-begin");
            let presentation = open(source)?;
            progress("macro-check-begin");
            if boolean(&presentation.get("HasVBProject")?)? && !request.format.retains_macros() {
                let _ = presentation.invoke("Close", vec![]);
                return Err(DeckError::new(
                    ErrorCode::InvalidArgs,
                    "매크로를 보존하는 PPTM 형식을 선택해 주세요.",
                ));
            }
            progress("save-begin");
            presentation.invoke(
                "SaveAs",
                vec![
                    output.into(),
                    (if request.format == OfficeFormat::Pptm {
                        25i32
                    } else {
                        24i32
                    })
                    .into(),
                ],
            )?;
            progress("source-close-begin");
            presentation.invoke("Close", vec![])?;
            progress("output-open-begin");
            let check = open(output)?;
            progress("output-check-begin");
            check.get_object("Slides")?.get("Count")?;
            check.invoke("Close", vec![])?;
        }
        OfficeProvider::Hancom => {
            // Ownership was verified above. Show only this worker's edit window so the
            // normal file-access approval dialog can be handled by the user.
            progress("hancom-visible-begin");
            instance
                .app
                .get_object("XHwpWindows")?
                .method_object("Item", vec![0i32.into()])?
                .put("Visible", true.into())?;
            progress("hancom-open-begin");
            if !boolean(&instance.app.invoke(
                "Open",
                vec![
                    source.into(),
                    "".into(),
                    "forceopen:true;readonly:true".into(),
                ],
            )?)? {
                return Err(failed());
            }
            progress("hancom-save-begin");
            if !boolean(
                &instance
                    .app
                    .invoke("SaveAs", vec![output.into(), "HWPX".into(), "".into()])?,
            )? {
                return Err(failed());
            }
            instance.app.invoke("Clear", vec![1i32.into()])?;
            progress("hancom-reopen-begin");
            if !boolean(&instance.app.invoke(
                "Open",
                vec![output.into(), "HWPX".into(), "readonly:true".into()],
            )?)? {
                return Err(failed());
            }
            instance.app.invoke("Clear", vec![1i32.into()])?;
        }
    }
    progress("complete");
    Ok(())
}
#[cfg(not(windows))]
pub(crate) fn convert(_request: &crate::native_workers::OfficeJob) -> Result<(), DeckError> {
    Err(failed())
}
