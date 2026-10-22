export interface AttachmentReference { name: string; url: string; markdown: string }
export interface StagedAttachment extends AttachmentReference { file: File; uploaded: boolean; objectUrl?: string }
export type UploadAttachments = (files: File[]) => Promise<AttachmentReference[]>;

const supported = /^(png|jpe?g|gif|webp|json|txt|md|csv|pdf|docx?|xlsx?|odt)$/i;
const imageTypes: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Keep names within the server allowlist; never disguise an unsupported file type. */
export function attachmentReference(file: Pick<File, 'name' | 'type' | 'size'>, unique = crypto.randomUUID()): AttachmentReference {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Attachments must be between 1 byte and 10 MiB.');
  const match = /\.([^.]+)$/.exec(file.name);
  const extension = (match?.[1] ?? imageTypes[file.type] ?? '').toLowerCase();
  if (!supported.test(extension)) throw new Error(`Unsupported attachment type: ${file.name || file.type || 'unknown'}. Use PNG, JPEG, GIF, WebP, JSON, TXT, Markdown, CSV, PDF, Word, Excel, or ODT.`);
  const stem = (match ? file.name.slice(0, match.index) : file.name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 65) || 'attachment';
  const name = `${stem}-${unique}.${extension}`;
  const url = `attachments/${encodeURIComponent(name)}`;
  const image = /^(png|jpe?g|gif|webp)$/.test(extension);
  return { name, url, markdown: `${image ? '!' : ''}[${stem}](${url})` };
}
