export interface InputAccessStatus {
    supported: boolean;
    inputMonitoring: boolean;
    accessibility: boolean;
    restartRequired: boolean;
    listenerError: string | null;
    appPath: string;
}

export function inputAccessState(status: InputAccessStatus) {
    if (!status.supported) return "unsupported";
    if (!status.inputMonitoring) return "blocked";
    if (status.restartRequired || status.listenerError) return "restart";
    return "ready";
}
