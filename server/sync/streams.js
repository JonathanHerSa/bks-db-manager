import { Transform } from 'stream';

/**
 * Text sanitizer shared by the full stream clone and the incremental applier.
 *
 * Only meaningful for engines whose dump is plain SQL text (mysql/mariadb,
 * postgres). Binary archives (MongoDB's `--archive`) must pass through
 * untouched or they get corrupted.
 */
export function createSanitizer({ textualDumpFormat = true, maskData = false } = {}) {
  return new Transform({
    transform(chunk, encoding, callback) {
      if (!textualDumpFormat) return callback(null, chunk);

      if (!maskData) {
        const hasKeyword =
          chunk.includes('DEFINER=') ||
          chunk.includes('GTID_PURGED') ||
          chunk.includes('SQL_LOG_BIN') ||
          chunk.includes('CREATE DATABASE') ||
          chunk.includes('transaction_timeout') ||
          chunk.includes('USE `');
        if (!hasKeyword) return callback(null, chunk);
      }

      let str = chunk.toString('utf-8');
      str = str.replace(/DEFINER=[^ *;]+/g, '');
      str = str.replace(/^[Uu][Ss][Ee]\s+[`'"]?[^;]+[`'"]?;/gm, '');
      str = str.replace(/^CREATE DATABASE[^;]+;/gmi, '');
      str = str.replace(/SET @@SESSION\.SQL_LOG_BIN[^;]+;/gmi, '');
      str = str.replace(/SET @@GLOBAL\.GTID_PURGED[^;]+;/gmi, '');
      // pg_dump 17+ emits this setting, but PostgreSQL <17 rejects it. Safe to
      // drop for older destinations; it only controls statement timeout.
      str = str.replace(/^SET\s+transaction_timeout\s*=\s*[^;]+;\s*$/gmi, '');

      if (maskData) {
        str = str.replace(
          /([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
          '$1***@masked.local'
        );
      }

      callback(null, Buffer.from(str, 'utf-8'));
    }
  });
}

export function createProgressTracker(onBytes) {
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        onBytes(chunk.length);
      } catch {
        // Progress reporting must never break the data pipe.
      }
      callback(null, chunk);
    }
  });
}

export function cleanStderr(stderr = '') {
  return String(stderr)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) =>
      line &&
      !line.includes('Using a password') &&
      !line.includes('Deprecated program')
    )
    .slice(-5)
    .join(' | ');
}
