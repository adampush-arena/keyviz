use std::{path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use super::{state::AppState, window::show_settings_window};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputAccessStatus {
    pub supported: bool,
    pub input_monitoring: bool,
    pub accessibility: bool,
    pub restart_required: bool,
    pub listener_error: Option<String>,
    pub app_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionPane {
    InputMonitoring,
    Accessibility,
}

impl PermissionPane {
    fn url(&self) -> &'static str {
        match self {
            Self::InputMonitoring => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
            }
            Self::Accessibility => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod native {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn CGPreflightListenEventAccess() -> bool;
        pub fn CGRequestListenEventAccess() -> bool;
        pub fn AXIsProcessTrusted() -> u8;
    }
}

pub fn input_monitoring_allowed() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        native::CGPreflightListenEventAccess()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn app_bundle_path(executable: &Path) -> &Path {
    executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        .unwrap_or(executable)
}

#[tauri::command]
pub fn get_input_access_status(app: tauri::AppHandle) -> Result<InputAccessStatus, String> {
    let executable = std::env::current_exe().map_err(|err| err.to_string())?;
    #[cfg(target_os = "macos")]
    let accessibility = unsafe { native::AXIsProcessTrusted() != 0 };
    #[cfg(not(target_os = "macos"))]
    let accessibility = true;
    let input_monitoring = input_monitoring_allowed();
    let state = app.state::<Mutex<AppState>>();
    let state = state.lock().map_err(|err| err.to_string())?;
    Ok(InputAccessStatus {
        supported: cfg!(target_os = "macos"),
        input_monitoring,
        accessibility,
        restart_required: state.restart_required,
        listener_error: state.listener_error.clone(),
        app_path: app_bundle_path(&executable).to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn open_permission_settings(app: tauri::AppHandle, pane: PermissionPane) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("These permission settings are only available on macOS.".into());
    }
    app.opener()
        .open_url(pane.url(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn request_input_monitoring(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if !input_monitoring_allowed() {
        unsafe {
            native::CGRequestListenEventAccess();
        }
    }
    open_permission_settings(app, PermissionPane::InputMonitoring)
}

#[tauri::command]
pub fn renew_input_monitoring(app: tauri::AppHandle) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Permission renewal is only available on macOS.".into());
    }
    // Renew only this app's Input Monitoring approval, never other apps or services.
    let output = std::process::Command::new("/usr/bin/tccutil")
        .args(["reset", "ListenEvent", &app.config().identifier])
        .output()
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Could not renew Input Monitoring approval: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    {
        let state = app.state::<Mutex<AppState>>();
        state
            .lock()
            .map_err(|err| err.to_string())?
            .restart_required = true;
    }
    request_input_monitoring(app)
}

#[tauri::command]
pub fn reveal_running_app(app: tauri::AppHandle) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|err| err.to_string())?;
    app.opener()
        .reveal_item_in_dir(app_bundle_path(&executable))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn restart_keyviz(app: tauri::AppHandle) {
    app.request_restart();
}

pub fn notify_input_access_problem(app: &tauri::AppHandle) {
    let _ = app.emit("input-access-changed", ());
    let window_app = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(err) = show_settings_window(&window_app) {
            eprintln!("Could not show permission settings: {err}");
        }
    });
}

pub fn start_permission_monitor(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    std::thread::spawn(move || {
        let mut was_allowed = input_monitoring_allowed();
        if !was_allowed {
            if let Ok(mut state) = app.state::<Mutex<AppState>>().lock() {
                state.restart_required = true;
            }
            notify_input_access_problem(&app);
        }
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let allowed = input_monitoring_allowed();
            if was_allowed && !allowed {
                // A revoked or replaced approval can disable the existing event tap.
                // Restart after reapproval to recreate it instead of claiming success.
                if let Ok(mut state) = app.state::<Mutex<AppState>>().lock() {
                    state.restart_required = true;
                }
                notify_input_access_problem(&app);
            } else if !was_allowed && allowed {
                let _ = app.emit("input-access-changed", ());
            }
            was_allowed = allowed;
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_running_app_bundle_for_permission_reapproval() {
        assert_eq!(
            app_bundle_path(Path::new("/Applications/keyviz.app/Contents/MacOS/keyviz")),
            Path::new("/Applications/keyviz.app")
        );
    }

    #[test]
    fn supports_an_unbundled_development_executable() {
        let executable = Path::new("/project/src-tauri/target/debug/keyviz");
        assert_eq!(app_bundle_path(executable), executable);
    }

    #[test]
    fn settings_commands_use_only_the_selected_privacy_pane() {
        assert!(PermissionPane::InputMonitoring
            .url()
            .ends_with("?Privacy_ListenEvent"));
        assert!(PermissionPane::Accessibility
            .url()
            .ends_with("?Privacy_Accessibility"));
        assert!(serde_json::from_str::<PermissionPane>("\"all\"").is_err());
    }
}
