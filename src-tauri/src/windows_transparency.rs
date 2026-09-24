use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
};
use windows::Win32::Graphics::Gdi::{
    CreateRectRgn, DeleteObject, RedrawWindow, RDW_ALLCHILDREN, RDW_FRAME, RDW_INVALIDATE,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    WM_DISPLAYCHANGE, WM_DPICHANGED, WM_DWMCOMPOSITIONCHANGED, WM_ERASEBKGND, WM_NCDESTROY,
};

const SUBCLASS_ID: usize = 0x49564c59;

// Call only on the HWND's owning thread. A stable callback/id pair updates the
// existing subclass, so repeated focus/page-load repairs do not stack handlers.
pub(crate) fn install_transparency_recovery(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if !SetWindowSubclass(hwnd, Some(transparency_subclass), SUBCLASS_ID, 0).as_bool() {
            return Err("Failed to install overlay transparency recovery".into());
        }
    }
    restore_windows_alpha_composition(hwnd)
}

unsafe extern "system" fn transparency_subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    _data: usize,
) -> LRESULT {
    if message == WM_ERASEBKGND {
        // Tao's GDI background brush ignores alpha, even for Color(0,0,0,0).
        // This HWND is exclusively the transparent overlay: let WebView2 paint
        // it instead of filling the margins with an opaque native color.
        return LRESULT(1);
    }
    if message == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(transparency_subclass), subclass_id);
        return DefSubclassProc(hwnd, message, wparam, lparam);
    }

    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if matches!(
        message,
        WM_DWMCOMPOSITIONCHANGED | WM_DISPLAYCHANGE | WM_DPICHANGED
    ) {
        // A locked, unfocused overlay may never receive a Tauri focus/theme
        // event after DWM or a monitor restarts. Recover on the native message,
        // after the normal window procedure has finished any size/DPI changes.
        if let Err(error) = restore_windows_alpha_composition(hwnd) {
            eprintln!("Failed to restore overlay composition after display change: {error}");
        }
        let _ = RedrawWindow(
            hwnd,
            None,
            None,
            RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_FRAME,
        );
    }
    result
}

pub(crate) fn restore_windows_alpha_composition(hwnd: HWND) -> Result<(), String> {
    // Match Tao's transparent-window setup. The caller owns this region even
    // when DWM rejects the request; WebView2 keeps control of per-pixel alpha.
    unsafe {
        let region = CreateRectRgn(0, 0, -1, -1);
        if region.0.is_null() {
            return Err("Failed to allocate the transparent window region".into());
        }
        let blur = DWM_BLURBEHIND {
            dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
            fEnable: true.into(),
            hRgnBlur: region,
            fTransitionOnMaximized: false.into(),
        };
        let result = DwmEnableBlurBehindWindow(hwnd, &blur);
        let _ = DeleteObject(region);
        result.map_err(|error| error.to_string())
    }
}
