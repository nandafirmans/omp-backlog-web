import { expect, test } from 'bun:test';
import { fileTree } from './fileTree';

test('nests paths into folders in input order', () => {
  expect(fileTree(['.gitignore', 'src/App.tsx', 'src/lib/a.ts', 'src/main.tsx', 'vite.config.ts'])).toEqual([
    { key: '.gitignore', name: '.gitignore', path: '.gitignore' },
    { key: 'dir:src', name: 'src', path: 'src', children: [
      { key: 'src/App.tsx', name: 'App.tsx', path: 'src/App.tsx' },
      { key: 'dir:src/lib', name: 'lib', path: 'src/lib', children: [{ key: 'src/lib/a.ts', name: 'a.ts', path: 'src/lib/a.ts' }] },
      { key: 'src/main.tsx', name: 'main.tsx', path: 'src/main.tsx' },
    ] },
    { key: 'vite.config.ts', name: 'vite.config.ts', path: 'vite.config.ts' },
  ]);
});
