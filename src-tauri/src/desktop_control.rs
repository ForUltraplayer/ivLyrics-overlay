// @file desktop_control.rs
// @brief Validate an in-memory playback pairing from Spotify to its fixed loopback helper.
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
pub struct PlaybackControlBounds {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl PlaybackControlBounds {
    pub fn valid(&self) -> bool {
        [self.left, self.top, self.width, self.height].iter().all(|v| v.is_finite() && v.abs() <= 100_000.0)
            && self.left >= 0.0 && self.top >= 0.0 && self.width > 0.0 && self.height > 0.0
    }
    pub fn contains_physical(&self, x: f64, y: f64, scale: f64) -> bool {
        self.valid() && scale.is_finite() && scale > 0.0
            && x / scale >= self.left && x / scale < self.left + self.width
            && y / scale >= self.top && y / scale < self.top + self.height
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackControlConfig {
    pub bridge_url: String,
    pub token: String,
    pub expires_at: u64,
}

impl std::fmt::Debug for PlaybackControlConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("PlaybackControlConfig").field("bridge_url", &self.bridge_url)
            .field("token", &"[redacted]").field("expires_at", &self.expires_at).finish()
    }
}

impl PlaybackControlConfig {
    pub fn valid_at(&self, now_ms: u64) -> bool {
        self.bridge_url == "http://127.0.0.1:19643"
            && (32..=256).contains(&self.token.len())
            && self.token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            && self.expires_at > now_ms
            && self.expires_at <= now_ms.saturating_add(86_400_000)
    }
}

#[cfg(test)]
mod tests {
    use super::PlaybackControlConfig;
    #[test]
    fn only_live_fixed_loopback_pairing_is_accepted() {
        let mut value = PlaybackControlConfig { bridge_url: "http://127.0.0.1:19643".into(), token: "x".repeat(43), expires_at: 2000 };
        assert!(value.valid_at(1000));
        value.bridge_url = "https://external.example".into(); assert!(!value.valid_at(1000));
        value.bridge_url = "http://127.0.0.1:19643".into(); value.token = "short".into(); assert!(!value.valid_at(1000));
        value.token = "x".repeat(43); value.expires_at = 999; assert!(!value.valid_at(1000));
        assert!(!format!("{:?}", value).contains(&"x".repeat(43)));
    }
    #[test]
    fn locked_hit_test_is_limited_to_the_scaled_toolbar_rectangle() {
        let bounds = super::PlaybackControlBounds { left: 180.0, top: 146.0, width: 140.0, height: 46.0 };
        for scale in [1.0, 1.25, 1.5, 2.0] {
            assert!(bounds.contains_physical(200.0 * scale, 160.0 * scale, scale));
            assert!(!bounds.contains_physical(100.0 * scale, 160.0 * scale, scale));
            assert!(!bounds.contains_physical(320.0 * scale, 160.0 * scale, scale));
            assert!(!bounds.contains_physical(200.0 * scale, 192.0 * scale, scale));
        }
        assert!(!bounds.contains_physical(200.0, 160.0, 0.0));
        let invalid = super::PlaybackControlBounds { width: f64::NAN, ..bounds };
        assert!(!invalid.valid());
    }
}
