export function getFileRelativePath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string; path?: string };
  return withPath.webkitRelativePath || withPath.path || file.name;
}

export function appendFilesWithPaths(formData: FormData, files: File[]) {
  for (const file of files) {
    formData.append("files", file);
    formData.append("paths", getFileRelativePath(file));
  }
}
