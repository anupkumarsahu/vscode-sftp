import { reportError } from '../../helper';
import logger from '../../logger';

export interface ITarget {
  fsPath: string;
}

export interface CommandOption {
  [x: string]: any;
}

export default abstract class Command {
  id: string;
  name!: string;
  private _commandDoneListeners: Array<(...args: any[]) => void>;

  constructor() {
    this._commandDoneListeners = [];
  }

  // // Type for listener to specify what arguments it expects
  // onCommandDone(listener) {
  //   this._commandDoneListeners.push(listener);

  //   return () => {
  //     const index = this._commandDoneListeners.indexOf(listener);
  //     if (index > -1) this._commandDoneListeners.splice(index, 1);
  //   };
  // }

  // Type for listener to specify what arguments it expects
  onCommandDone(listener: (...args: any[]) => void) {
    this._commandDoneListeners.push(listener);

    return () => {
      const index = this._commandDoneListeners.indexOf(listener);
      if (index > -1) {
        this._commandDoneListeners.splice(index, 1);
      }
    };
  }

  // Abstract method that child classes must implement
  protected abstract doCommandRun(...args: any[]);

  // // Main method to run the command
  // async run(...args) {
  //   logger.trace(`run command '${this.name}'`);
  //   try {
  //     await this.doCommandRun(...args);
  //   } catch (error) {
  //     reportError(error);
  //   } finally {
  //     this.commitCommandDone(...args);
  //   }
  // }

  // Main method to run the command
  async run(...args: any[]) {
    // Consider changing `logger.trace` to `logger.debug` or `logger.info` based on your needs
    logger.trace(`run command '${this.name}'`);

    try {
      await this.doCommandRun(...args);  // Execute the actual command logic
    } catch (error) {
      // Centralized error reporting
      reportError(error);
    } finally {
      // Notify listeners once the command is done
      this.commitCommandDone(...args);
    }
  }

  // Notify listeners about the completion of the command
  private commitCommandDone(...args: any[]) {
    this._commandDoneListeners.forEach(listener => listener(...args));
  }
}
