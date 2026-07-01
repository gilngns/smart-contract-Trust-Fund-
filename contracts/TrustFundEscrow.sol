// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TrustFundEscrow is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    using MessageHashUtils for bytes32;

    bytes32 public constant BACKEND_ROLE = keccak256("BACKEND_ROLE");

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    enum CampaignState {
        ACTIVE,
        FUNDED,
        ADVANCE_PAID,
        MILESTONE_SUBMITTED,
        VALIDATED,
        FROZEN,
        COMPLETED
    }

    struct Campaign {
        bytes32 campaignId;
        uint128 targetAmount;
        uint128 totalCollected;
        uint128 milestoneAmount;
        uint128 advanceAmount;
        uint32 createdAt;
        uint8 totalMilestones;
        uint8 currentMilestone;
        CampaignState state;
        bool advanceReleased;
        address beneficiary;
    }

    struct EvidenceMetadata {
        bytes32 metadataHash;
    }

    IERC20 public xidr;

    using ECDSA for bytes32;

    address public backendWallet;

    address public oracleSigner;

    mapping(bytes32 => mapping(uint8 => bytes32)) public evidenceMetadataHash;

    mapping(bytes32 => Campaign) private campaigns;

    mapping(bytes32 => uint256) public lockedFunds;

    mapping(bytes32 => bool) public refundEnabled;

    mapping(bytes32 => uint256) public oracleNonces;

    mapping(bytes32 => string) public rabCID;

    mapping(bytes32 => mapping(uint8 => string)) public milestoneEvidenceCID;

    uint256 private _reentrancyStatus;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(
            _reentrancyStatus != _ENTERED,
            "ReentrancyGuard: reentrant call"
        );
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    event CampaignCreated(
        bytes32 indexed campaignId,
        uint256 targetAmount,
        uint8 totalMilestones
    );

    event RefundEnabled(bytes32 campaignId);

    event EvidenceSubmitted(
        bytes32 campaignId,
        uint8 milestone,
        string cid,
        bytes32 metadataHash
    );

    event EmergencyWithdraw(address token, uint256 amount);

    event FundsDeposited(
        bytes32 indexed campaignId,
        uint256 amount,
        uint256 totalCollected,
        bool isFunded
    );

    event OracleValidated(
        bytes32 indexed campaignId,
        uint8 milestone,
        bool validated,
        uint8 score
    );

    event AdvanceReleased(
        bytes32 indexed campaignId,
        uint256 amount,
        address recipient
    );

    event MilestoneSubmitted(bytes32 indexed campaignId, uint8 milestone);

    event MilestoneReleased(
        bytes32 indexed campaignId,
        uint8 milestone,
        uint256 amount,
        address recipient,
        bool isCompleted
    );

    event CampaignStateChanged(
        bytes32 indexed campaignId,
        CampaignState oldState,
        CampaignState newState
    );

    event RefundTriggered(
        bytes32 indexed campaignId,
        uint256 amount,
        address recipient
    );

    event BackendWalletUpdated(address oldWallet, address newWallet);

    error CampaignAlreadyExists(bytes32 campaignId);
    error CampaignNotFound(bytes32 campaignId);
    error InvalidState(
        bytes32 campaignId,
        CampaignState current,
        CampaignState required
    );
    error InvalidAmount(uint256 provided, string reason);
    error InvalidMilestoneConfig(string reason);
    error ZeroAddress();
    error TransferFailed();
    error InsufficientLockedFunds(
        bytes32 campaignId,
        uint256 available,
        uint256 requested
    );
    error MilestoneAlreadyCompleted(bytes32 campaignId);

    modifier campaignExists(bytes32 campaignId) {
        if (campaigns[campaignId].createdAt == 0) {
            revert CampaignNotFound(campaignId);
        }
        _;
    }

    modifier inState(bytes32 campaignId, CampaignState expected) {
        CampaignState current = campaigns[campaignId].state;
        if (current != expected) {
            revert InvalidState(campaignId, current, expected);
        }
        _;
    }

    function initialize(
        address _xidrToken,
        address _backendWallet,
        address _admin
    ) external initializer {
        if (
            _xidrToken == address(0) ||
            _backendWallet == address(0) ||
            _admin == address(0)
        ) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        __Pausable_init();
        _reentrancyStatus = _NOT_ENTERED;

        xidr = IERC20(_xidrToken);
        backendWallet = _backendWallet;

        oracleSigner = _admin;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
        _grantRole(BACKEND_ROLE, _backendWallet);
    }

    function updateOracleSigner(
        address newSigner
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        oracleSigner = newSigner;
    }

    function verifyOracle(
        bytes32 campaignId,
        uint8 score,
        uint256 nonce,
        bytes memory signature
    ) internal view returns (bool) {
        bytes32 message = keccak256(
            abi.encodePacked(
                address(this),
                block.chainid,
                campaignId,
                score,
                nonce
            )
        ).toEthSignedMessageHash();

        return message.recover(signature) == oracleSigner;
    }

    function createCampaign(
        bytes32 campaignId,
        uint128 targetAmount,
        uint128 advanceAmount,
        uint128 milestoneAmount,
        uint8 totalMilestones,
        string memory _rabCID,
        address beneficiary
    ) external onlyRole(BACKEND_ROLE) whenNotPaused {
        if (bytes(_rabCID).length == 0) {
            revert InvalidAmount(0, "CID required");
        }

        if (beneficiary == address(0)) revert ZeroAddress();

        if (campaigns[campaignId].createdAt != 0) {
            revert CampaignAlreadyExists(campaignId);
        }

        if (targetAmount == 0)
            revert InvalidAmount(targetAmount, "target cannot be zero");
        if (totalMilestones == 0 || totalMilestones > 20) {
            revert InvalidMilestoneConfig("totalMilestones must be 1-20");
        }

        uint256 totalPayout = uint256(advanceAmount) +
            (uint256(milestoneAmount) * totalMilestones);
        if (totalPayout > targetAmount) {
            revert InvalidMilestoneConfig("payout config exceeds targetAmount");
        }

        rabCID[campaignId] = _rabCID;

        if (beneficiary == address(0)) revert ZeroAddress();

        campaigns[campaignId] = Campaign({
            campaignId: campaignId,
            targetAmount: targetAmount,
            totalCollected: 0,
            milestoneAmount: milestoneAmount,
            advanceAmount: advanceAmount,
            createdAt: uint32(block.timestamp),
            totalMilestones: totalMilestones,
            currentMilestone: 0,
            state: CampaignState.ACTIVE,
            advanceReleased: false,
            beneficiary: beneficiary
        });

        totalCampaigns += 1;

        emit CampaignCreated(campaignId, targetAmount, totalMilestones);
    }

    function depositXIDR(
        bytes32 campaignId,
        uint128 amount,
        address donor
    )
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
        nonReentrant
    {
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.state != CampaignState.ACTIVE) {
            revert InvalidState(
                campaignId,
                campaign.state,
                CampaignState.ACTIVE
            );
        }

        if (refundEnabled[campaignId]) {
            revert InvalidState(
                campaignId,
                campaign.state,
                CampaignState.ACTIVE
            );
        }

        if (amount == 0) revert InvalidAmount(amount, "amount cannot be zero");
        if (donor == address(0)) revert ZeroAddress();

        if (xidr.allowance(msg.sender, address(this)) < amount) {
            revert InvalidAmount(amount, "insufficient allowance");
        }

        xidr.safeTransferFrom(msg.sender, address(this), amount);

        contributions[campaignId][donor] += amount;

        if (!isDonor[campaignId][donor]) {
            donors[campaignId].push(donor);
            isDonor[campaignId][donor] = true;
        }

        unchecked {
            campaign.totalCollected += amount;
            lockedFunds[campaignId] += amount;
        }

        bool isFunded = campaign.totalCollected >= campaign.targetAmount;

        if (isFunded) {
            _changeState(campaign, CampaignState.FUNDED);
        }

        emit FundsDeposited(
            campaignId,
            amount,
            campaign.totalCollected,
            isFunded
        );
    }

    function oracleCallback(
        bytes32 campaignId,
        uint8 score,
        uint256 nonce,
        bytes memory signature
    ) external whenNotPaused campaignExists(campaignId) {
        if (nonce != oracleNonces[campaignId]) {
            revert InvalidAmount(nonce, "invalid nonce");
        }

        if (!verifyOracle(campaignId, score, nonce, signature)) {
            revert InvalidAmount(score, "invalid oracle signature");
        }

        if (score > 100) revert InvalidAmount(score, "score must be 0-100");

        oracleNonces[campaignId]++;

        Campaign storage campaign = campaigns[campaignId];

        bool isValidState = (campaign.state == CampaignState.FUNDED ||
            campaign.state == CampaignState.MILESTONE_SUBMITTED);

        if (!isValidState) {
            revert InvalidState(
                campaignId,
                campaign.state,
                CampaignState.FUNDED
            );
        }

        if (score >= 85) {
            _changeState(campaign, CampaignState.VALIDATED);
        } else if (score >= 50) {
            _changeState(campaign, CampaignState.FROZEN);
        } else {
            _changeState(campaign, CampaignState.FROZEN);
            refundEnabled[campaignId] = true;
        }

        emit OracleValidated(
            campaignId,
            campaign.currentMilestone,
            score >= 85,
            score
        );
    }

    function releaseAdvance(
        bytes32 campaignId
    )
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
        inState(campaignId, CampaignState.VALIDATED)
        nonReentrant
    {
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.advanceReleased) {
            revert InvalidMilestoneConfig("advance already released");
        }

        uint256 amount = campaign.advanceAmount;

        if (amount > 0) {
            if (lockedFunds[campaignId] < amount) {
                revert InsufficientLockedFunds(
                    campaignId,
                    lockedFunds[campaignId],
                    amount
                );
            }

            unchecked {
                lockedFunds[campaignId] -= amount;
            }

            xidr.safeTransfer(campaign.beneficiary, amount);

            emit AdvanceReleased(campaignId, amount, campaign.beneficiary);
        }

        campaign.advanceReleased = true;

        _changeState(campaign, CampaignState.ADVANCE_PAID);
    }

    function claimRefund(
        bytes32 campaignId
    ) external nonReentrant campaignExists(campaignId) {
        address donor = msg.sender;

        Campaign storage campaign = campaigns[campaignId];

        if (
            campaign.state != CampaignState.FROZEN || !refundEnabled[campaignId]
        ) {
            revert InvalidState(
                campaignId,
                campaign.state,
                CampaignState.FROZEN
            );
        }

        uint256 userContribution = contributions[campaignId][donor];
        if (userContribution == 0) {
            revert InvalidAmount(0, "no contribution");
        }

        contributions[campaignId][donor] = 0;

        uint256 currentLocked = lockedFunds[campaignId];

        uint256 unrefundedBasis = uint256(campaign.totalCollected) -
            refundedContribution[campaignId];

        uint256 refundAmount = (userContribution * currentLocked) /
            unrefundedBasis;

        if (userContribution >= unrefundedBasis || refundAmount > currentLocked) {
            refundAmount = currentLocked;
        }

        if (refundAmount == 0) {
            revert InvalidAmount(0, "nothing left to refund");
        }

        refundedContribution[campaignId] += userContribution;
        lockedFunds[campaignId] -= refundAmount;

        xidr.safeTransfer(donor, refundAmount);

        emit RefundTriggered(campaignId, refundAmount, donor);

        if (lockedFunds[campaignId] == 0) {
            refundEnabled[campaignId] = false;
            _changeState(campaign, CampaignState.COMPLETED);
        }
    }

    function submitMilestone(
        bytes32 campaignId,
        string memory evidenceCID,
        bytes32 metadataHash
    ) external onlyRole(BACKEND_ROLE) whenNotPaused campaignExists(campaignId) {
        if (metadataHash == bytes32(0)) {
            revert InvalidAmount(0, "metadata hash required");
        }

        if (bytes(evidenceCID).length == 0) {
            revert InvalidAmount(0, "evidence CID required");
        }

        Campaign storage campaign = campaigns[campaignId];

        if (campaign.state != CampaignState.ADVANCE_PAID) {
            revert InvalidState(
                campaignId,
                campaign.state,
                CampaignState.ADVANCE_PAID
            );
        }

        if (campaign.currentMilestone >= campaign.totalMilestones) {
            revert MilestoneAlreadyCompleted(campaignId);
        }

        if (
            bytes(milestoneEvidenceCID[campaignId][campaign.currentMilestone])
                .length != 0
        ) {
            revert InvalidAmount(0, "evidence already submitted");
        }

        milestoneEvidenceCID[campaignId][
            campaign.currentMilestone
        ] = evidenceCID;

        _changeState(campaign, CampaignState.MILESTONE_SUBMITTED);

        evidenceMetadataHash[campaignId][
            campaign.currentMilestone
        ] = metadataHash;

        emit MilestoneSubmitted(campaignId, campaign.currentMilestone);

        emit EvidenceSubmitted(
            campaignId,
            campaign.currentMilestone,
            evidenceCID,
            metadataHash
        );
    }

    function isRefundEnabled(bytes32 campaignId) external view returns (bool) {
        return refundEnabled[campaignId];
    }

    function resolveFrozen(
        bytes32 campaignId,
        bool approve
    ) external onlyRole(BACKEND_ROLE) campaignExists(campaignId) {
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.state != CampaignState.FROZEN) {
            revert InvalidState(
                campaignId,
                campaign.state,
                CampaignState.FROZEN
            );
        }

        if (approve) {
            _changeState(campaign, CampaignState.VALIDATED);
        } else {
            refundEnabled[campaignId] = true;

            emit RefundEnabled(campaignId);
        }
    }

    function releaseMilestone(
        bytes32 campaignId
    )
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
        inState(campaignId, CampaignState.VALIDATED)
        nonReentrant
    {
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.currentMilestone >= campaign.totalMilestones) {
            revert MilestoneAlreadyCompleted(campaignId);
        }

        uint256 amount = campaign.milestoneAmount;

        if (
            campaign.milestoneAmount == 0 &&
            campaign.currentMilestone + 1 < campaign.totalMilestones
        ) {
            revert InvalidAmount(0, "invalid milestone amount");
        }

        bool isLastMilestone = (campaign.currentMilestone + 1) >=
            campaign.totalMilestones;

        if (isLastMilestone) {
            amount = lockedFunds[campaignId];
        }

        if (lockedFunds[campaignId] < amount) {
            revert InsufficientLockedFunds(
                campaignId,
                lockedFunds[campaignId],
                amount
            );
        }

        uint8 releasedMilestone;
        unchecked {
            lockedFunds[campaignId] -= amount;
            releasedMilestone = campaign.currentMilestone;
            campaign.currentMilestone += 1;
        }

        xidr.safeTransfer(campaign.beneficiary, amount);

        emit MilestoneReleased(
            campaignId,
            releasedMilestone,
            amount,
            campaign.beneficiary,
            isLastMilestone
        );

        if (isLastMilestone) {
            _changeState(campaign, CampaignState.COMPLETED);
        } else {
            _changeState(campaign, CampaignState.ADVANCE_PAID);
        }
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function updateBackendWallet(
        address newWallet
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newWallet == address(0)) revert ZeroAddress();

        address oldWallet = backendWallet;

        _revokeRole(BACKEND_ROLE, oldWallet);
        _grantRole(BACKEND_ROLE, newWallet);

        backendWallet = newWallet;

        emit BackendWalletUpdated(oldWallet, newWallet);
    }

    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(xidr)) {
            revert InvalidAmount(amount, "cannot withdraw campaign funds");
        }

        IERC20(token).safeTransfer(msg.sender, amount);

        emit EmergencyWithdraw(token, amount);
    }

    function getCampaign(
        bytes32 campaignId
    ) external view campaignExists(campaignId) returns (Campaign memory) {
        return campaigns[campaignId];
    }

    function getCampaignState(
        bytes32 campaignId
    ) external view campaignExists(campaignId) returns (CampaignState) {
        return campaigns[campaignId].state;
    }

    function getLockedFunds(
        bytes32 campaignId
    ) external view returns (uint256) {
        return lockedFunds[campaignId];
    }

    function isFullyFunded(
        bytes32 campaignId
    ) external view campaignExists(campaignId) returns (bool) {
        Campaign storage campaign = campaigns[campaignId];
        return campaign.totalCollected >= campaign.targetAmount;
    }

    function _changeState(
        Campaign storage campaign,
        CampaignState newState
    ) internal {
        CampaignState oldState = campaign.state;
        campaign.state = newState;
        emit CampaignStateChanged(campaign.campaignId, oldState, newState);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(UPGRADER_ROLE) {}

    mapping(bytes32 => mapping(address => uint256)) public contributions;
    mapping(bytes32 => address[]) public donors;
    mapping(bytes32 => mapping(address => bool)) private isDonor;

    uint256 public totalCampaigns;

    mapping(bytes32 => uint256) public refundedContribution;

    uint256[49] private __gap;
}
