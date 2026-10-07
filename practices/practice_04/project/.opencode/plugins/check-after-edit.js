export default {
  id: 'check-after-edit',
  async setup(ctx) {
    ctx.tool.hook('execute.after', async (event) => {
      try {
        const res = await ctx.exec('sh', ['scripts/check.sh'], { cwd: ctx.workspace.root });
        return { ...event, check: { ok: res.exitCode === 0, stdout: res.stdout, stderr: res.stderr } };
      } catch (e) {
        return { ...event, check: { ok: false, error: String(e) } };
      }
    });
  }
}
