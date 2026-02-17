/**
 * @module engine/utils
 *
 * Low-level utility functions used by the Docker engine: memory parsing,
 * output truncation, secret masking, and POSIX tar archive creation/extraction.
 */

/**
 * Parses a human-readable memory limit string into bytes.
 *
 * @param limit - Memory string (e.g. `"512m"`, `"1g"`, `"256k"`, `"1024"`).
 * @returns The limit in bytes.
 * @throws {Error} If the format is invalid.
 *
 * @example
 * ```typescript
 * parseMemoryLimit("512m"); // 536870912
 * parseMemoryLimit("1g");   // 1073741824
 * ```
 */
export function parseMemoryLimit(limit: string): number {
  const match = limit.match(/^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i);
  if (!match) {
    throw new Error(`Invalid memory limit format: "${limit}". Use e.g. "512m", "1g".`);
  }
  const value = Number.parseFloat(match[1]!);
  const unit = (match[2] || "b").toLowerCase();

  const multipliers: Record<string, number> = {
    b: 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
  };

  return Math.floor(value * (multipliers[unit] ?? 1));
}

/**
 * Truncates output to a maximum byte length. If truncated, appends a
 * summary line indicating the original and limit sizes.
 *
 * @param output - The full output string.
 * @param maxBytes - Maximum allowed byte length.
 * @returns Object with the (possibly truncated) text and a truncation flag.
 */
export function truncateOutput(
  output: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(output);

  if (bytes.length <= maxBytes) {
    return { text: output, truncated: false };
  }

  // Truncate at byte boundary, decode back
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const truncated = decoder.decode(bytes.slice(0, maxBytes));
  return {
    text: `${truncated}\n\n--- OUTPUT TRUNCATED (${bytes.length} bytes, limit: ${maxBytes}) ---`,
    truncated: true,
  };
}

/**
 * Replaces all occurrences of secret values in a string with `***`.
 * Empty secret values are skipped.
 *
 * @param text - The text to sanitize.
 * @param secrets - Map of secret names to values.
 * @returns The sanitized text.
 */
export function maskSecrets(text: string, secrets: Record<string, string>): string {
  let result = text;
  for (const value of Object.values(secrets)) {
    if (value.length > 0) {
      result = result.replaceAll(value, "***");
    }
  }
  return result;
}

/**
 * Creates a POSIX tar archive buffer containing a single file.
 *
 * Uses a minimal tar header (512-byte blocks) followed by data blocks
 * and a 1024-byte end-of-archive marker.
 *
 * @param filePath - Path for the file inside the archive (leading `/` is stripped).
 * @param content - File contents as a string or Buffer.
 * @returns A Buffer containing the complete tar archive.
 */
export function createTarBuffer(filePath: string, content: Buffer | string): Buffer {
  const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const headerSize = 512;
  const dataBlocks = Math.ceil(data.length / 512);
  const totalSize = headerSize + dataBlocks * 512 + 1024; // +1024 for end-of-archive
  const buf = Buffer.alloc(totalSize);

  // Filename (0..100)
  buf.write(filePath.replace(/^\//, ""), 0, 100, "utf-8");
  // Mode (100..108)
  buf.write("0000644\0", 100, 8, "utf-8");
  // UID (108..116)
  buf.write("0000000\0", 108, 8, "utf-8");
  // GID (116..124)
  buf.write("0000000\0", 116, 8, "utf-8");
  // Size (124..136) - octal
  buf.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "utf-8");
  // Mtime (136..148)
  buf.write(
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0")}\0`,
    136,
    12,
    "utf-8"
  );
  // Type flag (156) - '0' = regular file
  buf.write("0", 156, 1, "utf-8");
  // Magic (257..263)
  buf.write("ustar\0", 257, 6, "utf-8");
  // Version (263..265)
  buf.write("00", 263, 2, "utf-8");

  // Compute checksum
  // First fill checksum field with spaces
  buf.write("        ", 148, 8, "utf-8");
  let checksum = 0;
  for (let i = 0; i < headerSize; i++) {
    checksum += buf[i]!;
  }
  buf.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf-8");

  // Write data
  data.copy(buf, headerSize);

  return buf;
}

/**
 * Extracts a single file from a tar archive buffer.
 *
 * @param tarBuffer - The tar archive buffer.
 * @param targetPath - Path of the file to extract (leading `/` is stripped for matching).
 * @returns The extracted file contents as a Buffer.
 * @throws {Error} If the file is not found in the archive.
 */
export function extractFromTar(tarBuffer: Buffer, targetPath: string): Buffer {
  const normalizedTarget = targetPath.replace(/^\//, "");
  const basename = targetPath.split("/").pop() ?? targetPath;
  let offset = 0;

  while (offset < tarBuffer.length - 512) {
    // Read filename from header
    const nameEnd = tarBuffer.indexOf(0, offset);
    const name = tarBuffer.subarray(offset, Math.min(nameEnd, offset + 100)).toString("utf-8");

    if (name.length === 0) {
      break;
    }

    // Read size
    const sizeStr = tarBuffer
      .subarray(offset + 124, offset + 136)
      .toString("utf-8")
      .trim();
    const size = Number.parseInt(sizeStr, 8);

    if (Number.isNaN(size)) {
      break;
    }

    const dataStart = offset + 512;
    const dataBlocks = Math.ceil(size / 512);

    if (name === normalizedTarget || name.endsWith(`/${normalizedTarget}`) || name === basename) {
      return Buffer.from(tarBuffer.subarray(dataStart, dataStart + size));
    }

    offset = dataStart + dataBlocks * 512;
  }

  throw new Error(`File "${targetPath}" not found in tar archive`);
}

/**
 * Validates a package name to prevent command injection.
 * allow alphanumeric, dash, underscore, dot, @, / (for scoped packages), and = (for versions)
 *
 * @param name - The package name to validate.
 * @returns The name if valid.
 * @throws {Error} If the name contains invalid characters.
 */
export function validatePackageName(name: string): string {
  // Allow @scope/pkg, pkg@version, pkg==version, pkg-name, pkg_name, pkg.name
  if (!/^[@a-zA-Z0-9_./\-=]+$/.test(name)) {
    throw new Error(
      `Invalid package name: "${name}". Only alphanumeric, -, _, ., /, @, and = are allowed.`
    );
  }
  return name;
}
