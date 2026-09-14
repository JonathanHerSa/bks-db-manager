import { execSync } from 'child_process';

/**
 * Best-effort native notification. Never throws: a failed notification must
 * never abort an install/uninstall — the console output already covers the
 * information, this is just a nicer surface for someone who double-clicked
 * the binary and isn't watching a terminal.
 */
export function notifyUser(title, body, platform = process.platform) {
  try {
    if (platform === 'linux') {
      execSync(`notify-send "${escapeShell(title)}" "${escapeShell(body)}"`, { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      execSync(`osascript -e 'display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"'`, { stdio: 'ignore' });
    }
    // Windows: no dependency-free native toast without extra tooling: the
    // console output in companion-entry.js's double-click flow is the
    // primary surface there (see the "wait before closing" behavior).
  } catch {
    // Ignore: console output already carries the message.
  }
}

function escapeShell(str) {
  return String(str).replace(/(["\\$`])/g, '\\$1');
}

function escapeAppleScript(str) {
  return String(str).replace(/(["\\])/g, '\\$1');
}
