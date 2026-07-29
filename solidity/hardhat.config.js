require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  paths: {
    sources: "./contracts",
    tests: "./test-js",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
