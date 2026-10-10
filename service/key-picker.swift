import AppKit
import Foundation

func report(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let panel = NSOpenPanel()
panel.title = "Link Google Translation API key file"
panel.canChooseFiles = true
panel.canChooseDirectories = false
panel.allowsMultipleSelection = false
let parent = pid_t(CommandLine.arguments.count > 2 ? Int32(CommandLine.arguments[2]) ?? 0 : 0)
DispatchQueue.global().async {
    while let command = readLine() {
        DispatchQueue.main.async {
            if command == "cancel" { panel.cancel(nil) }
            if command == "focus" { app.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil) }
        }
    }
    DispatchQueue.main.async { panel.cancel(nil); exit(0) }
}
let timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { _ in
    if parent > 0 && kill(parent, 0) != 0 { exit(0) }
    report(["event": "window", "handle": panel.isVisible ? String(panel.windowNumber) : "0"])
}
app.activate(ignoringOtherApps: true)
panel.begin { response in
    report(["event": "result", "path": response == .OK ? panel.url?.path ?? "" : ""])
    timer.invalidate()
    exit(0)
}
app.run()
