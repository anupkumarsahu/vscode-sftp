import * as path from 'path';
import { Uri, window } from 'vscode';
import { FileType } from '../core';
import { getAllFileService } from '../modules/serviceManager';
import { ExplorerItem } from '../modules/remoteExplorer';
import { getActiveTextEditor } from '../host';
import { listFiles, toLocalPath, simplifyPath } from '../helper';

function configIngoreFilterCreator(config) {
  if (!config || !config.ignore) {
    return;
  }

  return file => !config.ignore(file.fsPath);
}

function createFileSelector(filterCreator?) {
  return async (): Promise<Uri | undefined> => {
    const remoteItems = getAllFileService().map((fileService, index) => {
      const config = fileService.getConfig();
      return {
        name: config.name || config.remotePath,
        description: config.host,
        fsPath: config.remotePath,
        type: FileType.Directory,
        filter: filterCreator ? filterCreator(config) : undefined,
        getFs: () => fileService.getRemoteFileSystem(config),
        index,
        remoteBaseDir: config.remotePath,
        baseDir: fileService.baseDir,
      };
    });

    const selected = await listFiles(remoteItems);

    if (!selected) {
      return;
    }

    const rootItem = remoteItems[selected.index];
    const localTarget = toLocalPath(selected.fsPath, rootItem.remoteBaseDir, rootItem.baseDir);

    return Uri.file(localTarget);
  };
}

// export function selectContext(): Promise<Uri | undefined> {
//   return new Promise((resolve, reject) => {
//     const sercives = getAllFileService();
//     const projectsList = sercives
//       .map(service => ({
//         value: service.baseDir,
//         label: service.name || simplifyPath(service.baseDir),
//         description: '',
//         detail: service.baseDir,
//       }))
//       .sort((l, r) => l.label.localeCompare(r.label));

//     // if (projectsList.length === 1) {
//     // return resolve(projectsList[0].value);
//     // }

//     window
//       .showQuickPick(projectsList, {
//         placeHolder: 'Select a folder...',
//       })
//       .then(selection => {
//         if (selection) {
//           return resolve(Uri.file(selection.value));
//         }

//         // cancel selection
//         resolve();
//       }, reject);
//   });
// }

export async function selectContext(): Promise<Uri | undefined> {
  const services = getAllFileService();

  const projectsList = services
    .map(service => ({
      value: service.baseDir,
      label: service.name || simplifyPath(service.baseDir),
      description: '',
      detail: service.baseDir,
    }))
    .sort((l, r) => l.label.localeCompare(r.label));

  // Uncomment if you want to auto-select when only one option exists
  // if (projectsList.length === 1) {
  //   return Uri.file(projectsList[0].value);
  // }

  const selection = await window.showQuickPick(projectsList, {
    placeHolder: 'Select a folder...',
  });

  return selection ? Uri.file(selection.value) : undefined;
}


export function applySelector<T>(...selectors: ((...args: any[]) => T | Promise<T>)[]) {
  return function combinedSelector(...args: any[]): T | Promise<T> {
    let result;
    for (const selector of selectors) {
      result = selector.apply(this, args);
      if (result) {
        break;
      }
    }

    return result;
  };
}

export function uriFromfspath(fileList: string[]): Uri[] | undefined {
  if (!Array.isArray(fileList) || typeof fileList[0] !== 'string') {
    return;
  }

  return fileList.map(file => Uri.file(file));
}

export function getActiveDocumentUri() {
  const active = getActiveTextEditor();
  if (!active || !active.document) {
    return;
  }

  return active.document.uri;
}

export function getActiveFolder() {
  const uri = getActiveDocumentUri();
  if (!uri) {
    return;
  }

  return Uri.file(path.dirname(uri.fsPath));
}

// selected file or activeTarget or configContext
export function uriFromExplorerContextOrEditorContext(item, items): undefined | Uri | Uri[] {
  // from explorer or editor context
  if (item instanceof Uri) {
    if (Array.isArray(items) && items[0] instanceof Uri) {
      // multi-select in explorer
      return items;
    } else {
      return item;
    }
  } else if ((item as ExplorerItem).resource) {
    // from remote explorer
    if (Array.isArray(items) && (items[0] as ExplorerItem).resource) {
      // multi-select in remote explorer
      return items.map(_ => _.resource.uri);
    } else {
      return item.resource.uri;
    }
  }

  return;
}

// selected folder or configContext
export function selectFolderFallbackToConfigContext(item, items): Promise<undefined | Uri | Uri[]> {
  // from explorer or editor context
  if (item) {
    if (item instanceof Uri) {
      if (Array.isArray(items) && items[0] instanceof Uri) {
        // multi-select in explorer
        return Promise.resolve(items);
      } else {
        return Promise.resolve(item);
      }
    } else if ((item as ExplorerItem).resource) {
      // from remote explorer
      return Promise.resolve(item.resource.uri);
    }
  }

  return selectContext();
}

// selected file from all remote files
export const selectFileFromAll = createFileSelector();

// selected file from remote files expect ignored
export const selectFile = createFileSelector(configIngoreFilterCreator);
