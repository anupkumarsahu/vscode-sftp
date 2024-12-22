import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as output from './ui/output';
import { getExtensionSetting } from './modules/ext';

const extSetting = getExtensionSetting();

const debug = extSetting.debug || extSetting.printDebugLog;

// Get the workspace folder path
const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
if (!workspaceFolder) {
  throw new Error('Workspace folder not found!'); // Ensure workspaceFolder is a string
}

// Define the log folder and file
const logFolderPath = path.join(workspaceFolder, '.vscode-logs'); // Folder for logs within workspace
const logFilePath = path.join(logFolderPath, 'extension.log'); // Log file path

// Ensure the log folder exists
if (!fs.existsSync(logFolderPath)) {
  try {
    fs.mkdirSync(logFolderPath, { recursive: true } as any);
  } catch (err) {
    console.error('Failed to create log folder:', err);
  }
}

// // Define a function to append logs to a file
// function appendLogToFile(message: string) {
//   fs.appendFile(logFilePath, message + '\n', (err) => {
//     if (err) {
//       console.error('Error writing to log file:', err);
//     }
//   });
// }

// Define a function to append logs to a file (synchronous)
function appendLogToFile(message: string) {
  try {
    fs.appendFileSync(logFilePath, message + '\n');
  } catch (err) {
    console.error('Error writing to log file:', err);
  }
}


// Add "Starting log message" to the log file
appendLogToFile(`================================================================`);
appendLogToFile(`=== Starting log for extension - ${new Date().toISOString()} ===`);
appendLogToFile(`================================================================`);

const paddingTime = time => ('00' + time).slice(-2);

export interface Logger {
  trace(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string | Error, ...args: any[]): void;
  critical(message: string | Error, ...args: any[]): void;
}

class VSCodeLogger implements Logger {

  private formatLog(level: string, message: string, ...args: any[]): string {
    const now = new Date();
    const timestamp = `[${now.getFullYear()}-${paddingTime(
      now.getMonth() + 1
    )}-${paddingTime(now.getDate())} ${paddingTime(now.getHours())}:${paddingTime(
      now.getMinutes()
    )}:${paddingTime(now.getSeconds())}]`;
    const formattedArgs = args.length > 0 ? JSON.stringify(args) : '';
    return `${timestamp} [${level}] ${message} ${formattedArgs}`;
  }

  private logToOutput(level: string, message: string, ...args: any[]) {
    const formattedMessage = this.formatLog(level, message, ...args);
    output.print(formattedMessage);
    appendLogToFile(formattedMessage);
  }
  
  log(message: string, ...args: any[]) {
    const now = new Date();
    const month = paddingTime(now.getMonth() + 1);
    const date = paddingTime(now.getDate());
    const h = paddingTime(now.getHours());
    const m = paddingTime(now.getMinutes());
    const s = paddingTime(now.getSeconds());

    const formattedMessage = `[${month}-${date} ${h}:${m}:${s}] ${message} ${args.join(' ')}`;

    // Output to the UI
    output.print(formattedMessage);

    // output.print(`[${month}-${date} ${h}:${m}:${s}]`, message, ...args);

    // Append to the log file
    appendLogToFile(formattedMessage);
  }

  trace(message: string, ...args: any[]) {
    if (debug) {
      this.logToOutput('trace', message, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (debug) {
      this.logToOutput('debug', message, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    this.logToOutput('info', message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.logToOutput('warn', message, ...args);
  }

  error(message: string | Error, ...args: any[]) {
    this.logToOutput('error', message instanceof Error ? message.stack || message.message : message, ...args);
  }

  critical(message: string | Error, ...args: any[]) {
    this.logToOutput('critical', message instanceof Error ? message.stack || message.message : message, ...args);
  }
}

const logger = new VSCodeLogger();

export default logger;
