use std::{sync::Mutex, thread};

use rdev::{listen, Button, EventType};
use serde::Serialize;
use tauri::{menu::MenuItem, AppHandle, Emitter, Manager, Wry};

use crate::app::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum InputEvent {
    KeyEvent { pressed: bool, name: String },
    MouseButtonEvent { pressed: bool, button: MouseButton },
    MouseMoveEvent { x: f64, y: f64 },
    MouseWheelEvent { delta_x: i64, delta_y: i64 },
}

#[derive(Debug, Clone, Serialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    Other,
}

pub fn map_mouse_button(button: Button) -> MouseButton {
    match button {
        Button::Left => MouseButton::Left,
        Button::Right => MouseButton::Right,
        Button::Middle => MouseButton::Middle,
        _ => MouseButton::Other,
    }
}

#[cfg(target_os = "macos")]
fn mouse_position_on_monitor(
    x: f64,
    y: f64,
    monitor_position: (i32, i32),
    monitor_scale: f64,
) -> (f64, f64) {
    // Quartz cursor coordinates are in points, while Tauri's monitor origin is in
    // physical pixels. Convert the origin to points before making it relative.
    let origin =
        tauri::PhysicalPosition::<i32>::from(monitor_position).to_logical::<f64>(monitor_scale);
    (x - origin.x, y - origin.y)
}

pub fn start_listener(app_handle: AppHandle, toggle_menu_item: MenuItem<Wry>) {
    thread::spawn(move || {
        println!("Starting global input listener...");

        if let Err(err) = listen(move |event| {
            // get app state
            let state = app_handle.state::<Mutex<AppState>>();
            let mut app_state = state.lock().unwrap();

            // track pressed keys
            if let EventType::KeyPress(key) = event.event_type {
                let key_name = format!("{:?}", key);
                // If the name contains parenthesis (like "RawKey(123)", "Unknown()"), ignore it.
                if key_name.contains('(') {
                    return;
                }
                // if key is already marked as pressed, ignore repeat
                if app_state.pressed_keys.contains(&key_name) {
                    return;
                }
                // record key as pressed
                app_state.pressed_keys.push(key_name);
                // check if toggle shortcut is pressed
                if app_state.toggle_shortcut == app_state.pressed_keys {
                    app_state.toggle_listener(&app_handle, &toggle_menu_item);

                    if !app_state.listening {
                        // emit key releases for all pressed keys
                        for key_name in &app_state.pressed_keys {
                            app_handle
                                .emit_to(
                                    "main",
                                    "input-event",
                                    InputEvent::KeyEvent {
                                        pressed: false,
                                        name: key_name.clone(),
                                    },
                                )
                                .unwrap()
                        }
                    }
                }
            } else if let EventType::KeyRelease(key) = event.event_type {
                let key_name = format!("{:?}", key);
                if key_name.contains('(') {
                    return;
                }
                // remove key from pressed keys
                app_state.pressed_keys.retain(|k| k != &key_name);
            }

            // emit event if listening
            if !app_state.listening {
                return;
            }
            let input_event = match event.event_type {
                EventType::KeyPress(key) => Some(InputEvent::KeyEvent {
                    pressed: true,
                    name: format!("{:?}", key),
                }),
                EventType::KeyRelease(key) => Some(InputEvent::KeyEvent {
                    pressed: false,
                    name: format!("{:?}", key),
                }),
                EventType::ButtonPress(button) => Some(InputEvent::MouseButtonEvent {
                    pressed: true,
                    button: map_mouse_button(button),
                }),
                EventType::ButtonRelease(button) => Some(InputEvent::MouseButtonEvent {
                    button: map_mouse_button(button),
                    pressed: false,
                }),
                EventType::MouseMove { x, y } => {
                    #[cfg(target_os = "macos")]
                    let (logical_x, logical_y) = mouse_position_on_monitor(
                        x,
                        y,
                        app_state.monitor_position,
                        app_state.monitor_scale,
                    );

                    #[cfg(not(target_os = "macos"))]
                    let (logical_x, logical_y) = {
                        let (offset_x, offset_y) = app_state.monitor_position;
                        (x - offset_x as f64, y - offset_y as f64)
                    };

                    Some(InputEvent::MouseMoveEvent {
                        x: logical_x,
                        y: logical_y,
                    })
                }
                EventType::Wheel { delta_x, delta_y } => {
                    Some(InputEvent::MouseWheelEvent { delta_x, delta_y })
                }
            };

            app_handle.emit("input-event", input_event).unwrap();
        }) {
            eprintln!("rdev listen failed: {:?}", err);
        }
    });
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::mouse_position_on_monitor;

    #[test]
    fn retina_monitor_above_primary_keeps_cursor_inside_overlay() {
        // LG: 2560x1440 points, origin (-367, -1440), scale 2.
        // The old conversion placed this center click at (1647, 2160), offscreen.
        assert_eq!(
            mouse_position_on_monitor(913.0, -720.0, (-734, -2880), 2.0),
            (1280.0, 720.0)
        );
    }

    #[test]
    fn primary_retina_monitor_preserves_cursor_points() {
        assert_eq!(
            mouse_position_on_monitor(900.0, 584.5, (0, 0), 2.0),
            (900.0, 584.5)
        );
    }

    #[test]
    fn retina_monitor_below_and_right_of_primary_uses_logical_origin() {
        assert_eq!(
            mouse_position_on_monitor(2000.0, 1400.0, (3600, 2338), 2.0),
            (200.0, 231.0)
        );
    }

    #[test]
    fn unscaled_monitor_left_of_primary_uses_its_own_scale() {
        assert_eq!(
            mouse_position_on_monitor(-960.0, 540.0, (-1920, 0), 1.0),
            (960.0, 540.0)
        );
    }
}
