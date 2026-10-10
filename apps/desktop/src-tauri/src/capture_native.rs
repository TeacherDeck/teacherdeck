// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Safe Windows capture adapter; all coordinates are physical pixels.
use deck_core::{DeckError, ErrorCode};
#[cfg(windows)]
use image::{ImageEncoder, Rgba, RgbaImage};
/// Bounded encoded frame; bytes remain inside the host.
pub struct Frame {
    /// PNG or JPEG encoded bytes.
    pub bytes: Vec<u8>,
    /// Physical width.
    pub width: u32,
    /// Physical height.
    pub height: u32,
}
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "캡처 영역이나 설정이 올바르지 않아요.",
    )
}
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "화면을 캡처할 수 없어요. 화면 상태를 확인해 주세요.",
    )
}
/// Enforces allocation and coordinate limits before OS allocation.
pub fn validate_rect(x: i32, y: i32, width: u32, height: u32) -> Result<(), DeckError> {
    if width < 5
        || height < 5
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > 32_000_000
    {
        return Err(invalid());
    }
    i64::from(x)
        .checked_add(i64::from(width))
        .filter(|v| *v <= i64::from(i32::MAX))
        .ok_or_else(invalid)?;
    i64::from(y)
        .checked_add(i64::from(height))
        .filter(|v| *v <= i64::from(i32::MAX))
        .ok_or_else(invalid)?;
    Ok(())
}
#[cfg(windows)]
struct BoundedBytes(Vec<u8>);
#[cfg(windows)]
impl std::io::Write for BoundedBytes {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(buf.len()) > 128 * 1024 * 1024 {
            return Err(std::io::Error::other("encoded frame exceeds limit"));
        }
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
/// Captures per-monitor intersections without allocating a whole desktop bitmap.
#[cfg(windows)]
pub fn capture(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    jpeg: bool,
    quality: u8,
) -> Result<Frame, DeckError> {
    validate_rect(x, y, width, height)?;
    if !(1..=100).contains(&quality) {
        return Err(invalid());
    }
    let mut composite = RgbaImage::from_pixel(width, height, Rgba([255, 255, 255, 255]));
    let mut touched = false;
    for monitor in xcap::Monitor::all().map_err(|_| unavailable())? {
        let mx = monitor.x().map_err(|_| unavailable())?;
        let my = monitor.y().map_err(|_| unavailable())?;
        let mw = monitor.width().map_err(|_| unavailable())?;
        let mh = monitor.height().map_err(|_| unavailable())?;
        let left = i64::from(x).max(i64::from(mx));
        let top = i64::from(y).max(i64::from(my));
        let right = (i64::from(x) + i64::from(width)).min(i64::from(mx) + i64::from(mw));
        let bottom = (i64::from(y) + i64::from(height)).min(i64::from(my) + i64::from(mh));
        if left >= right || top >= bottom {
            continue;
        }
        let cv = |v: i64| u32::try_from(v).map_err(|_| invalid());
        let frame = monitor
            .capture_region(
                cv(left - i64::from(mx))?,
                cv(top - i64::from(my))?,
                cv(right - left)?,
                cv(bottom - top)?,
            )
            .map_err(|_| unavailable())?;
        if frame.width() != cv(right - left)? || frame.height() != cv(bottom - top)? {
            return Err(unavailable());
        }
        image::imageops::replace(
            &mut composite,
            &frame,
            left - i64::from(x),
            top - i64::from(y),
        );
        touched = true;
    }
    if !touched {
        return Err(invalid());
    }
    let mut output = BoundedBytes(Vec::new());
    if jpeg {
        let rgb = image::DynamicImage::ImageRgba8(composite).into_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, quality)
            .encode(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .map_err(|_| unavailable())?;
    } else {
        image::codecs::png::PngEncoder::new(&mut output)
            .write_image(
                composite.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|_| unavailable())?;
    }
    Ok(Frame {
        bytes: output.0,
        width,
        height,
    })
}
/// Windows-only functionality is never emulated by external services.
#[cfg(not(windows))]
pub fn capture(
    _x: i32,
    _y: i32,
    _width: u32,
    _height: u32,
    _jpeg: bool,
    _quality: u8,
) -> Result<Frame, DeckError> {
    Err(unavailable())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_oversized_and_overflow_accepts_negative_origins() {
        assert!(validate_rect(-1920, -200, 1920, 1080).is_ok());
        for (x, y, w, h) in [
            (0, 0, 4, 10),
            (0, 0, 16385, 10),
            (0, 0, 8000, 8000),
            (i32::MAX, 0, 5, 5),
            (0, i32::MAX, 5, 5),
        ] {
            assert!(validate_rect(x, y, w, h).is_err());
        }
    }
}
