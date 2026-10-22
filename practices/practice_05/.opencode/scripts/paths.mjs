import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const tools = path.join(root, '.opencode');
export const browserPath = path.join(tools, '.cache', 'browsers');
export const libraryPath = path.join(tools, '.cache', 'system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
