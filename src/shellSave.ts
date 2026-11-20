import { isAppShell } from './shell';

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// WebView has no file downloads: write to the cache directory and open the
// native share sheet so the file can be saved or sent. Returns false when
// running as the plain web app.
export async function saveFileInShell(filename: string, data: string | Blob): Promise<boolean> {
  if (!isAppShell()) return false;
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const base64 =
    typeof data === 'string'
      ? bytesToBase64(new TextEncoder().encode(data))
      : bytesToBase64(new Uint8Array(await data.arrayBuffer()));
  await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  try {
    await Share.share({ files: [uri] });
  } catch {
    /* Share sheet dismissed — the file is already written. */
  }
  return true;
}
