import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

let _canImportTs: boolean | null = null;

export function canImportTypeScript(): boolean {
  if (_canImportTs !== null) return _canImportTs;

  if (process.env.NODE_ENV === 'production') {
    _canImportTs = false;
    return false;
  }

  const execArgv = process.execArgv.join(' ');
  if (execArgv.includes('tsx') || execArgv.includes('ts-node')) {
    _canImportTs = true;
    return true;
  }

  const argv1 = process.argv[1] || '';
  if (argv1.includes('tsx') || argv1.includes('ts-node')) {
    _canImportTs = true;
    return true;
  }

  if (process.env.TS_NODE_PROJECT) {
    _canImportTs = true;
    return true;
  }

  _canImportTs = false;
  return false;
}

export function resetCanImportTypeScript(): void {
  _canImportTs = false;
}

export function getExtensionOrder(): string[] {
  return canImportTypeScript()
    ? ['.ts', '.js', '.cjs', '.mjs']
    : ['.js', '.cjs', '.mjs', '.ts'];
}

async function safeImport(filePath: string): Promise<any> {
  try {
    return await import(pathToFileURL(filePath).href);
  } catch (err: any) {
    if (filePath.endsWith('.ts') && err?.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      console.warn(`[Plugin Import] TS import failed for ${path.basename(filePath)} (ERR_UNKNOWN_FILE_EXTENSION), trying JS fallback`);
      resetCanImportTypeScript();
      const basePath = filePath.replace(/\.ts$/, '');
      for (const ext of ['.js', '.cjs', '.mjs']) {
        const fallback = basePath + ext;
        if (fs.existsSync(fallback)) {
          console.log(`[Plugin Import] Using fallback: ${path.basename(fallback)}`);
          return await import(pathToFileURL(fallback).href);
        }
      }
    }
    throw err;
  }
}

export async function importPlugin(pluginPath: string): Promise<any> {
  const fullPath = path.resolve(process.cwd(), pluginPath);

  const extensions = getExtensionOrder();
  const canTs = canImportTypeScript();
  const hasExtension = ['.ts', '.js', '.cjs', '.mjs'].some(ext => fullPath.endsWith(ext));

  if (hasExtension) {
    if (!canTs && fullPath.endsWith('.ts')) {
      const basePath = fullPath.replace(/\.(ts|js|cjs|mjs)$/, '');
      for (const ext of extensions) {
        const candidate = basePath + ext;
        if (fs.existsSync(candidate)) {
          return safeImport(candidate);
        }
      }
    }

    if (fs.existsSync(fullPath)) {
      return safeImport(fullPath);
    }

    const basePath = fullPath.replace(/\.(ts|js|cjs|mjs)$/, '');
    for (const ext of extensions) {
      const candidate = basePath + ext;
      if (fs.existsSync(candidate)) {
        return safeImport(candidate);
      }
    }
  } else {
    for (const ext of extensions) {
      const candidate = fullPath + ext;
      if (fs.existsSync(candidate)) {
        return safeImport(candidate);
      }
    }

    for (const ext of extensions) {
      const candidate = path.join(fullPath, 'index' + ext);
      if (fs.existsSync(candidate)) {
        return safeImport(candidate);
      }
    }
  }

  return safeImport(fullPath);
}
