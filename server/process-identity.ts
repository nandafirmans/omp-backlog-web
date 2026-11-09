import { readFile, readdir } from 'node:fs/promises';
import { object } from './rpc';

interface Identity { pid: number; start: string; boot: string }
interface ProcessInfo { pid: number; group: number; start: string; state: string }

export async function processInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid, state: fields[0], group: Number(fields[2]), start: fields[19] };
  } catch (error) { if (object(error).code === 'ENOENT' || object(error).code === 'ESRCH') return null; throw error; }
}

export async function groupMembers(pid: number): Promise<ProcessInfo[]> {
  const members: ProcessInfo[] = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const info = await processInfo(Number(entry));
    if (info?.group === pid && info.state !== 'Z' && info.state !== 'X') members.push(info);
  }
  return members;
}

export async function identity(pid: number): Promise<Identity> {
  const info = await processInfo(pid);
  if (!info) throw new Error('OMP exited before its process identity could be recorded');
  return { pid, start: info.start, boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
}
