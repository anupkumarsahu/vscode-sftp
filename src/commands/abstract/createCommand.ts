import { Uri } from 'vscode';
import logger from '../../logger';
import { reportError } from '../../helper';
import { handleCtxFromUri, allHandleCtxFromUri, FileHandlerContext } from '../../fileHandlers';
import Command from './command';

interface BaseCommandOption {
  id: string;
  name?: string;
}

interface CommandOption extends BaseCommandOption {
  handleCommand: (this: Command, ...args: any[]) => unknown | Promise<unknown>;
}

interface FileCommandOption extends BaseCommandOption {
  handleFile: (ctx: FileHandlerContext) => Promise<unknown>;
  getFileTarget: (...args: any[]) => undefined | Uri | Uri[] | Promise<undefined | Uri | Uri[]>;
}

function checkType<T>() {
  return (a: T) => a;
}

export const checkCommand = checkType<CommandOption>();
export const checkFileCommand = checkType<FileCommandOption>();

export function createCommand(commandOption: CommandOption & { name: string }) {
  logger.info(`function createCommand of createCommand.ts`)
  logger.debug(`Command ID: ${commandOption.id}, Command Name: ${commandOption.name}`);

  return class NormalCommand extends Command {
    id = commandOption.id;
    name = commandOption.name;

    // constructor() {
    //   super();
    //   this.id = commandOption.id;
    //   this.name = commandOption.name;
    // }

    constructor() {
      super();
      logger.debug(`Created NormalCommand instance for: ${this.name}`);
    }

    doCommandRun(...args) {
      logger.debug(`Executing command: ${this.name} with args: ${JSON.stringify(args)}`);
      // commandOption.handleCommand.apply(this, args);
      try {
        commandOption.handleCommand.apply(this, args);
      } catch (error) {
        logger.error(`Error in command ${this.name}:`, error);
      }
    }
  };
}

export function createFileCommand(commandOption: FileCommandOption & { name: string }) {
  logger.info(`function createFileCommand of createCommand.ts`);

  return class FileCommand extends Command {
    id = commandOption.id;
    name = commandOption.name;

    // constructor() {
    //   super();
    //   this.id = commandOption.id;
    //   this.name = commandOption.name;
    // }

    constructor() {
      super();
      logger.info(`FileCommand initialized: ${this.name} (ID: ${this.id})`);
    }


    protected async doCommandRun(...args) {
      logger.debug(`Executing FileCommand: ${this.name} with args: ${JSON.stringify(args)}`);

  //     const target = await commandOption.getFileTarget(...args);
  //     if (!target) {
  //       logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
  //       return;
  //     }

  //     const targetList: Uri[] = Array.isArray(target) ? target : [target];
  //     const pendingTasks = targetList.map(async uri => {
  //       try {
  //         await commandOption.handleFile(handleCtxFromUri(uri));
  //       } catch (error) {
  //         reportError(error);
  //       }
  //     });

  //     await Promise.all(pendingTasks);
  //   }
  // };
  try {
    const target = await commandOption.getFileTarget(...args);
    if (!target) {
      logger.warn(`Command "${this.name}" canceled: No target provided.`);
      return;
    }

    const targetList: Uri[] = Array.isArray(target) ? target : [target];
    logger.info(`Command "${this.name}" will process ${targetList.length} target(s).`);

    const pendingTasks = targetList.map(async (uri) => {
      try {
        logger.debug(`Processing target URI: ${uri.toString()}`);
        await commandOption.handleFile(handleCtxFromUri(uri));
      } catch (error) {
        logger.error(`Error processing URI: ${uri.toString()}`, error);
        reportError(error);
      }
    });

    await Promise.all(pendingTasks);
    logger.info(`Command "${this.name}" completed successfully.`);
  } catch (error) {
    logger.error(`Error executing command "${this.name}":`, error);
    reportError(error);
  }
}
};
}

export function createFileMultiCommand(commandOption: FileCommandOption & { name: string }) {
  return class FileCommand extends Command {
    constructor() {
      super();
      this.id = commandOption.id;
      this.name = commandOption.name;
    }

    protected async doCommandRun(...args) {
      const target = await commandOption.getFileTarget(...args);
      if (!target) {
        logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
        return;
      }

      const targetList: Uri[] = Array.isArray(target) ? target : [target];
      const pendingTasks = targetList.map(async uri => {
        try {
          await Promise.all(allHandleCtxFromUri(uri).map(commandOption.handleFile));
        } catch (error) {
          reportError(error);
        }
      });

      await Promise.all(pendingTasks);
    }
  };
}