/** Formats both automatic backups and manually entered message templates in local time. */
export function formatCommitMessage(template: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return template.replaceAll('{{date}}', timestamp);
}
