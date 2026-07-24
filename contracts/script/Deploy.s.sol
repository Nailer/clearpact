// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ClearPactEscrow} from "../src/ClearPactEscrow.sol";

/// Deploys ClearPactEscrow to Arc testnet.
/// Usage: forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        // MVP: deployer acts as arbiter; Part 3 moves this to staked arbitration.
        ClearPactEscrow escrow = new ClearPactEscrow(deployer);
        vm.stopBroadcast();

        console.log("ClearPactEscrow deployed at:", address(escrow));
        console.log("Arbiter:", deployer);
    }
}
