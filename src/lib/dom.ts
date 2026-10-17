export function downloadCanvas(canvas: HTMLCanvasElement | null, name: string) {
  canvas?.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}

/** Let the page repaint (e.g. show "Processing…") before synchronous heavy work. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve));
    setTimeout(resolve, 50); // background tabs don't paint
  });
}
