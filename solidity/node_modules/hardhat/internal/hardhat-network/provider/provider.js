"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHardhatNetworkProvider = exports.EdrProviderWrapper = exports.getGlobalEdrContext = exports.DEFAULT_COINBASE = void 0;
const util_1 = require("@ethereumjs/util");
const edr_1 = require("@nomicfoundation/edr");
const picocolors_1 = __importDefault(require("picocolors"));
const debug_1 = __importDefault(require("debug"));
const events_1 = require("events");
const fs_extra_1 = __importDefault(require("fs-extra"));
const t = __importStar(require("io-ts"));
const napi_rs_1 = require("../../../common/napi-rs");
const constants_1 = require("../../constants");
const base_types_1 = require("../../core/jsonrpc/types/base-types");
const hardhat_network_1 = require("../../core/jsonrpc/types/input/hardhat-network");
const solc_1 = require("../../core/jsonrpc/types/input/solc");
const validation_1 = require("../../core/jsonrpc/types/input/validation");
const errors_1 = require("../../core/providers/errors");
const http_1 = require("../../core/providers/http");
const hardforks_1 = require("../../util/hardforks");
const consoleLogger_1 = require("../stack-traces/consoleLogger");
const solidity_errors_1 = require("../stack-traces/solidity-errors");
const packageInfo_1 = require("../../util/packageInfo");
const convertToEdr_1 = require("./utils/convertToEdr");
const logger_1 = require("./modules/logger");
const minimal_vm_1 = require("./vm/minimal-vm");
const log = (0, debug_1.default)("hardhat:core:hardhat-network:provider");
/* eslint-disable @nomicfoundation/hardhat-internal-rules/only-hardhat-error */
exports.DEFAULT_COINBASE = "0xc014ba5ec014ba5ec014ba5ec014ba5ec014ba5e";
let _globalEdrContext;
// Lazy initialize the global EDR context.
async function getGlobalEdrContext() {
    const { EdrContext, GENERIC_CHAIN_TYPE, genericChainProviderFactory } = (0, napi_rs_1.requireNapiRsModule)("@nomicfoundation/edr");
    if (_globalEdrContext === undefined) {
        // Only one is allowed to exist
        _globalEdrContext = new EdrContext();
        await _globalEdrContext.registerProviderFactory(GENERIC_CHAIN_TYPE, genericChainProviderFactory());
    }
    return _globalEdrContext;
}
exports.getGlobalEdrContext = getGlobalEdrContext;
class EdrProviderEventAdapter extends events_1.EventEmitter {
}
class EdrProviderWrapper extends events_1.EventEmitter {
    constructor(_provider, _providerConfig, _loggerConfig, 
    // we add this for backwards-compatibility with plugins like solidity-coverage
    _node, _subscriptionConfig, 
    // Store the initial `genesisAccounts`, `cacheDir`, and `chainOverrides` for `hardhat_reset`
    // calls, in case there is switching between local and fork configurations.
    _originalGenesisAccounts, _originalCacheDir, _originalChainOverrides) {
        super();
        this._provider = _provider;
        this._providerConfig = _providerConfig;
        this._loggerConfig = _loggerConfig;
        this._node = _node;
        this._subscriptionConfig = _subscriptionConfig;
        this._originalGenesisAccounts = _originalGenesisAccounts;
        this._originalCacheDir = _originalCacheDir;
        this._originalChainOverrides = _originalChainOverrides;
        this._failedStackTraces = 0;
    }
    static async create(config, loggerConfig, tracingConfig) {
        const { GENERIC_CHAIN_TYPE } = (0, napi_rs_1.requireNapiRsModule)("@nomicfoundation/edr");
        const coinbase = config.coinbase ?? exports.DEFAULT_COINBASE;
        const chainOverrides = Array.from(config.chains, ([chainId, hardforkConfig]) => {
            return {
                chainId: BigInt(chainId),
                name: "Unknown",
                hardforks: Array.from(hardforkConfig.hardforkHistory, ([hardfork, blockNumber]) => {
                    return {
                        condition: { blockNumber: BigInt(blockNumber) },
                        hardfork: (0, convertToEdr_1.ethereumsjsHardforkToEdrSpecId)((0, hardforks_1.getHardforkName)(hardfork)),
                    };
                }),
            };
        });
        const cacheDir = config.forkCachePath;
        let fork;
        if (config.forkConfig !== undefined) {
            fork = {
                blockNumber: config.forkConfig.blockNumber !== undefined
                    ? BigInt(config.forkConfig.blockNumber)
                    : undefined,
                cacheDir,
                chainOverrides,
                httpHeaders: (0, convertToEdr_1.httpHeadersToEdr)(config.forkConfig.httpHeaders),
                url: config.forkConfig.jsonRpcUrl,
            };
        }
        const initialDate = config.initialDate !== undefined
            ? BigInt(Math.floor(config.initialDate.getTime() / 1000))
            : undefined;
        // To accommodate construction ordering, we need an adapter to forward events
        // from the EdrProvider callback to the wrapper's listener
        const eventAdapter = new EdrProviderEventAdapter();
        const printLineFn = loggerConfig.printLineFn ?? logger_1.printLine;
        const replaceLastLineFn = loggerConfig.replaceLastLineFn ?? logger_1.replaceLastLine;
        const hardforkName = (0, hardforks_1.getHardforkName)(config.hardfork);
        const edrHardfork = (0, convertToEdr_1.ethereumsjsHardforkToEdrSpecId)(hardforkName);
        const [genesisState, ownedAccounts] = _genesisStateAndOwnedAccounts(fork !== undefined, edrHardfork, config.genesisAccounts);
        const precompileOverrides = config.enableRip7212
            ? (0, hardforks_1.hardforkGte)(hardforkName, hardforks_1.HardforkName.OSAKA)
                ? [] // Osaka includes the P256 precompile natively
                : [(0, edr_1.precompileP256Verify)()]
            : [];
        const edrProviderConfig = {
            allowBlocksWithSameTimestamp: config.allowBlocksWithSameTimestamp ?? false,
            allowUnlimitedContractSize: config.allowUnlimitedContractSize,
            bailOnCallFailure: config.throwOnCallFailures,
            bailOnTransactionFailure: config.throwOnTransactionFailures,
            blockGasLimit: BigInt(config.blockGasLimit),
            chainId: BigInt(config.chainId),
            coinbase: Buffer.from(coinbase.slice(2), "hex"),
            precompileOverrides,
            fork,
            genesisState,
            hardfork: edrHardfork,
            initialDate,
            initialBaseFeePerGas: config.initialBaseFeePerGas !== undefined
                ? BigInt(config.initialBaseFeePerGas)
                : undefined,
            minGasPrice: config.minGasPrice,
            mining: {
                autoMine: config.automine,
                interval: (0, convertToEdr_1.ethereumjsIntervalMiningConfigToEdr)(config.intervalMining),
                memPool: {
                    order: (0, convertToEdr_1.ethereumjsMempoolOrderToEdrMineOrdering)(config.mempoolOrder),
                },
            },
            networkId: BigInt(config.networkId),
            observability: {},
            ownedAccounts,
            // Turn off the Osaka EIP-7825 per transaction gas limit for HH2
            // when being run from `solidity-coverage`.
            // We detect the magic number that `solidity-coverage` sets the block
            // gas limit to, see https://github.com/sc-forks/solidity-coverage/blob/8e52fd7eae73803edf50c5af2faeeca8e5a57e27/lib/api.js#L55
            // We turn it off the transaction gas limit by setting it
            // to a large number (the same number `solidity-coverage` uses for
            // setting gas).
            transactionGasCap: config.blockGasLimit === 0x1fffffffffffff
                ? BigInt(0xfffffffffffff)
                : undefined,
        };
        const edrLoggerConfig = {
            enable: loggerConfig.enabled,
            decodeConsoleLogInputsCallback: (inputs) => {
                return consoleLogger_1.ConsoleLogger.getDecodedLogs(inputs.map((input) => {
                    return Buffer.from(input);
                }));
            },
            printLineCallback: (message, replace) => {
                if (replace) {
                    replaceLastLineFn(message);
                }
                else {
                    printLineFn(message);
                }
            },
        };
        const edrSubscriptionConfig = {
            subscriptionCallback: (event) => {
                eventAdapter.emit("ethEvent", event);
            },
        };
        const edrTracingConfig = tracingConfig ?? {};
        const contractDecoder = edr_1.ContractDecoder.withContracts(edrTracingConfig);
        const context = await getGlobalEdrContext();
        const provider = await context.createProvider(GENERIC_CHAIN_TYPE, edrProviderConfig, edrLoggerConfig, edrSubscriptionConfig, contractDecoder);
        const minimalEthereumJsNode = {
            _vm: (0, minimal_vm_1.getMinimalEthereumJsVm)(provider),
        };
        const wrapper = new EdrProviderWrapper(provider, edrProviderConfig, edrLoggerConfig, minimalEthereumJsNode, edrSubscriptionConfig, config.genesisAccounts, cacheDir, chainOverrides);
        // Pass through all events from the provider
        eventAdapter.addListener("ethEvent", wrapper._ethEventListener.bind(wrapper));
        return wrapper;
    }
    async request(args) {
        if (args.params !== undefined && !Array.isArray(args.params)) {
            throw new errors_1.InvalidInputError("Hardhat Network doesn't support JSON-RPC params sent as an object");
        }
        const params = args.params ?? [];
        // stubbed for backwards compatibility
        switch (args.method) {
            case "hardhat_getStackTraceFailuresCount":
                return 0;
            case "eth_mining":
                return false;
            case "net_listening":
                return true;
            case "net_peerCount":
                return (0, base_types_1.numberToRpcQuantity)(0);
            case "hardhat_reset":
                return this._reset(..._resetParams(params));
            case "hardhat_addCompilationResult":
                return this._addCompilationResult(..._addCompilationResultParams(params));
        }
        const stringifiedArgs = JSON.stringify({
            method: args.method,
            params,
        });
        const responseObject = await this._provider.handleRequest(stringifiedArgs);
        let response;
        if (typeof responseObject.data === "string") {
            response = JSON.parse(responseObject.data);
        }
        else {
            response = responseObject.data;
        }
        const needsTraces = this._node._vm.evm.events.eventNames().length > 0 ||
            this._node._vm.events.eventNames().length > 0;
        if (needsTraces) {
            const rawTraces = responseObject.traces;
            for (const rawTrace of rawTraces) {
                // For other consumers in JS we need to marshall the entire trace over FFI
                const trace = rawTrace.trace;
                // beforeTx event
                if (this._node._vm.events.listenerCount("beforeTx") > 0) {
                    this._node._vm.events.emit("beforeTx");
                }
                for (const traceItem of trace) {
                    // step event
                    if ("pc" in traceItem) {
                        if (this._node._vm.evm.events.listenerCount("step") > 0) {
                            this._node._vm.evm.events.emit("step", (0, convertToEdr_1.edrTracingStepToMinimalInterpreterStep)(traceItem));
                        }
                    }
                    // afterMessage event
                    else if ("executionResult" in traceItem) {
                        if (this._node._vm.evm.events.listenerCount("afterMessage") > 0) {
                            this._node._vm.evm.events.emit("afterMessage", (0, convertToEdr_1.edrTracingMessageResultToMinimalEVMResult)(traceItem));
                        }
                    }
                    // beforeMessage event
                    else {
                        if (this._node._vm.evm.events.listenerCount("beforeMessage") > 0) {
                            this._node._vm.evm.events.emit("beforeMessage", (0, convertToEdr_1.edrTracingMessageToMinimalMessage)(traceItem));
                        }
                    }
                }
                // afterTx event
                if (this._node._vm.events.listenerCount("afterTx") > 0) {
                    this._node._vm.events.emit("afterTx");
                }
            }
        }
        if ((0, http_1.isErrorResponse)(response)) {
            let error;
            let stackTrace = null;
            try {
                stackTrace = responseObject.stackTrace();
            }
            catch (e) {
                log("Failed to get stack trace: %O", e);
            }
            if (stackTrace !== null) {
                error = (0, solidity_errors_1.encodeSolidityStackTrace)(response.error.message, stackTrace);
                // Pass data and transaction hash from the original error
                error.data = response.error.data?.data ?? undefined;
                error.transactionHash =
                    response.error.data?.transactionHash ?? undefined;
            }
            else {
                if (response.error.code === errors_1.InvalidArgumentsError.CODE) {
                    error = new errors_1.InvalidArgumentsError(response.error.message);
                }
                else {
                    error = new errors_1.ProviderError(response.error.message, response.error.code);
                }
                error.data = response.error.data;
            }
            // eslint-disable-next-line @nomicfoundation/hardhat-internal-rules/only-hardhat-error
            throw error;
        }
        if (args.method === "evm_revert") {
            this.emit(constants_1.HARDHAT_NETWORK_REVERT_SNAPSHOT_EVENT);
        }
        // Override EDR version string with Hardhat version string with EDR backend,
        // e.g. `HardhatNetwork/2.19.0/@nomicfoundation/edr/0.2.0-dev`
        if (args.method === "web3_clientVersion") {
            return clientVersion(response.result);
        }
        else if (args.method === "debug_traceTransaction" ||
            args.method === "debug_traceCall") {
            return (0, convertToEdr_1.edrRpcDebugTraceToHardhat)(response.result);
        }
        else {
            return response.result;
        }
    }
    async _addCompilationResult(solcVersion, input, output) {
        try {
            await this._provider.addCompilationResult(solcVersion, input, output);
            return true;
        }
        catch (error) {
            // eslint-disable-next-line @nomicfoundation/hardhat-internal-rules/only-hardhat-error
            throw new errors_1.InternalError(error);
        }
    }
    async _reset(networkConfig) {
        const { GENERIC_CHAIN_TYPE } = (0, napi_rs_1.requireNapiRsModule)("@nomicfoundation/edr");
        const forkConfig = networkConfig?.forking;
        const [genesisState, ownedAccounts] = _genesisStateAndOwnedAccounts(forkConfig !== undefined, this._providerConfig.hardfork, this._originalGenesisAccounts);
        this._providerConfig.genesisState = genesisState;
        this._providerConfig.ownedAccounts = ownedAccounts;
        if (forkConfig !== undefined) {
            const cacheDir = this._providerConfig.fork === undefined
                ? this._originalCacheDir
                : this._providerConfig.fork?.cacheDir;
            const chainOverrides = this._providerConfig.fork === undefined
                ? this._originalChainOverrides
                : this._providerConfig.fork?.chainOverrides;
            this._providerConfig.fork = {
                blockNumber: forkConfig.blockNumber !== undefined
                    ? BigInt(forkConfig.blockNumber)
                    : undefined,
                cacheDir,
                chainOverrides,
                httpHeaders: (0, convertToEdr_1.httpHeadersToEdr)(forkConfig.httpHeaders),
                url: forkConfig.jsonRpcUrl,
            };
        }
        else {
            this._providerConfig.fork = undefined;
        }
        const context = await getGlobalEdrContext();
        const provider = await context.createProvider(GENERIC_CHAIN_TYPE, this._providerConfig, this._loggerConfig, this._subscriptionConfig, this._provider.contractDecoder());
        this._provider = provider;
        this._node._vm.stateManager.updateProvider(provider);
        this.emit(constants_1.HARDHAT_NETWORK_RESET_EVENT);
        return true;
    }
    // temporarily added to make smock work with HH+EDR
    async _setCallOverrideCallback(callback) {
        this._callOverrideCallback = callback;
        await this._provider.setCallOverrideCallback(async (address, data) => {
            return this._callOverrideCallback?.(Buffer.from(address), Buffer.from(data));
        });
    }
    async _setVerboseTracing(enabled) {
        await this._provider.setVerboseTracing(enabled);
    }
    _ethEventListener(event) {
        const subscription = `0x${event.filterId.toString(16)}`;
        const results = Array.isArray(event.result) ? event.result : [event.result];
        for (const result of results) {
            this._emitLegacySubscriptionEvent(subscription, result);
            this._emitEip1193SubscriptionEvent(subscription, result);
        }
    }
    _emitLegacySubscriptionEvent(subscription, result) {
        this.emit("notification", {
            subscription,
            result,
        });
    }
    _emitEip1193SubscriptionEvent(subscription, result) {
        const message = {
            type: "eth_subscription",
            data: {
                subscription,
                result,
            },
        };
        this.emit("message", message);
    }
}
exports.EdrProviderWrapper = EdrProviderWrapper;
async function clientVersion(edrClientVersion) {
    const hardhatPackage = await (0, packageInfo_1.getPackageJson)();
    const edrVersion = edrClientVersion.split("/")[1];
    return `HardhatNetwork/${hardhatPackage.version}/@nomicfoundation/edr/${edrVersion}`;
}
async function createHardhatNetworkProvider(hardhatNetworkProviderConfig, loggerConfig, artifacts) {
    log("Making tracing config");
    const tracingConfig = await makeTracingConfig(artifacts);
    log("Creating EDR provider");
    const provider = await EdrProviderWrapper.create(hardhatNetworkProviderConfig, loggerConfig, tracingConfig);
    log("EDR provider created");
    return provider;
}
exports.createHardhatNetworkProvider = createHardhatNetworkProvider;
async function makeTracingConfig(artifacts) {
    if (artifacts !== undefined) {
        const buildInfoFiles = await artifacts.getBuildInfoPaths();
        try {
            const buildInfos = await Promise.all(buildInfoFiles.map((filePath) => fs_extra_1.default.readFile(filePath)));
            return {
                buildInfos,
            };
        }
        catch (error) {
            console.warn(picocolors_1.default.yellow("Stack traces engine could not be initialized. Run Hardhat with --verbose to learn more."));
            log("Solidity stack traces disabled: Failed to read solc's input and output files. Please report this to help us improve Hardhat.\n", error);
        }
    }
}
function _addCompilationResultParams(params) {
    return (0, validation_1.validateParams)(params, t.string, solc_1.rpcCompilerInput, solc_1.rpcCompilerOutput);
}
function _resetParams(params) {
    return (0, validation_1.validateParams)(params, hardhat_network_1.optionalRpcHardhatNetworkConfig);
}
function _genesisStateAndOwnedAccounts(isForked, hardfork, genesisAccounts) {
    const { l1GenesisState, l1HardforkFromString } = (0, napi_rs_1.requireNapiRsModule)("@nomicfoundation/edr");
    const genesisState = isForked
        ? [] // TODO: Add support for overriding remote fork state when the local fork is different
        : l1GenesisState(l1HardforkFromString(hardfork));
    const ownedAccounts = genesisAccounts.map((account) => {
        const privateKey = Uint8Array.from(
        // Strip the `0x` prefix
        Buffer.from(account.privateKey.slice(2), "hex"));
        genesisState.push({
            address: (0, util_1.privateToAddress)(privateKey),
            balance: BigInt(account.balance),
            code: new Uint8Array(), // Empty account code, removing potential delegation code when forking
        });
        return account.privateKey;
    });
    return [genesisState, ownedAccounts];
}
//# sourceMappingURL=provider.js.map