export interface FileTreeNode { key: string; name: string; path: string; children?: FileTreeNode[] }

/** Nest slash-separated paths into folders, keeping the input order. Folder keys are prefixed so they never collide with file paths. */
export function fileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const folders = new Map<string, FileTreeNode>();
  for (const path of paths) {
    const parts = path.split('/');
    let level = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const folderPath = parts.slice(0, index + 1).join('/');
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = { key: `dir:${folderPath}`, name: parts[index], path: folderPath, children: [] };
        folders.set(folderPath, folder);
        level.push(folder);
      }
      level = folder.children!;
    }
    level.push({ key: path, name: parts.at(-1)!, path });
  }
  return root;
}
