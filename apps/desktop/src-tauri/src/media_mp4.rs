// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Bounded ISO-BMFF structure check; both video and audio tracks are required.
use crate::file_read::FileReadSession;
use crate::media_worker::failure;
use deck_core::DeckError;

struct Check {
    boxes: usize,
    video: bool,
    audio: bool,
    ftyp: bool,
    mdat: bool,
    moov: bool,
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, DeckError> {
    Ok(u32::from_be_bytes(
        bytes
            .get(offset..offset + 4)
            .ok_or_else(failure)?
            .try_into()
            .map_err(|_| failure())?,
    ))
}
fn scan(
    file: &mut FileReadSession,
    begin: u64,
    end: u64,
    depth: u8,
    check: &mut Check,
) -> Result<(), DeckError> {
    let mut offset = begin;
    while offset < end {
        check.boxes += 1;
        if check.boxes > 8192 || end - offset < 8 {
            return Err(failure());
        }
        let header = file.read_chunk(offset, 8)?;
        let kind = header.get(4..8).ok_or_else(failure)?;
        let short = u32_at(&header, 0)?;
        let (size, length) = match short {
            0 => (end - offset, 8),
            1 => {
                if end - offset < 16 {
                    return Err(failure());
                }
                let bytes = file.read_chunk(offset + 8, 8)?;
                (
                    u64::from_be_bytes(bytes.as_slice().try_into().map_err(|_| failure())?),
                    16,
                )
            }
            n => (u64::from(n), 8),
        };
        let next = offset.checked_add(size).ok_or_else(failure)?;
        if size < length || next > end {
            return Err(failure());
        }
        let payload = offset + length;
        if depth == 0 && kind == b"ftyp" {
            if check.ftyp || size - length < 8 || size - length > 4096 {
                return Err(failure());
            }
            let bytes = file.read_chunk(
                payload,
                usize::try_from(size - length).map_err(|_| failure())?,
            )?;
            let major = bytes.get(..4).ok_or_else(failure)?;
            if ![
                b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"dash", b"M4V ",
            ]
            .iter()
            .any(|brand| major == *brand)
            {
                return Err(failure());
            }
            check.ftyp = true;
        } else if depth == 0 && kind == b"mdat" {
            check.mdat |= size > length;
        } else if (depth == 0 && kind == b"moov")
            || (depth == 1 && kind == b"trak")
            || (depth == 2 && kind == b"mdia")
        {
            if depth == 0 {
                if check.moov {
                    return Err(failure());
                }
                check.moov = true;
            }
            scan(file, payload, next, depth + 1, check)?;
        } else if depth == 3 && kind == b"hdlr" {
            if size - length < 12 {
                return Err(failure());
            }
            let bytes = file.read_chunk(payload + 8, 4)?;
            check.video |= bytes == b"vide";
            check.audio |= bytes == b"soun";
        }
        offset = next;
    }
    Ok(())
}
/// Validate a pinned completed file without decoder plugins or reading unbounded metadata.
pub(crate) fn validate(file: &mut FileReadSession) -> Result<(), DeckError> {
    let mut check = Check {
        boxes: 0,
        video: false,
        audio: false,
        ftyp: false,
        mdat: false,
        moov: false,
    };
    scan(file, 0, file.size(), 0, &mut check)?;
    if !(check.ftyp && check.mdat && check.moov && check.video && check.audio) {
        return Err(failure());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn boxed(kind: &[u8], data: &[u8]) -> Vec<u8> {
        let mut result = ((data.len() + 8) as u32).to_be_bytes().to_vec();
        result.extend(kind);
        result.extend(data);
        result
    }
    fn track(kind: &[u8]) -> Vec<u8> {
        let mut payload = vec![0; 8];
        payload.extend(kind);
        boxed(b"trak", &boxed(b"mdia", &boxed(b"hdlr", &payload)))
    }
    #[test]
    fn combined_tracks_required_and_malformed_offsets_rejected() {
        let mut token = [0; 16];
        getrandom::fill(&mut token).unwrap();
        let root = std::env::temp_dir().join(format!(
            "deck-media-mp4-{}",
            deck_core::util::to_hex(&token)
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("synthetic.mp4");
        let mut good = boxed(b"ftyp", b"isom\0\0\0\0isom");
        good.extend(boxed(b"mdat", b"synthetic"));
        let mut tracks = track(b"vide");
        tracks.extend(track(b"soun"));
        good.extend(boxed(b"moov", &tracks));
        std::fs::write(&path, &good).unwrap();
        assert!(validate(&mut FileReadSession::open(&path).unwrap()).is_ok());
        let mut no_audio = boxed(b"ftyp", b"isom\0\0\0\0");
        no_audio.extend(boxed(b"mdat", b"data"));
        no_audio.extend(boxed(b"moov", &track(b"vide")));
        for bad in [
            no_audio,
            vec![0xff; 8],
            [good.as_slice(), b"x"].concat(),
            boxed(b"ftyp", b"bad!\0\0\0\0"),
        ] {
            std::fs::write(&path, bad).unwrap();
            assert!(validate(&mut FileReadSession::open(&path).unwrap()).is_err());
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
