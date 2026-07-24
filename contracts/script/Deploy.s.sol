// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ClearPactEscrow} from "../src/ClearPactEscrow.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

/// Deploys the ClearPact protocol (registry + escrow) to Arc testnet.
/// Usage: forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        ReputationRegistry registry = new ReputationRegistry();
        // MVP: deployer acts as arbiter; later evolves toward staked arbitration.
        ClearPactEscrow escrow = new ClearPactEscrow(deployer, registry);
        registry.setEscrow(address(escrow), true);
        vm.stopBroadcast();

        console.log("ReputationRegistry deployed at:", address(registry));
        console.log("ClearPactEscrow    deployed at:", address(escrow));
        console.log("Arbiter:", deployer);
    }
}
