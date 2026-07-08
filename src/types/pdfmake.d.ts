// Minimal typings for pdfmake 0.3's server-side singleton instance API.
// (@types/pdfmake targets the older 0.2 factory API, so we shim the bits we use.)
declare module "pdfmake" {
  interface CreatedPdf {
    getBuffer(): Promise<Buffer>;
  }
  interface PdfMakeInstance {
    addFonts(fonts: unknown): void;
    setFonts(fonts: unknown): void;
    setLocalAccessPolicy(cb: (path: string) => boolean): void;
    setUrlAccessPolicy(cb: (url: string) => boolean): void;
    createPdf(docDefinition: unknown, options?: unknown): CreatedPdf;
  }
  const pdfmake: PdfMakeInstance;
  export default pdfmake;
}

declare module "pdfmake/fonts/Roboto.js" {
  const fonts: Record<
    string,
    { normal: string; bold: string; italics: string; bolditalics: string }
  >;
  export default fonts;
}
