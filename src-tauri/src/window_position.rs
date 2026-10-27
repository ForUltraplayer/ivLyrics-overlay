// @file window_position.rs
// @author: ForUltraplayer
// @brief Move the existing lyric window by logical pixels within its current monitor work area.

#[derive(Clone, Copy)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn larger_height(height: u32, area_height: u32, scale: f64) -> Result<u32, String> {
    if !scale.is_finite() || scale <= 0.0 { return Err("Invalid monitor scale".into()); }
    // An explicit grow action never shrinks an already oversized window.
    Ok(height.saturating_add((48.0 * scale).round() as u32).min(area_height).max(height))
}

pub fn next_position(
    position: (i32, i32),
    size: (u32, u32),
    area: WorkArea,
    scale: f64,
    action: &str,
) -> Result<(i32, i32), String> {
    if !scale.is_finite() || scale <= 0.0 || area.width == 0 || area.height == 0 {
        return Err("Invalid monitor geometry".into());
    }
    let step = (32.0 * scale).round() as i64;
    let (x, y) = (i64::from(position.0), i64::from(position.1));
    let (x, y) = match action {
        "left" => (x - step, y),
        "right" => (x + step, y),
        "up" => (x, y - step),
        "down" => (x, y + step),
        "stay" => (x, y),
        "reset" => (
            i64::from(area.x) + (100.0 * scale).round() as i64,
            i64::from(area.y) + (100.0 * scale).round() as i64,
        ),
        _ => return Err("Unsupported window position action".into()),
    };
    // Oversized windows keep their top-left corner reachable rather than creating an invalid clamp range.
    let left = i64::from(area.x);
    let top = i64::from(area.y);
    let right = left + i64::from(area.width.saturating_sub(size.0));
    let bottom = top + i64::from(area.height.saturating_sub(size.1));
    Ok((
        x.clamp(left, right).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y.clamp(top, bottom).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> WorkArea { WorkArea { x: 0, y: 0, width: 1920, height: 1040 } }

    #[test]
    fn moves_by_logical_pixels_at_different_scales() {
        assert_eq!(next_position((100, 100), (500, 200), area(), 1.0, "down").unwrap(), (100, 132));
        assert_eq!(next_position((100, 100), (500, 200), area(), 1.5, "down").unwrap(), (100, 148));
        assert_eq!(next_position((100, 100), (500, 200), area(), 2.0, "left").unwrap(), (36, 100));
    }

    #[test]
    fn cannot_move_beyond_monitor_work_area() {
        assert_eq!(next_position((1410, 830), (500, 200), area(), 1.0, "down").unwrap(), (1410, 840));
        assert_eq!(next_position((10, 10), (500, 200), area(), 1.0, "left").unwrap(), (0, 10));
    }

    #[test]
    fn resets_on_negative_coordinate_monitor_without_hardcoded_primary_position() {
        let second = WorkArea { x: -2560, y: -400, width: 2560, height: 1400 };
        assert_eq!(next_position((9000, 9000), (500, 200), second, 1.5, "reset").unwrap(), (-2410, -250));
    }

    #[test]
    fn oversized_window_keeps_an_accessible_corner() {
        assert_eq!(next_position((100, 100), (4000, 3000), area(), 1.0, "reset").unwrap(), (0, 0));
    }

    #[test]
    fn rejects_unknown_actions_and_invalid_scale() {
        assert!(next_position((0, 0), (10, 10), area(), 1.0, "arbitrary").is_err());
        assert!(next_position((0, 0), (10, 10), area(), f64::NAN, "down").is_err());
        assert!(next_position((0, 0), (10, 10), area(), 0.0, "down").is_err());
    }

    #[test]
    fn grows_only_by_explicit_request_and_never_shrinks() {
        assert_eq!(larger_height(200, 1040, 1.5).unwrap(), 272);
        assert_eq!(larger_height(1000, 1040, 1.5).unwrap(), 1040);
        assert_eq!(larger_height(1200, 1040, 1.5).unwrap(), 1200);
    }
}
