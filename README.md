# TrustFund Escrow

> Milestone-based escrow smart contract powering **NexTrust** — a blockchain crowdfunding platform for Indonesian charitable foundations. Donor funds are held on-chain and released in stages only as milestone evidence is validated. If validation fails, donors reclaim their remaining share proportionally.
>
> _"AI menilai, blockchain menegakkan."_ — AI evaluates the evidence, the blockchain enforces the outcome.

<p align="left">
  <img alt="Solidity" src="https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity" />
  <img alt="Hardhat" src="https://img.shields.io/badge/Built%20with-Hardhat-FFF100?logo=ethereum&logoColor=black" />
  <img alt="OpenZeppelin" src="https://img.shields.io/badge/OpenZeppelin-v5-4E5EE4?logo=openzeppelin&logoColor=white" />
  <img alt="Network" src="https://img.shields.io/badge/Network-Polygon%20Amoy-8247E5?logo=polygon&logoColor=white" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-46%20passing-brightgreen" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

---

## Overview

`TrustFundEscrow` is an upgradeable (UUPS) escrow contract that mediates trust between donors and foundations without either side having to trust the other, or the platform operator.

Instead of transferring donations directly to a foundation, funds are locked in the contract and released **milestone by milestone**. Each milestone must pass an off-chain AI evaluation whose verdict is delivered on-chain via a signed oracle callback. Approved milestones release their tranche to the beneficiary; a failed campaign is frozen and donors withdraw their remaining balance pro-rata.

The contract is **fully custodial from the donor's perspective** — donors never hold a wallet or interact with the chain directly. A backend relayer executes all on-chain actions on their behalf, funded by donations collected via QRIS and represented on-chain as an IDR-pegged stablecoin (`MockXIDR` on testnet; StraitsX XIDR intended for production).

## Architecture

```
   Donor (QRIS)          Backend Relayer            Oracle (AI verdict)
        │                       │                          │
        │  fiat via QRIS        │  createCampaign          │  signed score
        ▼                       ▼  depositXIDR             ▼  oracleCallback
  ┌───────────────────────────────────────────────────────────────┐
  │                   TrustFundEscrow  (UUPS proxy)                 │
  │                                                                │
  │   lockedFunds ── released per approved milestone ──► Beneficiary│
  │        │                                                       │
  │        └── campaign frozen ──► proportional refund ──► Donors   │
  └───────────────────────────────────────────────────────────────┘
```

### Campaign lifecycle

```
ACTIVE ──deposit──► FUNDED ──oracle≥85──► VALIDATED ──► ADVANCE_PAID
                                   │                          │
                              oracle 50–84                submit &
                                   ▼                     validate loop
                                FROZEN ◄── oracle<50 ──────────┘
                                   │
                    resolveFrozen(false) / oracle<50
                                   ▼
                          proportional refund ──► COMPLETED
```

## Core Functions

| Function | Access | Purpose |
|----------|--------|---------|
| `createCampaign` | `BACKEND_ROLE` | Register a campaign with target, milestones, advance, and beneficiary |
| `depositXIDR` | `BACKEND_ROLE` | Lock a donor's contribution into the campaign escrow |
| `oracleCallback` | signed by oracle | Deliver an AI evaluation score; drives the state machine |
| `releaseAdvance` | `BACKEND_ROLE` | Release the upfront advance tranche to the beneficiary |
| `submitMilestone` | `BACKEND_ROLE` | Anchor milestone evidence (hash) on-chain |
| `releaseMilestone` | `BACKEND_ROLE` | Release a validated milestone tranche |
| `resolveFrozen` | `BACKEND_ROLE` | Approve or reject a frozen campaign |
| `claimRefund` | donor | Withdraw remaining locked share, proportionally |

## Security Model

- **Access control** — role-separated: `BACKEND_ROLE` (operations), `ORACLE_ROLE`, `UPGRADER_ROLE`, and `DEFAULT_ADMIN_ROLE` (pause/config).
- **Oracle authenticity** — evaluation scores are accepted only with a valid ECDSA signature from the configured signer, bound to the contract address and `chainId`, with a per-campaign nonce to prevent replay.
- **Reentrancy** — state changes precede all external token transfers (checks-effects-interactions), guarded by `nonReentrant`.
- **Proportional refunds** — when a campaign is frozen after funds were already released, each donor reclaims `contribution × remainingLocked / unrefundedContributions`. A running tally sweeps rounding dust so `lockedFunds` always settles to exactly zero.
- **Upgradeability** — UUPS proxy with a preserved storage layout (`__gap` reserved slots); upgrades are validated against the prior layout before deployment.
- **Pausable** — admin can halt state-changing operations in an emergency.

## Tech Stack

- **Solidity** `0.8.24` (EVM target: `cancun`)
- **Hardhat** — compile, test, deploy, verify
- **OpenZeppelin Contracts Upgradeable** v5
- **Polygon Amoy** testnet

## Deployments

| Network | Contract | Address |
|---------|----------|---------|
| Polygon Amoy | `TrustFundEscrow` (proxy) | `0x2553566bd945f8Ffb0C7780bD9f3791Bc6d25A90` |

## Getting Started

```bash
git clone https://github.com/gilngns/smart-contract-Trust-Fund-.git
cd smart-contract-Trust-Fund-
npm install
```

Create a `.env` file (see `.env.example`):

```bash
AMOY_RPC_URL=          # RPC endpoint (Alchemy / Infura)
PRIVATE_KEY=           # deployer wallet private key
POLYGONSCAN_API_KEY=   # for contract verification
```

## Usage

| Command | Description |
|---------|-------------|
| `npm test` | Run the full test suite |
| `npm run compile` | Compile contracts |
| `npm run coverage` | Generate a coverage report |
| `npm run gas-report` | Run tests with a gas report |
| `npm run deploy:amoy` | Deploy the proxy to Polygon Amoy |
| `npm run upgrade:amoy` | Upgrade the implementation behind the proxy |
| `npm run verify:amoy` | Verify the contract on PolygonScan |

## Testing

```bash
npm test
```

Tests run on Hardhat's in-memory network — no testnet tokens required. The suite covers unit tests, a full milestone loop, proportional-refund scenarios, fuzzing, state invariants, and a live reentrancy attack.

```
46 passing
```

> Recommended Node.js: v20 or v22 LTS (Hardhat does not officially support newer versions).

## Project Structure

```
contracts/
  TrustFundEscrow.sol       # main escrow contract
  mocks/
    MockXIDR.sol            # IDR-pegged test stablecoin
    ReentrancyAttacker.sol  # attacker used in the reentrancy test
scripts/
  deploy.js                 # deploy the UUPS proxy
  upgrade.js                # upgrade the implementation
  deployMock.js             # deploy the mock token
test/
  TrustFundEscrow.test.js   # test suite
deployments/                # deployment history (addresses, block info)
.openzeppelin/              # proxy storage layout — required for upgrades, do not delete
```

## Status & Roadmap

This contract is deployed and fully functional on **Polygon Amoy testnet**. It is a competition / research prototype, not yet production-hardened.

- [x] Milestone escrow with advance + staged release
- [x] Signed oracle callback with replay protection
- [x] Proportional refunds with dust handling
- [x] UUPS upgradeability with layout preservation
- [x] 46 passing tests (unit, fuzz, invariant, reentrancy)
- [ ] External security audit (required before mainnet)
- [ ] Production stablecoin integration (StraitsX XIDR)
- [ ] Mainnet deployment

## License

MIT