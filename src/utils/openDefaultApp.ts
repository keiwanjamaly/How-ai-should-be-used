export async function openAbsolutePathWithShell(
  path: string,
  shell: { openPath: (targetPath: string) => Promise<string> },
): Promise<void> {
  const error = await shell.openPath(path);
  if (error) {
    throw new Error(error);
  }
}
