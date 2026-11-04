#!/usr/bin/env python3
"""Keep the installed fork and its server available at login and after crashes."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess

LABEL = "com.elliptic1.t3code.fork"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, default=Path("/Applications/T3 Code (Fork).app"))
    parser.add_argument("--prepare-only", action="store_true", help="Write the job; activate it after the running app has quit for an update")
    parser.add_argument("--remove", action="store_true", help="Stop the managed app and remove automatic startup")
    args = parser.parse_args()
    job = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
    domain = f"gui/{os.getuid()}"
    if args.remove:
        subprocess.run(["launchctl", "bootout", f"{domain}/{LABEL}"], check=False, capture_output=True)
        job.unlink(missing_ok=True)
        print("Removed automatic fork startup. Saved server data is retained.")
        return
    info = plistlib.loads((args.app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != "com.t3tools.t3code.fork":
        raise SystemExit("Select the installed custom fork, with its own app identity.")
    executable = args.app / "Contents/MacOS" / info["CFBundleExecutable"]
    if not executable.is_file():
        raise SystemExit("The installed fork executable is missing.")
    logs = Path.home() / "Library/Logs/T3 Code Fork"
    logs.mkdir(parents=True, exist_ok=True)
    job.parent.mkdir(parents=True, exist_ok=True)
    contents = {
        "Label": LABEL,
        "ProgramArguments": ["/usr/bin/caffeinate", "-s", str(executable)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "ExitTimeOut": 90,
        "LimitLoadToSessionType": "Aqua",
        "WorkingDirectory": str(Path.home()),
        "StandardOutPath": str(logs / "keepalive.out.log"),
        "StandardErrorPath": str(logs / "keepalive.err.log"),
    }
    temporary = job.with_suffix(".tmp")
    temporary.write_bytes(plistlib.dumps(contents))
    temporary.replace(job)
    if args.prepare_only:
        print("Prepared automatic startup. Activate after quitting the existing fork with:")
        print(f"launchctl bootstrap {domain} '{job}'")
    else:
        subprocess.run(["launchctl", "bootstrap", domain, str(job)], check=True)
        print("The fork restarts after exit and starts at login; the Mac stays awake on AC power while it runs.")


if __name__ == "__main__":
    main()
