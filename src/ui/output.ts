import * as vscode from 'vscode';
import app from '../app';
import { EXTENSION_NAME } from '../constants';
import StatusBarItem from './statusBarItem';

let isShow = false;
const outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);

/**
 * Shows the output channel and updates the status bar item.
 */
export function show(): void {
  app.sftpBarItem.updateStatus(StatusBarItem.Status.ok);
  outputChannel.show();
  isShow = true;
}

/**
 * Hides the output channel and updates the status bar item.
 */
export function hide(): void {
  outputChannel.hide();
  isShow = false;
}

/**
 * Toggles the visibility of the output channel.
 */
export function toggle(): void {
  if (isShow) {
    hide();
  } else {
    show();
  }
}

/**
 * Prints messages to the output channel.
 * Formats arguments, including errors and objects, for better readability.
 * @param args - Arguments to be logged.
 */
export function print(...args: unknown[]): void {
  const msg = args
    .map(arg => {
      try {
        if (arg instanceof Error) {
          return arg.stack || arg.message;
        } else if (typeof arg === 'object' && arg !== null) {
          return JSON.stringify(arg, null, 2);
        } else if (arg === undefined || arg === null) {
          return String(arg);
        }
        return arg.toString();
      } catch (error) {
        return '[Error serializing argument]';
      }
    })
    .join(' ');

  outputChannel.appendLine(msg);
}