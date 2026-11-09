export const IMAGE_ACCEPT = ".jpg,.jpeg,.jfif,.png,.gif,.webp,.bmp,.tif,.tiff";
export const IMAGE_HELP = "Accepted: JPG, JPEG, JFIF, PNG, GIF, WEBP, BMP or TIFF. Maximum size: 8 MB.";
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
};

export async function validateScreenshot(file: File): Promise<File> {
  if (!file.size) throw new Error("This file is empty. Choose a screenshot containing your SMS message.");
  if (file.size > MAX_BYTES) throw new Error("This image exceeds the 8 MB limit. Choose a smaller image or crop it to the SMS message.");
  const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase() ?? "";
  const expected = Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] : undefined;
  if (!expected || (file.type && file.type !== expected)) throw new Error(`This file type is not supported. ${IMAGE_HELP}`);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const matches = expected === "image/png" ? hex.startsWith("89504e470d0a1a0a")
    : expected === "image/jpeg" ? hex.startsWith("ffd8ff")
    : expected === "image/gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6))
    : expected === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
    : expected === "image/bmp" ? hex.startsWith("424d")
    : hex.startsWith("49492a00") || hex.startsWith("4d4d002a");
  if (!matches) throw new Error("This file does not match its image format or its header is damaged. Choose a valid screenshot; renaming another file to .jpg or .png will not work.");
  // Some browsers omit the MIME type (notably for JFIF/TIFF). Send the type
  // verified from extension and bytes so the backend can validate it again.
  return file.type ? file : new File([file], file.name, { type: expected, lastModified: file.lastModified });
}
