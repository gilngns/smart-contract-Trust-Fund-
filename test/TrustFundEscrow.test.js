/**
 * test/TrustFundEscrow.test.js
 *
 * Test suite lengkap untuk TrustFundEscrow.
 * Mencakup: happy path, edge cases, access control, state machine, upgrade.
 *
 * Jalankan: npx hardhat test
 * Coverage: npx hardhat coverage
 */

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// ============================================================
//  HELPERS & CONSTANTS
// ============================================================

/** Konversi nilai ke satuan XIDR (6 desimal) */
const toXIDR = (amount) => ethers.parseUnits(amount.toString(), 6);

/** Buat bytes32 campaignId dari string */
const toCampaignId = (str) => ethers.keccak256(ethers.toUtf8Bytes(str));

const BACKEND_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BACKEND_ROLE"));
const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
const UPGRADER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE"));

const CampaignState = {
  ACTIVE: 0,
  FUNDED: 1,
  ADVANCE_PAID: 2,
  MILESTONE_SUBMITTED: 3,
  VALIDATED: 4,
  FROZEN: 5,
  COMPLETED: 6,
};

// ============================================================
//  FIXTURE — deploy fresh contract setiap test
// ============================================================

async function deployFixture() {
  const [admin, backend, oracle, donor1, donor2, attacker] =
    await ethers.getSigners();

  // Deploy MockXIDR
  const MockXIDR = await ethers.getContractFactory("MockXIDR");
  const xidr = await MockXIDR.deploy(admin.address);
  await xidr.waitForDeployment();

  // Deploy TrustFundEscrow sebagai UUPS proxy
  const TrustFundEscrow = await ethers.getContractFactory("TrustFundEscrow");
  const escrow = await upgrades.deployProxy(
    TrustFundEscrow,
    [await xidr.getAddress(), backend.address, admin.address],
    { kind: "uups", initializer: "initialize" }
  );
  await escrow.waitForDeployment();

  // Grant ORACLE_ROLE ke oracle signer
  await escrow.connect(admin).grantRole(ORACLE_ROLE, oracle.address);

  // Mint XIDR ke backend wallet untuk simulasi deposit
  const INITIAL_SUPPLY = toXIDR(100_000_000); // 100 juta XIDR
  await xidr.connect(admin).mint(backend.address, INITIAL_SUPPLY);

  // Approve escrow contract untuk tarik dari backend wallet
  await xidr
    .connect(backend)
    .approve(await escrow.getAddress(), INITIAL_SUPPLY);

  // Shorthand untuk campaign default
  const defaultCampaign = {
    id: toCampaignId("campaign-001"),
    target: toXIDR(10_000_000), // 10 juta XIDR = Rp 10 juta
    advance: toXIDR(2_000_000), // 2 juta advance
    milestone: toXIDR(2_000_000), // 2 juta per milestone
    totalMilestones: 4, // 4 milestones
  };

  return {
    escrow,
    xidr,
    admin,
    backend,
    oracle,
    donor1,
    donor2,
    attacker,
    defaultCampaign,
  };
}

// ============================================================
//  HELPER: Buat & deposit campaign sampai FUNDED
// ============================================================
async function setupFundedCampaign(escrow, backend, oracle, campaign) {
  await escrow
    .connect(backend)
    .createCampaign(
      campaign.id,
      campaign.target,
      campaign.advance,
      campaign.milestone,
      campaign.totalMilestones
    );
  await escrow.connect(backend).depositXIDR(campaign.id, campaign.target);
  // State sekarang: FUNDED
}

// ============================================================
//  TEST SUITES
// ============================================================

describe("TrustFundEscrow", function () {
  // ──────────────────────────────────────────────────────────
  // 1. DEPLOYMENT & INITIALIZATION
  // ──────────────────────────────────────────────────────────
  describe("Deployment & Initialization", function () {
    it("Should set XIDR token address correctly", async function () {
      const { escrow, xidr } = await loadFixture(deployFixture);
      expect(await escrow.xidr()).to.equal(await xidr.getAddress());
    });

    it("Should set backend wallet correctly", async function () {
      const { escrow, backend } = await loadFixture(deployFixture);
      expect(await escrow.backendWallet()).to.equal(backend.address);
    });

    it("Should grant DEFAULT_ADMIN_ROLE to admin", async function () {
      const { escrow, admin } = await loadFixture(deployFixture);
      const DEFAULT_ADMIN = await escrow.DEFAULT_ADMIN_ROLE();
      expect(await escrow.hasRole(DEFAULT_ADMIN, admin.address)).to.be.true;
    });

    it("Should grant BACKEND_ROLE to backend wallet", async function () {
      const { escrow, backend } = await loadFixture(deployFixture);
      expect(await escrow.hasRole(BACKEND_ROLE, backend.address)).to.be.true;
    });

    it("Should revert if initialized with zero address", async function () {
      const TrustFundEscrow = await ethers.getContractFactory(
        "TrustFundEscrow"
      );
      const [admin, backend] = await ethers.getSigners();

      await expect(
        upgrades.deployProxy(
          TrustFundEscrow,
          [ethers.ZeroAddress, backend.address, admin.address],
          { kind: "uups", initializer: "initialize" }
        )
      ).to.be.revertedWithCustomError(
        await TrustFundEscrow.deploy(),
        "ZeroAddress"
      );
    });

    it("Should not allow re-initialization", async function () {
      const { escrow, xidr, backend, admin } = await loadFixture(deployFixture);
      await expect(
        escrow.initialize(
          await xidr.getAddress(),
          backend.address,
          admin.address
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidInitialization");
    });
  });

  // ──────────────────────────────────────────────────────────
  // 2. CREATE CAMPAIGN
  // ──────────────────────────────────────────────────────────
  describe("createCampaign", function () {
    it("Should create campaign with correct data", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      const campaign = await escrow.getCampaign(c.id);
      expect(campaign.campaignId).to.equal(c.id);
      expect(campaign.targetAmount).to.equal(c.target);
      expect(campaign.advanceAmount).to.equal(c.advance);
      expect(campaign.milestoneAmount).to.equal(c.milestone);
      expect(campaign.totalMilestones).to.equal(c.totalMilestones);
      expect(campaign.state).to.equal(CampaignState.ACTIVE);
      expect(campaign.totalCollected).to.equal(0n);
    });

    it("Should emit CampaignCreated event", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await expect(
        escrow
          .connect(backend)
          .createCampaign(
            c.id,
            c.target,
            c.advance,
            c.milestone,
            c.totalMilestones
          )
      )
        .to.emit(escrow, "CampaignCreated")
        .withArgs(c.id, c.target, c.totalMilestones);
    });

    it("Should revert if called by non-backend", async function () {
      const {
        escrow,
        attacker,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await expect(
        escrow
          .connect(attacker)
          .createCampaign(
            c.id,
            c.target,
            c.advance,
            c.milestone,
            c.totalMilestones
          )
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should revert on duplicate campaignId", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      await expect(
        escrow
          .connect(backend)
          .createCampaign(
            c.id,
            c.target,
            c.advance,
            c.milestone,
            c.totalMilestones
          )
      ).to.be.revertedWithCustomError(escrow, "CampaignAlreadyExists");
    });

    it("Should revert with zero targetAmount", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await expect(
        escrow
          .connect(backend)
          .createCampaign(c.id, 0n, c.advance, c.milestone, c.totalMilestones)
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("Should revert if totalMilestones is 0 or > 20", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await expect(
        escrow
          .connect(backend)
          .createCampaign(c.id, c.target, c.advance, c.milestone, 0)
      ).to.be.revertedWithCustomError(escrow, "InvalidMilestoneConfig");

      await expect(
        escrow
          .connect(backend)
          .createCampaign(c.id, c.target, c.advance, c.milestone, 21)
      ).to.be.revertedWithCustomError(escrow, "InvalidMilestoneConfig");
    });

    it("Should revert if payout config exceeds targetAmount", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      // advance + (milestone * 4) > target
      const bigMilestone = toXIDR(3_000_000); // 2M advance + 4*3M = 14M > 10M target

      await expect(
        escrow
          .connect(backend)
          .createCampaign(
            c.id,
            c.target,
            c.advance,
            bigMilestone,
            c.totalMilestones
          )
      ).to.be.revertedWithCustomError(escrow, "InvalidMilestoneConfig");
    });
  });

  // ──────────────────────────────────────────────────────────
  // 3. DEPOSIT XIDR
  // ──────────────────────────────────────────────────────────
  describe("depositXIDR", function () {
    it("Should deposit and update locked funds", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      const depositAmount = toXIDR(5_000_000);
      await escrow.connect(backend).depositXIDR(c.id, depositAmount);

      const campaign = await escrow.getCampaign(c.id);
      expect(campaign.totalCollected).to.equal(depositAmount);
      expect(await escrow.getLockedFunds(c.id)).to.equal(depositAmount);
    });

    it("Should emit FundsDeposited event", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      const depositAmount = toXIDR(3_000_000);
      await expect(escrow.connect(backend).depositXIDR(c.id, depositAmount))
        .to.emit(escrow, "FundsDeposited")
        .withArgs(c.id, depositAmount, depositAmount, false);
    });

    it("Should transition to FUNDED when target is met", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );
      await escrow.connect(backend).depositXIDR(c.id, c.target);

      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.FUNDED
      );
    });

    it("Should emit FundsDeposited with isFunded=true when target met", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      await expect(escrow.connect(backend).depositXIDR(c.id, c.target))
        .to.emit(escrow, "FundsDeposited")
        .withArgs(c.id, c.target, c.target, true);
    });

    it("Should revert deposit on non-ACTIVE campaign", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      // State sekarang FUNDED, tidak bisa deposit lagi

      await expect(
        escrow.connect(backend).depositXIDR(c.id, toXIDR(1_000_000))
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("Should revert if amount is zero", async function () {
      const {
        escrow,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);
      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      await expect(
        escrow.connect(backend).depositXIDR(c.id, 0n)
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("Should actually transfer XIDR to contract", async function () {
      const {
        escrow,
        backend,
        xidr,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      const escrowAddr = await escrow.getAddress();
      const balBefore = await xidr.balanceOf(escrowAddr);

      await escrow.connect(backend).depositXIDR(c.id, c.target);

      const balAfter = await xidr.balanceOf(escrowAddr);
      expect(balAfter - balBefore).to.equal(c.target);
    });
  });

  // ──────────────────────────────────────────────────────────
  // 4. ORACLE CALLBACK
  // ──────────────────────────────────────────────────────────
  describe("oracleCallback", function () {
    it("Should validate and set state to VALIDATED (from FUNDED)", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);

      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.VALIDATED
      );
    });

    it("Should freeze campaign on fraud detection", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, false, 20);

      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.FROZEN
      );
    });

    it("Should emit OracleValidated event on validation", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);

      await expect(escrow.connect(oracle).oracleCallback(c.id, true, 85))
        .to.emit(escrow, "OracleValidated")
        .withArgs(c.id, 0, true, 85);
    });

    it("Should allow freeze from ADVANCE_PAID state", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90); // → VALIDATED
      await escrow.connect(backend).releaseAdvance(c.id); // → ADVANCE_PAID
      await escrow.connect(oracle).oracleCallback(c.id, false, 10); // → FROZEN

      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.FROZEN
      );
    });

    it("Should revert if called by non-oracle", async function () {
      const {
        escrow,
        backend,
        attacker,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, null, c);

      await expect(
        escrow.connect(attacker).oracleCallback(c.id, true, 90)
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should revert if state is not FUNDED or MILESTONE_SUBMITTED (for positive)", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      // State ACTIVE — belum funded
      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      await expect(
        escrow.connect(oracle).oracleCallback(c.id, true, 90)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  // ──────────────────────────────────────────────────────────
  // 5. RELEASE ADVANCE
  // ──────────────────────────────────────────────────────────
  describe("releaseAdvance", function () {
    it("Should release advance to backend wallet", async function () {
      const {
        escrow,
        backend,
        oracle,
        xidr,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);

      const balBefore = await xidr.balanceOf(backend.address);
      await escrow.connect(backend).releaseAdvance(c.id);
      const balAfter = await xidr.balanceOf(backend.address);

      expect(balAfter - balBefore).to.equal(c.advance);
    });

    it("Should transition to ADVANCE_PAID state", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(backend).releaseAdvance(c.id);

      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.ADVANCE_PAID
      );
    });

    it("Should emit AdvanceReleased event", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);

      await expect(escrow.connect(backend).releaseAdvance(c.id))
        .to.emit(escrow, "AdvanceReleased")
        .withArgs(c.id, c.advance, backend.address);
    });

    it("Should deduct locked funds after advance release", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(backend).releaseAdvance(c.id);

      const expected = c.target - c.advance;
      expect(await escrow.getLockedFunds(c.id)).to.equal(expected);
    });

    it("Should revert if state is not VALIDATED", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      // State masih FUNDED, belum VALIDATED

      await expect(
        escrow.connect(backend).releaseAdvance(c.id)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("Should revert if advance already released", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(backend).releaseAdvance(c.id);

      // Submit milestone → oracle validate → coba releaseAdvance lagi
      await escrow.connect(backend).submitMilestone(c.id);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);

      await expect(
        escrow.connect(backend).releaseAdvance(c.id)
      ).to.be.revertedWithCustomError(escrow, "InvalidMilestoneConfig");
    });
  });

  // ──────────────────────────────────────────────────────────
  // 6. SUBMIT MILESTONE
  // ──────────────────────────────────────────────────────────
  describe("submitMilestone", function () {
    it("Should transition to MILESTONE_SUBMITTED", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(backend).releaseAdvance(c.id);
      await escrow.connect(backend).submitMilestone(c.id);

      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.MILESTONE_SUBMITTED
      );
    });

    it("Should revert if not in ADVANCE_PAID state", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      // State FUNDED, bukan ADVANCE_PAID

      await expect(
        escrow.connect(backend).submitMilestone(c.id)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  // ──────────────────────────────────────────────────────────
  // 7. RELEASE MILESTONE (FULL HAPPY PATH)
  // ──────────────────────────────────────────────────────────
  describe("releaseMilestone — Full Happy Path", function () {
    async function runFullCycle(escrow, backend, oracle, xidr, campaign) {
      // Setup
      await setupFundedCampaign(escrow, backend, oracle, campaign);
      await escrow.connect(oracle).oracleCallback(campaign.id, true, 90);
      await escrow.connect(backend).releaseAdvance(campaign.id);

      const releases = [];

      for (let i = 0; i < campaign.totalMilestones; i++) {
        await escrow.connect(backend).submitMilestone(campaign.id);
        await escrow.connect(oracle).oracleCallback(campaign.id, true, 90);

        const balBefore = await xidr.balanceOf(backend.address);
        const tx = await escrow.connect(backend).releaseMilestone(campaign.id);
        const receipt = await tx.wait();
        const balAfter = await xidr.balanceOf(backend.address);

        releases.push({
          milestone: i,
          released: balAfter - balBefore,
          receipt,
        });
      }

      return releases;
    }

    it("Should release all milestones and complete campaign", async function () {
      const {
        escrow,
        backend,
        oracle,
        xidr,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      const releases = await runFullCycle(escrow, backend, oracle, xidr, c);

      expect(releases.length).to.equal(c.totalMilestones);
      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.COMPLETED
      );
    });

    it("Should have zero locked funds after completion", async function () {
      const {
        escrow,
        backend,
        oracle,
        xidr,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await runFullCycle(escrow, backend, oracle, xidr, c);

      expect(await escrow.getLockedFunds(c.id)).to.equal(0n);
    });

    it("Should emit MilestoneReleased with isCompleted=true on last milestone", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(backend).releaseAdvance(c.id);

      // Loop sampai milestone terakhir
      for (let i = 0; i < c.totalMilestones; i++) {
        await escrow.connect(backend).submitMilestone(c.id);
        await escrow.connect(oracle).oracleCallback(c.id, true, 90);

        const isLast = i === c.totalMilestones - 1;
        if (isLast) {
          await expect(escrow.connect(backend).releaseMilestone(c.id))
            .to.emit(escrow, "MilestoneReleased")
            .withArgs(
              c.id,
              i,
              await escrow.getLockedFunds(c.id),
              backend.address,
              true
            );
        } else {
          await escrow.connect(backend).releaseMilestone(c.id);
        }
      }
    });

    it("Should return to ADVANCE_PAID after non-last milestone", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(backend).releaseAdvance(c.id);

      await escrow.connect(backend).submitMilestone(c.id);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(backend).releaseMilestone(c.id);

      // Harus kembali ke ADVANCE_PAID untuk milestone berikutnya
      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.ADVANCE_PAID
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // 8. TRIGGER REFUND
  // ──────────────────────────────────────────────────────────
  describe("triggerRefund", function () {
    it("Should refund all locked funds to backend", async function () {
      const {
        escrow,
        backend,
        oracle,
        xidr,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, false, 15); // → FROZEN

      const lockedBefore = await escrow.getLockedFunds(c.id);
      const balBefore = await xidr.balanceOf(backend.address);

      await escrow.connect(backend).triggerRefund(c.id);

      const balAfter = await xidr.balanceOf(backend.address);
      expect(balAfter - balBefore).to.equal(lockedBefore);
    });

    it("Should set locked funds to zero after refund", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, false, 15);
      await escrow.connect(backend).triggerRefund(c.id);

      expect(await escrow.getLockedFunds(c.id)).to.equal(0n);
    });

    it("Should set state to COMPLETED after refund", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, false, 15);
      await escrow.connect(backend).triggerRefund(c.id);

      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.COMPLETED
      );
    });

    it("Should emit RefundTriggered event", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, false, 15);

      await expect(escrow.connect(backend).triggerRefund(c.id))
        .to.emit(escrow, "RefundTriggered")
        .withArgs(c.id, c.target, backend.address);
    });

    it("Should revert if state is not FROZEN", async function () {
      const {
        escrow,
        backend,
        oracle,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      // State FUNDED, bukan FROZEN

      await expect(
        escrow.connect(backend).triggerRefund(c.id)
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("Should revert if non-backend calls triggerRefund", async function () {
      const {
        escrow,
        backend,
        oracle,
        attacker,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await setupFundedCampaign(escrow, backend, oracle, c);
      await escrow.connect(oracle).oracleCallback(c.id, false, 15);

      await expect(
        escrow.connect(attacker).triggerRefund(c.id)
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // 9. ADMIN FUNCTIONS
  // ──────────────────────────────────────────────────────────
  describe("Admin Functions", function () {
    it("Should pause all transactions", async function () {
      const {
        escrow,
        admin,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow.connect(admin).pause();

      await expect(
        escrow
          .connect(backend)
          .createCampaign(
            c.id,
            c.target,
            c.advance,
            c.milestone,
            c.totalMilestones
          )
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("Should unpause and allow transactions", async function () {
      const {
        escrow,
        admin,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      await escrow.connect(admin).pause();
      await escrow.connect(admin).unpause();

      await expect(
        escrow
          .connect(backend)
          .createCampaign(
            c.id,
            c.target,
            c.advance,
            c.milestone,
            c.totalMilestones
          )
      ).to.not.be.reverted;
    });

    it("Should update backend wallet and rotate BACKEND_ROLE", async function () {
      const { escrow, admin, backend, donor1 } = await loadFixture(
        deployFixture
      );

      await escrow.connect(admin).updateBackendWallet(donor1.address);

      expect(await escrow.backendWallet()).to.equal(donor1.address);
      expect(await escrow.hasRole(BACKEND_ROLE, donor1.address)).to.be.true;
      expect(await escrow.hasRole(BACKEND_ROLE, backend.address)).to.be.false;
    });

    it("Should revert updateBackendWallet with zero address", async function () {
      const { escrow, admin } = await loadFixture(deployFixture);

      await expect(
        escrow.connect(admin).updateBackendWallet(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("Should revert pause if called by non-admin", async function () {
      const { escrow, attacker } = await loadFixture(deployFixture);

      await expect(
        escrow.connect(attacker).pause()
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // 10. UPGRADABILITY
  // ──────────────────────────────────────────────────────────
  describe("UUPS Upgradability", function () {
    it("Should allow upgrade by UPGRADER_ROLE", async function () {
      const { escrow, admin } = await loadFixture(deployFixture);

      const TrustFundEscrowV2 = await ethers.getContractFactory(
        "TrustFundEscrow"
      );
      const proxyAddress = await escrow.getAddress();

      // Upgrade tidak boleh throw
      await expect(
        upgrades.upgradeProxy(proxyAddress, TrustFundEscrowV2.connect(admin), {
          kind: "uups",
        })
      ).to.not.be.reverted;
    });

    it("Should preserve state after upgrade", async function () {
      const {
        escrow,
        admin,
        backend,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      // Buat kampanye sebelum upgrade
      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );

      // Upgrade contract
      const TrustFundEscrowV2 = await ethers.getContractFactory(
        "TrustFundEscrow"
      );
      const upgraded = await upgrades.upgradeProxy(
        await escrow.getAddress(),
        TrustFundEscrowV2.connect(admin),
        { kind: "uups" }
      );

      // State sebelum upgrade harus tetap ada
      const campaign = await upgraded.getCampaign(c.id);
      expect(campaign.targetAmount).to.equal(c.target);
      expect(campaign.state).to.equal(CampaignState.ACTIVE);
    });

    it("Should revert upgrade if caller lacks UPGRADER_ROLE", async function () {
      const { escrow, attacker } = await loadFixture(deployFixture);

      const TrustFundEscrowV2 = await ethers.getContractFactory(
        "TrustFundEscrow"
      );

      await expect(
        upgrades.upgradeProxy(
          await escrow.getAddress(),
          TrustFundEscrowV2.connect(attacker),
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(
        escrow,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // 11. MULTIPLE CAMPAIGNS (isolated state)
  // ──────────────────────────────────────────────────────────
  describe("Multiple Campaigns", function () {
    it("Should handle multiple concurrent campaigns independently", async function () {
      const {
        escrow,
        backend,
        oracle,
        xidr,
        defaultCampaign: c,
      } = await loadFixture(deployFixture);

      const c2 = {
        id: toCampaignId("campaign-002"),
        target: toXIDR(5_000_000),
        advance: toXIDR(500_000),
        milestone: toXIDR(1_500_000),
        totalMilestones: 3,
      };

      // Buat dua kampanye
      await escrow
        .connect(backend)
        .createCampaign(
          c.id,
          c.target,
          c.advance,
          c.milestone,
          c.totalMilestones
        );
      await escrow
        .connect(backend)
        .createCampaign(
          c2.id,
          c2.target,
          c2.advance,
          c2.milestone,
          c2.totalMilestones
        );

      // Fund campaign 1, freeze campaign 2
      await escrow.connect(backend).depositXIDR(c.id, c.target);
      await escrow.connect(backend).depositXIDR(c2.id, c2.target);
      await escrow.connect(oracle).oracleCallback(c.id, true, 90);
      await escrow.connect(oracle).oracleCallback(c2.id, false, 5);

      // State harus independen
      expect(await escrow.getCampaignState(c.id)).to.equal(
        CampaignState.VALIDATED
      );
      expect(await escrow.getCampaignState(c2.id)).to.equal(
        CampaignState.FROZEN
      );
    });
  });
});
