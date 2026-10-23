import path from 'node:path';
import { root, tools } from '../scripts/paths.mjs';

export default {
  id: 'practice05-spec-kit-env',
  async setup(context) {
    const registration = await context.shell.hook('create.before', event => {
      const bin = path.join(tools, 'bin');
      const currentPath = event.env.PATH ?? process.env.PATH ?? '';
      event.env.PATH = [bin, ...currentPath.split(path.delimiter).filter(part => part !== bin)].join(path.delimiter);
      // Spec Kit belongs to this practice, including commands launched from project/.
      event.env.SPECIFY_INIT_DIR ??= path.resolve(root);
    });
    return () => registration.dispose();
  },
};
