/**
 * @module version
 *
 * Exports the current version of isol8.
 */

import packageJson from "../package.json";

/**
 * Current version of isol8.
 * @example
 * ```typescript
 * import { VERSION } from "isol8";
 * console.log(`Using isol8 v${VERSION}`);
 * ```
 */
export const VERSION = packageJson.version;
