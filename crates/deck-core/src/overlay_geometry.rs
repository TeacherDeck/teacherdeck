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
/// Minimum usable toolbar width; matches the shared capture toolbar token.
pub const TOOLBAR_MIN_DIP: f64 = 300.0;
/// Places one transparent window around exact capture pixels and an accessible toolbar.
pub fn layout(
    rect: &PhysicalRect,
    border: u8,
    scale: f64,
    display: &PhysicalRect,
) -> Result<(PhysicalRect, crate::caps::overlay::OverlayUiLayout), DeckError> {
    let region = to_window(rect, border, scale)?;
    let band = toolbar(scale)?;
    let inset = i64::from(border);
    let display_right = i64::from(display.x) + i64::from(display.width);
    let display_bottom = i64::from(display.y) + i64::from(display.height);
    let width = ((TOOLBAR_MIN_DIP * scale).ceil() as u32).min(display.width);
    if width == 0 || display.height < band {
        return Err(invalid());
    }
    let toolbar_x = (i64::from(rect.x) + i64::from(rect.width) + inset - i64::from(width))
        .clamp(i64::from(display.x), display_right - i64::from(width));
    let above = i64::from(rect.y) - inset - i64::from(band);
    let below = i64::from(rect.y) + i64::from(rect.height) + inset;
    let toolbar_y = if above >= i64::from(display.y) {
        above.min(display_bottom - i64::from(band))
    } else {
        below.clamp(i64::from(display.y), display_bottom - i64::from(band))
    };
    let region_x = i64::from(rect.x) - inset;
    let region_y = i64::from(rect.y) - inset;
    let x = region_x.min(toolbar_x);
    let y = region_y.min(toolbar_y);
    let right = (region_x + i64::from(region.width)).max(toolbar_x + i64::from(width));
    let bottom = (region_y + i64::from(rect.height) + inset * 2).max(toolbar_y + i64::from(band));
    let window = PhysicalRect {
        x: i32::try_from(x).map_err(|_| invalid())?,
        y: i32::try_from(y).map_err(|_| invalid())?,
        width: u32::try_from(right - x).map_err(|_| invalid())?,
        height: u32::try_from(bottom - y).map_err(|_| invalid())?,
    };
    Ok((
        window,
        crate::caps::overlay::OverlayUiLayout {
            region: PhysicalRect {
                x: i32::try_from(region_x - x).map_err(|_| invalid())?,
                y: i32::try_from(region_y - y).map_err(|_| invalid())?,
                width: region.width,
                height: rect.height + u32::from(border) * 2,
            },
            toolbar: PhysicalRect {
                x: i32::try_from(toolbar_x - x).map_err(|_| invalid())?,
                y: i32::try_from(toolbar_y - y).map_err(|_| invalid())?,
                width,
                height: band,
            },
            scale,
        },
    ))
}
/// Native movement/resize changes only the captured pixels; auxiliary padding is retained.
pub fn changed(
    previous_window: &PhysicalRect,
    previous: &crate::caps::overlay::OverlayUiLayout,
    current_window: &PhysicalRect,
    border: u8,
    scale: f64,
) -> Result<PhysicalRect, DeckError> {
    toolbar(scale)?;
    let border = u32::from(border);
    let width_padding = previous_window
        .width
        .checked_sub(previous.region.width)
        .ok_or_else(invalid)?;
    let height_padding = previous_window
        .height
        .checked_sub(previous.region.height)
        .ok_or_else(invalid)?;
    // Windows can resize the outer DIP window automatically on a DPI transition.
    // That changes the control layout, not the physical capture dimensions.
    let current_window = if scale != previous.scale {
        PhysicalRect {
            width: previous_window.width,
            height: previous_window.height,
            ..current_window.clone()
        }
    } else {
        current_window.clone()
    };
    let rect = PhysicalRect {
        x: i32::try_from(
            i64::from(current_window.x) + i64::from(previous.region.x) + i64::from(border),
        )
        .map_err(|_| invalid())?,
        y: i32::try_from(
            i64::from(current_window.y) + i64::from(previous.region.y) + i64::from(border),
        )
        .map_err(|_| invalid())?,
        width: current_window
            .width
            .checked_sub(width_padding)
            .and_then(|n| n.checked_sub(border * 2))
            .ok_or_else(invalid)?,
        height: current_window
            .height
            .checked_sub(height_padding)
            .and_then(|n| n.checked_sub(border * 2))
            .ok_or_else(invalid)?,
    };
    crate::caps::capture::validate_rect(&rect)?;
    Ok(rect)
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
    fn toolbar_stays_on_screen_without_changing_tiny_top_edge_capture() {
        for scale in [1.0, 1.1, 1.5, 2.0] {
            let display = PhysicalRect {
                x: -1920,
                y: -1080,
                width: 1920,
                height: 1080,
            };
            for x in [-1920, -5] {
                let capture = PhysicalRect {
                    x,
                    y: -1080,
                    width: 5,
                    height: 5,
                };
                let (window, ui) = layout(&capture, 4, scale, &display).unwrap();
                assert_eq!(changed(&window, &ui, &window, 4, scale).unwrap(), capture);
                assert!(window.x + ui.toolbar.x >= display.x);
                assert!(window.y + ui.toolbar.y >= display.y);
                assert!(
                    i64::from(window.x) + i64::from(ui.toolbar.x) + i64::from(ui.toolbar.width)
                        <= 0
                );
                assert_eq!(ui.toolbar.width, (TOOLBAR_MIN_DIP * scale).ceil() as u32);
                assert_eq!(ui.region.width, 13);
                assert!(ui.toolbar.y >= ui.region.y + ui.region.height as i32);
            }
        }
    }
    #[test]
    fn native_move_resize_preserves_auxiliary_padding_and_exact_capture_coordinates() {
        let display = PhysicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let capture = PhysicalRect {
            x: 0,
            y: 0,
            width: 5,
            height: 5,
        };
        let (window, ui) = layout(&capture, 4, 2.0, &display).unwrap();
        let mut moved = window.clone();
        moved.x += 30;
        moved.y += 50;
        moved.width += 10;
        moved.height += 20;
        assert_eq!(
            changed(&window, &ui, &moved, 4, 2.0).unwrap(),
            PhysicalRect {
                x: 30,
                y: 50,
                width: 15,
                height: 25
            }
        );
        moved.width = 1;
        assert!(changed(&window, &ui, &moved, 4, 2.0).is_err());
    }
    #[test]
    fn dpi_transition_does_not_scale_actual_capture_pixels() {
        let display = PhysicalRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let capture = PhysicalRect {
            x: -1800,
            y: 0,
            width: 5,
            height: 5,
        };
        let (window, ui) = layout(&capture, 4, 1.0, &display).unwrap();
        let mut scaled = window.clone();
        scaled.width *= 2;
        scaled.height *= 2;
        assert_eq!(changed(&window, &ui, &scaled, 4, 2.0).unwrap(), capture);
        let (new_window, new_ui) = layout(&capture, 4, 2.0, &display).unwrap();
        assert_eq!(
            changed(&new_window, &new_ui, &new_window, 4, 2.0).unwrap(),
            capture
        );
    }
    #[test]
    fn full_screen_capture_keeps_toolbar_within_display() {
        let scale = 2.0;
        let capture = PhysicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let (window, ui) = layout(&capture, 4, 2.0, &capture).unwrap();
        assert_eq!(changed(&window, &ui, &window, 4, scale).unwrap(), capture);
        assert!(window.y + ui.toolbar.y >= 0);
        assert!(window.y + ui.toolbar.y + ui.toolbar.height as i32 <= 1080);
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
