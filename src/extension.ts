'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import app from './app';
import initCommands from './initCommands';
import { reportError } from './helper';
import fileActivityMonitor from './modules/fileActivityMonitor';
import { tryLoadConfigs } from './modules/config';
import { getAllFileService, createFileService, disposeFileService } from './modules/serviceManager';
import { getWorkspaceFolders, setContextValue } from './host';
import RemoteExplorer from './modules/remoteExplorer';
import logger from './logger';

// async function setupWorkspaceFolder(dir) {
//   const configs = await tryLoadConfigs(dir);
//   configs.forEach(config => {
//     createFileService(config, dir);
//   });
// }

/**
 * Sets up a workspace folder by loading configurations and creating file services.
 *
 * @param {string} dir - The directory path of the workspace folder.
 * @returns {Promise<void>} A promise that resolves once the workspace folder is set up.
 */
async function setupWorkspaceFolder(dir: string): Promise<void> {
  logger.info(`Setting up workspace folder: ${dir}`);

  try {
    const configs = await tryLoadConfigs(dir);
    logger.debug(`Loaded ${configs.length} configurations for workspace folder: ${dir}`);

    configs.forEach(config => {
      logger.debug(`Creating file service for config: ${JSON.stringify(config)}`);
      createFileService(config, dir);
    });
    
    logger.info(`Workspace folder setup completed: ${dir}`);
  } catch (error) {
    logger.error(`Error setting up workspace folder: ${dir}`, { error });
    throw error; // Rethrow the error to propagate it up the call stack
  }
}


// function setup(workspaceFolders: vscode.WorkspaceFolder[]) {
//   fileActivityMonitor.init();
//   const pendingInits = workspaceFolders.map(folder => setupWorkspaceFolder(folder.uri.fsPath));

//   return Promise.all(pendingInits);
// }

/**
 * Sets up the file activity monitor and initializes configurations for each workspace folder.
 *
 * @param {vscode.WorkspaceFolder[]} workspaceFolders - An array of workspace folders to set up.
 * @returns {Promise<void>} A promise that resolves when all workspace folders are set up.
 */
function setup(workspaceFolders: vscode.WorkspaceFolder[]): Promise<void> {
  logger.info('Initializing file activity monitor...');
  fileActivityMonitor.init(); // Initialize the file activity monitor

  logger.info(`Setting up ${workspaceFolders.length} workspace folder(s)...`);
  
  // Map each workspace folder to its setup promise
  const pendingInits: Promise<void>[] = workspaceFolders.map(folder => {
    logger.debug(`Setting up workspace folder: ${folder.uri.fsPath}`);
    return setupWorkspaceFolder(folder.uri.fsPath); // Ensure setupWorkspaceFolder returns a Promise<void>
  });

  // Return a promise that resolves when all workspace folders are set up
  return Promise.all(pendingInits)
    .then(() => {
      logger.info('All workspace folders set up successfully.');
    })
    .catch(error => {
      logger.error('Error during workspace folder setup.', { error });
      throw error; // Re-throw the error for higher-level handling
    });
}


/**
 * Activates the VS Code extension.
 * Initializes commands, sets up workspace configuration, and initializes UI elements.
 *
 * @param {vscode.ExtensionContext} context - The extension context provided by VS Code.
 */
export async function activate(context: vscode.ExtensionContext) {
  logger.info('Activating extension...');

  // Access extension-specific paths and other information
  try {
    logger.info('Initializing commands...');
    initCommands(context); // Register all extension commands
  } catch (error) {
    logger.error('Error during command initialization.', { error });
    reportError(error, 'initCommands');
  }

  // Get the workspace folders
  const workspaceFolders = getWorkspaceFolders();
  if (!workspaceFolders) {
    logger.warn('No workspace folders detected. Extension activation halted.');
    return; // Exit early if there are no workspace folders
  }

  // Set extension context value to indicate it is enabled
  logger.info('Setting context value: enabled = true');
  setContextValue('enabled', true);

  // Display SFTP bar item in the VS Code status bar
  logger.info('Displaying SFTP bar item in the status bar.');
  app.sftpBarItem.show();

  // Subscribe to app state changes
  logger.info('Subscribing to app state changes.');
  app.state.subscribe(_ => {
    const currentText = app.sftpBarItem.getText();
    // Reset bar item if it's showing a profile
    if (currentText.startsWith('SFTP')) {
      logger.debug('Resetting SFTP bar item text.');
      app.sftpBarItem.reset();
    }
    // Refresh remote explorer, if available
    if (app.remoteExplorer) {
      logger.debug('Refreshing remote explorer.');
      app.remoteExplorer.refresh();
    }
  });

  // Setup workspace-specific configurations and initialize Remote Explorer
  try {
    logger.info('Setting up workspace configurations...');
    await setup(workspaceFolders); // Configure the extension for the current workspace
    logger.info('Initializing Remote Explorer...');
    app.remoteExplorer = new RemoteExplorer(context); // Initialize Remote Explorer UI
  } catch (error) {
    logger.error('Error during workspace setup or Remote Explorer initialization.', { error });
    reportError(error);
  }

  logger.info('Extension activated successfully.');
}

export function deactivate() {
  fileActivityMonitor.destory();
  getAllFileService().forEach(disposeFileService);
}
