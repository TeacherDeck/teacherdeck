// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Single-window overlay geometry. Module rects always mean the captured inner pixels.
use crate::caps::capture::PhysicalRect;
use crate::{DeckError, ErrorCode};
/// Logical toolbar band height, matching the original QuickCapture window.
pub const TOOLBAR_DIP: f64 = 36.0;
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "캡처 창의 좌표나 배율이 올바르지 않아요.",
    )
}
fn toolbar(scale: f64) -> Result<u32, DeckError> {
    if !scale.is_finite() || !(0.5..=8.0).contains(&scale) {
        return Err(invalid());
    }
    Ok((TOOLBAR_DIP * scale).ceil() as u32)
}
/// Adds the toolbar and CSS border around the requested captured inner pixels.
pub fn to_window(rect: &PhysicalRect, border: u8, scale: f64) -> Result<PhysicalRect, DeckError> {
    crate::caps::capture::validate_rect(rect)?;
    if !(1..=12).contains(&border) {
        return Err(invalid());
    }
    let inset = u32::from(border);
    let top = toolbar(scale)?;
    Ok(PhysicalRect {
        x: i32::try_from(i64::from(rect.x) - i64::from(inset)).map_err(|_| invalid())?,
        y: i32::try_from(i64::from(rect.y) - i64::from(inset) - i64::from(top))
            .map_err(|_| invalid())?,
        width: rect.width.checked_add(inset * 2).ok_or_else(invalid)?,
        height: rect
            .height
            .checked_add(top)
            .and_then(|h| h.checked_add(inset * 2))
            .ok_or_else(invalid)?,
    })
}
/// Removes the toolbar and border after native move/resize/DPI events.
pub fn from_window(rect: &PhysicalRect, border: u8, scale: f64) -> Result<PhysicalRect, DeckError> {
    if !(1..=12).contains(&border) {
        return Err(invalid());
    }
    let inset = u32::from(border);
    let top = toolbar(scale)?;
    let captured = PhysicalRect {
        x: i32::try_from(i64::from(rect.x) + i64::from(inset)).map_err(|_| invalid())?,
        y: i32::try_from(i64::from(rect.y) + i64::from(inset) + i64::from(top))
            .map_err(|_| invalid())?,
        width: rect.width.checked_sub(inset * 2).ok_or_else(invalid)?,
        height: rect
            .height
            .checked_sub(top)
            .and_then(|h| h.checked_sub(inset * 2))
            .ok_or_else(invalid)?,
    };
    crate::caps::capture::validate_rect(&captured)?;
    Ok(captured)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_capture_rect_round_trips_across_dpi_and_negative_origins() {
        let rect = PhysicalRect {
            x: -1920,
            y: -200,
            width: 600,
            height: 400,
        };
        for scale in [1.0, 1.1, 1.25, 1.5, 1.75, 2.0] {
            for border in [1, 4, 12] {
                let window = to_window(&rect, border, scale).unwrap();
                assert_eq!(from_window(&window, border, scale).unwrap(), rect);
                assert_eq!(window.width, rect.width + u32::from(border) * 2);
                assert_eq!(
                    window.height,
                    rect.height + (36.0 * scale).ceil() as u32 + u32::from(border) * 2
                );
            }
        }
    }
    #[test]
    fn resize_and_move_preserve_inner_pixel_edges() {
        let rect = PhysicalRect {
            x: 300,
            y: 200,
            width: 600,
            height: 400,
        };
        let mut window = to_window(&rect, 4, 1.5).unwrap();
        window.x -= 100;
        window.y += 20;
        window.width += 100;
        window.height -= 50;
        let result = from_window(&window, 4, 1.5).unwrap();
        assert_eq!(
            result,
            PhysicalRect {
                x: 200,
                y: 220,
                width: 700,
                height: 350
            }
        );
    }
    #[test]
    fn invalid_scale_overflow_and_tiny_window_are_rejected() {
        let rect = PhysicalRect {
            x: i32::MIN,
            y: 0,
            width: 5,
            height: 5,
        };
        assert!(to_window(&rect, 4, 1.0).is_err());
        let valid = PhysicalRect {
            x: 0,
            y: 0,
            width: 5,
            height: 5,
        };
        for scale in [f64::NAN, f64::INFINITY, 0.0, 9.0] {
            assert!(to_window(&valid, 4, scale).is_err());
        }
        assert!(from_window(&valid, 4, 1.0).is_err());
        assert!(to_window(&valid, 0, 1.0).is_err());
    }
}
