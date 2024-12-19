import * as vscode from "vscode";
import * as fse from "fs-extra";
import * as path from "path";
import * as Joi from "joi";
import { CONFIG_PATH } from "../constants";
import { reportError } from "../helper";
import { showTextDocument } from "../host";

// const nullable = schema => schema.optional().allow(null);
// const nullable = schema => schema.allow(null).optional();

const configScheme = Joi.object({
  name: Joi.string(),

  context: Joi.string(),
  protocol: Joi.any().valid("sftp", "ftp", "local"),

  host: Joi.string().required(),
  port: Joi.number().integer(),
  connectTimeout: Joi.number().integer(),
  username: Joi.string().required(),
  // password: nullable(Joi.string()),
  password: Joi.string().allow(null).optional(),

  // agent: nullable(Joi.string()),
  agent: Joi.string().allow(null).optional(),
  // privateKeyPath: nullable(Joi.string()),
  privateKeyPath: Joi.string().allow(null).optional(),
  // passphrase: nullable(Joi.string().allow(true)),
  passphrase: Joi.alternatives()
    .try(Joi.string().allow(null), Joi.boolean())
    .optional(),
  // interactiveAuth: Joi.alternatives([
  //   Joi.boolean(),
  //   Joi.array()
  //     .items(Joi.string()),
  // ]).optional(),
  interactiveAuth: Joi.alternatives()
    .try(Joi.boolean(), Joi.array().items(Joi.string()))
    .optional(),
  // algorithms: Joi.any(),
  algorithms: Joi.object().optional(),
  // sshConfigPath: Joi.string(),
  sshConfigPath: Joi.string().optional(),
  // sshCustomParams: Joi.string(),
  sshCustomParams: Joi.string().optional(),

  // secure: Joi.any().valid(true, false, 'control', 'implicit'),
  secure: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("control", "implicit"))
    .optional(),
  // secureOptions: nullable(Joi.object()),
  secureOptions: Joi.object().allow(null).optional(),
  // passive: Joi.boolean(),
  passive: Joi.boolean().optional(),

  remotePath: Joi.string().required(),
  // uploadOnSave: Joi.boolean(),
  uploadOnSave: Joi.boolean().optional(),
  // useTempFile: Joi.boolean(),
  useTempFile: Joi.boolean().optional(),
  // openSsh: Joi.boolean(),
  openSsh: Joi.boolean().optional(),
  // downloadOnOpen: Joi.boolean().allow('confirm'),
  downloadOnOpen: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("confirm"))
    .optional(),

  // ignore: Joi.array()
  //   .min(0)
  //   .items(Joi.string()),
  ignore: Joi.array().min(0).items(Joi.string()).optional(),
  // ignoreFile: Joi.string(),
  ignoreFile: Joi.string().optional(),
  // watcher: {
  //   files: Joi.string().allow(false, null),
  //   autoUpload: Joi.boolean(),
  //   autoDelete: Joi.boolean(),
  // },
  watcher: Joi.object({
    files: Joi.alternatives().try(Joi.string(), Joi.boolean(), null).optional(),
    autoUpload: Joi.boolean().optional(),
    autoDelete: Joi.boolean().optional(),
  }).optional(),
  // concurrency: Joi.number().integer(),
  concurrency: Joi.number().integer().optional(),

  // syncOption: {
  //   delete: Joi.boolean(),
  //   skipCreate: Joi.boolean(),
  //   ignoreExisting: Joi.boolean(),
  //   update: Joi.boolean(),
  // },
  syncOption: Joi.object({
    delete: Joi.boolean().optional(),
    skipCreate: Joi.boolean().optional(),
    ignoreExisting: Joi.boolean().optional(),
    update: Joi.boolean().optional(),
  }).optional(),
  // remoteTimeOffsetInHours: Joi.number(),
  remoteTimeOffsetInHours: Joi.number().optional(),

  // remoteExplorer: {
  //   filesExclude: Joi.array()
  //     .min(0)
  //     .items(Joi.string()),
  //   order: Joi.number(),
  // },
  remoteExplorer: Joi.object({
    filesExclude: Joi.array().items(Joi.string()).optional(),
    order: Joi.number().optional(),
  }).optional(),
});

const defaultConfig = {
  // common
  // name: undefined,
  remotePath: "./",
  uploadOnSave: false,
  useTempFile: false,
  openSsh: false,
  downloadOnOpen: false,
  ignore: [],
  // ignoreFile: undefined,
  // watcher: {
  //   files: false,
  //   autoUpload: false,
  //   autoDelete: false,
  // },
  concurrency: 4,
  // limitOpenFilesOnRemote: false

  protocol: "sftp",

  // server common
  // host,
  // port,
  // username,
  // password,
  connectTimeout: 10 * 1000,

  // sftp
  // agent,
  // privateKeyPath,
  // passphrase,
  interactiveAuth: false,
  // algorithms,

  // ftp
  secure: false,
  // secureOptions,
  // passive: false,
  remoteTimeOffsetInHours: 0,

  remoteExplorer: {
    order: 0,
  },
};

function mergedDefault(config) {
  return {
    ...defaultConfig,
    ...config,
  };
}

function getConfigPath(basePath) {
  return path.join(basePath, CONFIG_PATH);
}

// export function validateConfig(config) {
//   const { error } = Joi.validate(config, configScheme, {
//     allowUnknown: true,
//     convert: false,
//     language: {
//       object: {
//         child: '!!prop "{{!child}}" fails because {{reason}}',
//       },
//     },
//   });
//   return error;
// }

// interface ConfigValidator {
//   message: string;
// }

export function validateConfig(config: any): { message: string } {
  const { error } = configScheme.validate(config, {
    allowUnknown: true,
    convert: false,
    messages: {
      "object.child": '!!prop "{{!child}}" fails because {{reason}}',
    },
  });

  if (error) {
    return { message: error.message }; // Convert the error to a consistent format
  }

  return { message: "Validation passed." }; // Return undefined if no error exists
}

export function readConfigsFromFile(configPath): Promise<any[]> {
  return fse.readJson(configPath).then((config) => {
    const configs = Array.isArray(config) ? config : [config];
    return configs.map(mergedDefault);
  });
}

export function tryLoadConfigs(workspace): Promise<any[]> {
  const configPath = getConfigPath(workspace);
  return fse.pathExists(configPath).then(
    (exist) => {
      if (exist) {
        return readConfigsFromFile(configPath);
      }
      return [];
    },
    (_) => [],
  );
}

// export function getConfig(activityPath: string) {
//   const config = configTrie.findPrefix(normalizePath(activityPath));
//   if (!config) {
//     throw new Error(`(${activityPath}) config file not found`);
//   }

//   return normalizeConfig(config);
// }

export function newConfig(basePath) {
  const configPath = getConfigPath(basePath);

  return fse
    .pathExists(configPath)
    .then((exist) => {
      if (exist) {
        return showTextDocument(vscode.Uri.file(configPath));
      }

      return fse
        .outputJson(
          configPath,
          {
            name: "My Server",
            host: "localhost",
            protocol: "sftp",
            port: 22,
            username: "username",
            remotePath: "/",
            uploadOnSave: false,
            useTempFile: false,
            openSsh: false,
          },
          { spaces: 4 },
        )
        .then(() => showTextDocument(vscode.Uri.file(configPath)));
    })
    .catch(reportError);
}
