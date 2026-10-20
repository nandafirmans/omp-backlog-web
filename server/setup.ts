import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { closeStore, createStore, database } from './store';

async function hiddenPassword(label: string): Promise<string> {
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') { cleanup(); reject(new Error('Setup cancelled')); return; }
        if (character === '\r' || character === '\n') { cleanup(); resolve(value); return; }
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ' && value.length < 1024) value += character;
      }
    };
    stdin.on('data', onData);
  });
}

if (!stdin.isTTY || !stdout.isTTY || process.argv.length !== 2) throw new Error('Run bun server/setup.ts in an interactive terminal without arguments. Password input is hidden.');
const store = createStore();
try {
  const db = database(store);
  if (db.query('SELECT id FROM owner WHERE id=1').get()) throw new Error('An owner already exists. Setup will not overwrite the account.');
  const terminal = createInterface({ input: stdin, output: stdout });
  const username = (await terminal.question('Owner username: ')).trim();
  terminal.close();
  if (!/^[a-zA-Z0-9_.@-]{1,100}$/.test(username)) throw new Error('Use 1–100 letters, digits, _, ., @, or - for the username.');
  const password = await hiddenPassword('Password (minimum 12 characters): ');
  if (password.length < 12 || password.length > 1024) throw new Error('Password must be 12–1024 characters.');
  const confirmation = await hiddenPassword('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id', memoryCost: 65536, timeCost: 3 });
  db.query('INSERT INTO owner(id,username,hash) VALUES(1,?,?)').run(username, hash);
  stdout.write('Owner created. Start the application with bun run dev.\n');
} finally { if (stdin.isRaw) stdin.setRawMode(false); closeStore(store); }
