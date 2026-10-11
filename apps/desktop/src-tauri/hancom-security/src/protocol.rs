// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Bounded private protocol shared by the host and its Hancom callback.
#![forbid(unsafe_code)]
pub(crate) const MAX_UNITS: usize = 2048;
pub(crate) const MAX_FRAME: usize = 4 + MAX_UNITS * 2;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Endpoint {
    pub(crate) token: String,
    pub(crate) worker_pid: u32,
}
impl Endpoint {
    pub(crate) fn from_filename(name: &str) -> Option<Self> {
        let mut parts = name
            .strip_prefix("tdhwp-")?
            .strip_suffix(".dll")?
            .split('-');
        let token = parts.next()?;
        let worker = parts.next()?;
        if parts.next().is_some() || !valid_token(token) {
            return None;
        }
        let parse_pid = |s: &str| {
            if s.is_empty() || s.starts_with('0') || !s.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            s.parse::<u32>().ok().filter(|p| *p != 0)
        };
        Some(Self {
            token: token.into(),
            worker_pid: parse_pid(worker)?,
        })
    }
    pub(crate) fn pipe_name(&self) -> String {
        format!("\\\\.\\pipe\\TeacherDeck-Hwp-{}", self.token)
    }
    pub(crate) fn filename(&self) -> String {
        format!("tdhwp-{}-{}.dll", self.token, self.worker_pid)
    }
}
pub(crate) fn valid_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub(crate) fn local_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    if path.encode_utf16().count() > MAX_UNITS
        || !bytes.first().is_some_and(u8::is_ascii_alphabetic)
        || bytes.get(1) != Some(&b':')
        || bytes.get(2) != Some(&b'\\')
        || path
            .chars()
            .skip(2)
            .any(|c| c == ':' || c == '/' || c.is_control())
    {
        return false;
    }
    path.get(3..).is_some_and(|rest| {
        !rest.is_empty()
            && rest.split('\\').all(|part| {
                !part.is_empty()
                    && part != "."
                    && part != ".."
                    && !part.ends_with(['.', ' '])
                    && !part.contains(['<', '>', '"', '|', '?', '*'])
            })
    })
}
pub(crate) fn encode_path(path: &str) -> Option<Vec<u8>> {
    if !local_path(path) {
        return None;
    }
    let units: Vec<_> = path.encode_utf16().collect();
    let mut frame = Vec::with_capacity(4 + units.len() * 2);
    frame.extend_from_slice(&u32::try_from(units.len()).ok()?.to_le_bytes());
    for unit in units {
        frame.extend_from_slice(&unit.to_le_bytes());
    }
    Some(frame)
}
pub(crate) fn decode_path(frame: &[u8]) -> Option<String> {
    let length = u32::from_le_bytes(frame.get(..4)?.try_into().ok()?) as usize;
    if length == 0 || length > MAX_UNITS || frame.len() != 4 + length * 2 {
        return None;
    }
    let units: Vec<_> = frame
        .get(4..)?
        .as_chunks::<2>()
        .0
        .iter()
        .map(|[lo, hi]| u16::from_le_bytes([*lo, *hi]))
        .collect();
    let path = String::from_utf16(&units).ok()?;
    local_path(&path).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_endpoint_and_nonzero_processes_only() {
        let token = "0123456789abcdef0123456789abcdef";
        let endpoint = Endpoint::from_filename(&format!("tdhwp-{token}-123.dll")).unwrap();
        assert_eq!(
            Endpoint::from_filename(&endpoint.filename()),
            Some(endpoint)
        );
        for name in [
            format!("tdhwp-{token}-0.dll"),
            format!("tdhwp-{token}-01.dll"),
            format!("tdhwp-{token}-1.dll.bak"),
            format!("tdhwp-{token}-1-2.dll"),
            format!("tdhwp-{}-1.dll", token.to_uppercase()),
            format!("tdhwp-{token}-4294967296.dll"),
        ] {
            assert!(Endpoint::from_filename(&name).is_none());
        }
    }
    #[test]
    fn bounded_frame_roundtrip_and_ambiguous_paths_rejected() {
        for path in [r"C:\synthetic\source.hwp", r"D:\합성 자료\converted.hwpx"] {
            assert_eq!(decode_path(&encode_path(path).unwrap()), Some(path.into()));
        }
        for path in [
            r"relative.hwp",
            r"\\server\share\source.hwp",
            r"\\?\C:\source.hwp",
            r"C:\synthetic\..\source.hwp",
            r"C:\synthetic\.\source.hwp",
            r"C:\synthetic\source.hwp:ads",
            r"C:\synthetic\\source.hwp",
            r"C:/synthetic/source.hwp",
            r"C:\synthetic\source.hwp.",
            r"C:\synthetic\source.hwp ",
            "C:\\synthetic\\nul\0.hwp",
        ] {
            assert!(encode_path(path).is_none(), "{path:?}");
        }
        let frame = encode_path(r"C:\synthetic\source.hwp").unwrap();
        assert!(decode_path(&frame[..frame.len() - 1]).is_none());
        let mut trailing = frame.clone();
        trailing.push(0);
        assert!(decode_path(&trailing).is_none());
        let mut huge = frame;
        huge[..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode_path(&huge).is_none());
        assert!(decode_path(&[1, 0, 0, 0, 0, 216]).is_none());
        assert!(encode_path(&format!("C:\\{}", "a".repeat(MAX_UNITS))).is_none());
    }
}
