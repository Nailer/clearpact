// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

/// Deploys MilestoneEscrow against the EXISTING (already-live) Part 3
/// ReputationRegistry, so worker bonds and reputation stay a single shared
/// identity across both settlement shapes.
/// Usage: forge script script/DeployMilestone.s.sol --rpc-url arc_testnet --broadcast
contract DeployMilestone is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");

        vm.startBroadcast(pk);
        MilestoneEscrow escrow = new MilestoneEscrow(deployer, ReputationRegistry(registryAddr));
        ReputationRegistry(registryAddr).setEscrow(address(escrow), true);
        vm.stopBroadcast();

        console.log("MilestoneEscrow deployed at:", address(escrow));
        console.log("Registry (existing):", registryAddr);
        console.log("Arbiter:", deployer);
    }
}
