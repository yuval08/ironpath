import type ExcelJS from 'exceljs';

/**
 * ExcelJS is ~1 MB minified. It is only needed when the user exports or imports a
 * spreadsheet, so it is loaded on demand rather than bundled into the entry chunk.
 *
 * The CJS/ESM interop shape differs between dev (Vite pre-bundle) and the
 * production build, hence the `default ?? mod` fallback.
 */
export interface ExcelModule {
  Workbook: new () => ExcelJS.Workbook;
}

export async function loadExcelJS(): Promise<ExcelModule> {
  const mod = (await import('exceljs')) as unknown as { default?: ExcelModule } & ExcelModule;
  return mod.default ?? mod;
}
