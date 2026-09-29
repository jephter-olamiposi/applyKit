/**
 * @fileoverview Robust Download Manager for Extension Side Panel & Content Script contexts.
 *
 * Solves download failures in Chrome Extension MV3 Side Panels (ADR-0026, ADR-0031):
 * 1. Native Chrome Downloads API: Uses `chrome.downloads.download` when available.
 * 2. Data URL Conversion: Converts Blobs to Data URLs to eliminate premature blob URL
 *    revocation race conditions during async download initiation.
 * 3. File System Sanitation: Strips illegal filename characters across Windows, Mac, and Linux.
 * 4. Fallback DOM Mechanism: Standard anchor click with extended URL lifetime (60s).
 */

/**
 * Sanitizes a filename for cross-platform filesystem safety.
 */
export function sanitizeDownloadFilename(filename: string): string {
  // Strip control characters and illegal OS characters: / \ : * ? " < > |
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim();
}

/**
 * Converts a Blob to a base64 Data URL string asynchronously.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return a string Data URL.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read Blob as Data URL.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Triggers a user download of a Blob with the specified filename.
 *
 * @param blob The Blob object containing file data (e.g. PDF, text, markdown).
 * @param rawFilename Proposed filename.
 */
export async function downloadBlob(blob: Blob, rawFilename: string): Promise<void> {
  const filename = sanitizeDownloadFilename(rawFilename);

  // 1. Preferred Extension Path: Use chrome.downloads.download
  if (
    typeof chrome !== 'undefined' &&
    chrome.downloads &&
    typeof chrome.downloads.download === 'function'
  ) {
    try {
      const dataUrl = await blobToDataUrl(blob);
      await new Promise<number>((resolve, reject) => {
        chrome.downloads.download(
          {
            url: dataUrl,
            filename,
            saveAs: false, // Save directly to user's standard Downloads folder
          },
          (downloadId) => {
            const err = chrome.runtime?.lastError;
            if (err) {
              reject(new Error(err.message));
            } else if (downloadId === undefined) {
              reject(new Error('Download failed to initiate.'));
            } else {
              resolve(downloadId);
            }
          }
        );
      });
      return;
    } catch (chromeErr) {
      console.warn('chrome.downloads failed, falling back to anchor element:', chromeErr);
    }
  }

  // 2. Fallback DOM Mechanism (Web context, tests, or if chrome.downloads is unavailable)
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);

  link.click();

  // Remove element and revoke after safe delay so the browser has time to stream the file
  document.body.removeChild(link);
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore
    }
  }, 60000);
}

/**
 * Triggers a download of raw text content (Markdown, plain text, JSON, CSV).
 *
 * @param content Text content string.
 * @param filename Proposed filename.
 * @param mimeType MIME type (default 'text/plain;charset=utf-8').
 */
export async function downloadText(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8'
): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  await downloadBlob(blob, filename);
}
