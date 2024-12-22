import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as sshConfig from 'ssh-config';
import app from '../app';
import logger from '../logger';
import { getUserSetting } from '../host';
import { replaceHomePath, resolvePath } from '../helper';
import { SETTING_KEY_REMOTE } from '../constants';
import upath from './upath';
import Ignore from './ignore';
import { FileSystem } from './fs';
import Scheduler from './scheduler';
import { createRemoteIfNoneExist, removeRemoteFs } from './remoteFs';
import TransferTask from './transferTask';
import localFs from './localFs';

type Omit<T, U> = Pick<T, Exclude<keyof T, U>>;

interface Root {
  name: string;
  context: string;
  watcher: WatcherConfig;
  defaultProfile: string;
}

interface Host {
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
  connectTimeout: number;
}

interface ServiceOption {
  protocol: string;
  remote?: string;
  uploadOnSave: boolean;
  useTempFile: boolean;
  openSsh: boolean;
  downloadOnOpen: boolean | 'confirm';
  filePerm?: number;
  dirPerm?: number;
  syncOption: {
    delete: boolean;
    skipCreate: boolean;
    ignoreExisting: boolean;
    update: boolean;
  };
  ignore: string[];
  ignoreFile: string;
  remoteExplorer: {
    filesExclude?: string[];
    order: number;
  };
  remoteTimeOffsetInHours: number;
  limitOpenFilesOnRemote: number | true;
}

interface WatcherConfig {
  files: false | string;
  autoUpload: boolean;
  autoDelete: boolean;
}

interface SftpOption {
  // sftp
  agent?: string;
  privateKeyPath?: string;
  passphrase: string | true;
  interactiveAuth: boolean | string[];
  algorithms: any;
  sshConfigPath?: string;
  concurrency: number;
  sshCustomParams?: string;
  hop: (Host & SftpOption)[] | (Host & SftpOption);
}

interface FtpOption {
  secure: boolean | 'control' | 'implicit';
  secureOptions: any;
}

export interface FileServiceConfig
  extends Root,
    Host,
    ServiceOption,
    SftpOption,
    FtpOption {
  profiles?: {
    [x: string]: FileServiceConfig;
  };
}

export interface ServiceConfig
  extends Root,
    Host,
    Omit<ServiceOption, 'ignore'>,
    SftpOption,
    FtpOption {
  ignore?: ((fsPath: string) => boolean) | null;
}

export interface WatcherService {
  create(watcherBase: string, watcherConfig: WatcherConfig): any;
  dispose(watcherBase: string): void;
}

interface TransferScheduler {
  // readonly _scheduler: Scheduler;
  size: number;
  add(x: TransferTask): void;
  run(): Promise<void>;
  stop(): void;
}

type ConfigValidator = (x: any) => { message: string };

const DEFAULT_SSHCONFIG_FILE = '~/.ssh/config';

/**
 * Retrieves a list of ignored files from the configuration.
 * Combines the `ignore` list from the configuration and the contents of the specified `ignoreFile`.
 *
 * @param {FileServiceConfig} config - The file service configuration.
 * @returns {string[]} - An array of file patterns to ignore.
 * @throws {Error} - Throws an error if the `ignoreFile` does not exist.
 */
function filesIgnoredFromConfig(config: FileServiceConfig): string[] {
  const cache = app.fsCache;

  // Initialize the ignore list with the `ignore` property from the config
  const ignore: string[] = Array.isArray(config.ignore) && config.ignore.length 
    ? config.ignore 
    : [];

  logger.info('Processing ignored files from config...', { config });

  const ignoreFile = config.ignoreFile;
  if (!ignoreFile) {
    // If no ignoreFile is specified, return the ignore list
    logger.info('No ignoreFile specified in the configuration.');
    return ignore;
  }

  logger.debug('Checking for ignoreFile...', { ignoreFile });

  let ignoreFromFile = ''; // Initialize as an empty string
  if (cache.has(ignoreFile)) {
    // Use cached content if available
    const cachedContent = cache.get(ignoreFile);
    if (typeof cachedContent === 'string') {
      ignoreFromFile = cachedContent;
      logger.debug('Loaded ignoreFile from cache.', { ignoreFile });
    } else {
      logger.error('Invalid cached content for ignoreFile.', { ignoreFile, cachedContent });
      throw new Error(`Cached content for ${ignoreFile} is not a string.`);
    }
  } else if (fs.existsSync(ignoreFile)) {
    // Read the ignoreFile if it exists
    try {
      ignoreFromFile = fs.readFileSync(ignoreFile, 'utf8');
      cache.set(ignoreFile, ignoreFromFile);
      logger.debug('Loaded ignoreFile from disk and cached it.', { ignoreFile });
    } catch (err) {
      logger.error('Failed to read ignoreFile.', { ignoreFile, error: err.message });
      throw new Error(`Error reading ignoreFile ${ignoreFile}: ${err.message}`);
    }
  } else {
    // Throw an error if the ignoreFile does not exist
    logger.error(`Ignore file not found: ${ignoreFile}`);
    throw new Error(`File ${ignoreFile} not found. Check your config of "ignoreFile".`);
  }

  // Combine the ignore list and the content of the ignore file, split into lines
  const combinedIgnore = ignore.concat(ignoreFromFile.split(/\r?\n/g).filter(line => line.trim()));
  logger.info('Combined ignore list generated.', { combinedIgnore });

  return combinedIgnore;
}

function getHostInfo(config) {
  logger.info('Starting getHostInfo of fileService.ts');
  
  const ignoreOptions = [
    'name',
    'remotePath',
    'uploadOnSave',
    'useTempFile',
    'openSsh',
    'downloadOnOpen',
    'ignore',
    'ignoreFile',
    'watcher',
    'concurrency',
    'syncOption',
    'sshConfigPath',
  ];

  const result = Object.keys(config).reduce((obj, key) => {
    if (ignoreOptions.indexOf(key) === -1) {
      obj[key] = config[key];
    }
    // Log after each key iteration for better clarity on what's happening
    logger.debug(`Checking key: ${key}, added to result: ${!(ignoreOptions.indexOf(key) === -1)}`);
    return obj;
  }, {});

  // Log the final object after filtering, but only once to avoid excessive logging
  logger.info(`Filtered config result: ${JSON.stringify(result)}`);

  return result;
}


function chooseDefaultPort(protocol) {
  return protocol === 'ftp' ? 21 : 22;
}

function setConfigValue(config, key, value) {
  if (config[key] === undefined) {
    if (key === 'port') {
      config[key] = parseInt(value, 10);
    } else {
      config[key] = value;
    }
  }
}

function mergeConfigWithExternalRefer(
  config: FileServiceConfig
): FileServiceConfig {
  // Create a copy of the config object to avoid mutating the original
  const mergedConfig = { ...config };

  logger.info('Starting mergeConfigWithExternalRefer...');
  logger.debug('Input configuration:', config);

  // Check and merge configuration from remote if `config.remote` exists
  if (config.remote) {
    logger.info(`Merging remote configuration for key: "${config.remote}"`);
    const remoteMap = getUserSetting(SETTING_KEY_REMOTE);
    const remote = remoteMap.get<Record<string, any>>(config.remote);

    if (!remote) {
      const errorMessage = `Cannot find remote configuration for "${config.remote}".`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Key mappings for remote configurations
    const remoteKeyMapping = new Map([['scheme', 'protocol']]);
    // Keys to ignore during merging
    const remoteKeysIgnored = new Set(['rootPath']);

    Object.entries(remote).forEach(([key, value]) => {
      if (remoteKeysIgnored.has(key)) {
        logger.debug(`Ignoring remote key: "${key}"`);
        return;
      }

      const targetKey = remoteKeyMapping.get(key) || key;
      logger.debug(`Mapping remote key: "${key}" -> "${targetKey}"`);
      setConfigValue(mergedConfig, targetKey, value);
    });

    logger.info('Remote configuration merged successfully.');
  }

  // If the protocol is not "sftp", no further processing is required
  if (config.protocol !== 'sftp') {
    logger.info(`Protocol is not "sftp". Returning merged configuration.`);
    return mergedConfig;
  }

  logger.info('Protocol is "sftp". Proceeding with SSH configuration merge.');

  // Resolve the SSH configuration file path
  const sshConfigPath = replaceHomePath(
    config.sshConfigPath || DEFAULT_SSHCONFIG_FILE
  );

  logger.debug(`Resolved SSH config path: "${sshConfigPath}"`);

  // Use cache for loading SSH config content
  const cache = app.fsCache;
  let sshConfigContent = cache.get(sshConfigPath);

  if (!sshConfigContent) {
    logger.info(`SSH config not found in cache. Reading from file: "${sshConfigPath}"`);
    try {
      sshConfigContent = fs.readFileSync(sshConfigPath, 'utf8');
      cache.set(sshConfigPath, sshConfigContent);
      logger.info(`SSH config file loaded and cached.`);
    } catch (error) {
      const errorMessage = `Failed to load SSH configuration from "${sshConfigPath}": ${error.message}`;
      logger.warn(errorMessage);
      return mergedConfig; // Return without modifying the config
    }
  } else {
    logger.info('SSH config loaded from cache.');
  }

  // Parse the SSH configuration file
  const parsedSSHConfig = sshConfig.parse(sshConfigContent);
  const section = parsedSSHConfig.find({ Host: mergedConfig.host });

  if (!section) {
    logger.debug(`No SSH configuration found for host "${mergedConfig.host}".`);
    return mergedConfig;
  }

  logger.info(`SSH configuration found for host "${mergedConfig.host}". Merging...`);

  // Map SSH configuration keys to `mergedConfig`
  const sshKeyMapping = new Map([
    ['hostname', 'host'],
    ['port', 'port'],
    ['user', 'username'],
    ['identityfile', 'privateKeyPath'],
    ['serveraliveinterval', 'keepalive'],
    ['connecttimeout', 'connTimeout'],
  ]);

  section.config.forEach((line) => {
    if (!line.param) return;

    const key = sshKeyMapping.get(line.param.toLowerCase());
    if (key) {
      logger.debug(`Mapping SSH config key: "${line.param}" -> "${key}"`);
      if (key === 'host') {
        mergedConfig[key] = line.value;
      } else {
        setConfigValue(mergedConfig, key, line.value);
      }
    }
  });

  logger.info('SSH configuration merged successfully.');
  logger.debug('Final merged configuration:', mergedConfig);

  return mergedConfig;
}

function getCompleteConfig(
  config: FileServiceConfig,
  workspace: string
): FileServiceConfig {
  logger.info('Starting configuration merge and resolution...', { initialConfig: config });

  // Merge external configuration
  const mergedConfig = mergeConfigWithExternalRefer(config);
  logger.debug('Merged config with external references:', { mergedConfig });

  // Handle conflicting options: "agent" and "privateKeyPath"
  if (mergedConfig.agent && mergedConfig.privateKeyPath) {
    logger.warn(
      'Config Option Conflicted. You are specifying "agent" and "privateKey" at the same time, ' +
      'the later will be ignored.'
    );
  }

  // Normalize the remotePath to ensure it doesn't start with './'
  mergedConfig.remotePath = upath.normalize(mergedConfig.remotePath);
  logger.debug('Normalized remote path:', { remotePath: mergedConfig.remotePath });

  // Resolve paths for privateKey and ignoreFile based on workspace
  if (mergedConfig.privateKeyPath) {
    mergedConfig.privateKeyPath = resolvePath(workspace, mergedConfig.privateKeyPath);
    logger.debug('Resolved private key path:', { privateKeyPath: mergedConfig.privateKeyPath });
  }

  if (mergedConfig.ignoreFile) {
    mergedConfig.ignoreFile = resolvePath(workspace, mergedConfig.ignoreFile);
    logger.debug('Resolved ignore file path:', { ignoreFile: mergedConfig.ignoreFile });
  }

  // Resolve agent path if it starts with an environment variable placeholder
  if (mergedConfig.agent && mergedConfig.agent.startsWith('$')) {
    const envVarName = mergedConfig.agent.slice(1);
    const envVarValue = process.env[envVarName];

    if (!envVarValue) {
      const errorMsg = `Environment variable "${envVarName}" not found`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    mergedConfig.agent = envVarValue;
    logger.debug('Resolved agent from environment variable:', { agent: mergedConfig.agent });
  }

  logger.info('Configuration resolved successfully.', { finalConfig: mergedConfig });

  return mergedConfig;
}

function mergeProfile(
  target: FileServiceConfig,
  source: FileServiceConfig
): FileServiceConfig {
  // Create a shallow copy of the target object and exclude the 'profiles' property
  const res: FileServiceConfig = { ...target };
  delete res.profiles;

  logger.info('Starting profile merge...', { targetConfig: target, sourceConfig: source });

  // Iterate over each property in the source configuration and merge it into the result
  Object.keys(source).forEach((key) => {
    if (key === 'ignore') {
      // Special handling for 'ignore' property if both target and source have 'ignore' arrays
      if (Array.isArray(res.ignore) && Array.isArray(source.ignore)) {
        logger.debug(`Merging 'ignore' arrays...`, {
          targetIgnore: res.ignore,
          sourceIgnore: source.ignore,
        });
        // Combine arrays, preserving both
        res.ignore = [...res.ignore, ...source.ignore];
      } else {
        // Handle cases where 'ignore' is not a valid array
        logger.warn(
          `Invalid 'ignore' property format in either target or source. Replacing 'ignore' with source.`,
          { targetIgnore: res.ignore, sourceIgnore: source.ignore }
        );
        // Replace with the source's 'ignore' if it's a valid array, otherwise default to an empty array
        res.ignore = Array.isArray(source.ignore) ? source.ignore : [];
      }
    } else {
      // Handle merging of all other properties
      logger.debug(`Merging property '${key}'...`, { value: source[key] });
      res[key] = source[key];
    }
  });

  logger.info('Profiles merged successfully.', { mergedConfig: res });

  return res;
}


enum Event {
  BEFORE_TRANSFER = 'BEFORE_TRANSFER',
  AFTER_TRANSFER = 'AFTER_TRANSFER',
}

let id = 0;

export default class FileService {
  private _eventEmitter: EventEmitter = new EventEmitter();
  private _name: string;
  private _watcherConfig: WatcherConfig;
  private _profiles: string[] = [];
  private _pendingTransferTasks: Set<TransferTask> = new Set();
  private _transferSchedulers: TransferScheduler[] = [];
  private _config: FileServiceConfig;
  private _configValidator: ConfigValidator;
  private _watcherService: WatcherService = { create: () => {}, dispose: () => {} };
  
  id: number;
  baseDir: string;
  workspace: string;

  constructor(baseDir: string, workspace: string, config: FileServiceConfig) {
    this.id = ++id;
    this.workspace = workspace;
    this.baseDir = baseDir;
    this._watcherConfig = config.watcher;
    this._config = config;

    if (config.profiles) {
      this._profiles = Object.keys(config.profiles);
    }
  }

  get name(): string {
    return this._name || '';
  }

  set name(name: string) {
    this._name = name;
  }

  setConfigValidator(configValidator: ConfigValidator) {
    this._configValidator = configValidator;
  }

  setWatcherService(watcherService: WatcherService) {
    this._disposeWatcher();
    this._watcherService = watcherService;
    this._createWatcher();
  }

  getAvailableProfiles(): string[] {
    return this._profiles;
  }

  getPendingTransferTasks(): TransferTask[] {
    return Array.from(this._pendingTransferTasks);
  }

  isTransferring(): boolean {
    return this._transferSchedulers.length > 0;
  }

  cancelTransferTasks() {
    this._transferSchedulers.forEach(transfer => transfer.stop());
    this._transferSchedulers.length = 0;
    this._pendingTransferTasks.forEach(t => t.cancel());
    this._pendingTransferTasks.clear();
  }

  beforeTransfer(listener: (task: TransferTask) => void) {
    this._eventEmitter.on(Event.BEFORE_TRANSFER, listener);
  }

  afterTransfer(listener: (err: Error | null, task: TransferTask) => void) {
    this._eventEmitter.on(Event.AFTER_TRANSFER, listener);
  }

  createTransferScheduler(concurrency): TransferScheduler {
    const scheduler = new Scheduler({
      autoStart: false,
      concurrency,
    });

    scheduler.onTaskStart((task) => {
      this._pendingTransferTasks.add(task as TransferTask);
      this._eventEmitter.emit(Event.BEFORE_TRANSFER, task);
    });

    scheduler.onTaskDone((err, task) => {
      this._pendingTransferTasks.delete(task as TransferTask);
      this._eventEmitter.emit(Event.AFTER_TRANSFER, err, task);
    });

    const transferScheduler: TransferScheduler = {
      get size() {
        return scheduler.size;
      },
      stop() {
        scheduler.empty();
      },
      add(task: TransferTask) {
        scheduler.add(task);
      },
      run() {
        if (scheduler.size <= 0) {
          this._removeScheduler(transferScheduler);
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          scheduler.onIdle(() => {
            this._removeScheduler(transferScheduler);
            resolve();
          });
          scheduler.start();
        });
      },
    };

    this._storeScheduler(transferScheduler);
    return transferScheduler;
  }

  getLocalFileSystem(): FileSystem {
    return localFs;
  }

  getRemoteFileSystem(config: ServiceConfig): Promise<FileSystem> {
    return createRemoteIfNoneExist(getHostInfo(config));
  }

  getConfig(useProfile = app.state.profile): ServiceConfig {
    try {
      let config = this._config;
      logger.debug(`Current config: ${JSON.stringify(config)}`);
  
      const hasProfiles = config.profiles && Object.keys(config.profiles).length > 0;
      if (hasProfiles && useProfile) {
        logger.debug(`Using profile: ${useProfile}`);
        const profile = config.profiles![useProfile];
  
        if (!profile) {
          const errorMsg = `Unknown Profile "${useProfile}". Please check your profile setting.`;
          logger.error(errorMsg);
          throw new Error(errorMsg);
        }
  
        config = mergeProfile(config, profile);
      }
  
      const completeConfig = getCompleteConfig(config, this.workspace);
  
      if (this._configValidator) {
        logger.debug("Starting configuration validation...", { completeConfig });

        const error = this._configValidator(completeConfig);

        if (!error) {
          const errorMsg = `Config validation failed: ${error}.`;

          logger.error(errorMsg, {validationError: error, completeConfig,  });
          throw new Error(errorMsg);
        }
      }
  
      logger.debug('Configuration validation passed successfully.', { completeConfig });
      return this._resolveServiceConfig(completeConfig);
  
    } catch (err) {
      logger.critical('Error in getConfig:', err);
      throw err;
    }
  }

  getAllConfig(): Array<ServiceConfig> {
    const profiles = this._config.profiles;
    return profiles ? Object.keys(profiles).map(p => this.getConfig(p)) : [];
  }

  dispose() {
    this._disposeWatcher();
    this._disposeFileSystem();
  }

  private _resolveServiceConfig(fileServiceConfig: FileServiceConfig): ServiceConfig {
    const serviceConfig: ServiceConfig = fileServiceConfig as any;
    if (serviceConfig.port === undefined) {
      serviceConfig.port = chooseDefaultPort(serviceConfig.protocol);
    }
    if (serviceConfig.protocol === 'ftp') {
      serviceConfig.concurrency = 1;
    }
    serviceConfig.ignore = this._createIgnoreFn(fileServiceConfig);
    return serviceConfig;
  }

  private _storeScheduler(scheduler: TransferScheduler) {
    this._transferSchedulers.push(scheduler);
  }

  // private _removeScheduler(scheduler: TransferScheduler) {
  //   const index = this._transferSchedulers.indexOf(scheduler);
  //   if (index !== -1) {
  //     this._transferSchedulers.splice(index, 1);
  //   }
  // }

  private _createIgnoreFn(config: FileServiceConfig): ServiceConfig['ignore'] {
    const ignoreConfig = filesIgnoredFromConfig(config);
    if (ignoreConfig.length <= 0) return null;

    const ignore = Ignore.from(ignoreConfig);
    return fsPath => {
      const normalizedPath = path.normalize(fsPath);
      let relativePath = normalizedPath.startsWith(this.baseDir)
        ? path.relative(this.baseDir, fsPath)
        : upath.relative(config.remotePath, fsPath);
      return relativePath !== '' && ignore.ignores(relativePath);
    };
  }

  private _createWatcher() {
    this._watcherService.create(this.baseDir, this._watcherConfig);
  }

  private _disposeWatcher() {
    this._watcherService.dispose(this.baseDir);
  }

  private _disposeFileSystem() {
    return removeRemoteFs(getHostInfo(this.getConfig()));
  }
}

