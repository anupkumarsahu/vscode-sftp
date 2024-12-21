import * as vscode from 'vscode';
import { COMMAND_OPEN_CONNECTION_IN_TERMINAL } from '../constants';
import { getAllFileService } from '../modules/serviceManager';
import { ExplorerRoot } from '../modules/remoteExplorer';
import { interpolate } from '../utils';
import { checkCommand } from './abstract/createCommand';
import logger from '../logger';

const isWindows = process.platform === 'win32';

function shouldUseAgent(config) {
  return typeof config.agent === 'string' && config.agent.length > 0;
}

function shouldUseKey(config) {
  return typeof config.privateKeyPath === 'string' && config.privateKeyPath.length > 0;
}

function adaptPath(filepath: string): string {
  if (isWindows) {
    // Normalize Windows paths with single backslashes
    return filepath.replace(/\\/g, '\\');
  }
  // Normalize Unix paths
  return filepath.replace(/\\/g, '/');
}

function getSshCommand(
  config: { host: string; port: number; username: string },
  extraOption?: string
) {
  let sshStr = `ssh -t ${config.username}@${config.host} -p ${config.port}`;
  if (extraOption) {
    sshStr += ` ${extraOption}`;
  }
  // sshStr += ` "cd \\"${config.workingDir}\\"; exec \\$SHELL -l"`;
  return sshStr;
}

/**
 * Opens an SSH connection in a terminal.
 *
 * This command handles the process of opening an SSH connection to a remote server
 * using the configuration provided by the user. It supports both SFTP and SSH protocols.
 *
 * @param {ExplorerRoot} [exploreItem] - Optional parameter representing the explorer item.
 * If provided, it will use the configuration from the explorer context.
 *
 * @returns {Promise<void>} - A promise that resolves when the command is handled.
 *
 * The function performs the following steps:
 * 1. Checks if the `exploreItem` is provided and has a valid SFTP configuration.
 * 2. If not, it retrieves all file services and filters them to get SFTP configurations.
 * 3. Prompts the user to select a remote configuration if multiple are available.
 * 4. Constructs the SSH command based on the configuration and user preferences.
 * 5. Opens a new terminal and sends the SSH command to establish the connection.
 */
export default checkCommand({
  id: COMMAND_OPEN_CONNECTION_IN_TERMINAL,

  /**
   * Handles the command to open an SSH connection in a terminal.
   *
   * @param {ExplorerRoot} [exploreItem] - Optional parameter representing the explorer item.
   * If provided, it will use the configuration from the explorer context.
   * 
   * @returns {Promise<void>} - A promise that resolves when the command is handled.
   */
  async handleCommand(exploreItem?: ExplorerRoot): Promise<void> {
    try {
      logger.info('Executing open connection command', { exploreItem });

      let selectedRemoteConfig: any;

      if (exploreItem && exploreItem.explorerContext) {
        selectedRemoteConfig = exploreItem.explorerContext.config;
        if (selectedRemoteConfig.protocol !== 'sftp') {
          logger.warn('Unsupported protocol. Only SFTP is supported.');
          return;
        }
      } else {
        const remoteItems = getAllFileService().reduce<
          { label: string; description: string; config: any }[]
        >((result, fileService) => {
          const config = fileService.getConfig();
          if (config.protocol === 'sftp') {
            result.push({
              label: config.name || config.remotePath,
              description: config.host,
              config,
            });
          }
          return result;
        }, []);

        if (remoteItems.length <= 0) {
          vscode.window.showWarningMessage('No SFTP remote configurations found.');
          logger.warn('No SFTP configurations available.');
          return;
        }

        const item = await vscode.window.showQuickPick(remoteItems, {
          placeHolder: 'Select a folder...',
        });
        if (!item) {
          logger.info('User canceled folder selection.');
          return;
        }

        selectedRemoteConfig = item.config;
      }

      if (!selectedRemoteConfig) {
        logger.error('No valid remote configuration selected.');
        return;
      }

      const sshConfig = {
        host: selectedRemoteConfig.host,
        port: selectedRemoteConfig.port,
        username: selectedRemoteConfig.username,
      };
      const terminal = vscode.window.createTerminal(selectedRemoteConfig.name);

      let sshCommand: string;
      if (shouldUseAgent(selectedRemoteConfig)) {
        sshCommand = getSshCommand(sshConfig);
      } else if (shouldUseKey(selectedRemoteConfig)) {
        sshCommand = getSshCommand(
          sshConfig,
          `-i "${adaptPath(selectedRemoteConfig.privateKeyPath)}"`
        );
      } else {
        sshCommand = getSshCommand(sshConfig);
      }

      if (selectedRemoteConfig.sshCustomParams) {
        sshCommand +=
          ' ' +
          interpolate(selectedRemoteConfig.sshCustomParams, {
            remotePath: selectedRemoteConfig.remotePath || '',
          });
      }

      logger.info('Sending SSH command to terminal', { sshCommand });
      terminal.sendText(sshCommand);
      terminal.show();
    } catch (error) {
      logger.error('Error executing open connection command', { error });
      vscode.window.showErrorMessage('Failed to open SSH connection. See logs for details.');
    }
  },
});
