import { describe, test, expect } from 'vitest';
import { buildUnitContent } from './service.linux.js';

describe('buildUnitContent', () => {
  test('embeds the given ExecStart command line verbatim', () => {
    const unit = buildUnitContent({ execCommand: '"/home/alice/.local/share/bks-db-manager/bin/bks-db-manager-companion" --serve' });
    expect(unit).toContain('ExecStart="/home/alice/.local/share/bks-db-manager/bin/bks-db-manager-companion" --serve');
  });

  test('also works with a dev-mode "node <script>" command line', () => {
    const unit = buildUnitContent({ execCommand: '"/usr/bin/node" "/repo/server/serve.js"' });
    expect(unit).toContain('ExecStart="/usr/bin/node" "/repo/server/serve.js"');
  });

  test('never hardcodes WorkingDirectory (the exec command is self-sufficient)', () => {
    const unit = buildUnitContent({ execCommand: '"/x/bin/bks-db-manager-companion" --serve' });
    expect(unit).not.toContain('WorkingDirectory');
  });

  test('restarts on failure and is enabled for the default user target', () => {
    const unit = buildUnitContent({ execCommand: '"/x/bin/bks-db-manager-companion" --serve' });
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
  });
});
