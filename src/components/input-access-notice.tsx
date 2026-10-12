import { inputAccessState, InputAccessStatus } from "@/lib/input-access";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";

export function InputAccessNotice() {
    const [status, setStatus] = useState<InputAccessStatus | null>(null);
    const [checkError, setCheckError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const isMacos = platform() === "macos";

    const checkAccess = useCallback(async () => {
        try {
            setStatus(await invoke<InputAccessStatus>("get_input_access_status"));
            setCheckError(null);
        } catch (error) {
            setCheckError(String(error));
        }
    }, []);

    useEffect(() => {
        if (!isMacos) return;
        void checkAccess();
        const timer = setInterval(() => void checkAccess(), 2_000);
        const onFocus = () => void checkAccess();
        window.addEventListener("focus", onFocus);
        const unlisten = listen("input-access-changed", onFocus);
        return () => {
            clearInterval(timer);
            window.removeEventListener("focus", onFocus);
            void unlisten.then(stop => stop());
        };
    }, [checkAccess, isMacos]);

    const runAction = async (command: string, args?: Record<string, unknown>) => {
        setBusy(true);
        setActionError(null);
        try {
            await invoke(command, args);
            await checkAccess();
        } catch (error) {
            setActionError(String(error));
        } finally {
            setBusy(false);
        }
    };

    if (!isMacos || (status && !status.supported)) return null;
    const state = status ? inputAccessState(status) : "checking";
    const error = actionError || checkError;

    if (state === "ready" && !error) {
        return <div className="mx-6 mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span role="status">Input Monitoring approved</span>
            <Button size="xs" variant="ghost" onClick={() => void checkAccess()}>Check permissions</Button>
        </div>;
    }

    return <section className="mx-6 mt-6 space-y-3 rounded-lg border border-amber-400/50 bg-amber-50 p-4 dark:bg-amber-950/30" aria-label="Input permissions">
        <div aria-live="polite">
            <h2 className="text-sm font-semibold">
                {state === "checking" ? "Checking input access…" : state === "restart" ? "Restart Keyviz to resume indicators" : "Input access needs attention"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
                {state === "restart"
                    ? "Input Monitoring is approved. Restart Keyviz to reconnect its input listener."
                    : "Keyviz needs Input Monitoring to show your keypresses and mouse clicks. Enable it for the app you are running."}
            </p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
            {state === "restart" ?
                <Button disabled={busy} onClick={() => void runAction("restart_keyviz")}>Restart Keyviz</Button> :
                <Button disabled={busy || !status} onClick={() => void runAction("request_input_monitoring")}>Open Input Monitoring</Button>
            }
            <Button variant="outline" disabled={busy} onClick={() => void checkAccess()}>Recheck access</Button>
            <Button variant="outline" disabled={busy} onClick={() => void runAction("reveal_running_app")}>Show this app in Finder</Button>
            {state !== "restart" && status?.restartRequired &&
                <Button variant="outline" disabled={busy} onClick={() => void runAction("restart_keyviz")}>I’ve enabled it — restart Keyviz</Button>
            }
        </div>
        {status && <>
            <p className="break-all text-xs text-muted-foreground">App to approve: {status.appPath}</p>
            <details className="text-sm">
                <summary className="cursor-pointer font-medium">Already enabled, but still not working?</summary>
                <div className="mt-3 space-y-3">
                    <p className="text-muted-foreground">
                        After an app update, macOS may keep an approval for the old copy. Renew approval clears only Keyviz’s Input Monitoring permission and opens System Settings. Add the app shown above, enable it, then restart Keyviz.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" disabled={busy} onClick={() => void runAction("renew_input_monitoring")}>Renew approval</Button>
                        <Button variant="outline" disabled={busy} onClick={() => void runAction("open_permission_settings", { pane: "accessibility" })}>Open Accessibility</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Accessibility: {status.accessibility ? "approved" : "not approved"}. If input still fails after restoring Input Monitoring, check this permission too.
                    </p>
                </div>
            </details>
        </>}
    </section>;
}
