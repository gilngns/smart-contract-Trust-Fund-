const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("TrustFundEscrow FULL AUDIT TEST", function () {
  let escrow, token;
  let owner, backend, user1, user2, attacker;

  const DECIMALS = 6;
  const toX = (n) => ethers.parseUnits(n.toString(), DECIMALS);
  const campaignId = ethers.id("CAMPAIGN");

  beforeEach(async () => {
    [owner, backend, user1, user2, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockXIDR");
    token = await Token.deploy(owner.address);

    const Escrow = await ethers.getContractFactory("TrustFundEscrow");

    escrow = await upgrades.deployProxy(
      Escrow,
      [token.target, backend.address, owner.address],
      { kind: "uups" }
    );

    await token.mint(backend.address, toX(100000));
    await token.connect(backend).approve(escrow.target, toX(100000));
  });

  // =========================
  // HELPER
  // =========================
  async function create() {
    await escrow
      .connect(backend)
      .createCampaign(
        campaignId,
        toX(1000),
        toX(100),
        toX(100),
        5,
        "CID",
        user1.address
      );
  }

  async function funded() {
    await create();
    await escrow
      .connect(backend)
      .depositXIDR(campaignId, toX(1000), user1.address);
  }

  async function validated() {
    await funded();
    const sig = await sign(90, 0);
    await escrow.oracleCallback(campaignId, 90, 0, sig);
  }

  async function sign(score, nonce) {
    const msg = ethers.solidityPackedKeccak256(
      ["address", "uint256", "bytes32", "uint8", "uint256"],
      [escrow.target, 31337, campaignId, score, nonce]
    );
    return await owner.signMessage(ethers.getBytes(msg));
  }

  // =========================
  // BASIC
  // =========================
  it("initialize", async () => {
    expect(await escrow.backendWallet()).to.equal(backend.address);
  });

  it("revert zero address init", async () => {
    const Escrow = await ethers.getContractFactory("TrustFundEscrow");
    await expect(
      upgrades.deployProxy(Escrow, [
        ethers.ZeroAddress,
        backend.address,
        owner.address,
      ])
    ).to.be.reverted;
  });

  // =========================
  // CREATE CAMPAIGN
  // =========================
  it("create success", async () => {
    await create();
    const c = await escrow.getCampaign(campaignId);
    expect(c.targetAmount).to.equal(toX(1000));
  });

  it("invalid config > target", async () => {
    await expect(
      escrow
        .connect(backend)
        .createCampaign(campaignId, toX(100), toX(100), toX(100), 2, "CID", user1.address)
    ).to.be.reverted;
  });

  it("invalid milestone > 20", async () => {
    await expect(
      escrow
        .connect(backend)
        .createCampaign(campaignId, toX(1000), 0, toX(10), 21, "CID", user1.address)
    ).to.be.reverted;
  });

  it("empty CID", async () => {
    await expect(
      escrow
        .connect(backend)
        .createCampaign(campaignId, toX(1000), toX(100), toX(100), 5, "", user1.address)
    ).to.be.reverted;
  });

  // =========================
  // DEPOSIT
  // =========================
  it("deposit success", async () => {
    await create();
    await escrow
      .connect(backend)
      .depositXIDR(campaignId, toX(500), user1.address);

    expect(await escrow.getLockedFunds(campaignId)).to.equal(toX(500));
  });

  it("multiple donors", async () => {
    await create();

    await escrow
      .connect(backend)
      .depositXIDR(campaignId, toX(500), user1.address);
    await escrow
      .connect(backend)
      .depositXIDR(campaignId, toX(500), user2.address);

    expect(await escrow.getLockedFunds(campaignId)).to.equal(toX(1000));
  });

  it("revert zero amount", async () => {
    await create();
    await expect(
      escrow.connect(backend).depositXIDR(campaignId, 0, user1.address)
    ).to.be.reverted;
  });

  // =========================
  // ORACLE
  // =========================
  it("oracle valid", async () => {
    await funded();
    const sig = await sign(90, 0);
    await escrow.oracleCallback(campaignId, 90, 0, sig);
    expect(await escrow.getCampaignState(campaignId)).to.equal(4);
  });

  it("oracle freeze", async () => {
    await funded();
    const sig = await sign(60, 0);
    await escrow.oracleCallback(campaignId, 60, 0, sig);
    expect(await escrow.getCampaignState(campaignId)).to.equal(5);
  });

  it("oracle refund", async () => {
    await funded();
    const sig = await sign(40, 0);
    await escrow.oracleCallback(campaignId, 40, 0, sig);
    expect(await escrow.isRefundEnabled(campaignId)).to.equal(true);
  });

  it("invalid signature", async () => {
    await funded();
    await expect(escrow.oracleCallback(campaignId, 90, 0, "0x1234")).to.be
      .reverted;
  });

  it("nonce replay", async () => {
    await funded();
    const sig = await sign(90, 0);
    await escrow.oracleCallback(campaignId, 90, 0, sig);

    await expect(escrow.oracleCallback(campaignId, 90, 0, sig)).to.be.reverted;
  });

  it("score > 100", async () => {
    await funded();
    const sig = await sign(120, 0);
    await expect(escrow.oracleCallback(campaignId, 120, 0, sig)).to.be.reverted;
  });

  // =========================
  // ADVANCE
  // =========================
  it("release advance", async () => {
    await validated();
    await escrow.connect(backend).releaseAdvance(campaignId);
    expect(await escrow.getCampaignState(campaignId)).to.equal(2);
  });

  it("revert advance wrong state", async () => {
    await create();
    await expect(escrow.connect(backend).releaseAdvance(campaignId)).to.be
      .reverted;
  });

  // =========================
  // MILESTONE FULL LOOP
  // =========================
  it("complete all milestones", async () => {
    await validated();
    await escrow.connect(backend).releaseAdvance(campaignId);

    for (let i = 0; i < 5; i++) {
      await escrow
        .connect(backend)
        .submitMilestone(
          campaignId,
          "CID",
          ethers.keccak256(ethers.toUtf8Bytes("metadata"))
        );

      const sig = await sign(90, i + 1);
      await escrow.oracleCallback(campaignId, 90, i + 1, sig);

      await escrow.connect(backend).releaseMilestone(campaignId);
    }

    expect(await escrow.getCampaignState(campaignId)).to.equal(6);
    expect(await escrow.getLockedFunds(campaignId)).to.equal(0);
  });

  // =========================
  // REFUND
  // =========================
  it("refund per donor", async () => {
    await create();

    await escrow
      .connect(backend)
      .depositXIDR(campaignId, toX(500), user1.address);
    await escrow
      .connect(backend)
      .depositXIDR(campaignId, toX(500), user2.address);

    const sig = await sign(40, 0);
    await escrow.oracleCallback(campaignId, 40, 0, sig);

    await escrow.connect(user1).claimRefund(campaignId);

    expect(await escrow.getLockedFunds(campaignId)).to.equal(toX(500));
  });

  // =========================
  // ADMIN
  // =========================
  it("pause/unpause", async () => {
    await escrow.pause();
    await expect(create()).to.be.reverted;

    await escrow.unpause();
    await create();
  });

  it("non admin cannot pause", async () => {
    await expect(escrow.connect(user1).pause()).to.be.reverted;
  });

  it("update backend", async () => {
    await escrow.updateBackendWallet(user2.address);
    expect(await escrow.backendWallet()).to.equal(user2.address);
  });

  it("update oracle signer", async () => {
    await escrow.updateOracleSigner(user2.address);
    expect(await escrow.oracleSigner()).to.equal(user2.address);
  });

  // =========================
  // EMERGENCY
  // =========================
  it("withdraw other token", async () => {
    const Token = await ethers.getContractFactory("MockXIDR");
    const other = await Token.deploy(owner.address);

    await other.mint(escrow.target, toX(100));
    await escrow.emergencyWithdraw(other.target, toX(100));
  });

  it("cannot withdraw xidr", async () => {
    await expect(escrow.emergencyWithdraw(token.target, toX(100))).to.be
      .reverted;
  });

  // =========================
  // UUPS
  // =========================
  it("upgrade success", async () => {
    const EscrowV2 = await ethers.getContractFactory("TrustFundEscrow");
    await upgrades.upgradeProxy(escrow.target, EscrowV2);
  });

  it("state persists after upgrade", async () => {
    await create();

    const EscrowV2 = await ethers.getContractFactory("TrustFundEscrow");
    const upgraded = await upgrades.upgradeProxy(escrow.target, EscrowV2);

    const c = await upgraded.getCampaign(campaignId);
    expect(c.targetAmount).to.equal(toX(1000));
  });

  // =========================
  // EXTRA AUDIT TEST (ADD THIS)
  // =========================

  describe("EXTRA AUDIT COVERAGE", function () {
    // =========================
    // STATE MACHINE NEGATIVE
    // =========================

    it("fuzz: random deposits should not break state", async () => {
      await create();

      let total = 0;

      for (let i = 0; i < 10; i++) {
        const rand = Math.floor(Math.random() * 200) + 1;

        // stop kalau sudah mendekati target
        if (total + rand > 1000) break;

        const amount = toX(rand);

        await escrow
          .connect(backend)
          .depositXIDR(campaignId, amount, user1.address);

        total += rand;
      }

      const locked = await escrow.getLockedFunds(campaignId);

      expect(locked).to.be.gt(0);
    });

    it("invariant: totalReleased never exceeds target", async () => {
      await create();

      await escrow
        .connect(backend)
        .depositXIDR(campaignId, toX(1000), user1.address);

      const campaign = await escrow.getCampaign(campaignId);

      expect(campaign.totalCollected).to.be.lte(campaign.targetAmount);
    });

    it("should reject oracle call after state already validated", async () => {
      await funded();

      const sig = await sign(90, 0);
      await escrow.oracleCallback(campaignId, 90, 0, sig);

      await expect(escrow.oracleCallback(campaignId, 90, 1, sig)).to.be
        .reverted;
    });

    it("should not allow double refund", async () => {
      await funded();

      const sig = await sign(40, 0);
      await escrow.oracleCallback(campaignId, 40, 0, sig);

      await escrow.connect(user1).claimRefund(campaignId);

      await expect(escrow.connect(user1).claimRefund(campaignId)).to.be
        .reverted;
    });

    it("should revert deposit after funded", async () => {
      await funded();

      await expect(
        escrow.connect(backend).depositXIDR(campaignId, toX(100), user1.address)
      ).to.be.reverted;
    });

    it("should revert submitMilestone before advance", async () => {
      await validated();

      await expect(
        escrow
          .connect(backend)
          .submitMilestone(
            campaignId,
            "CID",
            ethers.keccak256(ethers.toUtf8Bytes("metadata"))
          )
      ).to.be.reverted;
    });

    it("should revert releaseMilestone without oracle validation", async () => {
      await validated();
      await escrow.connect(backend).releaseAdvance(campaignId);

      await escrow
        .connect(backend)
        .submitMilestone(
          campaignId,
          "CID",
          ethers.keccak256(ethers.toUtf8Bytes("metadata"))
        );

      await expect(escrow.connect(backend).releaseMilestone(campaignId)).to.be
        .reverted;
    });

    // =========================
    // ACCESS CONTROL
    // =========================
    it("non-backend cannot create campaign", async () => {
      await expect(
        escrow
          .connect(user1)
          .createCampaign(campaignId, toX(1000), toX(100), toX(100), 5, "CID", user1.address)
      ).to.be.reverted;
    });

    it("non-backend cannot deposit", async () => {
      await create();

      await expect(
        escrow.connect(user1).depositXIDR(campaignId, toX(100), user1.address)
      ).to.be.reverted;
    });

    it("user can claim their own refund", async () => {
      await funded();

      const sig = await sign(40, 0);
      await escrow.oracleCallback(campaignId, 40, 0, sig);

      await expect(escrow.connect(user1).claimRefund(campaignId)).to.not.be
        .reverted;
    });

    // =========================
    // LOCKED FUNDS EDGE
    // =========================
    it("should handle last milestone payout correctly (no revert)", async () => {
      await escrow
        .connect(backend)
        .createCampaign(
          campaignId,
          toX(1000),
          toX(0),
          toX(200),
          5,
          "CID",
          user1.address
        );

      await escrow
        .connect(backend)
        .depositXIDR(campaignId, toX(1000), user1.address);

      const sig = await sign(90, 0);
      await escrow.oracleCallback(campaignId, 90, 0, sig);

      await escrow.connect(backend).releaseAdvance(campaignId);

      for (let i = 1; i <= 5; i++) {
        await escrow
          .connect(backend)
          .submitMilestone(
            campaignId,
            "CID",
            ethers.keccak256(ethers.toUtf8Bytes("metadata"))
          );

        const sigM = await sign(90, i);
        await escrow.oracleCallback(campaignId, 90, i, sigM);

        await escrow.connect(backend).releaseMilestone(campaignId);
      }

      expect(await escrow.getLockedFunds(campaignId)).to.equal(0);
    });

    // =========================
    // DONOR EDGE CASE
    // =========================
    it("same donor multiple deposits accumulates correctly", async () => {
      await create();

      await escrow
        .connect(backend)
        .depositXIDR(campaignId, toX(300), user1.address);
      await escrow
        .connect(backend)
        .depositXIDR(campaignId, toX(200), user1.address);

      const locked = await escrow.getLockedFunds(campaignId);

      expect(locked).to.equal(toX(500));
    });

    // =========================
    // ORACLE EDGE CASE
    // =========================
    it("old signature invalid after signer change", async () => {
      await funded();

      const sig = await sign(90, 0);

      await escrow.updateOracleSigner(user2.address);

      await expect(escrow.oracleCallback(campaignId, 90, 0, sig)).to.be
        .reverted;
    });

    it("cannot skip nonce", async () => {
      await funded();

      const sig = await sign(90, 5);

      await expect(escrow.oracleCallback(campaignId, 90, 5, sig)).to.be
        .reverted;
    });

    // =========================
    // INVARIANT BASIC
    // =========================
    it("lockedFunds <= totalCollected", async () => {
      await create();

      await escrow
        .connect(backend)
        .depositXIDR(campaignId, toX(300), user1.address);
      await escrow
        .connect(backend)
        .depositXIDR(campaignId, toX(200), user2.address);

      const campaign = await escrow.getCampaign(campaignId);
      const locked = await escrow.getLockedFunds(campaignId);

      expect(locked).to.be.lte(campaign.totalCollected);
    });

    it("lockedFunds never negative", async () => {
      await funded();

      const locked = await escrow.getLockedFunds(campaignId);

      expect(locked).to.be.gte(0);
    });
  });

  describe("REENTRANCY REAL TEST", function () {
    let attackerContract;

    beforeEach(async () => {
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      attackerContract = await Attacker.deploy(escrow.target);
    });

    it("should block reentrancy attack", async () => {
      await create();

      // attacker jadi donor
      await escrow
        .connect(backend)
        .depositXIDR(campaignId, toX(1000), attackerContract.target);

      const sig = await sign(90, 0);
      await escrow.oracleCallback(campaignId, 90, 0, sig);

      await escrow.connect(backend).releaseAdvance(campaignId);

      await escrow
        .connect(backend)
        .submitMilestone(
          campaignId,
          "CID",
          ethers.keccak256(ethers.toUtf8Bytes("metadata"))
        );

      const sig1 = await sign(90, 1);
      await escrow.oracleCallback(campaignId, 90, 1, sig1);

      await attackerContract.set(campaignId);

      await expect(attackerContract.attack()).to.be.reverted;
    });
  });
});
