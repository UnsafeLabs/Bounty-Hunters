"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSolcOutputSelection = exports.defaultMochaOptions = exports.defaultHttpNetworkParams = exports.defaultHardhatNetworkParams = exports.DEFAULT_GAS_MULTIPLIER = exports.defaultHardhatNetworkHdAccountsConfigParams = exports.defaultHdAccountsConfigParams = exports.defaultLocalhostNetworkParams = exports.defaultDefaultNetwork = exports.DEFAULT_HARDHAT_NETWORK_BALANCE = exports.HARDHAT_NETWORK_MNEMONIC = exports.HARDHAT_NETWORK_DEFAULT_INITIAL_BASE_FEE_PER_GAS = exports.HARDHAT_NETWORK_DEFAULT_MAX_PRIORITY_FEE_PER_GAS = exports.HARDHAT_NETWORK_DEFAULT_GAS_PRICE = exports.DEFAULT_SOLC_VERSION = void 0;
const hardforks_1 = require("../../util/hardforks");
const constants_1 = require("../../constants");
exports.DEFAULT_SOLC_VERSION = "0.7.3";
exports.HARDHAT_NETWORK_DEFAULT_GAS_PRICE = "auto";
exports.HARDHAT_NETWORK_DEFAULT_MAX_PRIORITY_FEE_PER_GAS = 1e9;
exports.HARDHAT_NETWORK_DEFAULT_INITIAL_BASE_FEE_PER_GAS = 1e9;
exports.HARDHAT_NETWORK_MNEMONIC = "test test test test test test test test test test test junk";
exports.DEFAULT_HARDHAT_NETWORK_BALANCE = "10000000000000000000000";
exports.defaultDefaultNetwork = constants_1.HARDHAT_NETWORK_NAME;
exports.defaultLocalhostNetworkParams = {
    url: "http://127.0.0.1:8545",
    timeout: 40000,
};
exports.defaultHdAccountsConfigParams = {
    initialIndex: 0,
    count: 20,
    path: "m/44'/60'/0'/0",
    passphrase: "",
};
exports.defaultHardhatNetworkHdAccountsConfigParams = {
    ...exports.defaultHdAccountsConfigParams,
    mnemonic: exports.HARDHAT_NETWORK_MNEMONIC,
    accountsBalance: exports.DEFAULT_HARDHAT_NETWORK_BALANCE,
};
exports.DEFAULT_GAS_MULTIPLIER = 1;
exports.defaultHardhatNetworkParams = {
    hardfork: hardforks_1.HardforkName.OSAKA,
    blockGasLimit: 60000000,
    gasPrice: exports.HARDHAT_NETWORK_DEFAULT_GAS_PRICE,
    chainId: 31337,
    throwOnTransactionFailures: true,
    throwOnCallFailures: true,
    allowUnlimitedContractSize: false,
    mining: {
        auto: true,
        interval: 0,
        mempool: {
            order: "priority",
        },
    },
    accounts: exports.defaultHardhatNetworkHdAccountsConfigParams,
    loggingEnabled: false,
    gasMultiplier: exports.DEFAULT_GAS_MULTIPLIER,
    minGasPrice: 0n,
    /**
     * Block numbers / timestamps were taken from:
     * https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/common/src/chains.ts
     *
     * To find hardfork activation blocks by timestamp, use:
     * https://api-TESTNET.etherscan.io/api?module=block&action=getblocknobytime&timestamp=TIMESTAMP&closest=before&apikey=APIKEY
     */
    chains: new Map([
        [
            11155111,
            {
                hardforkHistory: new Map([
                    [hardforks_1.HardforkName.GRAY_GLACIER, 0],
                    [hardforks_1.HardforkName.MERGE, 1450409],
                    [hardforks_1.HardforkName.SHANGHAI, 2990908],
                    [hardforks_1.HardforkName.CANCUN, 5187023],
                    [hardforks_1.HardforkName.PRAGUE, 7836331],
                ]),
            },
        ],
        // TODO: the rest of this config is a temporary workaround,
        // see https://github.com/NomicFoundation/edr/issues/522
        [
            10,
            {
                hardforkHistory: new Map([[hardforks_1.HardforkName.SHANGHAI, 0]]),
            },
        ],
        [
            11155420,
            {
                hardforkHistory: new Map([[hardforks_1.HardforkName.SHANGHAI, 0]]),
            },
        ],
        [
            42161,
            {
                hardforkHistory: new Map([[hardforks_1.HardforkName.SHANGHAI, 0]]),
            },
        ],
        [
            43114,
            {
                hardforkHistory: new Map([
                    [hardforks_1.HardforkName.SHANGHAI, 11404279],
                    [hardforks_1.HardforkName.CANCUN, 41263126],
                ]),
            },
        ],
        [
            421614,
            {
                hardforkHistory: new Map([[hardforks_1.HardforkName.SHANGHAI, 0]]),
            },
        ],
    ]),
};
exports.defaultHttpNetworkParams = {
    accounts: "remote",
    gas: "auto",
    gasPrice: "auto",
    gasMultiplier: exports.DEFAULT_GAS_MULTIPLIER,
    httpHeaders: {},
    timeout: 20000,
};
exports.defaultMochaOptions = {
    timeout: 40000,
};
exports.defaultSolcOutputSelection = {
    "*": {
        "*": [
            "abi",
            "evm.bytecode",
            "evm.deployedBytecode",
            "evm.methodIdentifiers",
            "metadata",
        ],
        "": ["ast"],
    },
};
//# sourceMappingURL=default-config.js.map